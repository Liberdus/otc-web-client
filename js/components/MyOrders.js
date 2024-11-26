import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';
import { isDebugEnabled } from '../config.js';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
        
        // Initialize debug logger
        this.debug = (message, ...args) => {
            if (isDebugEnabled('MY_ORDERS')) {
                console.log('[MyOrders]', message, ...args);
            }
        };
    }

    async initialize() {
        try {
            this.debug('Starting initialization...');
            // Cleanup previous state
            this.cleanup();
            this.debug('Container HTML before clear:', this.container.innerHTML);
            this.container.innerHTML = '';
            
            await this.setupTable();
            this.debug('Table setup complete');
            
            // Wait for WebSocket initialization (reusing parent class method)
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

            // Subscribe to order events
            this.setupWebSocket();

            // Get initial orders from cache and filter for user
            const userAddress = await window.walletManager.getAccount();
            const cachedOrders = window.webSocket.getOrders()
                .filter(order => order.maker.toLowerCase() === userAddress.toLowerCase());

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
                                No orders found where you are the maker
                            </div>
                        </td>
                    </tr>`;
            } else {
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
                    this.debug('New order received:', orderData);
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
                    this.debug(`Order ${event.toLowerCase()}:`, order);
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

    async cancelOrder(orderId) {
        try {
            // Find the button first using container instead of tbody
            const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
            if (button) {
                button.disabled = true;
                button.textContent = 'Canceling...';
            }

            this.debug('Canceling order:', orderId);
            // Get the contract instance and cancel the order
            const contract = await this.getContract();
            const tx = await contract.cancelOrder(orderId);
            this.debug('Cancel transaction submitted:', tx.hash);
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

    async createOrderRow(order, tokenDetailsMap) {
        const tr = this.createElement('tr');
        tr.dataset.orderId = order.id.toString();

        const sellTokenDetails = tokenDetailsMap.get(order.sellToken);
        const buyTokenDetails = tokenDetailsMap.get(order.buyToken);
        const expiryTime = this.getExpiryTime(order.timestamp);
        const status = this.getOrderStatus(order, expiryTime);

        // Format taker display
        const takerDisplay = order.taker === ethers.constants.AddressZero 
            ? '<span class="open-order">Open to All</span>'
            : `<span class="targeted-order" title="${order.taker}">Specific Taker</span>`;

        tr.innerHTML = `
            <td>${order.id}</td>
            <td>${sellTokenDetails?.symbol || 'Unknown'}</td>
            <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails?.decimals || 18)}</td>
            <td>${buyTokenDetails?.symbol || 'Unknown'}</td>
            <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails?.decimals || 18)}</td>
            <td>${this.formatTimestamp(order.timestamp)}</td>
            <td>${this.formatExpiry(order.timestamp)}</td>
            <td class="order-status">${status}</td>
            <td class="taker-column">${takerDisplay}</td>
            <td class="action-column">
                ${status === 'Active' ? 
                    `<button class="cancel-button" data-order-id="${order.id}">Cancel</button>` : 
                    '<span class="order-completed">Completed</span>'
                }
            </td>`;

        // Add click handler for cancel button
        const cancelButton = tr.querySelector('.cancel-button');
        if (cancelButton) {
            cancelButton.addEventListener('click', () => this.cancelOrder(order.id));
        }

        return tr;
    }
}