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

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Initializing TakerOrders component');
            
            // Show connect wallet message if in read-only mode
            if (readOnlyMode || !window.walletManager?.provider) {
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Orders for Me</h2>
                        <p class="connect-prompt">Connect wallet to view orders targeted to you</p>
                    </div>`;
                return;
            }

            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();

            // Get current account
            let userAddress;
            try {
                userAddress = await window.walletManager.getAccount();
            } catch (error) {
                this.debug('Error getting account:', error);
                userAddress = null;
            }

            if (!userAddress) {
                this.debug('No account connected');
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Orders for Me</h2>
                        <p class="connect-prompt">Connect wallet to view orders targeted to you</p>
                    </div>`;
                return;
            }

            // Get initial orders from cache and filter for taker
            const cachedOrders = window.webSocket?.getOrders() || [];
            const filteredOrders = cachedOrders.filter(order => 
                order?.taker && userAddress && 
                order.taker.toLowerCase() === userAddress.toLowerCase()
            );

            // Clear existing orders and add filtered ones
            this.orders.clear();
            if (filteredOrders.length > 0) {
                this.debug('Loading orders from cache:', filteredOrders);
                filteredOrders.forEach(order => {
                    this.orders.set(order.id, order);
                });
            }

            // Create table structure
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                this.debug('Table body not found');
                return;
            }

            if (!filteredOrders.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="no-orders-message">
                            <div class="placeholder-text">
                                No orders found for you
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
            this.container.innerHTML = `
                <div class="tab-content-wrapper">
                    <h2>Orders for Me</h2>
                    <p class="error-message">Failed to load orders. Please try again later.</p>
                </div>`;
        }
    }

    setupWebSocket() {
        // Use parent's debounced refresh mechanism
        const debouncedRefresh = () => {
            this.debouncedRefresh();
        };

        // Clear existing subscriptions before adding new ones
        this.eventSubscriptions.forEach(sub => {
            window.webSocket.unsubscribe(sub.event, sub.callback);
        });
        this.eventSubscriptions.clear();

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
                
                debouncedRefresh();
            }
        });

        // Subscribe to filled/canceled orders
        ['OrderFilled', 'OrderCanceled'].forEach(event => {
            this.eventSubscriptions.add({
                event,
                callback: (order) => {
                    if (this.orders.has(order.id)) {
                        this.debug(`Order ${event.toLowerCase()}:`, order);
                        this.orders.get(order.id).status = event === 'OrderFilled' ? 'Filled' : 'Canceled';
                        debouncedRefresh();
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
        const statusCell = tr.querySelector('.order-status');
        
        if (actionCell && statusCell) {
            try {
                const currentTime = Math.floor(Date.now() / 1000);
                const orderTime = Number(order.timestamp);
                const contract = window.webSocket?.contract;
                
                const orderExpiry = await contract.ORDER_EXPIRY();
                const isExpired = currentTime > orderTime + orderExpiry.toNumber();
                
                if (!isExpired && order.status === 'Active') {
                    actionCell.innerHTML = `
                        <button class="fill-button" data-order-id="${order.id}">Fill Order</button>
                    `;
                    
                    // Add click handler for fill button
                    const fillButton = actionCell.querySelector('.fill-button');
                    if (fillButton) {
                        fillButton.addEventListener('click', () => this.fillOrder(order.id));
                    }
                } else {
                    actionCell.innerHTML = '<span class="order-status"></span>';
                }
            } catch (error) {
                console.error('[TakerOrders] Error in createOrderRow:', error);
                actionCell.innerHTML = '<span class="order-status error">Error</span>';
            }
        }

        return tr;
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
                    const approveTx = await buyToken.connect(window.walletManager.getProvider().getSigner()).approve(
                        this.contract.address,
                        order.buyAmount,
                        {
                            gasLimit: 70000,  // Standard gas limit for ERC20 approvals
                            gasPrice: await window.walletManager.getProvider().getGasPrice()
                        }
                    );
                    
                    this.debug('Approval transaction sent:', approveTx.hash);
                    await approveTx.wait();
                    this.showSuccess('Token approval granted');
                } catch (error) {
                    if (error.code === 4001) { // MetaMask user rejected
                        this.showError('Token approval was rejected');
                        return;
                    }
                    throw error;
                }
            }

            // Estimate gas for filling the order
            let gasLimit;
            try {
                // First try with static call to check if transaction would fail
                await this.contract.callStatic.fillOrder(orderId);

                const gasEstimate = await this.contract.estimateGas.fillOrder(orderId);
                // Add 20% buffer to the estimated gas
                gasLimit = gasEstimate.mul(120).div(100);
                this.debug('Gas estimate with buffer:', gasLimit.toString());
            } catch (error) {
                this.debug('Gas estimation failed:', error);
                gasLimit = ethers.BigNumber.from(300000); // Conservative fallback
                this.debug('Using fallback gas limit:', gasLimit.toString());
            }

            // Fill order with estimated gas limit
            const tx = await this.contract.fillOrder(orderId, {
                gasLimit,
                gasPrice: await window.walletManager.getProvider().getGasPrice()
            });
            
            this.debug('Fill order transaction sent:', tx.hash);
            this.showSuccess('Order fill transaction submitted');
            
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
            this.contract = window.webSocket?.contract;
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Get current account
            const userAddress = await window.walletManager.getAccount();
            if (!userAddress) {
                throw new Error('No wallet connected');
            }

            // Clear existing orders from table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                console.warn('[TakerOrders] Table body not found');
                return;
            }
            tbody.innerHTML = '';

            // Get ALL orders from WebSocket cache without filtering
            const allOrders = window.webSocket?.getOrders() || [];
            
            // Filter orders only by taker address
            let ordersToDisplay = allOrders.filter(order => 
                order?.taker && 
                order.taker.toLowerCase() === userAddress.toLowerCase()
            );

            // Check if we should filter for fillable orders
            const showOnlyFillable = this.container.querySelector('#fillable-orders-toggle')?.checked;
            if (showOnlyFillable) {
                // Filter for fillable orders
                const fillableChecks = await Promise.all(
                    ordersToDisplay.map(async order => {
                        const canFill = await this.canFillOrder(order);
                        return canFill ? order : null;
                    })
                );
                ordersToDisplay = fillableChecks.filter(order => order !== null);
            }

            // Get token details for display
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

            // Check if we have any orders after filtering
            if (!ordersToDisplay.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="no-orders-message">
                            <div class="placeholder-text">
                                No orders found for you
                            </div>
                        </td>
                    </tr>`;
                return;
            }

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
        // Call parent's setupTable to get basic structure
        await super.setupTable();
        
        // Update the filter toggle text to be more specific
        const filterToggleSpan = this.container.querySelector('.filter-toggle span');
        if (filterToggleSpan) {
            filterToggleSpan.textContent = 'Show only fillable orders';
        }

        // Update the table header
        const thead = this.container.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = `
                <th data-sort="id">ID <span class="sort-icon">↕</span></th>
                <th>Buy</th>
                <th>Amount</th>
                <th>Sell</th>
                <th>Amount</th>
                <th>Expires</th>
                <th data-sort="status">Status <span class="sort-icon">↕</span></th>
                <th>Action</th>
            `;

            // Initialize sorting state
            this.sortConfig = {
                column: 'id',
                direction: 'asc'
            };

            // Re-add click handlers for sorting
            thead.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => this.handleSort(th.dataset.sort));
            });
        }
    }

    // Override handleSort to use parent's debouncedRefresh
    handleSort(column) {
        this.debug('Sorting by column:', column);
        
        if (this.sortConfig.column === column) {
            this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortConfig.column = column;
            this.sortConfig.direction = 'asc';
        }

        const headers = this.container.querySelectorAll('th[data-sort]');
        headers.forEach(header => {
            const icon = header.querySelector('.sort-icon');
            if (header.dataset.sort === column) {
                header.classList.add('active-sort');
                icon.textContent = this.sortConfig.direction === 'asc' ? '↑' : '↓';
            } else {
                header.classList.remove('active-sort');
                icon.textContent = '↕';
            }
        });

        // Use parent's debouncedRefresh instead of direct refreshOrdersView call
        this.debouncedRefresh();
    }
}
