import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';
import { isDebugEnabled } from '../config.js';
import { erc20Abi } from '../abi/erc20.js';

export class TakerOrders extends ViewOrders {
    constructor() {
        super('taker-orders');
        
        // Initialize debug logger
        this.debug = (message, ...args) => {
            if (isDebugEnabled('TAKER_ORDERS')) {
                console.log('[TakerOrders]', message, ...args);
            }
        };
    }

    async initialize() {
        try {
            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();
            
            // Wait for WebSocket initialization
            if (!window.webSocket?.isInitialized) {
                this.debug('Waiting for WebSocket initialization...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }

            // Get initial orders from cache and filter for taker
            const userAddress = await window.walletManager.getAccount();
            const cachedOrders = window.webSocket.getOrders()
                .filter(order => order.taker.toLowerCase() === userAddress.toLowerCase());

            if (cachedOrders.length > 0) {
                this.debug('Loading orders from cache:', cachedOrders);
                cachedOrders.forEach(order => {
                    this.orders.set(order.id, order);
                });
            }

            // Always call refreshOrdersView to either show orders or empty state
            const tbody = this.container.querySelector('tbody');
            if (!cachedOrders.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                No orders found where you are the designated taker
                            </div>
                        </td>
                    </tr>`;
            } else {
                await this.refreshOrdersView();
            }

            // Setup WebSocket event handlers after initial load
            this.setupWebSocket();

        } catch (error) {
            console.error('[TakerOrders] Initialization error:', error);
            throw error;
        }
    }

    setupWebSocket() {
        // Subscribe to order sync completion with taker filter
        this.eventSubscriptions.add({
            event: 'orderSyncComplete',
            callback: async (orders) => {
                const userAddress = await window.walletManager.getAccount();
                this.orders.clear();
                
                // Filter orders where user is specifically set as taker
                Object.values(orders)
                    .filter(order => order.taker.toLowerCase() === userAddress.toLowerCase())
                    .forEach(order => {
                        this.orders.set(order.id, order);
                    });
                
                this.refreshOrdersView().catch(error => {
                    this.debug('Error refreshing orders after sync:', error);
                });
            }
        });

        // Subscribe to new orders
        this.eventSubscriptions.add({
            event: 'OrderCreated',
            callback: async (orderData) => {
                const userAddress = await window.walletManager.getAccount();
                if (orderData.taker.toLowerCase() === userAddress.toLowerCase()) {
                    this.debug('New order received:', orderData);
                    this.orders.set(orderData.id, orderData);
                    this.refreshOrdersView().catch(error => {
                        this.debug('Error refreshing after new order:', error);
                    });
                }
            }
        });

        // Subscribe to filled/canceled orders
        ['OrderFilled', 'OrderCanceled'].forEach(event => {
            this.eventSubscriptions.add({
                event,
                callback: (order) => {
                    if (this.orders.has(order.id)) {
                        this.debug(`Order ${event.toLowerCase()}:`, order);
                        this.removeOrderFromTable(order.id);
                    }
                }
            });
        });

        // Register all subscriptions
        this.eventSubscriptions.forEach(sub => {
            window.webSocket.subscribe(sub.event, sub.callback);
        });
    }

    async createOrderRow(order, tokenDetailsMap) {
        const tr = await super.createOrderRow(order, tokenDetailsMap);
        
        // Replace the action column with fill button for active orders
        const actionCell = tr.querySelector('.action-column');
        if (actionCell) {
            const status = this.getOrderStatus(order, this.getExpiryTime(order.timestamp));
            if (status === 'Active') {
                actionCell.innerHTML = `
                    <button class="fill-button" data-order-id="${order.id}">Fill Order</button>
                `;
                
                // Add click handler for fill button
                const fillButton = actionCell.querySelector('.fill-button');
                if (fillButton) {
                    fillButton.addEventListener('click', () => this.fillOrder(order.id));
                }
            } else {
                actionCell.innerHTML = `<span class="order-status status-${status.toLowerCase()}">${status}</span>`;
            }
        }

        return tr;
    }

    isOrderForTaker(order, userAddress) {
        if (!order || !userAddress) return false;
        return order.taker.toLowerCase() === userAddress.toLowerCase();
    }

    // Override fillOrder to add specific handling for taker orders
    async fillOrder(orderId) {
        const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
        try {
            if (button) {
                button.disabled = true;
                button.textContent = 'Filling...';
            }

            const order = this.orders.get(orderId);
            this.debug('Order details:', order);

            // Use ERC20 ABI for token contract
            const buyToken = new ethers.Contract(
                order.buyToken,
                erc20Abi,
                window.walletManager.getProvider()
            );
            
            const userAddress = await window.walletManager.getAccount();
            const balance = await buyToken.balanceOf(userAddress);
            this.debug('Current balance:', balance.toString());
            this.debug('Required amount:', order.buyAmount.toString());

            if (balance.lt(order.buyAmount)) {
                throw new Error(`Insufficient token balance. Have ${ethers.utils.formatEther(balance)}, need ${ethers.utils.formatEther(order.buyAmount)}`);
            }

            // Check allowance using ERC20 contract
            const allowance = await buyToken.allowance(userAddress, this.contract.address);
            this.debug('Current allowance:', allowance.toString());

            if (allowance.lt(order.buyAmount)) {
                this.showSuccess('Requesting token approval...');
                
                try {
                    // Use a default gas limit for approval if estimation fails
                    let gasLimit;
                    try {
                        const approveGasEstimate = await buyToken.estimateGas.approve(
                            this.contract.address,
                            order.buyAmount
                        );
                        gasLimit = Math.floor(approveGasEstimate.toNumber() * 1.2); // 20% buffer
                    } catch (error) {
                        this.debug('Gas estimation failed for approval, using default:', error);
                        gasLimit = 100000; // Default gas limit for ERC20 approvals
                    }

                    const approveTx = await buyToken.connect(window.walletManager.getProvider().getSigner()).approve(
                        this.contract.address,
                        order.buyAmount,
                        {
                            gasLimit,
                            gasPrice: await window.walletManager.getProvider().getGasPrice()
                        }
                    );
                    
                    this.debug('Approval transaction sent:', approveTx.hash);
                    await approveTx.wait();
                    this.showSuccess('Token approval granted');
                } catch (error) {
                    this.debug('Approval failed:', error);
                    throw new Error('Token approval failed. Please try again.');
                }
            }

            // Estimate gas for fillOrder with fallback
            let fillGasLimit;
            try {
                const fillGasEstimate = await this.contract.estimateGas.fillOrder(orderId);
                fillGasLimit = Math.floor(fillGasEstimate.toNumber() * 1.2); // 20% buffer
                this.debug('Fill order gas estimate:', fillGasEstimate.toString());
            } catch (error) {
                this.debug('Gas estimation failed for fill order, using default:', error);
                fillGasLimit = 300000; // Default gas limit for fill orders
            }

            this.debug('Sending fill order transaction with params:', {
                orderId,
                gasLimit: fillGasLimit,
                gasPrice: (await window.walletManager.getProvider().getGasPrice()).toString()
            });

            const tx = await this.contract.fillOrder(orderId, {
                gasLimit: fillGasLimit,
                gasPrice: await window.walletManager.getProvider().getGasPrice()
            });
            
            this.debug('Transaction sent:', tx.hash);
            await tx.wait();
            this.debug('Transaction confirmed');

        } catch (error) {
            this.debug('Fill order error details:', {
                message: error.message,
                code: error.code,
                data: error?.error?.data,
                reason: error?.reason,
                stack: error.stack
            });
            
            let errorMessage = 'Failed to fill order: ';
            
            // Try to decode the error
            if (error?.error?.data) {
                try {
                    const decodedError = this.contract.interface.parseError(error.error.data);
                    errorMessage += `${decodedError.name}: ${decodedError.args}`;
                    this.debug('Decoded error:', decodedError);
                } catch (e) {
                    // If we can't decode the error, fall back to basic messages
                    if (error.code === -32603) {
                        errorMessage += 'Transaction would fail. Check order status and token approvals.';
                    } else {
                        errorMessage += error.message;
                    }
                }
            }
            
            this.showError(errorMessage);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Fill Order';
            }
        }
    }

    async refreshOrdersView() {
        try {
            // Get contract instance first
            this.contract = await this.getContract();
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Clear existing orders from table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                console.warn('[TakerOrders] Table body not found');
                return;
            }
            tbody.innerHTML = '';

            // Get filter state
            const showOnlyFillable = this.container.querySelector('#fillable-orders-toggle')?.checked;

            // Filter orders if necessary
            let ordersToDisplay = Array.from(this.orders.values());
            if (showOnlyFillable) {
                ordersToDisplay = await Promise.all(ordersToDisplay.map(async order => {
                    const status = this.getOrderStatus(order, this.getExpiryTime(order.timestamp));
                    return status === 'Active' ? order : null;
                }));
                ordersToDisplay = ordersToDisplay.filter(order => order !== null);
            }

            // Check if we have any orders after filtering
            if (!ordersToDisplay || ordersToDisplay.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyFillable ? 'No fillable orders found' : 'No orders found where you are the designated taker'}
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            // Rest of your existing refreshOrdersView code...
            const tokenAddresses = new Set();
            ordersToDisplay.forEach(order => {
                if (order?.sellToken) tokenAddresses.add(order.sellToken.toLowerCase());
                if (order?.buyToken) tokenAddresses.add(order.buyToken.toLowerCase());
            });

            const tokenDetails = await this.getTokenDetails(Array.from(tokenAddresses));
            const tokenDetailsMap = new Map();
            Array.from(tokenAddresses).forEach((address, index) => {
                if (tokenDetails[index]) {
                    tokenDetailsMap.set(address, tokenDetails[index]);
                }
            });

            // Create and append order rows
            for (const order of ordersToDisplay) {
                try {
                    const orderWithLowercase = {
                        ...order,
                        sellToken: order.sellToken.toLowerCase(),
                        buyToken: order.buyToken.toLowerCase()
                    };
                    const row = await this.createOrderRow(orderWithLowercase, tokenDetailsMap);
                    if (row) {
                        tbody.appendChild(row);
                    }
                } catch (error) {
                    console.error('[TakerOrders] Error creating row for order:', order.id, error);
                }
            }

        } catch (error) {
            this.debug('Error refreshing orders view:', error);
            throw error;
        }
    }

    async setupTable() {
        const tableContainer = this.createElement('div', 'table-container');
        
        // Add filter controls
        const filterControls = this.createElement('div', 'filter-controls');
        filterControls.innerHTML = `
            <label class="filter-toggle">
                <input type="checkbox" id="fillable-orders-toggle">
                <span>Show only fillable orders</span>
            </label>
        `;
        
        // Add event listener for the toggle
        const toggle = filterControls.querySelector('#fillable-orders-toggle');
        toggle.addEventListener('change', () => this.refreshOrdersView());
        
        tableContainer.appendChild(filterControls);
        
        // Add table
        const table = this.createElement('table', 'orders-table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Sell</th>
                    <th>Amount</th>
                    <th>Buy</th>
                    <th>Amount</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Taker</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        
        tableContainer.appendChild(table);
        this.container.appendChild(tableContainer);
    }
}
