import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { ContractError, CONTRACT_ERRORS } from '../errors/ContractErrors.js';

export class ViewOrders extends BaseComponent {
    constructor(containerId = 'view-orders') {
        super(containerId);
        this.orders = new Map();
        this.tokenCache = new Map();
        this.provider = new ethers.providers.Web3Provider(window.ethereum);
        this.setupErrorHandling();
        this.eventSubscriptions = new Set();
    }

    setupErrorHandling() {
        if (!window.webSocket) {
            console.log('[ViewOrders] WebSocket not available for error handling, retrying in 1s...');
            setTimeout(() => this.setupErrorHandling(), 1000);
            return;
        }

        window.webSocket.subscribe('error', (error) => {
            let userMessage = 'An error occurred';
            
            if (error instanceof ContractError) {
                switch(error.code) {
                    case CONTRACT_ERRORS.INVALID_ORDER.code:
                        userMessage = 'This order no longer exists';
                        break;
                    case CONTRACT_ERRORS.INSUFFICIENT_ALLOWANCE.code:
                        userMessage = 'Please approve tokens before proceeding';
                        break;
                    case CONTRACT_ERRORS.UNAUTHORIZED.code:
                        userMessage = 'You are not authorized to perform this action';
                        break;
                    case CONTRACT_ERRORS.EXPIRED_ORDER.code:
                        userMessage = 'This order has expired';
                        break;
                    default:
                        userMessage = error.message;
                }
            }

            this.showError(userMessage);
            console.error('[ViewOrders] Order error:', {
                code: error.code,
                message: error.message,
                details: error.details
            });
        });
    }

    async initialize(readOnlyMode = true) {
        try {
            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();
            
            // Wait for WebSocket to be initialized
            if (!window.webSocket?.isInitialized) {
                console.log('[ViewOrders] Waiting for WebSocket initialization...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }
            
            // Setup WebSocket event handlers
            this.setupWebSocket();

            // Get initial orders from cache
            const cachedOrders = window.webSocket.getOrders();
            if (cachedOrders && cachedOrders.length > 0) {
                console.log('[ViewOrders] Loading orders from cache:', cachedOrders);
                cachedOrders.forEach(order => {
                    this.orders.set(order.id, order);
                });
                await this.refreshOrdersView();
            }

        } catch (error) {
            console.error('[ViewOrders] Initialization error:', error);
            throw error;
        }
    }

    async setupWebSocket() {
        // Subscribe to order sync completion
        this.eventSubscriptions.add({
            event: 'orderSyncComplete',
            callback: (orders) => {
                console.log('[ViewOrders] Received order sync:', orders);
                this.orders.clear();
                Object.entries(orders).forEach(([orderId, orderData]) => {
                    this.orders.set(Number(orderId), {
                        id: Number(orderId),
                        ...orderData
                    });
                });
                this.refreshOrdersView();
            }
        });

        // Subscribe to new orders
        this.eventSubscriptions.add({
            event: 'OrderCreated',
            callback: (orderData) => {
                console.log('[ViewOrders] New order received:', orderData);
                this.orders.set(Number(orderData.id), orderData);
                this.refreshOrdersView();
            }
        });

        // Add subscription for OrderCanceled events
        this.eventSubscriptions.add({
            event: 'OrderCanceled',
            callback: (order) => {
                console.log('[ViewOrders] Order canceled:', order);
                if (this.orders.has(order.id)) {
                    const existingOrder = this.orders.get(order.id);
                    existingOrder.status = 'Canceled';
                    this.orders.set(order.id, existingOrder);
                    this.refreshOrdersView().catch(error => {
                        console.error('[ViewOrders] Error refreshing view after cancel:', error);
                    });
                }
            }
        });

        // Add subscription for OrderFilled events
        this.eventSubscriptions.add({
            event: 'OrderFilled',
            callback: (order) => {
                console.log('[ViewOrders] Order filled:', order);
                if (this.orders.has(order.id)) {
                    const existingOrder = this.orders.get(order.id);
                    existingOrder.status = 'Filled';
                    this.orders.set(order.id, existingOrder);
                    this.refreshOrdersView().catch(error => {
                        console.error('[ViewOrders] Error refreshing view after fill:', error);
                    });
                }
            }
        });

        // Register all subscriptions
        this.eventSubscriptions.forEach(sub => {
            window.webSocket.subscribe(sub.event, sub.callback);
        });
    }

    async refreshOrdersView() {
        console.log('[ViewOrders] Refreshing view with orders:', Array.from(this.orders.values()));
        try {
            // Get contract instance first
            this.contract = await this.getContract();
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Clear existing orders from table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                console.warn('[ViewOrders] Table body not found');
                return;
            }
            tbody.innerHTML = '';

            // Check if we have any orders
            if (!this.orders || this.orders.size === 0) {
                console.log('[ViewOrders] No orders to display');
                return;
            }

            // Get token details for all orders
            const tokenAddresses = new Set();
            this.orders.forEach(order => {
                if (order?.sellToken) tokenAddresses.add(order.sellToken);
                if (order?.buyToken) tokenAddresses.add(order.buyToken);
            });

            if (tokenAddresses.size === 0) {
                console.log('[ViewOrders] No token addresses found');
                return;
            }

            console.log('[ViewOrders] Getting details for tokens:', Array.from(tokenAddresses));
            const tokenDetails = await this.getTokenDetails(Array.from(tokenAddresses));
            
            const tokenDetailsMap = new Map();
            tokenDetails.forEach((details, index) => {
                if (details) {
                    tokenDetailsMap.set(Array.from(tokenAddresses)[index], details);
                }
            });

            // Add orders to table
            for (const order of this.orders.values()) {
                if (order) {
                    const row = await this.createOrderRow(order, tokenDetailsMap);
                    tbody.appendChild(row);
                }
            }
        } catch (error) {
            console.error('[ViewOrders] Error refreshing orders view:', error);
            throw error;
        }
    }

    showReadOnlyMessage() {
        this.container.innerHTML = `
            <div class="tab-content-wrapper">
                <h2>Orders</h2>
                <p class="connect-prompt">Connect wallet to view orders</p>
            </div>`;
    }

    updateOrderStatus(orderId, status) {
        const row = this.container.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            const statusCell = row.querySelector('.order-status');
            if (statusCell) {
                statusCell.textContent = status;
                statusCell.className = `order-status status-${status.toLowerCase()}`;
            }
        }
    }

