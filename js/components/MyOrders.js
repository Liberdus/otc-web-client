import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
    }

    async initialize() {
        try {
            console.log('[MyOrders] Starting initialization...');
            // Cleanup previous state
            this.cleanup();
            console.log('[MyOrders] Container HTML before clear:', this.container.innerHTML);
            this.container.innerHTML = '';
            
            await this.setupTable();
            console.log('[MyOrders] Table setup complete');
            
            // Wait for WebSocket initialization (reusing parent class method)
            if (!window.webSocket?.isInitialized) {
                console.log('[MyOrders] Waiting for WebSocket initialization...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }

            // Subscribe to order events
            this.setupWebSocket();

            // Get initial orders from cache and filter for user
            const userAddress = await window.walletManager.getAccount();
            const cachedOrders = window.webSocket.getOrders()
                .filter(order => order.maker.toLowerCase() === userAddress.toLowerCase());

            if (cachedOrders.length > 0) {
                console.log('[MyOrders] Loading orders from cache:', cachedOrders);
                cachedOrders.forEach(order => {
                    this.orders.set(order.id, order);
                });
                await this.refreshOrdersView();
            }

        } catch (error) {
            console.error('[MyOrders] Initialization error:', error);
            throw error;
        }
    }

    setupWebSocket() {
        // Subscribe to order sync completion with user filter
        this.eventSubscriptions.add({
            event: 'orderSyncComplete',
            callback: async (orders) => {
                const userAddress = await window.walletManager.getAccount();
                this.orders.clear();
                
                Object.values(orders)
                    .filter(order => order.maker.toLowerCase() === userAddress.toLowerCase())
                    .forEach(order => {
                        this.orders.set(order.id, order);
                    });
                
                this.refreshOrdersView().catch(error => {
                    console.error('[MyOrders] Error refreshing orders after sync:', error);
                });
            }
        });

        // Subscribe to new orders
        this.eventSubscriptions.add({
            event: 'OrderCreated',
            callback: async (orderData) => {
                const userAddress = await window.walletManager.getAccount();
                if (orderData.maker.toLowerCase() === userAddress.toLowerCase()) {
                    console.log('[MyOrders] New order received:', orderData);
                    this.orders.set(orderData.id, orderData);
                    this.refreshOrdersView().catch(error => {
                        console.error('[MyOrders] Error refreshing after new order:', error);
                    });
                }
            }
        });

        // Subscribe to filled/canceled orders
        ['OrderFilled', 'OrderCanceled'].forEach(event => {
            this.eventSubscriptions.add({
                event,
                callback: (order) => {
                    console.log(`[MyOrders] Order ${event.toLowerCase()}:`, order);
                    if (this.orders.has(order.id)) {
                        this.orders.get(order.id).status = event === 'OrderFilled' ? 'Filled' : 'Canceled';
                        this.refreshOrdersView().catch(error => {
                            console.error('[MyOrders] Error refreshing after order status change:', error);
                        });
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
        
        // Replace the action column based on order status
        const actionCell = tr.querySelector('td.action-column');
        if (actionCell) {
            const status = this.getOrderStatus(order, this.getExpiryTime(order.timestamp));
            
            if (status === 'Active') {
                actionCell.innerHTML = `
                    <button class="cancel-button" data-order-id="${order.id}">Cancel</button>
                `;
                
                // Add click handler for cancel button
                const cancelButton = actionCell.querySelector('.cancel-button');
                if (cancelButton) {
                    cancelButton.addEventListener('click', () => this.cancelOrder(order.id));
                }
            } else {
                actionCell.innerHTML = `<span class="order-status status-${status.toLowerCase()}">${status}</span>`;
            }
        }

        return tr;
    }

    async cancelOrder(orderId) {
        try {
            // Find the button first using container instead of tbody
            const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
            if (button) {
                button.disabled = true;
                button.textContent = 'Canceling...';
            }

            // Get the contract instance and cancel the order
            const contract = await this.getContract();
            const tx = await contract.cancelOrder(orderId);
            await tx.wait();

            // Success message
            this.showSuccess('Order canceled successfully');
            
            // Note: The order will be removed from the table when we receive the
            // OrderCanceled event through WebSocket
        } catch (error) {
            console.error('[MyOrders] Error canceling order:', error);
            this.showError('Failed to cancel order');
            
            // Reset button state on error
            const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
            if (button) {
                button.disabled = false;
                button.textContent = 'Cancel';
            }
        }
    }
}