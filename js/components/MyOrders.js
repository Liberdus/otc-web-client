import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';
import { isDebugEnabled } from '../config.js';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
        
        // Initialize sort config with id as default sort, descending
        this.sortConfig = {
            column: 'id',
            direction: 'desc',
            isColumnClick: false
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
        try {
            this.debug('Refreshing orders view with sort config:', this.sortConfig);
            
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

            // Sort orders based on sortConfig
            ordersToDisplay.sort((a, b) => {
                if (this.sortConfig.column === 'id') {
                    return this.sortConfig.direction === 'asc'
                        ? Number(a.id) - Number(b.id)
                        : Number(b.id) - Number(a.id);
                } else if (this.sortConfig.column === 'status') {
                    const statusPriority = {
                        'Open': 1,
                        'Active': 1,
                        'Pending': 2,
                        'Filled': 3,
                        'Canceled': 4,
                        'Await Cleanup': 5
                    };
                    
                    const priorityA = statusPriority[a.status] || 999;
                    const priorityB = statusPriority[b.status] || 999;
                    
                    return this.sortConfig.direction === 'asc'
                        ? priorityA - priorityB
                        : priorityB - priorityA;
                }
                
                // Default to ID sort if no other criteria
                return this.sortConfig.direction === 'asc'
                    ? Number(a.id) - Number(b.id)
                    : Number(b.id) - Number(a.id);
            });

            // Update the orders Map with sorted orders
            this.orders.clear();
            ordersToDisplay.forEach(order => {
                this.orders.set(order.id, order);
            });

            await super.refreshOrdersView();

        } catch (error) {
            console.error('[MyOrders] Initialization error:', error);
            this.container.innerHTML = `
                <div class="tab-content-wrapper">
                    <h2>My Orders</h2>
                    <p class="error-message">Failed to load orders. Please try again later.</p>
                </div>`;
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
                th.addEventListener('click', () => {
                    const column = th.dataset.sort;
                    
                    // Toggle direction if clicking same column
                    if (this.sortConfig.column === column) {
                        this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.sortConfig.column = column;
                        this.sortConfig.direction = 'asc';
                    }
                    
                    this.sortConfig.isColumnClick = true;
                    this.debug('Sort config updated:', this.sortConfig);
                    this.refreshOrdersView();
                });
            });
        }

        // Hide the filter toggle but keep the element for future use
        const filterToggle = this.container.querySelector('#fillable-orders-toggle');
        if (filterToggle) {
            filterToggle.parentElement.style.display = 'none';
            filterToggle.checked = false;
        }
    }
}