    async addOrderToTable(order, tokenDetailsMap) {
        try {
            const sellTokenDetails = tokenDetailsMap.get(order.sellToken);
            const buyTokenDetails = tokenDetailsMap.get(order.buyToken);

            const row = document.createElement('tr');
            row.setAttribute('data-order-id', order.id);
            
            row.innerHTML = `
                <td>${order.id}</td>
                <td>${order.maker}</td>
                <td>${order.taker || 'Any'}</td>
                <td>${sellTokenDetails.symbol} (${order.sellToken})</td>
                <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails.decimals)}</td>
                <td>${buyTokenDetails.symbol} (${order.buyToken})</td>
                <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails.decimals)}</td>
                <td>${new Date(order.timestamp * 1000).toLocaleString()}</td>
                <td class="order-status status-${order.status.toLowerCase()}">${order.status}</td>
            `;

            const tableBody = this.container.querySelector('tbody');
            if (tableBody) {
                tableBody.appendChild(row);
            }
        } catch (error) {
            console.error('[ViewOrders] Error adding order to table:', error);
            throw error;
        }
    }

    removeOrderFromTable(orderId) {
        const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            row.remove();
            this.orders.delete(orderId.toString());
        }
    }

    async setupTable() {
        const tableContainer = this.createElement('div', 'table-container');
        const table = this.createElement('table', 'orders-table');
        
        const thead = this.createElement('thead');
        thead.innerHTML = `
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
        `;
        
        table.appendChild(thead);
        table.appendChild(this.createElement('tbody'));
        tableContainer.appendChild(table);
        this.container.appendChild(tableContainer);
    }

    formatAddress(address) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatTimestamp(timestamp) {
        const date = new Date(Number(timestamp) * 1000);
        return date.toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    formatExpiry(timestamp) {
        const expiryTime = this.getExpiryTime(timestamp);
        const days = Math.floor((expiryTime - Date.now()) / (1000 * 60 * 60 * 24));
        return `${days}d`;
    }

    setupEventListeners() {
        this.tbody.addEventListener('click', async (e) => {
            if (e.target.classList.contains('fill-button')) {
                const orderId = e.target.dataset.orderId;
                await this.fillOrder(orderId);
            }
        });
    }

    setupFilters() {
        // Will implement filtering in next iteration
    }

    async fillOrder(orderId) {
        try {
            console.log('[ViewOrders] Starting fill order process for orderId:', orderId);
            const order = await this.getOrderDetails(orderId);
            const contract = await this.getContract();
            
            // Execute the fill transaction
            const tx = await contract.fillOrder(orderId);
            console.log('[ViewOrders] Fill transaction submitted:', tx.hash);
            
            const receipt = await tx.wait();
            console.log('[ViewOrders] Fill transaction receipt:', receipt);

            // Refresh the orders display
            await this.initialize(false); // Use initialize instead of loadOrders
            
            this.showSuccess(`Order ${orderId} filled successfully!`);
        } catch (error) {
            console.error('[ViewOrders] Fill order error:', error);
            this.showError(`Failed to fill order: ${error.message}`);
        }
    }

    async getOrderDetails(orderId) {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            const order = await contract.orders(orderId);
            return {
                id: orderId,
                maker: order.maker,
                taker: order.taker,
                sellToken: order.sellToken,
                sellAmount: order.sellAmount,
                buyToken: order.buyToken,
                buyAmount: order.buyAmount,
                timestamp: order.timestamp,
                status: order.status,
                orderCreationFee: order.orderCreationFee,
                tries: order.tries
            };
        } catch (error) {
            console.error('[ViewOrders] Error getting order details:', error);
            throw error;
        }
    }

    cleanup() {
        this.eventSubscriptions.forEach(sub => {
            window.webSocket.unsubscribe(sub.event, sub.callback);
        });
        this.eventSubscriptions.clear();
    }

    async createOrderRow(order, tokenDetailsMap) {
        const tr = this.createElement('tr');
        tr.dataset.orderId = order.id.toString();

        const sellTokenDetails = tokenDetailsMap.get(order.sellToken);
        const buyTokenDetails = tokenDetailsMap.get(order.buyToken);
        const canFill = await this.canFillOrder(order);
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
            <td class="action-column">${canFill ? 
                `<button class="fill-button" data-order-id="${order.id}">Fill Order</button>` : 
                order.maker?.toLowerCase() === window.ethereum?.selectedAddress?.toLowerCase() ?
                '<span class="your-order">Your Order</span>' : 
                ''
            }</td>`;

        // Add click handler for fill button
        const fillButton = tr.querySelector('.fill-button');
        if (fillButton) {
            fillButton.addEventListener('click', () => this.fillOrder(order.id));
        }

        return tr;
    }

    getExpiryTime(timestamp) {
        const ORDER_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
        return (Number(timestamp) + ORDER_EXPIRY) * 1000; // Convert to milliseconds
    }

    getOrderStatus(order, expiryTime) {
        if (order.status === 'Filled') return 'Filled';
        if (order.status === 'Canceled') return 'Canceled';
        if (Date.now() > expiryTime) return 'Expired';
        return 'Active';
    }

    async canFillOrder(order) {
        try {
            if (!window.ethereum?.selectedAddress) {
                console.log('[ViewOrders] No wallet connected');
                return false;
            }

            // Convert status from number to string if needed
            const statusMap = ['Active', 'Filled', 'Canceled'];
            const orderStatus = typeof order.status === 'number' ? statusMap[order.status] : order.status;
            
            if (orderStatus !== 'Active') {
                console.log('[ViewOrders] Order not active:', orderStatus);
                return false;
            }
            
            const expiryTime = this.getExpiryTime(order.timestamp);
            
            // TEMPORARY: Allow filling own orders for testing
            const canFill = Date.now() < expiryTime; // Only check expiry

            console.log('[ViewOrders] Can fill order:', canFill);
            return canFill;
        } catch (error) {
            console.error('[ViewOrders] Error in canFillOrder:', error);
            return false;
        }
    }
}
