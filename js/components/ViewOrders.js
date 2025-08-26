import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { ContractError, CONTRACT_ERRORS } from '../errors/ContractErrors.js';
import { getNetworkConfig } from '../config.js';
import { walletManager } from '../config.js';
import { createLogger } from '../services/LogService.js';
import { tokenIconService } from '../services/TokenIconService.js';
import { generateTokenIconHTML } from '../utils/tokenIcons.js';
import { handleTransactionError } from '../utils/ui.js';

export class ViewOrders extends BaseComponent {
    constructor(containerId = 'view-orders') {
        super(containerId);
        this.provider = typeof window.ethereum !== 'undefined' ? 
            new ethers.providers.Web3Provider(window.ethereum) : null;
        this.currentPage = 1;
        this.totalOrders = 0;
        this.setupErrorHandling();
        this.eventSubscriptions = new Set();
        this.expiryTimers = new Map();
        this.tokenList = [];
        this.currentAccount = null;
        
        // Initialize logger
        const logger = createLogger('VIEW_ORDERS');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);

        // Add debounce mechanism
        this._refreshTimeout = null;
        this.debouncedRefresh = () => {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = setTimeout(() => {
                this.refreshOrdersView().catch(error => {
                    this.error('Error refreshing orders:', error);
                });
            }, 100);
        };

        // Add loading state
        this.isLoading = false;

        // Use global pricing service instead of local instance
        this.pricingService = window.pricingService;

        // Subscribe to pricing updates from global service
        if (window.pricingService) {
            window.pricingService.subscribe((event) => {
                if (event === 'refreshComplete') {
                    this.debug('Prices updated, refreshing orders view');
                    this.refreshOrdersView().catch(error => {
                        this.error('Error refreshing orders after price update:', error);
                    });
                }
            });
        }

