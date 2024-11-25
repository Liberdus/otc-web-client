import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class TakerOrders extends ViewOrders {
    constructor() {
        super('taker-orders');
    }

    async initialize() {
        try {
            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();
            
            // Wait for WebSocket initialization
            if (!window.webSocket?.isInitialized) {
                console.log('[TakerOrders] Waiting for WebSocket initialization...');
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
                console.log('[TakerOrders] Loading orders from cache:', cachedOrders);
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
                    console.error('[TakerOrders] Error refreshing orders after sync:', error);
                });
            }
        });

        // Subscribe to new orders
        this.eventSubscriptions.add({
            event: 'OrderCreated',
            callback: async (orderData) => {
                const userAddress = await window.walletManager.getAccount();
                if (orderData.taker.toLowerCase() === userAddress.toLowerCase()) {
                    console.log('[TakerOrders] New order received:', orderData);
                    this.orders.set(orderData.id, orderData);
                    this.refreshOrdersView().catch(error => {
                        console.error('[TakerOrders] Error refreshing after new order:', error);
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
                        console.log(`[TakerOrders] Order ${event.toLowerCase()}:`, order);
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
        try {
            const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
            if (button) {
                button.disabled = true;
                button.textContent = 'Filling...';
            }

            await super.fillOrder(orderId);

        } catch (error) {
            console.error('[TakerOrders] Fill order error:', error);
            this.showError('Failed to fill order');
            
            // Reset button state
            const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
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
                console.log('[TakerOrders] No orders to display');
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

            console.log('[TakerOrders] Getting details for tokens:', Array.from(tokenAddresses));
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
            console.error('[TakerOrders] Error refreshing orders view:', error);
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
