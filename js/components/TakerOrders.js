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
                throw new Error(`Insufficient token allowance. Need ${ethers.utils.formatEther(order.buyAmount.sub(allowance))} more tokens approved.`);
            }

            // Add gas buffer to estimation
            const gasEstimate = await this.contract.estimateGas.fillOrder(orderId);
            this.debug('Estimated gas:', gasEstimate.toString());
            
            // Add transaction overrides
            const tx = await this.contract.fillOrder(orderId, {
                gasLimit: Math.floor(gasEstimate.toNumber() * 1.2), // 20% buffer
                gasPrice: await window.walletManager.getProvider().getGasPrice()
            });
            
            this.debug('Transaction sent:', tx.hash);
            await tx.wait();
            this.debug('Transaction confirmed');

        } catch (error) {
            this.debug('Fill order error details:', {
                message: error.message,
                code: error.code,
                data: error?.error?.data, // Capture internal error data
                reason: error?.reason,    // Capture revert reason
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

            // Check if we have any orders
            if (!this.orders || this.orders.size === 0) {
                this.debug('No orders to display');
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                No orders found where you are the designated taker
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            // Get token details for all tokens in orders
            const tokenAddresses = new Set();
            this.orders.forEach(order => {
                if (order?.sellToken) tokenAddresses.add(order.sellToken.toLowerCase());
                if (order?.buyToken) tokenAddresses.add(order.buyToken.toLowerCase());
            });

            this.debug('Getting details for tokens:', Array.from(tokenAddresses));
            const tokenDetails = await this.getTokenDetails(Array.from(tokenAddresses));
            
            const tokenDetailsMap = new Map();
            Array.from(tokenAddresses).forEach((address, index) => {
                if (tokenDetails[index]) {
                    tokenDetailsMap.set(address, tokenDetails[index]);
                }
            });

            // Create and append order rows
            for (const order of this.orders.values()) {
                try {
                    // Ensure order token addresses are lowercase when looking up details
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
        this.container.innerHTML = `
            <div class="table-container">
                <table class="orders-table">
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
                </table>
            </div>
        `;
    }
}
