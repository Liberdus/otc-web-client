import { ViewOrders } from './ViewOrders.js';
import { createLogger } from '../services/LogService.js';

export class TakerOrders extends ViewOrders {
    constructor() {
        super('taker-orders');
        this.isProcessingFill = false;
        
        // Initialize logger
        const logger = createLogger('TAKER_ORDERS');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
    }



    async refreshOrdersView() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            this.debug('Refreshing taker orders view');
            
            // Get current user address
            const userAddress = await window.walletManager.getAccount();
            if (!userAddress) {
                this.debug('No wallet connected, showing empty state');
                // Show empty state for taker orders when no wallet is connected
                const tbody = this.container.querySelector('tbody');
                if (tbody) {
                    tbody.innerHTML = `
                        <tr class="empty-message">
                            <td colspan="8" class="no-orders-message">
                                <div class="placeholder-text">
                                    Please connect your wallet to view your taker orders
                                </div>
                            </td>
                        </tr>`;
                }
                return; // Exit early without throwing error
            }

            // Get all orders and filter for taker
            let ordersToDisplay = Array.from(window.webSocket.orderCache.values())
                .filter(order => 
                    order?.taker && 
                    order.taker.toLowerCase() === userAddress.toLowerCase()
                );

            this.debug(`Found ${ordersToDisplay.length} taker orders`);

            // Get filter states
            const sellTokenFilter = this.container.querySelector('#sell-token-filter')?.value;
            const buyTokenFilter = this.container.querySelector('#buy-token-filter')?.value;
            const orderSort = this.container.querySelector('#order-sort')?.value;
            const showOnlyActive = this.container.querySelector('#fillable-orders-toggle')?.checked ?? true;
            const pageSize = parseInt(this.container.querySelector('#page-size-select')?.value || '25');

            // Reset to page 1 when filters change
            if (this._lastFilters?.sellToken !== sellTokenFilter ||
                this._lastFilters?.buyToken !== buyTokenFilter ||
                this._lastFilters?.showOnlyActive !== showOnlyActive) {
                this.currentPage = 1;
            }

            // Store current filter state
            this._lastFilters = {
                sellToken: sellTokenFilter,
                buyToken: buyTokenFilter,
                showOnlyActive: showOnlyActive
            };

            // Apply token filters
            if (sellTokenFilter) {
                ordersToDisplay = ordersToDisplay.filter(order => 
                    order.sellToken.toLowerCase() === sellTokenFilter.toLowerCase()
                );
            }
            if (buyTokenFilter) {
                ordersToDisplay = ordersToDisplay.filter(order => 
                    order.buyToken.toLowerCase() === buyTokenFilter.toLowerCase()
                );
            }

            // Filter active orders if needed
            if (showOnlyActive) {
                ordersToDisplay = ordersToDisplay.filter(order => 
                    window.webSocket.canFillOrder(order, userAddress)
                );
            }

            // Set total orders after filtering
            this.totalOrders = ordersToDisplay.length;

            // Apply sorting
            if (orderSort === 'newest') {
                ordersToDisplay.sort((a, b) => b.id - a.id);
            } else if (orderSort === 'best-deal') {
                ordersToDisplay.sort((a, b) => 
                    Number(a.dealMetrics?.deal || Infinity) - 
                    Number(b.dealMetrics?.deal || Infinity)
                );
            }

            // Apply pagination
            const startIndex = (this.currentPage - 1) * pageSize;
            const endIndex = pageSize === -1 ? ordersToDisplay.length : startIndex + pageSize;
            const paginatedOrders = pageSize === -1 ? 
                ordersToDisplay : 
                ordersToDisplay.slice(startIndex, endIndex);

            // Display orders
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                this.error('tbody element not found in container');
                return;
            }

            tbody.innerHTML = '';

            for (const order of paginatedOrders) {
                const newRow = await this.createOrderRow(order);
                if (newRow) {
                    tbody.appendChild(newRow);
                }
            }

            // Update pagination controls
            this.updatePaginationControls(ordersToDisplay.length);

            if (ordersToDisplay.length === 0) {
                this.debug('No orders to display');
                tbody.innerHTML = `
                    <tr class="empty-message">
                        <td colspan="8" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyActive ? 
                                    'No active orders where you are the taker' : 
                                    'No orders found where you are the taker'}
                            </div>
                        </td>
                    </tr>`;
            }

        } catch (error) {
            this.error('Error refreshing orders:', error);
            this.showError('Failed to refresh orders view');
        } finally {
            this.isLoading = false;
        }
    }

    // Override setupWebSocket to filter for taker events
    setupWebSocket() {
        try {
            super.setupWebSocket();

            // Add taker-specific event handling
            this.eventSubscriptions.add({
                event: 'orderSyncComplete',
                callback: async (orders) => {
                    if (this.isProcessingFill) {
                        this.debug('Skipping sync while processing fill');
                        return;
                    }
                    
                    const userAddress = await window.walletManager.getAccount();
                    this.orders.clear();
                    
                    const takerOrders = Object.values(orders)
                        .filter(order => 
                            order.taker.toLowerCase() === userAddress.toLowerCase()
                        );
                    
                    this.debug(`Synced ${takerOrders.length} taker orders`);
                    
                    takerOrders.forEach(order => {
                        this.orders.set(order.id, order);
                    });
                    
                    await this.refreshOrdersView();
                }
            });
        } catch (error) {
            this.error('Error setting up WebSocket:', error);
        }
    }

    // Override setupTable to customize headers and add advanced filters
    async setupTable() {
        try {
            await super.setupTable();
            
            // Show advanced filters by default
            const advancedFilters = this.container.querySelector('.advanced-filters');
            if (advancedFilters) {
                advancedFilters.style.display = 'block';
                const advancedFiltersToggle = this.container.querySelector('.advanced-filters-toggle');
                if (advancedFiltersToggle) {
                    advancedFiltersToggle.classList.add('expanded');
                }
            } else {
                this.warn('Advanced filters element not found');
            }
            
            // Customize table header
            const thead = this.container.querySelector('thead tr');
            if (!thead) {
                this.error('Table header element not found');
                return;
            }

            thead.innerHTML = `
                <th>ID</th>
                <th>Buy</th>
                <th>Amount</th>
                <th>Sell</th>
                <th>Amount</th>
                <th>
                    Deal
                    <span class="info-icon" title="Deal = Price × Market Rate

For You as Taker (Buyer):
• Lower deal number is better
• Deal > 1: You're paying more than market value
• Deal < 1: You're paying less than market value

Example:
Deal = 1.2 means you're paying 20% above market rate
Deal = 0.8 means you're paying 20% below market rate">ⓘ</span>
                </th>
                <th>Expires</th>
                <th>Status</th>
                <th>Action</th>
            `;
        } catch (error) {
            this.error('Error setting up table:', error);
        }
    }
}
