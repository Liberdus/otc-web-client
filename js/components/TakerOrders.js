import { ViewOrders } from './ViewOrders.js';
import { createLogger } from '../services/LogService.js';
import { ethers } from 'ethers';
import { processOrderAddress, generateStatusCellHTML, setupClickToCopy } from '../utils/ui.js';

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
                            <td colspan="7" class="no-orders-message">
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
                        <td colspan="7" class="no-orders-message">
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
                <th>Sell</th>
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

    /**
     * Override createOrderRow to add counterparty address display
     * @param {Object} order - The order object
     * @returns {HTMLElement} The table row element
     */
    async createOrderRow(order) {
        try {
            const tr = document.createElement('tr');
            tr.dataset.orderId = order.id.toString();
            tr.dataset.timestamp = order.timings?.createdAt?.toString() || '0';

            // Get token info from WebSocket cache
            const sellTokenInfo = await window.webSocket.getTokenInfo(order.sellToken);
            const buyTokenInfo = await window.webSocket.getTokenInfo(order.buyToken);

            // Use pre-formatted values from dealMetrics
            const { 
                formattedSellAmount,
                formattedBuyAmount,
                deal,
                sellTokenUsdPrice,
                buyTokenUsdPrice 
            } = order.dealMetrics || {};

            // Fallback amount formatting if dealMetrics not yet populated
            const safeFormattedSellAmount = typeof formattedSellAmount !== 'undefined'
                ? formattedSellAmount
                : (order?.sellAmount && sellTokenInfo?.decimals != null
                    ? ethers.utils.formatUnits(order.sellAmount, sellTokenInfo.decimals)
                    : '0');
            const safeFormattedBuyAmount = typeof formattedBuyAmount !== 'undefined'
                ? formattedBuyAmount
                : (order?.buyAmount && buyTokenInfo?.decimals != null
                    ? ethers.utils.formatUnits(order.buyAmount, buyTokenInfo.decimals)
                    : '0');

            // Format USD prices
            const formatUsdPrice = (price) => {
                if (!price) return '';
                if (price >= 100) return `$${price.toFixed(0)}`;
                if (price >= 1) return `$${price.toFixed(2)}`;
                return `$${price.toFixed(4)}`;
            };

            // Calculate total values (price × amount)
            const calculateTotalValue = (price, amount) => {
                if (!price || !amount) return '';
                const total = price * parseFloat(amount);
                if (total >= 100) return `$${total.toFixed(0)}`;
                if (total >= 1) return `$${total.toFixed(2)}`;
                return `$${total.toFixed(4)}`;
            };

            // Determine prices with fallback to current pricing service map
            const resolvedSellPrice = typeof sellTokenUsdPrice !== 'undefined' 
                ? sellTokenUsdPrice 
                : (window.pricingService ? window.pricingService.getPrice(order.sellToken) : undefined);
            const resolvedBuyPrice = typeof buyTokenUsdPrice !== 'undefined' 
                ? buyTokenUsdPrice 
                : (window.pricingService ? window.pricingService.getPrice(order.buyToken) : undefined);

            // Mark as estimate if not explicitly present in pricing map
            const sellPriceClass = (window.pricingService && window.pricingService.isPriceEstimated(order.sellToken)) ? 'price-estimate' : '';
            const buyPriceClass = (window.pricingService && window.pricingService.isPriceEstimated(order.buyToken)) ? 'price-estimate' : '';

            const orderStatus = window.webSocket.getOrderStatus(order);
            const expiryEpoch = order?.timings?.expiresAt;
            const expiryText = typeof expiryEpoch === 'number' ? this.formatTimeDiff(expiryEpoch - Math.floor(Date.now() / 1000)) : 'Unknown';

            // Get counterparty address for display
            const userAddress = window.walletManager.getAccount()?.toLowerCase();
            const { counterpartyAddress, isZeroAddr, formattedAddress } = processOrderAddress(order, userAddress);

            tr.innerHTML = `
                <td>${order.id}</td>
                <td>
                    <div class="token-info">
                        <div class="token-icon">
                            <div class="loading-spinner"></div>
                        </div>
                        <div class="token-details">
                            <div class="token-symbol-row">
                                <span class="token-symbol">${sellTokenInfo.symbol}</span>
                                <span class="token-price ${sellPriceClass}">${calculateTotalValue(resolvedSellPrice, safeFormattedSellAmount)}</span>
                            </div>
                            <span class="token-amount">${safeFormattedSellAmount}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="token-info">
                        <div class="token-icon">
                            <div class="loading-spinner"></div>
                        </div>
                        <div class="token-details">
                            <div class="token-symbol-row">
                                <span class="token-symbol">${buyTokenInfo.symbol}</span>
                                <span class="token-price ${buyPriceClass}">${calculateTotalValue(resolvedBuyPrice, safeFormattedBuyAmount)}</span>
                            </div>
                            <span class="token-amount">${safeFormattedBuyAmount}</span>
                        </div>
                    </div>
                </td>
                <td>${(deal || 0).toFixed(6)}</td>
                <td>${expiryText}</td>
                <td class="order-status">
                    ${generateStatusCellHTML(orderStatus, counterpartyAddress, isZeroAddr, formattedAddress)}
                </td>
                <td class="action-column"></td>`;

            // Add click-to-copy functionality for counterparty address
            const addressElement = tr.querySelector('.counterparty-address.clickable');
            setupClickToCopy(addressElement);

            // Render token icons asynchronously (target explicit columns)
            const sellTokenIconContainer = tr.querySelector('td:nth-child(2) .token-icon');
            const buyTokenIconContainer = tr.querySelector('td:nth-child(3) .token-icon');
            
            if (sellTokenIconContainer) {
                this.renderTokenIcon(sellTokenInfo, sellTokenIconContainer);
            }
            if (buyTokenIconContainer) {
                this.renderTokenIcon(buyTokenInfo, buyTokenIconContainer);
            }

            // Start expiry timer for this row
            this.startExpiryTimer(tr);

            return tr;
        } catch (error) {
            this.error('Error creating order row:', error);
            return null;
        }
    }
}
