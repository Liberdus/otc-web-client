import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';
import { isDebugEnabled } from '../config.js';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
        
        // Initialize sort config
        this.sortConfig = {
            column: 'id',
            direction: 'asc'
        };
        
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
        // First call parent's setupWebSocket if it exists
        if (super.setupWebSocket) {
            super.setupWebSocket();
        }

        // Add OrderCanceled event handler
        this.eventSubscriptions.add({
            event: 'OrderCanceled',
            callback: async (orderData) => {
                this.debug('Order canceled event received:', orderData);
                
                // Update the order in our local state
                if (this.orders.has(orderData.id)) {
                    const order = this.orders.get(orderData.id);
                    order.status = 'Canceled';
                    this.orders.set(orderData.id, order);
                    
                    // Update UI elements
                    const statusCell = this.container.querySelector(`tr[data-order-id="${orderData.id}"] .order-status`);
                    const actionCell = this.container.querySelector(`tr[data-order-id="${orderData.id}"] .action-column`);
                    
                    if (statusCell) {
                        statusCell.textContent = 'Canceled';
                        statusCell.className = 'order-status canceled';
                    }
                    if (actionCell) {
                        actionCell.innerHTML = '<span class="order-status">Canceled</span>';
                    }
                }
            }
        });
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
            } catch (error) {
                this.debug('Gas estimation failed for cancel order, using default:', error);
                cancelGasLimit = 100000; // Default gas limit for cancel orders
            }

            const tx = await contract.cancelOrder(orderId, {
                gasLimit: cancelGasLimit,
                gasPrice: await this.provider.getGasPrice()
            });
            
            this.debug('Cancel transaction sent:', tx.hash);
            this.showSuccess('Cancel transaction submitted');
            
            await tx.wait();
            this.debug('Transaction confirmed');

        } catch (error) {
            this.debug('Cancel order error:', error);
            let errorMessage = 'Failed to cancel order: ';
            
            if (error?.error?.data) {
                try {
                    const decodedError = this.contract.interface.parseError(error.error.data);
                    errorMessage += `${decodedError.name}: ${decodedError.args}`;
                } catch (e) {
                    if (error.code === -32603) {
                        errorMessage += 'Transaction would fail. Please try again.';
                    } else {
                        errorMessage += error.message;
                    }
                }
            }
            
            this.showError(errorMessage);
            
            // Reset button state on error
            if (button) {
                button.disabled = false;
                button.textContent = 'Cancel';
            }
        }
    }

    async createOrderRow(order, tokenDetailsMap) {
        const tr = await super.createOrderRow(order, tokenDetailsMap);
        const actionCell = tr.querySelector('.action-column');
        const statusCell = tr.querySelector('.order-status');
        const expiresCell = tr.querySelector('td:nth-child(6)'); // Expires column
        
        if (actionCell && statusCell) {
            try {
                const currentTime = Math.floor(Date.now() / 1000);
                const orderTime = Number(order.timestamp);
                const contract = await this.getContract();
                
                // Get expiry times directly from contract
                const orderExpiry = await contract.ORDER_EXPIRY();
                const gracePeriod = await contract.GRACE_PERIOD();
                
                const expiryTime = orderTime + orderExpiry.toNumber();
                const timeDiff = expiryTime - currentTime;
                
                // Format time difference for expires column
                const formatTimeDiff = (diff) => {
                    const absHours = Math.floor(Math.abs(diff) / 3600);
                    const absMinutes = Math.floor((Math.abs(diff) % 3600) / 60);
                    const sign = diff < 0 ? '-' : '';
                    return `${sign}${absHours}h ${absMinutes}m`;
                };

                // Update expires column with the time difference
                if (expiresCell) {
                    expiresCell.textContent = formatTimeDiff(timeDiff);
                }

                const isGracePeriodExpired = currentTime > orderTime + orderExpiry.toNumber() + gracePeriod.toNumber();
                
                // Status column only shows contract states
                if (order.status === 'Canceled') {
                    statusCell.textContent = 'Canceled';
                    statusCell.className = 'order-status canceled';
                } else if (order.status === 'Filled') {
                    statusCell.textContent = 'Filled';
                    statusCell.className = 'order-status filled';
                } else {
                    statusCell.textContent = 'Active';
                    statusCell.className = 'order-status active';
                }

                // Keep existing action column logic
                if (order.status === 'Canceled') {
                    actionCell.innerHTML = '<span class="order-status">Canceled</span>';
                } else if (order.status === 'Filled') {
                    actionCell.innerHTML = '<span class="order-status">Filled</span>';
                } else if (isGracePeriodExpired) {
                    actionCell.innerHTML = '<span class="order-status">Await Cleanup</span>';
                } else {
                    actionCell.innerHTML = `
                        <button class="cancel-button" data-order-id="${order.id}">Cancel</button>
                    `;
                    const cancelButton = actionCell.querySelector('.cancel-button');
                    if (cancelButton) {
                        cancelButton.addEventListener('click', () => this.cancelOrder(order.id));
                    }
                }
            } catch (error) {
                console.error('[MyOrders] Error in createOrderRow:', error);
                actionCell.innerHTML = '<span class="order-status error">Error</span>';
            }
        }

        return tr;
    }

    async refreshOrdersView() {
        try {
            this.debug('Initializing MyOrders component');
            
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

            // Get current account
            const userAddress = await window.walletManager.getAccount();
            if (!userAddress) {
                this.debug('No account connected');
                return;
            }

            // Get filter state
            const showOnlyActive = this.container.querySelector('#fillable-orders-toggle')?.checked;

            // Filter orders for the current user
            let ordersToDisplay = Array.from(this.orders.values()).filter(order => 
                order?.maker && userAddress && 
                order.maker.toLowerCase() === userAddress.toLowerCase()
            );

            if (showOnlyActive) {
                ordersToDisplay = ordersToDisplay.filter(order => 
                    order.status !== 'Canceled' && order.status !== 'Filled'
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

            // Sort orders based on current sort configuration
            ordersToDisplay = ordersToDisplay.sort((a, b) => {
                const direction = this.sortConfig.direction === 'asc' ? 1 : -1;
                
                switch (this.sortConfig.column) {
                    case 'id':
                        return (Number(a.id) - Number(b.id)) * direction;
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
        
        // Update the table header to show maker's perspective
        const thead = this.container.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = `
                <th data-sort="id">ID <span class="sort-icon">↕</span></th>
                <th>Sell</th>
                <th>Amount</th>
                <th>Buy</th>
                <th>Amount</th>
                <th>Expires</th>
                <th data-sort="status">Status <span class="sort-icon">↕</span></th>
                <th>Taker</th>
                <th>Action</th>
            `;

            // Re-add click handlers for sorting after updating innerHTML
            thead.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => this.handleSort(th.dataset.sort));
            });
        }

        // Replace the filter toggle text
        const filterToggleSpan = this.container.querySelector('.filter-toggle span');
        if (filterToggleSpan) {
            filterToggleSpan.textContent = 'Show only active orders';
        }
    }
}