        // Subscribe to WebSocket updates
        if (window.webSocket) {
            window.webSocket.subscribe("ordersUpdated", () => {
                this.debug('Orders updated via WebSocket, refreshing view');
                this.refreshOrdersView().catch(error => {
                    this.error('Error refreshing orders after WebSocket update:', error);
                });
            });
        }
    }

    async init() {
        try {
            this.debug('Initializing ViewOrders...');
            
            // Wait for WebSocket initialization first
            if (!window.webSocket) {
                this.debug('WebSocket not available, showing loading state...');
                this.showLoadingState();
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.init(); // Retry initialization
            }

            // Wait for WebSocket to be fully initialized
            await window.webSocket.waitForInitialization();
            
            // Get current account
            this.currentAccount = walletManager.getAccount()?.toLowerCase();
            this.debug('Current account:', this.currentAccount);
            
            // Add wallet state listener to refresh UI when wallet state changes
            this.walletListener = (event, data) => {
                this.debug('Wallet event received:', event, data);
                if (event === 'connect' || event === 'disconnect' || event === 'accountsChanged') {
                    this.debug('Wallet state changed, refreshing orders view');
                    this.currentAccount = walletManager.getAccount()?.toLowerCase();
                    this.refreshOrdersView().catch(error => {
                        this.error('Error refreshing orders after wallet state change:', error);
                    });
                }
            };
            walletManager.addListener(this.walletListener);
            
            // Setup WebSocket subscriptions
            await this.setupWebSocket();
            
            this.debug('ViewOrders initialization complete');
        } catch (error) {
            this.debug('Error in ViewOrders initialization:', error);
            this.showError('Failed to initialize orders view');
        }
    }

    showLoadingState() {
        this.container.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading orders...</div>
            </div>`;
    }

    async getTokenIcon(token) {
        try {
            if (!token?.address) {
                this.debug('No token address provided:', token);
                return this.getDefaultTokenIcon();
            }

            // If token already has an iconUrl, use it
            if (token.iconUrl) {
                this.debug('Using existing iconUrl for token:', token.symbol);
                return generateTokenIconHTML(token.iconUrl, token.symbol, token.address);
            }
            
            // Otherwise, get icon URL from token icon service
            const chainId = walletManager.chainId ? parseInt(walletManager.chainId, 16) : 137; // Default to Polygon
            const iconUrl = await tokenIconService.getIconUrl(token.address, chainId);
            
            // Generate HTML using the utility function
            return generateTokenIconHTML(iconUrl, token.symbol, token.address);
        } catch (error) {
            this.debug('Error getting token icon:', error);
            return this.getDefaultTokenIcon();
        }
    }

    getDefaultTokenIcon() {
        return generateTokenIconHTML('fallback', '?', 'unknown');
    }

    // Helper method to render token icon asynchronously
    async renderTokenIcon(token, container) {
        try {
            const iconHtml = await this.getTokenIcon(token);
            container.innerHTML = iconHtml;
        } catch (error) {
            this.debug('Error rendering token icon:', error);
            // Fallback to basic icon
            container.innerHTML = generateTokenIconHTML('fallback', token.symbol, token.address);
        }
    }

    // Update last updated timestamp
    updateLastUpdatedTimestamp(element) {
        if (!element || !this.pricingService) return;
        
        const lastUpdateTime = this.pricingService.getLastUpdateTime();
        if (lastUpdateTime && lastUpdateTime !== 'Never') {
            element.textContent = `Last updated: ${lastUpdateTime}`;
            element.style.display = 'inline';
        } else {
            element.textContent = 'No prices loaded yet';
            element.style.display = 'inline';
        }
    }

    setupErrorHandling() {
        if (!window.webSocket) {
            if (!this._retryAttempt) {
                this.warn('WebSocket not available, waiting for initialization...');
                this._retryAttempt = true;
            }
            setTimeout(() => this.setupErrorHandling(), 1000);
            return;
        }
        this._retryAttempt = false;

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
            this.error('Order error:', {
                code: error.code,
                message: error.message,
                details: error.details
            });
        });
    }

    async initialize(readOnlyMode = true) {
        if (!this.initialized) {
            // First time setup - create table structure and setup WebSocket
            await this.setupTable();
            await this.setupWebSocket();
            this.initialized = true;
        }
        // Just refresh the view with current cache
        await this.refreshOrdersView();
    }

    async setupWebSocket() {
        this.debug('Setting up WebSocket subscriptions');
        
        if (!window.webSocket?.provider) {
            this.debug('WebSocket provider not available, waiting for reconnection...');
            return;
        }

        // Add provider state logging
        this.debug('WebSocket provider state:', {
            connected: window.webSocket.provider._websocket?.connected,
            readyState: window.webSocket.provider._websocket?.readyState
        });
        
        // Clear existing subscriptions
        this.eventSubscriptions.forEach(sub => {
            window.webSocket.unsubscribe(sub.event, sub.callback);
        });
        this.eventSubscriptions.clear();

        // Add new subscriptions with error handling
        const addSubscription = (event, callback) => {
            const wrappedCallback = async (...args) => {
                try {
                    await callback(...args);
                } catch (error) {
                    this.debug(`Error in ${event} callback:`, error);
                    this.showError('Error processing order update');
                }
            };
            this.eventSubscriptions.add({ event, callback: wrappedCallback });
            window.webSocket.subscribe(event, wrappedCallback);
        };

        // Add subscriptions with error handling
        addSubscription('orderSyncComplete', async (orders) => {
            this.debug('Order sync complete:', orders);
            await this.refreshOrdersView();
        });

        // Add other event subscriptions similarly
        ['OrderCreated', 'OrderFilled', 'OrderCanceled'].forEach(event => {
            addSubscription(event, async (orderData) => {
                this.debug(`${event} event received:`, orderData);
                await this.refreshOrdersView();
            });
        });
    }

    async refreshOrdersView() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            // Get all orders first
            let ordersToDisplay = Array.from(window.webSocket.orderCache.values());
            
            // Apply token filters
            const sellTokenFilter = this.container.querySelector('#sell-token-filter')?.value;
            const buyTokenFilter = this.container.querySelector('#buy-token-filter')?.value;
            const orderSort = this.container.querySelector('#order-sort')?.value;
            const showOnlyActive = this.container.querySelector('#fillable-orders-toggle')?.checked;

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

            // Filter orders based on status and fillable flag
            ordersToDisplay = ordersToDisplay.filter(order => {
                const currentTime = Math.floor(Date.now() / 1000);
                const expiresAt = order?.timings?.expiresAt;
                const isExpired = typeof expiresAt === 'number' ? currentTime > expiresAt : false;
                const isActive = order.status === 'Active' && !isExpired;
                const canFill = window.webSocket.canFillOrder(order, walletManager.getAccount());
                const isUserOrder = order.maker?.toLowerCase() === walletManager.getAccount()?.toLowerCase();

                // Apply token filters
                if (sellTokenFilter && order.sellToken.toLowerCase() !== sellTokenFilter.toLowerCase()) return false;
                if (buyTokenFilter && order.buyToken.toLowerCase() !== buyTokenFilter.toLowerCase()) return false;

                // Apply active/fillable filter
                if (showOnlyActive) {
                    return isActive && (canFill || isUserOrder);
                }
                
                return true; // Show all orders when checkbox is unchecked
            });

            // Set total orders after filtering
            this.totalOrders = ordersToDisplay.length;

            // Apply sorting
            if (orderSort === 'newest') {
                ordersToDisplay.sort((a, b) => b.id - a.id);
            } else if (orderSort === 'best-deal') {
                ordersToDisplay.sort((a, b) => {
                    const dealA = a.dealMetrics?.deal > 0 ? 1 / a.dealMetrics.deal : Infinity;
                    const dealB = b.dealMetrics?.deal > 0 ? 1 / b.dealMetrics.deal : Infinity;
                    return dealB - dealA; // Higher deal is better for buyer perspective
                });
            }

            // Apply pagination
            const pageSizeSelect = this.container.querySelector('#page-size-select');
            const pageSize = pageSizeSelect ? parseInt(pageSizeSelect.value) : 25; // Default to 25 if element doesn't exist
            const startIndex = (this.currentPage - 1) * pageSize;
            const endIndex = pageSize === -1 ? ordersToDisplay.length : startIndex + pageSize;
            const paginatedOrders = pageSize === -1 ? 
                ordersToDisplay : 
                ordersToDisplay.slice(startIndex, endIndex);

            // Update the table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                this.debug('No tbody found, skipping table update');
                return;
            }
            tbody.innerHTML = '';
            
            for (const order of paginatedOrders) {
                const newRow = await this.createOrderRow(order);
                if (newRow) {
                    tbody.appendChild(newRow);
                }
            }

            // Show empty state if no orders
            if (paginatedOrders.length === 0) {
                tbody.innerHTML = `
                    <tr class="empty-message">
                        <td colspan="7" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyActive ? 
                                    'No fillable orders found' : 
                                    'No orders found'}
                            </div>
                        </td>
                    </tr>`;
            }

            // Update pagination controls
            this.updatePaginationControls(this.totalOrders);

        } catch (error) {
            this.debug('Error refreshing orders:', error);
            this.showError('Failed to refresh orders view');
        } finally {
            this.isLoading = false;
        }
    }

    showReadOnlyMessage() {
        this.container.innerHTML = `
            <div class="tab-content-wrapper">
                <h2>Orders</h2>
                <p class="connect-prompt">Connect wallet to view orders</p>
            </div>`;
    }

    async setupTable() {
        // Prevent multiple table setups
        if (this._tableSetup) {
            this.debug('Table already setup, skipping...');
            return;
        }
        this._tableSetup = true;
        
        // Clear existing content to prevent duplicates
        this.container.innerHTML = '';
        
        const tableContainer = this.createElement('div', 'table-container');
        
        // Main filter controls
        const filterControls = this.createElement('div', 'filter-controls');
        filterControls.innerHTML = `
            <div class="filter-row">
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
                        <span>Show only fillable orders</span>
                    </label>
                </div>

                <div class="pagination-controls">
                    <select id="page-size-select" class="page-size-select">
                        <option value="10">10 per page</option>
                        <option value="25" selected>25 per page</option>
                        <option value="50">50 per page</option>
                        <option value="100">100 per page</option>
                        <option value="-1">View all</option>
                    </select>
                    
                    <div class="pagination-buttons">
                        <button class="pagination-button prev-page" title="Previous page">←</button>
                        <span class="page-info">Page 1 of 1</span>
                        <button class="pagination-button next-page" title="Next page">→</button>
                    </div>
                </div>
            </div>
        `;
        // Get tokens from WebSocket's tokenCache
        const tokens = Array.from(window.webSocket.tokenCache.values())
            .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Sort alphabetically by symbol
        
        this.debug('Available tokens:', tokens);

        // Advanced filters section
        const advancedFilters = this.createElement('div', 'advanced-filters');
        advancedFilters.style.display = 'none';
        advancedFilters.innerHTML = `
            <div class="filter-row">
                <div class="token-filters">
                    <select id="sell-token-filter" class="token-filter">
                        <option value="">All Buy Tokens</option>
                        ${tokens.map(token => 
                            `<option value="${token.address}">${token.symbol}</option>`
                        ).join('')}
                    </select>
                    <select id="buy-token-filter" class="token-filter">
                        <option value="">All Sell Tokens</option>
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
        `;

        // Add the advanced filters section after the main controls
        filterControls.appendChild(advancedFilters);
        
        // Setup advanced filters toggle
        const advancedFiltersToggle = filterControls.querySelector('.advanced-filters-toggle');
        advancedFiltersToggle.addEventListener('click', () => {
            const isExpanded = advancedFilters.style.display !== 'none';
            advancedFilters.style.display = isExpanded ? 'none' : 'block';
            advancedFiltersToggle.classList.toggle('expanded', !isExpanded);
        });

        // Add event listeners for filters
        const sellTokenFilter = advancedFilters.querySelector('#sell-token-filter');
        const buyTokenFilter = advancedFilters.querySelector('#buy-token-filter');
        const orderSort = advancedFilters.querySelector('#order-sort');

        sellTokenFilter.addEventListener('change', () => this.refreshOrdersView());
        buyTokenFilter.addEventListener('change', () => this.refreshOrdersView());
        orderSort.addEventListener('change', () => this.refreshOrdersView());

        tableContainer.appendChild(filterControls);
        
        // Add table
        const table = this.createElement('table', 'orders-table');
        
        const thead = this.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>ID</th>
                <th>Buy</th>
                <th>Sell</th>
                <th>
                    Deal
                    <span class="info-icon" title="Deal = Buy Value / Sell Value
                    
• Higher deal number is better
• Deal > 1: better deal based on market prices
• Deal < 1: worse deal based on market prices">ⓘ</span>
                </th>
                <th>Expires</th>
                <th>Status</th>
                <th>Action</th>
            </tr>`;
        
        table.appendChild(thead);
        table.appendChild(this.createElement('tbody'));
        tableContainer.appendChild(table);
        
        // Bottom controls with refresh button
        const bottomControls = this.createElement('div', 'filter-controls bottom-controls');
        bottomControls.innerHTML = `
            <div class="filter-row">
                <div class="refresh-container">
                    <button id="refresh-prices-btn" class="refresh-prices-button">↻ Refresh Prices</button>
                    <span class="refresh-status"></span>
                    <span class="last-updated" id="last-updated-timestamp"></span>
                </div>

                <div class="pagination-controls">
                    <div class="pagination-buttons">
                        <button class="pagination-button prev-page" title="Previous page">←</button>
                        <span class="page-info">Page 1 of 1</span>
                        <button class="pagination-button next-page" title="Next page">→</button>
                    </div>
                </div>
            </div>
        `;
        
        tableContainer.appendChild(bottomControls);

        // Setup refresh button functionality
        const refreshButton = bottomControls.querySelector('#refresh-prices-btn');
        const statusIndicator = bottomControls.querySelector('.refresh-status');
        const lastUpdatedElement = bottomControls.querySelector('#last-updated-timestamp');
        
        // Initialize last updated timestamp
        this.updateLastUpdatedTimestamp(lastUpdatedElement);
        
        let refreshTimeout;
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
                    // Update timestamp after successful refresh
                    this.updateLastUpdatedTimestamp(lastUpdatedElement);
                    await this.refreshOrdersView();
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

        // Sync both page size selects
        const topSelect = filterControls.querySelector('#page-size-select');
        
        topSelect.addEventListener('change', () => {
            this.currentPage = 1;
            this.refreshOrdersView();
        });

        // Add event listeners for pagination
        const toggle = filterControls.querySelector('#fillable-orders-toggle');
        toggle.addEventListener('change', () => this.refreshOrdersView());
        
        // Add event listeners for pagination
        const setupPaginationListeners = (controls) => {
            const prevButton = controls.querySelector('.prev-page');
            const nextButton = controls.querySelector('.next-page');
            const pageInfo = controls.querySelector('.page-info');
            
            prevButton.addEventListener('click', () => {
                console.log('Previous clicked, current page:', this.currentPage);
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.updatePageInfo(pageInfo);
                    this.refreshOrdersView();
                }
            });
            
            nextButton.addEventListener('click', () => {
                const pageSize = parseInt(this.container.querySelector('#page-size-select').value);
                console.log('Next clicked, current page:', this.currentPage, 'total orders:', this.totalOrders, 'page size:', pageSize);
                const totalPages = Math.ceil(this.totalOrders / pageSize);
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.updatePageInfo(pageInfo);
                    this.refreshOrdersView();
                }
            });
        };

        // Add this helper method to your class
        this.updatePageInfo = (pageInfoElement) => {
            const pageSize = parseInt(this.container.querySelector('#page-size-select').value);
            const totalPages = Math.ceil(this.totalOrders / pageSize);
            pageInfoElement.textContent = `Page ${this.currentPage} of ${totalPages}`;
        };

        // Setup pagination for both top and bottom controls
        const controls = tableContainer.querySelectorAll('.filter-controls');
        controls.forEach(setupPaginationListeners);

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

    setupEventListeners() {
        this.tbody.addEventListener('click', async (e) => {
            if (e.target.classList.contains('fill-button')) {
                const orderId = e.target.dataset.orderId;
                await this.fillOrder(orderId);
            }
        });
    }

    async checkAllowance(tokenAddress, owner, amount) {
        try {
            if (!this.provider) {
                return false;
            }
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function allowance(address owner, address spender) view returns (uint256)'],
                this.provider
            );
            const allowance = await tokenContract.allowance(owner, this.webSocket.contractAddress);
            return allowance.gte(amount);
        } catch (error) {
            this.error('Error checking allowance:', error);
            return false;
        }
    }

    async fillOrder(orderId) {
        const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
        
        try {
            if (!this.provider) {
                throw new Error('MetaMask is not installed. Please install MetaMask to take orders.');
            }

            // Check if wallet is connected and has an account
            const connectedAccount = walletManager.getAccount();
            if (!connectedAccount) {
                throw new Error('Please sign in to fill order');
            }

            // Additional check to ensure signer is properly connected
            try {
                const signer = this.provider.getSigner();
                await signer.getAddress(); // This will throw if not properly connected
            } catch (error) {
                throw new Error('Please sign in to fill order');
            }

            if (button) {
                button.disabled = true;
                button.textContent = 'Filling...';
                button.classList.add('disabled');
            }

            this.debug('Starting fill order process for orderId:', orderId);
            
            const order = window.webSocket.orderCache.get(Number(orderId));
            this.debug('Order details:', order);

            if (!order) {
                throw new Error('Order not found');
            }

            // Get contract from WebSocket and connect to signer
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not available');
            }
            const signer = this.provider.getSigner();
            const contractWithSigner = contract.connect(signer);

            // Check order status first
            const currentOrder = await contractWithSigner.orders(orderId);
            this.debug('Current order state:', currentOrder);
            
            if (currentOrder.status !== 0) {
                throw new Error(`Order is not active (status: ${this.getOrderStatusText(currentOrder.status)})`);
            }

            // Check expiry
            const now = Math.floor(Date.now() / 1000);
            const orderExpiry = await contract.ORDER_EXPIRY();
            const expiryTime = Number(order.timestamp) + orderExpiry.toNumber();
            
            if (now >= expiryTime) {
                throw new Error('Order has expired');
            }

            // Get token contracts
            const buyToken = new ethers.Contract(
                order.buyToken,
                erc20Abi,
                this.provider.getSigner()
            );
            
            const sellToken = new ethers.Contract(
                order.sellToken,
                erc20Abi,
                this.provider.getSigner()
            );

            const currentAccount = await this.provider.getSigner().getAddress();

            // Get token details for proper formatting
            const buyTokenDecimals = await buyToken.decimals();
            const buyTokenSymbol = await buyToken.symbol();
            
            // Check balances first
            const buyTokenBalance = await buyToken.balanceOf(currentAccount);
            this.debug('Buy token balance:', {
                balance: buyTokenBalance.toString(),
                required: order.buyAmount.toString()
            });

            if (buyTokenBalance.lt(order.buyAmount)) {
                const formattedBalance = ethers.utils.formatUnits(buyTokenBalance, buyTokenDecimals);
                const formattedRequired = ethers.utils.formatUnits(order.buyAmount, buyTokenDecimals);
                
                throw new Error(
                    `Insufficient ${buyTokenSymbol} balance.\n` +
                    `Required: ${Number(formattedRequired).toLocaleString()} ${buyTokenSymbol}\n` +
                    `Available: ${Number(formattedBalance).toLocaleString()} ${buyTokenSymbol}`
                );
            }

            // Check allowances
            const buyTokenAllowance = await buyToken.allowance(currentAccount, contract.address);
            this.debug('Buy token allowance:', {
                current: buyTokenAllowance.toString(),
                required: order.buyAmount.toString()
            });

            if (buyTokenAllowance.lt(order.buyAmount)) {
                this.debug('Requesting buy token approval');
                const approveTx = await buyToken.approve(
                    contract.address, 
                    order.buyAmount  // Use exact order amount instead of MaxUint256
                );
                await approveTx.wait();
                this.showSuccess(`${buyTokenSymbol} approval granted`);
            }

            // Verify contract has enough sell tokens
            const contractSellBalance = await sellToken.balanceOf(contract.address);
            this.debug('Contract sell token balance:', {
                balance: contractSellBalance.toString(),
                required: order.sellAmount.toString()
            });

            if (contractSellBalance.lt(order.sellAmount)) {
                const sellTokenSymbol = await sellToken.symbol();
                const sellTokenDecimals = await sellToken.decimals();
                const formattedBalance = ethers.utils.formatUnits(contractSellBalance, sellTokenDecimals);
                const formattedRequired = ethers.utils.formatUnits(order.sellAmount, sellTokenDecimals);
                
                throw new Error(
                    `Contract has insufficient ${sellTokenSymbol} balance.\n` +
                    `Required: ${Number(formattedRequired).toLocaleString()} ${sellTokenSymbol}\n` +
                    `Available: ${Number(formattedBalance).toLocaleString()} ${sellTokenSymbol}`
                );
            }

            // Add gas buffer and execute transaction
            const gasEstimate = await contractWithSigner.estimateGas.fillOrder(orderId);
            this.debug('Gas estimate:', gasEstimate.toString());
            
            const gasLimit = gasEstimate.mul(120).div(100); // Add 20% buffer
            const tx = await contractWithSigner.fillOrder(orderId, { gasLimit });
            this.debug('Transaction sent:', tx.hash);
            
            const receipt = await tx.wait();
            this.debug('Transaction receipt:', receipt);

            if (receipt.status === 0) {
                throw new Error('Transaction reverted by contract');
            }

            order.status = 'Filled';
            await this.refreshOrdersView();

            this.showSuccess(`Order ${orderId} filled successfully!`);

        } catch (error) {
            this.debug('Fill order error details:', error);
            
            // Use utility function for consistent error handling
            handleTransactionError(error, this, 'fill order');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Fill Order';
                button.classList.remove('disabled');
            }
        }
    }

    getReadableError(error) {
        if (error.message?.includes('insufficient allowance')) {
            return 'Insufficient token allowance';
        }
        if (error.message?.includes('insufficient balance')) {
            return 'Insufficient token balance';
        }
        
        // Handle contract revert errors with detailed messages
        if (error.code === -32603 && error.data?.message) {
            return error.data.message;
        }
        
        // Try to extract error from ethers error structure
        if (error.error?.data?.message) {
            return error.error.data.message;
        }
        
        switch (error.code) {
            case 'ACTION_REJECTED':
                return 'Transaction was rejected by user';
            case 'INSUFFICIENT_FUNDS':
                return 'Insufficient funds for gas';
            case -32603:
                return 'Transaction would fail. Check order status and approvals.';
            case 'UNPREDICTABLE_GAS_LIMIT':
                return 'Error estimating gas. The transaction may fail.';
            default:
                return error.reason || error.message || 'Unknown error occurred';
        }
    }

    cleanup() {
        // Remove wallet listener
        if (this.walletListener) {
            walletManager.removeListener(this.walletListener);
            this.walletListener = null;
        }
        
        // Only clear timers, keep table structure
        if (this.expiryTimers) {
            this.expiryTimers.forEach(timerId => clearInterval(timerId));
            this.expiryTimers.clear();
        }
        
        // Reset table setup flag to allow re-initialization if needed
        this._tableSetup = false;
        
        // Don't clear the table
    }

    async createOrderRow(order) {
        try {
            const tr = document.createElement('tr');
            tr.dataset.orderId = order.id.toString();
            tr.dataset.timestamp = order.timings?.createdAt?.toString() || '0';

            // Get token info from WebSocket cache
            const sellTokenInfo = await window.webSocket.getTokenInfo(order.sellToken);
            const buyTokenInfo = await window.webSocket.getTokenInfo(order.buyToken);
            const deal = order.dealMetrics?.deal > 0 ? 1 / order.dealMetrics?.deal : undefined; // view as buyer/taker
            // Use pre-formatted values from dealMetrics
            const { 
                formattedSellAmount,
                formattedBuyAmount,
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
                if (!price || !amount) return 'N/A';
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
            const expiryText = orderStatus === 'Active' && typeof expiryEpoch === 'number' 
                ? this.formatTimeDiff(expiryEpoch - Math.floor(Date.now() / 1000)) 
                : '';

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
                <td>${deal !== undefined ? (deal || 0).toFixed(6) : 'N/A'}</td>
                <td>${expiryText}</td>
                <td class="order-status">${orderStatus}</td>
                <td class="action-column"></td>`;

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

    updatePaginationControls(totalOrders) {
        const pageSize = parseInt(this.container.querySelector('#page-size-select')?.value || '25');
        
        const updateControls = (container) => {
            const prevButton = container.querySelector('.prev-page');
            const nextButton = container.querySelector('.next-page');
            const pageInfo = container.querySelector('.page-info');
            
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
            const expiresCell = row.querySelector('td:nth-child(5)');
            const statusCell = row.querySelector('.order-status');
            const actionCell = row.querySelector('.action-column');
            if (!expiresCell || !statusCell || !actionCell) return;

            const orderId = row.dataset.orderId;
            const order = window.webSocket.orderCache.get(Number(orderId));
            if (!order) return;

            const currentTime = Math.floor(Date.now() / 1000);
            const expiresAt = order?.timings?.expiresAt;
            const isExpired = typeof expiresAt === 'number' ? currentTime > expiresAt : false;
            const timeDiff = typeof expiresAt === 'number' ? expiresAt - currentTime : 0;
            const currentAccount = walletManager.getAccount()?.toLowerCase();
            const isUserOrder = order.maker?.toLowerCase() === currentAccount;

            // Update expiry text - only calculate for active orders
            const orderStatusForExpiry = window.webSocket.getOrderStatus(order);
            const newExpiryText = orderStatusForExpiry === 'Active' ? this.formatTimeDiff(timeDiff) : '';
            if (expiresCell.textContent !== newExpiryText) {
                expiresCell.textContent = newExpiryText;
            }

            // Update status column to show current status
            const currentStatus = window.webSocket.getOrderStatus(order);
            const statusMainElement = statusCell.querySelector('.status-main');
            if (statusMainElement && statusMainElement.textContent !== currentStatus) {
                statusMainElement.textContent = currentStatus;
                this.debug(`Updated status for order ${order.id}: ${currentStatus}`);
            } else if (!statusMainElement && statusCell.textContent !== currentStatus) {
                // Fallback for old structure
                statusCell.textContent = currentStatus;
                this.debug(`Updated status for order ${order.id}: ${currentStatus}`);
            }

            // Update action column content - no status text here, only actions
            if (isUserOrder) {
                actionCell.innerHTML = '<span class="mine-label">Mine</span>';
            } else if (!isUserOrder && window.webSocket.canFillOrder(order, currentAccount)) {
                actionCell.innerHTML = `<button class="fill-button" data-order-id="${order.id}">Fill</button>`;
                const fillButton = actionCell.querySelector('.fill-button');
                if (fillButton) {
                    fillButton.addEventListener('click', () => this.fillOrder(order.id));
                }
            } else {
                actionCell.innerHTML = '';
            }
        };

        // Update immediately and then every minute
        updateExpiryAndButton();
        const timerId = setInterval(updateExpiryAndButton, 60000); // Update every minute
        this.expiryTimers.set(row.dataset.orderId, timerId);
    }

    getExplorerUrl(address) {
        const networkConfig = getNetworkConfig();
        if (!networkConfig?.explorer) {
            console.warn('Explorer URL not configured');
            return '#';
        }
        return `${networkConfig.explorer}/address/${ethers.utils.getAddress(address)}`;
    }

    getOrderStatusText(status) {
        const statusMap = {
            0: 'Active',
            1: 'Filled',
            2: 'Cancelled'
            // Removed status 3 (Expired) as we want to keep showing 'Active'
        };
        return statusMap[status] || `Unknown (${status})`;
    }

    async getContract() {
        if (!window.webSocket?.contract) {
            throw new Error('WebSocket contract not initialized');
        }
        return window.webSocket.contract;
    }

    formatTimeDiff(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) {
            return `${days}D ${hours}H ${minutes}M`;
        } else if (hours > 0) {
            return `${hours}H ${minutes}M`;
        } else {
            return `${minutes}M`;
        }
    }
}
