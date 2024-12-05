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

            // Get current gas price
            const gasPrice = await this.provider.getGasPrice();
            
            // Estimate gas for the cancelOrder transaction
            let gasLimit;
            try {
                // First try with static call to check if transaction would fail
                await this.contract.callStatic.cancelOrder(orderId);
                
                gasLimit = await this.contract.estimateGas.cancelOrder(orderId);
                // Add 20% buffer to the estimated gas
                gasLimit = gasLimit.mul(120).div(100);
                this.debug('Estimated gas limit with buffer:', gasLimit.toString());
            } catch (error) {
                this.debug('Gas estimation failed:', error);
                gasLimit = ethers.BigNumber.from(200000); // Conservative fallback for cancel
                this.debug('Using fallback gas limit:', gasLimit.toString());
            }

            // Execute the cancel order transaction with retry mechanism
            const maxRetries = 3;
            let attempt = 0;
            let lastError;

            while (attempt < maxRetries) {
                try {
                    const tx = await this.contract.cancelOrder(orderId, {
                        gasLimit,
                        gasPrice
                    });
                    
                    this.debug('Transaction sent:', tx.hash);
                    await tx.wait();
                    this.debug('Transaction confirmed');

                    // Update order status in memory
                    const orderToUpdate = this.orders.get(Number(orderId));
                    if (orderToUpdate) {
                        orderToUpdate.status = 'Canceled';
                        this.orders.set(Number(orderId), orderToUpdate);
                        await this.refreshOrdersView();
                    }

                    this.showSuccess(`Order ${orderId} canceled successfully!`);
                    return;
                } catch (error) {
                    lastError = error;
                    attempt++;
                    if (attempt < maxRetries) {
                        this.debug(`Attempt ${attempt} failed, retrying...`, error);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }

            throw lastError;

        } catch (error) {
            this.debug('Cancel order error:', error);
            this.showError(this.getReadableError(error));
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Cancel Order';
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
            // Get contract instance first
            this.contract = await this.getContract();
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
                console.warn('[MyOrders] Table body not found');
                return;
            }
            tbody.innerHTML = '';

            // Get ALL orders from WebSocket cache without filtering
            const allOrders = window.webSocket?.getOrders() || [];
            
            // Filter orders only by maker address
            let ordersToDisplay = allOrders.filter(order => 
                order?.maker && 
                order.maker.toLowerCase() === userAddress.toLowerCase()
            );

            // Check if we should filter for cancellable orders
            const showOnlyCancellable = this.container.querySelector('#fillable-orders-toggle')?.checked;
            if (showOnlyCancellable) {
                // Filter for active orders that can be cancelled
                const currentTime = Math.floor(Date.now() / 1000);
                const contract = await this.getContract();
                const orderExpiry = await contract.ORDER_EXPIRY();
                const gracePeriod = await contract.GRACE_PERIOD();

                ordersToDisplay = ordersToDisplay.filter(order => {
                    const orderTime = Number(order.timestamp);
                    const isExpiredWithoutGrace = currentTime > orderTime + orderExpiry.toNumber();
                    const isGracePeriodExpired = currentTime > orderTime + orderExpiry.toNumber() + gracePeriod.toNumber();

                    // Show orders that are:
                    // 1. Active/Open AND not expired, OR
                    // 2. Active/Open AND expired but still within grace period
                    return (order.status === 'Active' || order.status === 'Open') && 
                           (!isExpiredWithoutGrace || !isGracePeriodExpired);
                });
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
                        <td colspan="9" class="no-orders-message">
                            <div class="placeholder-text">
                                No orders found
                            </div>
                        </td>
                    </tr>`;
                return;
            }

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
                    console.error('[MyOrders] Error creating row for order:', order.id, error);
                }
            }

        } catch (error) {
            this.debug('Error refreshing orders view:', error);
            throw error;
        }
    }

    handleSort(column) {
        this.debug('Sorting by column:', column);
        
        if (this.sortConfig.column === column) {
            this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortConfig.column = column;
            this.sortConfig.direction = 'asc';
        }

        const headers = this.container.querySelector('thead').querySelectorAll('th[data-sort]');
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

    async setupTable() {
        // Call parent's setupTable to get basic structure
        await super.setupTable();
        
        // Update the filter toggle text to be more specific
        const filterToggleSpan = this.container.querySelector('.filter-toggle span');
        if (filterToggleSpan) {
            filterToggleSpan.textContent = 'Show only cancellable orders';
        }

        // Show the filter toggle
        const filterToggle = this.container.querySelector('.filter-toggle');
        if (filterToggle) {
            filterToggle.style.display = 'flex';
        }
        
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
    }
}