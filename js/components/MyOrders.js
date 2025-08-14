import { ViewOrders } from './ViewOrders.js';
import { PricingService } from '../services/PricingService.js';
import { createLogger } from '../services/LogService.js';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
        this.pricingService = new PricingService();
        
        // Initialize logger
        const logger = createLogger('MY_ORDERS');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
        
        // Initialize sort config with id as default sort, descending
        this.sortConfig = {
            column: 'id',
            direction: 'desc',
            isColumnClick: false
        };
    }

    async initialize(readOnlyMode = true) {
        // Prevent concurrent initializations
        if (this.isInitializing) {
            this.debug('Already initializing, skipping...');
            return;
        }

        this.isInitializing = true;

        try {
            this.debug('Initializing MyOrders component');
            
            // Check wallet connection first
            if (!window.walletManager.isWalletConnected()) {
                this.warn('No wallet connected, showing connect prompt');
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>My Orders</h2>
                        <p class="connect-prompt">Connect wallet to view your orders</p>
                    </div>`;
                return;
            }

            // Get current account
            let userAddress = window.walletManager.getAccount();
            if (!userAddress) {
                this.warn('No account connected');
                return;
            }

            // Check if WebSocket cache is already available
            if (window.webSocket?.orderCache.size > 0) {
                this.debug('Using existing WebSocket cache');
                await this.setupTable();
                await this.refreshOrdersView();
                return;
            }

            // If no cache, then wait for WebSocket initialization
            if (!window.webSocket?.isInitialized) {
                this.warn('WebSocket not initialized, waiting...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }

            // Setup table and refresh view
            await this.setupTable();
            await this.refreshOrdersView();

        } catch (error) {
            this.error('Initialization error:', error);
            this.showError('Failed to initialize orders view');
        } finally {
            this.isInitializing = false;
        }
    }

    async refreshOrdersView() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            // Store current filter state before refresh
            const checkbox = this.container.querySelector('#fillable-orders-toggle');
            const showOnlyCancellable = checkbox?.checked ?? false; // Get current state
            
            // Get all orders first
            let ordersToDisplay = Array.from(window.webSocket.orderCache.values());
            
            // Filter for user's orders only
            const userAddress = window.walletManager.getAccount()?.toLowerCase();
            ordersToDisplay = ordersToDisplay.filter(order => 
                order.maker?.toLowerCase() === userAddress
            );

            // Get filter states
            const sellTokenFilter = this.container.querySelector('#sell-token-filter')?.value;
            const buyTokenFilter = this.container.querySelector('#buy-token-filter')?.value;
            const orderSort = this.container.querySelector('#order-sort')?.value;

            // Apply filters
            ordersToDisplay = ordersToDisplay.filter(order => {
                // Apply token filters
                if (sellTokenFilter && order.sellToken.toLowerCase() !== sellTokenFilter.toLowerCase()) return false;
                if (buyTokenFilter && order.buyToken.toLowerCase() !== buyTokenFilter.toLowerCase()) return false;

                // Apply cancellable filter if checked
                if (showOnlyCancellable) {
                    return window.webSocket.canCancelOrder(order, userAddress);
                }
                
                return true;
            });

            // Set total orders after filtering
            this.totalOrders = ordersToDisplay.length;

            // Apply sorting
            if (orderSort === 'newest') {
                ordersToDisplay.sort((a, b) => b.id - a.id);
            } else if (orderSort === 'best-deal') {
                ordersToDisplay.sort((a, b) => 
                    Number(b.dealMetrics?.deal || 0) - 
                    Number(a.dealMetrics?.deal || 0)
                );
            }

            // Apply pagination
            const pageSize = parseInt(this.container.querySelector('#page-size-select')?.value || '50');
            if (pageSize !== -1) {  // -1 means show all
                const startIndex = (this.currentPage - 1) * pageSize;
                const endIndex = startIndex + pageSize;
                ordersToDisplay = ordersToDisplay.slice(startIndex, endIndex);
            }

            // Update the table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                this.warn('No tbody found in table');
                return;
            }

            tbody.innerHTML = '';
            
            for (const order of ordersToDisplay) {
                const newRow = await this.createOrderRow(order);
                if (newRow) {
                    tbody.appendChild(newRow);
                }
            }

            // Update pagination controls
            this.updatePaginationControls(this.totalOrders);

            // Show empty state if no orders
            if (ordersToDisplay.length === 0) {
                tbody.innerHTML = `
                    <tr class="empty-message">
                        <td colspan="9" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyCancellable ? 
                                    'No cancellable orders found' : 
                                    'No orders found'}
                            </div>
                        </td>
                    </tr>`;
            }

            // After table is rebuilt, restore checkbox state
            if (checkbox) {
                checkbox.checked = showOnlyCancellable;
            }

        } catch (error) {
            this.error('Error refreshing orders:', error);
            this.showError('Failed to refresh orders view');
        } finally {
            this.isLoading = false;
        }
    }

    getTotalPages() {
        const pageSize = parseInt(this.container.querySelector('#page-size-select')?.value || '50');
        if (pageSize === -1) return 1; // View all
        return Math.ceil(this.totalOrders / pageSize);
    }

    // Keep the setupTable method as is since it's specific to MyOrders view
    async setupTable() {
        // Get tokens from WebSocket's tokenCache first
        const tokens = Array.from(window.webSocket.tokenCache.values())
            .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Sort alphabetically by symbol
        
        this.debug('Available tokens:', tokens);

        const paginationControls = `
            <div class="pagination-controls">
                <select id="page-size-select" class="page-size-select">
                    <option value="10">10 per page</option>
                    <option value="25">25 per page</option>
                    <option value="50" selected>50 per page</option>
                    <option value="100">100 per page</option>
                    <option value="-1">View all</option>
                </select>
                
                <div class="pagination-buttons">
                    <button class="pagination-button prev-page" title="Previous page" disabled>
                        ←
                    </button>
                    <span class="page-info">Page 1 of 0</span>
                    <button class="pagination-button next-page" title="Next page" disabled>
                        →
                    </button>
                </div>
            </div>
        `;

        // Main filter controls
        const filterControls = `
            <div class="filter-controls">
                <div class="filter-row">
                    <div class="filters-left">
                        <div class="filters-group">
                            <button class="advanced-filters-toggle">
                                <svg class="filter-icon" viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3V3H19V3C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z"/>
                                </svg>
                                Filters
                                <svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                                </svg>
                            </button>
                            <label class="filter-toggle">
                                <input type="checkbox" id="fillable-orders-toggle" checked>
                                <span>Show only cancellable orders</span>
                            </label>
                        </div>
                    </div>
                    ${paginationControls}
                </div>
                <div class="advanced-filters" style="display: none;">
                    <div class="filter-row">
                        <div class="token-filters">
                            <select id="sell-token-filter" class="token-filter">
                                <option value="">All Sell Tokens</option>
                                ${tokens.map(token => 
                                    `<option value="${token.address}">${token.symbol}</option>`
                                ).join('')}
                            </select>
                            <select id="buy-token-filter" class="token-filter">
                                <option value="">All Buy Tokens</option>
                                ${tokens.map(token => 
                                    `<option value="${token.address}">${token.symbol}</option>`
                                ).join('')}
                            </select>
                            <select id="order-sort" class="order-sort">
                                <option value="newest">Newest First</option>
                                <option value="best-deal">Best Deal First</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>`;

        const bottomControls = `
            <div class="filter-controls bottom-controls">
                <div class="filter-row">
                    <div class="refresh-container">
                        <button id="refresh-prices-btn" class="refresh-prices-button">↻ Refresh Prices</button>
                        <span class="refresh-status"></span>
                    </div>
                    ${paginationControls}
                </div>
            </div>
        `;

        this.container.innerHTML = `
            <div class="table-container">
                ${filterControls}
                <table class="orders-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Sell</th>
                            <th>Amount</th>
                            <th>Buy</th>
                            <th>Amount</th>
                            <th>
                                Deal
                                <span class="info-icon" title="Deal = Price × Market Rate

For Your Orders (as Seller):
• Higher deal number is better
• Deal > 1: You're getting more than market value
• Deal < 1: You're getting less than market value

Example:
Deal = 1.2 means you're selling at 20% above market rate
Deal = 0.8 means you're selling at 20% below market rate">ⓘ</span>
                            </th>
                            <th>Expires</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                ${bottomControls}
            </div>`;

        // Setup advanced filters toggle
        const advancedFiltersToggle = this.container.querySelector('.advanced-filters-toggle');
        const advancedFilters = this.container.querySelector('.advanced-filters');
        
        if (advancedFiltersToggle && advancedFilters) {
            advancedFiltersToggle.addEventListener('click', () => {
                const isExpanded = advancedFilters.style.display !== 'none';
                advancedFilters.style.display = isExpanded ? 'none' : 'block';
                advancedFiltersToggle.classList.toggle('expanded', !isExpanded);
            });
        }

        // Add event listeners for filters
        const sellTokenFilter = this.container.querySelector('#sell-token-filter');
        const buyTokenFilter = this.container.querySelector('#buy-token-filter');
        const orderSort = this.container.querySelector('#order-sort');

        if (sellTokenFilter) sellTokenFilter.addEventListener('change', () => this.refreshOrdersView());
        if (buyTokenFilter) buyTokenFilter.addEventListener('change', () => this.refreshOrdersView());
        if (orderSort) orderSort.addEventListener('change', () => this.refreshOrdersView());

        // Initialize pagination
        this.currentPage = 1;
        const pageSize = this.container.querySelector('#page-size-select');
        if (pageSize) {
            pageSize.value = '50'; // Set default page size
        }

        // Setup pagination for both top and bottom controls
        const setupPaginationListeners = (controls) => {
            const prevButton = controls.querySelector('.prev-page');
            const nextButton = controls.querySelector('.next-page');
            const pageInfo = controls.querySelector('.page-info');
            
            if (prevButton) {
                prevButton.addEventListener('click', () => {
                    if (this.currentPage > 1) {
                        this.currentPage--;
                        this.refreshOrdersView();
                    }
                });
            }
            
            if (nextButton) {
                nextButton.addEventListener('click', () => {
                    const pageSize = parseInt(this.container.querySelector('#page-size-select').value);
                    const totalPages = Math.ceil(this.totalOrders / pageSize);
                    if (this.currentPage < totalPages) {
                        this.currentPage++;
                        this.refreshOrdersView();
                    }
                });
            }
        };

        // Sync both page size selects
        const pageSizeSelects = this.container.querySelectorAll('.page-size-select');
        pageSizeSelects.forEach(select => {
            select.addEventListener('change', (event) => {
                // Update all page size selects to match
                pageSizeSelects.forEach(otherSelect => {
                    if (otherSelect !== event.target) {
                        otherSelect.value = event.target.value;
                    }
                });
                this.currentPage = 1; // Reset to first page when changing page size
                this.refreshOrdersView();
            });
        });

        // Setup pagination for both top and bottom controls
        const controls = this.container.querySelectorAll('.filter-controls');
        controls.forEach(setupPaginationListeners);

        // Add filter toggle listener
        const filterToggles = this.container.querySelectorAll('#fillable-orders-toggle');
        filterToggles.forEach(toggle => {
            toggle.addEventListener('change', (event) => {
                filterToggles.forEach(otherToggle => {
                    if (otherToggle !== event.target) {
                        otherToggle.checked = event.target.checked;
                    }
                });
                this.refreshOrdersView();
            });
        });

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Add refresh button functionality
        const refreshButton = this.container.querySelector('#refresh-prices-btn');
        const statusIndicator = this.container.querySelector('.refresh-status');
        
        let refreshTimeout;
        if (refreshButton) {
            refreshButton.addEventListener('click', async () => {
                if (refreshTimeout) return;
                
                refreshButton.disabled = true;
                refreshButton.innerHTML = '↻ Refreshing...';
                statusIndicator.className = 'refresh-status loading';
                statusIndicator.style.opacity = 1;
                
                try {
                    const result = await this.pricingService.refreshPrices();
                    if (result.success) {
                        statusIndicator.className = 'refresh-status success';
                        statusIndicator.textContent = `Updated ${new Date().toLocaleTimeString()}`;
                    } else {
                        statusIndicator.className = 'refresh-status error';
                        statusIndicator.textContent = result.message;
                    }
                } catch (error) {
                    statusIndicator.className = 'refresh-status error';
                    statusIndicator.textContent = 'Failed to refresh prices';
                } finally {
                    refreshButton.disabled = false;
                    refreshButton.innerHTML = '↻ Refresh Prices';
                    
                    refreshTimeout = setTimeout(() => {
                        refreshTimeout = null;
                        statusIndicator.style.opacity = 0;
                    }, 2000);
                }
            });
        }

        // Add pagination event listeners for both top and bottom controls
        const controls = this.container.querySelectorAll('.filter-controls');
        controls.forEach(control => {
            const prevButton = control.querySelector('.prev-page');
            const nextButton = control.querySelector('.next-page');
            
            if (prevButton) {
                prevButton.addEventListener('click', () => {
                    if (this.currentPage > 1) {
                        this.currentPage--;
                        this.refreshOrdersView();
                    }
                });
            }
            
            if (nextButton) {
                nextButton.addEventListener('click', () => {
                    const totalPages = this.getTotalPages();
                    this.debug('Next button clicked', { 
                        currentPage: this.currentPage, 
                        totalPages, 
                        totalOrders: this.totalOrders 
                    });
                    if (this.currentPage < totalPages) {
                        this.currentPage++;
                        this.refreshOrdersView();
                    }
                });
            }
        });

        // Add filter toggle listener
        const filterToggle = this.container.querySelector('#fillable-orders-toggle');
        if (filterToggle) {
            filterToggle.addEventListener('change', () => {
                this.currentPage = 1; // Reset to first page when filter changes
                this.refreshOrdersView();
            });
        }

        // Add token filter listeners
        const tokenFilters = this.container.querySelectorAll('.token-filter');
        tokenFilters.forEach(filter => {
            filter.addEventListener('change', () => {
                this.currentPage = 1; // Reset to first page when filter changes
                this.refreshOrdersView();
            });
        });

        // Add sort listener
        const sortSelect = this.container.querySelector('#order-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                this.currentPage = 1; // Reset to first page when sort changes
                this.refreshOrdersView();
            });
        }
    }

    async createOrderRow(order) {
        try {
            // Create the row element first
            const tr = document.createElement('tr');
            tr.dataset.orderId = order.id.toString();
            tr.dataset.timestamp = order.timings.createdAt.toString();
            
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

            // Format USD prices with appropriate precision
            const formatUsdPrice = (price) => {
                if (!price) return '';
                if (price >= 100) return `$${price.toFixed(0)}`;
                if (price >= 1) return `$${price.toFixed(2)}`;
                return `$${price.toFixed(4)}`;
            };

            // Format expiry time
            const formatTimeDiff = (seconds) => {
                const days = Math.floor(Math.abs(seconds) / 86400);
                const hours = Math.floor((Math.abs(seconds) % 86400) / 3600);
                const minutes = Math.floor((Math.abs(seconds) % 3600) / 60);
                
                const prefix = seconds < 0 ? '-' : '';
                
                if (days > 0) {
                    return `${prefix}${days}D ${hours}H ${minutes}M`;
                } else if (hours > 0) {
                    return `${prefix}${hours}H ${minutes}M`;
                } else {
                    return `${prefix}${minutes}M`;
                }
            };

            const currentTime = Math.floor(Date.now() / 1000);
            const timeUntilExpiry = order.timings.expiresAt - currentTime;
            const expiryText = formatTimeDiff(timeUntilExpiry);

            // Add price-estimate class if using default price
            const sellPriceClass = sellTokenUsdPrice ? '' : 'price-estimate';
            const buyPriceClass = buyTokenUsdPrice ? '' : 'price-estimate';

            // Get order status from WebSocket cache
            const orderStatus = window.webSocket.getOrderStatus(order);

            tr.innerHTML = `
                <td>${order.id}</td>
                <td>
                    <div class="token-info">
                        ${this.getTokenIcon(sellTokenInfo)}
                        <div class="token-details">
                            <span>${sellTokenInfo.symbol}</span>
                            <span class="token-price ${sellPriceClass}">${formatUsdPrice(sellTokenUsdPrice)}</span>
                        </div>
                    </div>
                </td>
                <td>${formattedSellAmount}</td>
                <td>
                    <div class="token-info">
                        ${this.getTokenIcon(buyTokenInfo)}
                        <div class="token-details">
                            <span>${buyTokenInfo.symbol}</span>
                            <span class="token-price ${buyPriceClass}">${formatUsdPrice(buyTokenUsdPrice)}</span>
                        </div>
                    </div>
                </td>
                <td>${formattedBuyAmount}</td>
                <td>${(deal || 0).toFixed(6)}</td>
                <td>${expiryText}</td>
                <td class="order-status">${orderStatus}</td>
                <td class="action-column"></td>`;

            // Add cancel button logic to action column
            const actionCell = tr.querySelector('.action-column');
            const userAddress = window.walletManager.getAccount()?.toLowerCase();
            
            // Use WebSocket helper to determine if order can be cancelled
            if (window.webSocket.canCancelOrder(order, userAddress)) {
                const cancelButton = document.createElement('button');
                cancelButton.className = 'cancel-order-btn';
                cancelButton.textContent = 'Cancel';
                
                cancelButton.addEventListener('click', async () => {
                    try {
                        cancelButton.disabled = true;
                        cancelButton.textContent = 'Cancelling...';
                        cancelButton.classList.add('disabled');

                        // Get contract from WebSocket and connect to signer
                        const contract = window.webSocket.contract;
                        if (!contract) {
                            throw new Error('Contract not available');
                        }

                        const signer = this.provider.getSigner();
                        const contractWithSigner = contract.connect(signer);
                        
                        // Add gas buffer
                        const gasEstimate = await contractWithSigner.estimateGas.cancelOrder(order.id);
                        const gasLimit = gasEstimate.mul(120).div(100); // Add 20% buffer
                        
                        cancelButton.textContent = 'Approving...';
                        
                        const tx = await contractWithSigner.cancelOrder(order.id, { gasLimit });
                        
                        cancelButton.textContent = 'Confirming...';
                        
                        const receipt = await tx.wait();
                        if (receipt.status === 0) {
                            throw new Error('Transaction reverted by contract');
                        }

                        // Show success notification
                        this.showSuccess(`Order ${order.id} cancelled successfully!`);

                        // Update the row status immediately
                        const statusCell = tr.querySelector('td.order-status');
                        if (statusCell) {
                            statusCell.textContent = 'Cancelled';
                            statusCell.classList.add('cancelled');
                        }

                        // Remove the cancel button
                        actionCell.textContent = '-';

                        this.debouncedRefresh();
                    } catch (error) {
                        this.debug('Error cancelling order:', error);
                        if (error.code === 4001) {
                            this.showError('Transaction rejected by user');
                        } else {
                            this.showError(this.getReadableError(error));
                        }
                    } finally {
                        cancelButton.disabled = false;
                        cancelButton.textContent = 'Cancel';
                        cancelButton.classList.remove('disabled');
                    }
                });
                
                actionCell.appendChild(cancelButton);
            } else {
                actionCell.textContent = '-';
            }

            // Start the expiry timer
            this.startExpiryTimer(tr);

            return tr;
        } catch (error) {
            this.error('Error creating order row:', error);
            return null;
        }
    }

    updatePaginationControls(totalOrders) {
        const pageSize = parseInt(this.container.querySelector('#page-size-select')?.value || '25');
        
        const updateControls = (container) => {
            const prevButton = container.querySelector('.prev-page');
            const nextButton = container.querySelector('.next-page');
            const pageInfo = container.querySelector('.page-info');
            
            if (!prevButton || !nextButton || !pageInfo) {
                console.warn('Pagination controls not found');
                return;
            }
            
            if (pageSize === -1) {
                // Show all orders
                prevButton.disabled = true;
                nextButton.disabled = true;
                pageInfo.textContent = `Showing all ${totalOrders} orders`;
                return;
            }
            
            const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
            
            // Ensure current page is within bounds
            this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);
            
            prevButton.disabled = this.currentPage <= 1;
            nextButton.disabled = this.currentPage >= totalPages;
            
            const startItem = ((this.currentPage - 1) * pageSize) + 1;
            const endItem = Math.min(this.currentPage * pageSize, totalOrders);
            
            pageInfo.textContent = `${startItem}-${endItem} of ${totalOrders} orders (Page ${this.currentPage} of ${totalPages})`;
        };
        
        // Update both top and bottom controls
        const controls = this.container.querySelectorAll('.filter-controls');
        controls.forEach(updateControls);
    }

    startExpiryTimer(row) {
        // Clear any existing timer
        const existingTimer = this.expiryTimers?.get(row.dataset.orderId);
        if (existingTimer) {
            clearInterval(existingTimer);
        }

        // Initialize timers Map if not exists
        if (!this.expiryTimers) {
            this.expiryTimers = new Map();
        }

        const updateExpiryAndButton = async () => {
            const expiresCell = row.querySelector('td:nth-child(7)');
            const actionCell = row.querySelector('.action-column');
            if (!expiresCell || !actionCell) return;

            const orderId = row.dataset.orderId;
            const order = window.webSocket.orderCache.get(Number(orderId));
            if (!order) return;

            const currentTime = Math.floor(Date.now() / 1000);
            const timeDiff = order.timings.expiresAt - currentTime;
            const currentAccount = window.walletManager.getAccount()?.toLowerCase();

            // Update expiry text
            const newExpiryText = this.formatTimeDiff(timeDiff);
            if (expiresCell.textContent !== newExpiryText) {
                expiresCell.textContent = newExpiryText;
            }

            // Update action column content for MyOrders view
            if (window.webSocket.canCancelOrder(order, currentAccount)) {
                // Only update if there isn't already a cancel button
                if (!actionCell.querySelector('.cancel-order-btn')) {
                    const cancelButton = document.createElement('button');
                    cancelButton.className = 'cancel-order-btn';
                    cancelButton.textContent = 'Cancel';
                    
                    cancelButton.addEventListener('click', async () => {
                        try {
                            cancelButton.disabled = true;
                            cancelButton.textContent = 'Cancelling...';
                            
                            // Get contract from WebSocket and connect to signer
                            const contract = window.webSocket.contract;
                            if (!contract) {
                                throw new Error('Contract not available');
                            }

                            const signer = this.provider.getSigner();
                            const contractWithSigner = contract.connect(signer);
                            
                            const gasEstimate = await contractWithSigner.estimateGas.cancelOrder(order.id);
                            const gasLimit = gasEstimate.mul(120).div(100); // Add 20% buffer
                            
                            const tx = await contractWithSigner.cancelOrder(order.id, { gasLimit });
                            this.showError(`Cancelling order ${order.id}... Transaction sent`);
                            
                            const receipt = await tx.wait();
                            if (receipt.status === 0) {
                                throw new Error('Transaction reverted by contract');
                            }

                            this.showSuccess(`Order ${order.id} cancelled successfully!`);
                            actionCell.textContent = '-';
                            this.debouncedRefresh();
                        } catch (error) {
                            console.error('Error cancelling order:', error);
                            this.showError(this.getReadableError(error));
                            cancelButton.disabled = false;
                            cancelButton.textContent = 'Cancel';
                        }
                    });
                    
                    actionCell.innerHTML = '';
                    actionCell.appendChild(cancelButton);
                }
            } else if (order.maker?.toLowerCase() === currentAccount) {
                actionCell.innerHTML = '<span class="your-order">Your Order</span>';
            } else if (currentTime > order.timings.expiresAt) {
                actionCell.innerHTML = '<span class="expired-order">Expired</span>';
            } else {
                actionCell.textContent = '-';
            }
        };

        // Update immediately and then every minute
        updateExpiryAndButton();
        const timerId = setInterval(updateExpiryAndButton, 60000);
        this.expiryTimers.set(row.dataset.orderId, timerId);
    }
}