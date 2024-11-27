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

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Initializing MyOrders component');
            
            if (readOnlyMode || !window.walletManager?.provider) {
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>My Orders</h2>
                        <p class="connect-prompt">Connect wallet to view your orders</p>
                    </div>`;
                return;
            }

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
                        <h2>My Orders</h2>
                        <p class="connect-prompt">Connect wallet to view your orders</p>
                    </div>`;
                return;
            }

            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();

            // Setup WebSocket handlers after table setup
            this.setupWebSocket();

            // Get initial orders from cache and filter for maker
            const cachedOrders = window.webSocket?.getOrders() || [];
            const filteredOrders = cachedOrders.filter(order => 
                order?.maker && userAddress && 
                order.maker.toLowerCase() === userAddress.toLowerCase()
            );

            // Clear existing orders and add filtered ones
            this.orders.clear();
            if (filteredOrders.length > 0) {
                this.debug('Loading orders from cache:', filteredOrders);
                filteredOrders.forEach(order => {
                    this.orders.set(order.id, order);
                });
            }

            await this.refreshOrdersView();

        } catch (error) {
            console.error('[MyOrders] Initialization error:', error);
            this.container.innerHTML = `
                <div class="tab-content-wrapper">
                    <h2>My Orders</h2>
                    <p class="error-message">Failed to load orders. Please try again later.</p>
                </div>`;
        }
    }

    setupWebSocket() {
        // Clear existing subscriptions first
        this.eventSubscriptions.clear();
        if (window.webSocket) {
            window.webSocket.subscribers.forEach((_, event) => {
                window.webSocket.unsubscribe(event, this);
            });
        }

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
        if (window.webSocket) {
            this.eventSubscriptions.forEach(sub => {
                window.webSocket.subscribe(sub.event, sub.callback);
            });
        }
    }

    async cancelOrder(orderId) {
        const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
        try {
            if (button) {
                button.disabled = true;
                button.textContent = 'Canceling...';
            }

            this.debug('Starting cancel order process for orderId:', orderId);
            const contract = await this.getContract();
            
            // Estimate gas for cancelOrder with fallback
            let cancelGasLimit;
            try {
                const cancelGasEstimate = await contract.estimateGas.cancelOrder(orderId);
                cancelGasLimit = Math.floor(cancelGasEstimate.toNumber() * 1.2); // 20% buffer
                this.debug('Cancel order gas estimate:', cancelGasEstimate.toString());
            } catch (error) {
                this.debug('Gas estimation failed for cancel order, using default:', error);
                cancelGasLimit = 100000; // Default gas limit for cancel orders
            }

            this.debug('Sending cancel order transaction with params:', {
                orderId,
                gasLimit: cancelGasLimit,
                gasPrice: (await this.provider.getGasPrice()).toString()
            });

            const tx = await contract.cancelOrder(orderId, {
                gasLimit: 100000,  // Standard gas limit for cancel orders
                gasPrice: await this.provider.getGasPrice()
            });
            
            this.debug('Cancel transaction sent:', tx.hash);
            await tx.wait();
            this.debug('Transaction confirmed');

            this.showSuccess('Order canceled successfully');
            
        } catch (error) {
            this.debug('Cancel order error details:', {
                message: error.message,
                code: error.code,
                data: error?.error?.data,
                reason: error?.reason,
                stack: error.stack
            });
            
            let errorMessage = 'Failed to cancel order: ';
            
            // Try to decode the error
            if (error?.error?.data) {
                try {
                    const decodedError = this.contract.interface.parseError(error.error.data);
                    errorMessage += `${decodedError.name}: ${decodedError.args}`;
                    this.debug('Decoded error:', decodedError);
                } catch (e) {
                    // If we can't decode the error, fall back to basic messages
                    if (error.code === -32603) {
                        errorMessage += 'Transaction would fail. Please try again.';
                    } else {
                        errorMessage += error.message;
                    }
                }
            }
            
            this.showError(errorMessage);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Cancel';
            }
        }
    }

    async createOrderRow(order, tokenDetailsMap) {
        const tr = await super.createOrderRow(order, tokenDetailsMap);
        
        // Get the cells
        const cells = tr.querySelectorAll('td');
        
        // Swap back the Buy and Sell columns for MyOrders view
        const buySymbol = cells[1].textContent;
        const buyAmount = cells[2].textContent;
        const sellSymbol = cells[3].textContent;
        const sellAmount = cells[4].textContent;
        
        cells[1].textContent = sellSymbol;
        cells[2].textContent = sellAmount;
        cells[3].textContent = buySymbol;
        cells[4].textContent = buyAmount;

        // Update the action column
        const actionCell = tr.querySelector('.action-column');
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
                actionCell.innerHTML = `<span class="order-completed">Completed</span>`;
            }
        }

        return tr;
    }

    async refreshOrdersView() {
        this.debug('Refreshing orders view');
        try {
            // Get contract instance first
            this.contract = await this.getContract();
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Clear existing orders from table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                this.debug('Table body not found');
                return;
            }
            tbody.innerHTML = '';

            // Get filter state
            const showOnlyActive = this.container.querySelector('#fillable-orders-toggle')?.checked;

            // Filter orders if necessary
            let ordersToDisplay = Array.from(this.orders.values());
            if (showOnlyActive) {
                ordersToDisplay = ordersToDisplay.filter(order => 
                    this.getOrderStatus(order, this.getExpiryTime(order.timestamp)) === 'Active'
                );
            }

            // Get token details
            const tokenAddresses = new Set();
            ordersToDisplay.forEach(order => {
                if (order?.sellToken) tokenAddresses.add(order.sellToken);
                if (order?.buyToken) tokenAddresses.add(order.buyToken);
            });

            const tokenDetails = await this.getTokenDetails(Array.from(tokenAddresses));
            const tokenDetailsMap = new Map();
            tokenDetails.forEach((details, index) => {
                if (details) {
                    tokenDetailsMap.set(Array.from(tokenAddresses)[index], details);
                }
            });

            // Sort the filtered orders
            ordersToDisplay = ordersToDisplay.sort((a, b) => {
                const direction = this.sortConfig.direction === 'asc' ? 1 : -1;
                
                switch (this.sortConfig.column) {
                    case 'id':
                        return (Number(a.id) - Number(b.id)) * direction;
                    case 'sell':
                        const sellTokenA = tokenDetailsMap.get(a.sellToken)?.symbol || '';
                        const sellTokenB = tokenDetailsMap.get(b.sellToken)?.symbol || '';
                        return sellTokenA.localeCompare(sellTokenB) * direction;
                    case 'sellAmount':
                        const sellAmountA = ethers.utils.formatUnits(a.sellAmount, tokenDetailsMap.get(a.sellToken)?.decimals || 18);
                        const sellAmountB = ethers.utils.formatUnits(b.sellAmount, tokenDetailsMap.get(b.sellToken)?.decimals || 18);
                        return (Number(sellAmountA) - Number(sellAmountB)) * direction;
                    case 'buy':
                        const buyTokenA = tokenDetailsMap.get(a.buyToken)?.symbol || '';
                        const buyTokenB = tokenDetailsMap.get(b.buyToken)?.symbol || '';
                        return buyTokenA.localeCompare(buyTokenB) * direction;
                    case 'buyAmount':
                        const buyAmountA = ethers.utils.formatUnits(a.buyAmount, tokenDetailsMap.get(a.buyToken)?.decimals || 18);
                        const buyAmountB = ethers.utils.formatUnits(b.buyAmount, tokenDetailsMap.get(b.buyToken)?.decimals || 18);
                        return (Number(buyAmountA) - Number(buyAmountB)) * direction;
                    case 'created':
                        return (Number(a.timestamp) - Number(b.timestamp)) * direction;
                    case 'expires':
                        const expiryA = this.getExpiryTime(a.timestamp);
                        const expiryB = this.getExpiryTime(b.timestamp);
                        return (expiryA - expiryB) * direction;
                    case 'status':
                        const statusA = this.getOrderStatus(a, this.getExpiryTime(a.timestamp));
                        const statusB = this.getOrderStatus(b, this.getExpiryTime(b.timestamp));
                        return statusA.localeCompare(statusB) * direction;
                    default:
                        return 0;
                }
            });

            // Check if we have any orders after filtering
            if (!ordersToDisplay || ordersToDisplay.length === 0) {
                this.debug('No orders to display after filtering');
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyActive ? 'No active orders found' : 'No orders found'}
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            // Add orders to table
            for (const order of ordersToDisplay) {
                if (order) {
                    const row = await this.createOrderRow(order, tokenDetailsMap);
                    tbody.appendChild(row);
                }
            }
        } catch (error) {
            console.error('[MyOrders] Error refreshing orders view:', error);
            throw error;
        }
    }

    async setupTable() {
        // Call parent's setupTable to get basic structure
        await super.setupTable();
        
        // Update the table header to swap Buy and Sell back
        const thead = this.container.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = `
                <th data-sort="id">ID <span class="sort-icon">↕</span></th>
                <th data-sort="sell">Sell <span class="sort-icon">↕</span></th>
                <th data-sort="sellAmount" class="">Amount <span class="sort-icon">↕</span></th>
                <th data-sort="buy">Buy <span class="sort-icon">↕</span></th>
                <th data-sort="buyAmount">Amount <span class="sort-icon">↕</span></th>
                <th data-sort="expires">Expires <span class="sort-icon">↕</span></th>
                <th data-sort="status">Status <span class="sort-icon">↕</span></th>
                <th>Taker</th>
                <th>Action</th>
            `;
        }

        // Replace the filter toggle text
        const filterToggleSpan = this.container.querySelector('.filter-toggle span');
        if (filterToggleSpan) {
            filterToggleSpan.textContent = 'Show only active orders';
        }
    }
}