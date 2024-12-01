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
        
        // Remove the existing action column if it exists (from parent class)
        if (actionCell) {
            actionCell.remove();
        }

        // Create new taker cell
        const takerCell = document.createElement('td');
        // Check if order is open to anyone (taker is zero address)
        const isPublicOrder = order.taker === ethers.constants.AddressZero;
        
        if (isPublicOrder) {
            takerCell.innerHTML = '<span class="open-order">Public</span>';
        } else {
            // For private orders, show truncated address
            const shortAddress = `${order.taker.slice(0, 6)}...${order.taker.slice(-4)}`;
            takerCell.innerHTML = `<span class="targeted-order" title="${order.taker}">${shortAddress}</span>`;
        }

        // Create new action cell
        const newActionCell = document.createElement('td');
        newActionCell.className = 'action-column';

        try {
            const currentTime = Math.floor(Date.now() / 1000);
            const orderTime = Number(order.timestamp);
            const contract = await this.getContract();
            const orderExpiry = await contract.ORDER_EXPIRY();
            const gracePeriod = await contract.GRACE_PERIOD();
            const isGracePeriodExpired = currentTime > orderTime + orderExpiry.toNumber() + gracePeriod.toNumber();

            if (order.status === 'Canceled') {
                newActionCell.innerHTML = '<span class="order-status">Canceled</span>';
            } else if (order.status === 'Filled') {
                newActionCell.innerHTML = '<span class="order-status">Filled</span>';
            } else if (isGracePeriodExpired) {
                newActionCell.innerHTML = '<span class="order-status">Await Cleanup</span>';
            } else {
                newActionCell.innerHTML = `
                    <button class="cancel-button" data-order-id="${order.id}">Cancel</button>
                `;
                const cancelButton = newActionCell.querySelector('.cancel-button');
                if (cancelButton) {
                    cancelButton.addEventListener('click', () => this.cancelOrder(order.id));
                }
            }
        } catch (error) {
            console.error('[MyOrders] Error in createOrderRow:', error);
            newActionCell.innerHTML = '<span class="order-status error">Error</span>';
        }

        // Append both cells in correct order
        tr.appendChild(takerCell);
        tr.appendChild(newActionCell);

        return tr;
    }

    async refreshOrdersView() {
        const tbody = this.container.querySelector('tbody');
        if (!tbody) {
            this.debug('Table body not found');
            return;
        }

        // Show loading state immediately
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="loading-message">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Loading your orders...</div>
                </td>
            </tr>`;

        try {
            this.debug('Refreshing orders view');
            
            // Get contract instance first
            this.contract = await this.getContract();
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Get current account
            const userAddress = await window.walletManager.getAccount();
            if (!userAddress) {
                this.debug('No account connected');
                return;
            }

            // Get filter state
            const showOnlyCancellable = this.container.querySelector('#fillable-orders-toggle')?.checked;

            // Filter orders for the current user
            let ordersToDisplay = Array.from(this.orders.values()).filter(order => 
                order?.maker && userAddress && 
                order.maker.toLowerCase() === userAddress.toLowerCase()
            );

            if (showOnlyCancellable) {
                const currentTime = Math.floor(Date.now() / 1000);
                const orderExpiry = await this.contract.ORDER_EXPIRY();
                const gracePeriod = await this.contract.GRACE_PERIOD();

                ordersToDisplay = ordersToDisplay.filter(order => {
                    // Only show orders that are:
                    // 1. Not cancelled
                    // 2. Not filled
                    // 3. Not expired beyond grace period
                    const isGracePeriodExpired = currentTime > Number(order.timestamp) + orderExpiry.toNumber() + gracePeriod.toNumber();
                    return order.status !== 'Canceled' && 
                           order.status !== 'Filled' && 
                           !isGracePeriodExpired;
                });
            }

            // Get all token details at once
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

            // Create all rows first before adding to DOM
            const rows = await Promise.all(ordersToDisplay.map(order => 
                this.createOrderRow(order, tokenDetailsMap)
            ));

            // Clear loading state and add all rows at once
            tbody.innerHTML = '';
            if (!rows.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyCancellable ? 'No cancellable orders found' : 'No orders found'}
                            </div>
                        </td>
                    </tr>`;
            } else {
                rows.forEach(row => {
                    if (row) tbody.appendChild(row);
                });
            }

        } catch (error) {
            console.error('[MyOrders] Error refreshing orders view:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="no-orders-message">
                        <div class="placeholder-text">Failed to load orders</div>
                    </td>
                </tr>`;
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

            // Re-add click handlers for sorting
            thead.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => this.handleSort(th.dataset.sort));
            });
        }

        // Replace the filter toggle text and ensure it's unchecked by default
        const filterToggle = this.container.querySelector('#fillable-orders-toggle');
        if (filterToggle) {
            filterToggle.checked = false;  // Set to unchecked by default
        }
        const filterToggleSpan = this.container.querySelector('.filter-toggle span');
        if (filterToggleSpan) {
            filterToggleSpan.textContent = 'Show only cancellable orders';
        }
    }
}