import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { ContractError, CONTRACT_ERRORS } from '../errors/ContractErrors.js';
import { isDebugEnabled, getNetworkConfig } from '../config.js';

export class ViewOrders extends BaseComponent {
    constructor(containerId = 'view-orders') {
        super(containerId);
        this.orders = new Map();
        this.tokenCache = new Map();
        this.provider = new ethers.providers.Web3Provider(window.ethereum);
        this.currentPage = 1;
        this.setupErrorHandling();
        this.eventSubscriptions = new Set();
        this.expiryTimers = new Map();
        
        // Initialize debug logger with VIEW_ORDERS flag
        this.debug = (message, ...args) => {
            if (isDebugEnabled('VIEW_ORDERS')) {
                console.log('[ViewOrders]', message, ...args);
            }
        };

        // Add debounce mechanism
        this._refreshTimeout = null;
        this.debouncedRefresh = () => {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = setTimeout(() => {
                this.refreshOrdersView().catch(error => {
                    this.debug('Error refreshing orders:', error);
                });
            }, 100);
        };

        // Add loading state
        this.isLoading = false;

        // Initialize sorting state with null values
        this.sortConfig = {
            column: null,
            direction: null,
            isColumnClick: false
        };
    }

    setupErrorHandling() {
        if (!window.webSocket) {
            if (!this._retryAttempt) {
                this.debug('WebSocket not available, waiting for initialization...');
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
            this.debug('Order error:', {
                code: error.code,
                message: error.message,
                details: error.details
            });
        });
    }

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Initializing ViewOrders component');
            
            // Add WebSocket connection check
            if (!window.webSocket) {
                this.debug('ERROR: WebSocket not available');
                this.showError('WebSocket connection not available');
                return;
            }

            if (!window.webSocket.isInitialized) {
                this.debug('WebSocket not yet initialized, waiting...');
                let attempts = 0;
                const maxAttempts = 10;
                
                while (!window.webSocket.isInitialized && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;
                    this.debug(`Waiting for WebSocket initialization... Attempt ${attempts}/${maxAttempts}`);
                }
                
                if (!window.webSocket.isInitialized) {
                    this.debug('ERROR: WebSocket failed to initialize after waiting');
                    this.showError('Failed to connect to WebSocket');
                    return;
                }
            }

            // Add cache check
            const cachedOrders = window.webSocket.getOrders();
            this.debug('Initial cached orders:', {
                orderCount: cachedOrders?.length || 0,
                orders: cachedOrders
            });
            
            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();
            
            // Setup WebSocket event handlers
            await this.setupWebSocket();

            // Get initial orders from cache
            if (cachedOrders && cachedOrders.length > 0) {
                this.debug('Loading orders from cache:', cachedOrders);
                // Clear existing orders before adding new ones
                this.orders.clear();
                cachedOrders.forEach(order => {
                    this.orders.set(order.id, order);
                });
            }

            // Always call refreshOrdersView to show orders or empty state
            await this.refreshOrdersView();

        } catch (error) {
            this.debug('Initialization error:', error);
            throw error;
        }
    }

    async setupWebSocket() {
        this.debug('Setting up WebSocket subscriptions');
        
        // Add connection status check
        if (!window.webSocket?.provider) {
            this.debug('ERROR: WebSocket provider not available');
            this.showError('WebSocket provider not available');
            return;
        }

        // Add provider state logging
        this.debug('WebSocket provider state:', {
            connected: window.webSocket.provider._websocket?.connected,
            readyState: window.webSocket.provider._websocket?.readyState
        });
        
        // Clear existing subscriptions
        this.eventSubscriptions.clear();
        if (window.webSocket) {
            window.webSocket.subscribers.forEach((_, event) => {
                window.webSocket.unsubscribe(event, this);
            });
        }
        
        // Add new subscriptions
        this.eventSubscriptions.add({
            event: 'orderSyncComplete',
            callback: (orders) => {
                this.debug('Received order sync:', orders);
                this.orders.clear();
                Object.entries(orders).forEach(([orderId, orderData]) => {
                    this.orders.set(Number(orderId), {
                        id: Number(orderId),
                        ...orderData
                    });
                });
                this.refreshOrdersView().catch(console.error);
            }
        });

        this.eventSubscriptions.add({
            event: 'OrderCreated',
            callback: (orderData) => {
                this.debug('New order received:', orderData);
                this.orders.set(Number(orderData.id), orderData);
                this.refreshOrdersView().catch(error => {
                    console.error('[ViewOrders] Error refreshing view after new order:', error);
                });
            }
        });

        this.eventSubscriptions.add({
            event: 'OrderFilled',
            callback: (orderData) => {
                this.debug('Order filled:', orderData);
                if (this.orders.has(Number(orderData.id))) {
                    this.orders.get(Number(orderData.id)).status = 'Filled';
                    this.refreshOrdersView().catch(error => {
                        console.error('[ViewOrders] Error refreshing view after order fill:', error);
                    });
                }
            }
        });

        this.eventSubscriptions.add({
            event: 'OrderCanceled',
            callback: (orderData) => {
                this.debug('Order canceled:', orderData);
                if (this.orders.has(Number(orderData.id))) {
                    this.orders.get(Number(orderData.id)).status = 'Canceled';
                    this.refreshOrdersView().catch(error => {
                        console.error('[ViewOrders] Error refreshing view after order cancel:', error);
                    });
                }
            }
        });

        if (window.webSocket) {
            this.debug('Registering WebSocket subscriptions');
            this.eventSubscriptions.forEach(sub => {
                window.webSocket.subscribe(sub.event, sub.callback);
            });
        }
    }

    async refreshOrdersView() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            this.debug('Refreshing orders view');
            
            // Add WebSocket state check
            if (!window.webSocket?.isInitialized) {
                this.debug('ERROR: WebSocket not initialized during refresh');
                this.showError('WebSocket connection not available');
                return;
            }

            // Add order cache check
            const cachedOrders = Array.from(this.orders.values());
            this.debug('Current order cache:', {
                size: this.orders.size,
                orders: cachedOrders
            });

            this.showLoadingState();

            // Debug WebSocket state
            console.log('🔍 WebSocket contract availability:', {
                webSocketExists: !!window.webSocket,
                contractExists: !!window.webSocket?.contract,
                contractAddress: window.webSocket?.contract?.address
            });

            // Use WebSocket contract directly instead of getContract()
            const contract = window.webSocket?.contract;
            if (!contract) {
                console.log('🔍 Contract not available in WebSocket, trying getContract()');
                const fallbackContract = window.webSocket?.contract;
                if (!fallbackContract) {
                    console.log('🔍 No contract available at all - showing orders without expiry calculation');
                    // Show orders without expiry filtering
                    const orders = Array.from(this.orders.values());
                    await this.displayOrders(orders);
                    return;
                }
                this.contract = fallbackContract;
            } else {
                console.log('🔍 Using WebSocket contract:', contract.address);
                this.contract = contract;
            }
            
            // Get contract expiry times
            const orderExpiry = (await this.contract.ORDER_EXPIRY()).toNumber();
            const gracePeriod = (await this.contract.GRACE_PERIOD()).toNumber();
            const currentTime = Math.floor(Date.now() / 1000);

            // Get filter and pagination state
            const showOnlyActive = this.container.querySelector('#fillable-orders-toggle')?.checked;
            const pageSize = parseInt(this.container.querySelector('#page-size-select').value);
            
            // Process all orders first
            let ordersToDisplay = Array.from(this.orders.values());
            
            this.debug('Orders before filtering:', ordersToDisplay);

            // Get all token details at once
            const tokenAddresses = new Set();
            ordersToDisplay.forEach(order => {
                if (order?.sellToken) tokenAddresses.add(order.sellToken.toLowerCase());
                if (order?.buyToken) tokenAddresses.add(order.buyToken.toLowerCase());
            });

            const [tokenDetails] = await Promise.all([
                this.getTokenDetails(Array.from(tokenAddresses))
            ]);

            // Process token details
            const tokenDetailsMap = new Map();
            Array.from(tokenAddresses).forEach((address, index) => {
                if (tokenDetails[index]) {
                    tokenDetailsMap.set(address, tokenDetails[index]);
                }
            });

            // Do all async operations before touching the DOM
            if (showOnlyActive && this.contract) {
                ordersToDisplay = ordersToDisplay.filter(order => {
                    // Check if order is not filled or canceled
                    if (order.status === 'Filled' || order.status === 'Canceled') {
                        return false;
                    }

                    // Check if order is not expired
                    const expiryTime = Number(order.timestamp) + orderExpiry;
                    return currentTime < expiryTime;
                });
            }

            // Sort orders based on whether this is a column click or initial load
            if (this.sortConfig.isColumnClick) {
                switch (this.sortConfig.column) {
                    case 'id':
                        ordersToDisplay.sort((a, b) => {
                            const idCompare = Number(a.id) - Number(b.id);
                            return this.sortConfig.direction === 'asc' ? idCompare : -idCompare;
                        });
                        break;
                    case 'buy':
                        ordersToDisplay.sort((a, b) => {
                            const tokenA = tokenDetailsMap.get(a.buyToken.toLowerCase())?.symbol || '';
                            const tokenB = tokenDetailsMap.get(b.buyToken.toLowerCase())?.symbol || '';
                            const compare = tokenA.localeCompare(tokenB);
                            return this.sortConfig.direction === 'asc' ? compare : -compare;
                        });
                        break;
                    case 'sell':
                        ordersToDisplay.sort((a, b) => {
                            const tokenA = tokenDetailsMap.get(a.sellToken.toLowerCase())?.symbol || '';
                            const tokenB = tokenDetailsMap.get(b.sellToken.toLowerCase())?.symbol || '';
                            const compare = tokenA.localeCompare(tokenB);
                            return this.sortConfig.direction === 'asc' ? compare : -compare;
                        });
                        break;
                }
            } else {
                // Default status-based sorting
                ordersToDisplay.sort((a, b) => {
                    // Define status priority (Active = 0, Filled = 1, Canceled = 2, Expired = 3)
                    const getStatusPriority = (order) => {
                        // If order is explicitly Filled or Canceled, use that status
                        if (order.status === 'Filled') return 1;
                        if (order.status === 'Canceled') return 2;

                        // Check if Active order is expired
                        const orderTime = Number(order.timestamp);
                        const expiryTime = orderTime + orderExpiry;
                        
                        if (currentTime >= expiryTime) {
                            return 3; // Expired orders have lowest priority
                        }

                        return 0; // Active and not expired
                    };

                    const priorityA = getStatusPriority(a);
                    const priorityB = getStatusPriority(b);

                    // First sort by status priority
                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }

                    // Within same status, sort by ID descending
                    return Number(b.id) - Number(a.id);
                });
            }

            const totalOrders = ordersToDisplay.length;
            
            // Apply pagination
            if (pageSize !== -1) {
                const startIndex = (this.currentPage - 1) * pageSize;
                ordersToDisplay = ordersToDisplay.slice(startIndex, startIndex + pageSize);
            }

            // Create all rows before touching the DOM
            const rows = await Promise.all(ordersToDisplay.map(async order => {
                const orderWithLowercase = {
                    ...order,
                    sellToken: order.sellToken.toLowerCase(),
                    buyToken: order.buyToken.toLowerCase()
                };
                return this.createOrderRow(orderWithLowercase, tokenDetailsMap);
            }));

            // Only update the DOM once all processing is complete
            const tbody = this.container.querySelector('tbody');
            if (!tbody) return;

            // Update pagination before showing orders
            this.updatePaginationControls(totalOrders);

            // Show no orders message or display the rows
            if (!rows.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyActive ? 'No fillable orders found' : 'No orders found'}
                            </div>
                        </td>
                    </tr>`;
            } else {
                tbody.innerHTML = '';
                rows.forEach(row => {
                    if (row) tbody.appendChild(row);
                });
            }

        } catch (error) {
            this.debug('Error refreshing orders:', error);
            this.showError('Failed to refresh orders');
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

    updateOrderStatus(orderId, status) {
        const order = this.orders.get(orderId.toString());
        if (order) {
            order.status = status;
            this.orders.set(orderId.toString(), order);
            this.debouncedRefresh();
        }
    }

    async addOrderToTable(order, tokenDetailsMap) {
        try {
            this.orders.set(order.id.toString(), order);
            this.debouncedRefresh();
        } catch (error) {
            console.error('[ViewOrders] Error adding order to table:', error);
            throw error;
        }
    }

    removeOrderFromTable(orderId) {
        this.orders.delete(orderId.toString());
        this.debouncedRefresh();
    }

    async setupTable() {
        const tableContainer = this.createElement('div', 'table-container');
        
        // Create top pagination controls with dropdown
        const createTopControls = () => `
            <div class="pagination-controls">
                <select id="page-size-select" class="page-size-select">
                    <option value="10">10 per page</option>
                    <option value="25">25 per page</option>
                    <option value="50" selected>50 per page</option>
                    <option value="100">100 per page</option>
                    <option value="-1">View all</option>
                </select>
                
                <div class="pagination-buttons">
                    <button class="pagination-button prev-page" title="Previous page">
                        ←
                    </button>
                    <span class="page-info">Page 1 of 1</span>
                    <button class="pagination-button next-page" title="Next page">
                        →
                    </button>
                </div>
            </div>
        `;

        // Create bottom pagination controls without dropdown
        const createBottomControls = () => `
            <div class="pagination-controls">
                <div class="pagination-buttons">
                    <button class="pagination-button prev-page" title="Previous page">
                        ←
                    </button>
                    <span class="page-info">Page 1 of 1</span>
                    <button class="pagination-button next-page" title="Next page">
                        
                    </button>
                </div>
            </div>
        `;
        
        // Add top filter controls with pagination
        const filterControls = this.createElement('div', 'filter-controls');
        filterControls.innerHTML = `
            <div class="filter-row">
                <label class="filter-toggle">
                    <input type="checkbox" id="fillable-orders-toggle" checked>
                    <span>Show only fillable orders</span>
                </label>
                ${createTopControls()}
            </div>
        `;
        
        tableContainer.appendChild(filterControls);
        
        // Add table
        const table = this.createElement('table', 'orders-table');
        
        const thead = this.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th data-sort="id">ID <span class="sort-icon">↕</span></th>
                <th data-sort="buy">Buy <span class="sort-icon">↕</span></th>
                <th>Amount</th>
                <th data-sort="sell">Sell <span class="sort-icon">↕</span></th>
                <th>Amount</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Action</th>
            </tr>
        `;
        
        // Add click handlers for sorting
        thead.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => this.handleSort(th.dataset.sort));
        });
        
        table.appendChild(thead);
        table.appendChild(this.createElement('tbody'));
        tableContainer.appendChild(table);
        
        // Add bottom pagination
        const bottomControls = this.createElement('div', 'filter-controls bottom-controls');
        bottomControls.innerHTML = `
            <div class="filter-row">
                ${createBottomControls()}
            </div>
        `;
        tableContainer.appendChild(bottomControls);
        
        // Add event listeners
        const addPaginationListeners = (container, isTop) => {
            if (isTop) {
                const pageSizeSelect = container.querySelector('.page-size-select');
                if (pageSizeSelect) {
                    pageSizeSelect.addEventListener('change', () => {
                        this.currentPage = 1;
                        this.refreshOrdersView();
                    });
                }
            }
            
            const prevButton = container.querySelector('.prev-page');
            const nextButton = container.querySelector('.next-page');
            
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
                    if (this.currentPage < totalPages) {
                        this.currentPage++;
                        this.refreshOrdersView();
                    }
                });
            }
        };
        
        // Add listeners to both top and bottom controls
        addPaginationListeners(filterControls, true);
        addPaginationListeners(bottomControls, false);
        
        const toggle = filterControls.querySelector('#fillable-orders-toggle');
        toggle.addEventListener('change', () => this.refreshOrdersView());
        
        this.container.appendChild(tableContainer);

        // Initialize sorting state
        this.sortConfig = {
            column: 'id',
            direction: 'asc'
        };
    }

    handleSort(column) {
        this.debug('Sorting by column:', column);
        
        // If clicking same column and already in a sorted state
        if (this.sortConfig.column === column && this.sortConfig.isColumnClick) {
            // Cycle through: asc -> desc -> default (null)
            if (this.sortConfig.direction === 'asc') {
                this.sortConfig.direction = 'desc';
            } else if (this.sortConfig.direction === 'desc') {
                // Reset to default sorting
                this.sortConfig.direction = null;
                this.sortConfig.column = null;
                this.sortConfig.isColumnClick = false;
            }
        } else {
            // First click - start with ascending
            this.sortConfig.column = column;
            this.sortConfig.direction = 'asc';
            this.sortConfig.isColumnClick = true;
        }

        // Update sort icons and active states
        const headers = this.container.querySelectorAll('th[data-sort]');
        headers.forEach(header => {
            const icon = header.querySelector('.sort-icon');
            if (header.dataset.sort === column) {
                if (this.sortConfig.direction) {
                    header.classList.add('active-sort');
                    icon.textContent = this.sortConfig.direction === 'asc' ? '↑' : '↓';
                } else {
                    header.classList.remove('active-sort');
                    icon.textContent = '↕';
                }
            } else {
                header.classList.remove('active-sort');
                icon.textContent = '↕';
            }
        });

        this.debug('Sort config after update:', this.sortConfig);
        this.refreshOrdersView();
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

    async formatExpiry(timestamp) {
        try {
            const contract = window.webSocket?.contract;
            const orderExpiry = (await contract.ORDER_EXPIRY()).toNumber();  // 420 seconds (7 minutes)
            // Don't add gracePeriod here since we only want to show when it expires
            
            const expiryTime = Number(timestamp) + orderExpiry;  // Just use orderExpiry
            const now = Math.floor(Date.now() / 1000);
            const timeLeft = expiryTime - now;

            this.debug('Expiry calculation:', {
                timestamp,
                orderExpiry,
                expiryTime,
                now,
                timeLeft,
                timeLeftMinutes: timeLeft / 60
            });

            if (timeLeft <= 0) {
                return 'Expired';
            }

            const minutes = Math.ceil(timeLeft / 60);
            return `${minutes}m`;
        } catch (error) {
            this.debug('Error formatting expiry:', error);
            return 'Unknown';
        }
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

    async checkAllowance(tokenAddress, owner, amount) {
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function allowance(address owner, address spender) view returns (uint256)'],
                this.provider
            );
            const allowance = await tokenContract.allowance(owner, this.contract.address);
            return allowance.gte(amount);
        } catch (error) {
            console.error('[ViewOrders] Error checking allowance:', error);
            return false;
        }
    }

    async fillOrder(orderId, button) {
        try {
            if (button) {
                button.disabled = true;
                button.textContent = 'Processing...';
            }

            this.debug('Starting fill order process for orderId:', orderId);
            
            const order = this.orders.get(Number(orderId));
            this.debug('Order details:', order);

            if (!order) {
                throw new Error('Order not found');
            }

            // Check order status first
            const currentOrder = await this.contract.orders(orderId);
            this.debug('Current order state:', currentOrder);
            
            if (currentOrder.status !== 0) {
                throw new Error(`Order is not active (status: ${this.getOrderStatusText(currentOrder.status)})`);
            }

            // Check expiry
            const now = Math.floor(Date.now() / 1000);
            const orderExpiry = await this.contract.ORDER_EXPIRY();
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

            // Check balances first
            const buyTokenBalance = await buyToken.balanceOf(currentAccount);
            this.debug('Buy token balance:', {
                balance: buyTokenBalance.toString(),
                required: order.buyAmount.toString()
            });

            if (buyTokenBalance.lt(order.buyAmount)) {
                throw new Error(`Insufficient balance of buy token. Have: ${ethers.utils.formatEther(buyTokenBalance)}, Need: ${ethers.utils.formatEther(order.buyAmount)}`);
            }

            // Check allowances
            const buyTokenAllowance = await buyToken.allowance(currentAccount, this.contract.address);
            this.debug('Buy token allowance:', {
                current: buyTokenAllowance.toString(),
                required: order.buyAmount.toString()
            });

            if (buyTokenAllowance.lt(order.buyAmount)) {
                this.debug('Requesting buy token approval');
                const approveTx = await buyToken.approve(this.contract.address, order.buyAmount);
                await approveTx.wait();
                this.showSuccess('Token approval granted');
            }

            // Verify contract has enough sell tokens
            const contractSellBalance = await sellToken.balanceOf(this.contract.address);
            this.debug('Contract sell token balance:', {
                balance: contractSellBalance.toString(),
                required: order.sellAmount.toString()
            });

            if (contractSellBalance.lt(order.sellAmount)) {
                throw new Error('Contract does not have enough tokens to fill order');
            }

            // Estimate gas first
            try {
                const gasEstimate = await this.contract.estimateGas.fillOrder(orderId);
                this.debug('Gas estimate:', gasEstimate.toString());
                
                // Add 20% buffer to gas estimate
                const gasLimit = gasEstimate.mul(120).div(100);
                
                const tx = await this.contract.fillOrder(orderId, {
                    gasLimit
                });
                
                this.debug('Transaction sent:', tx.hash);
                const receipt = await tx.wait();
                this.debug('Transaction receipt:', receipt);

                if (receipt.status === 0) {
                    throw new Error('Transaction reverted by contract');
                }

                order.status = 'Filled';
                this.orders.set(Number(orderId), order);
                await this.refreshOrdersView();

                this.showSuccess(`Order ${orderId} filled successfully!`);
            } catch (error) {
                this.debug('Gas estimation/transaction error:', error);
                throw error;
            }

        } catch (error) {
            this.debug('Fill order error details:', error);
            
            // Handle replaced transactions that succeeded
            if (error.code === 'TRANSACTION_REPLACED' && !error.cancelled) {
                if (error.receipt?.status === 1) {
                    this.showSuccess('Order filled successfully!');
                    await this.refreshOrders();
                    return;
                }
            }
            
            this.showError('Failed to fill order');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Fill Order';
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

    async getOrderDetails(orderId) {
        try {
            const contract = window.webSocket?.contract;
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
        clearTimeout(this._refreshTimeout);
        // Clear all expiry timers
        if (this.expiryTimers) {
            this.expiryTimers.forEach(timerId => clearInterval(timerId));
            this.expiryTimers.clear();
        }
        
        // Clear existing subscriptions
        this.eventSubscriptions.forEach(sub => {
            if (window.webSocket) {
                window.webSocket.unsubscribe(sub.event, sub.callback);
            }
        });
        this.eventSubscriptions.clear();
        
        // Clear orders map
        this.orders.clear();
        
        // Clear the table
        if (this.container) {
            const tbody = this.container.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = '';
            }
        }
    }

    async createOrderRow(order, tokenDetailsMap) {
        const tr = this.createElement('tr');
        tr.dataset.orderId = order.id.toString();
        tr.dataset.timestamp = order.timestamp;
        tr.dataset.status = order.status;

        const sellTokenDetails = tokenDetailsMap.get(order.sellToken);
        const buyTokenDetails = tokenDetailsMap.get(order.buyToken);
        const canFill = await this.canFillOrder(order);
        const expiryTime = await this.getExpiryTime(order.timestamp);
        const status = this.getOrderStatus(order, expiryTime);
        const formattedExpiry = await this.formatExpiry(order.timestamp);
        
        // Get current account first
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        const currentAccount = accounts[0]?.toLowerCase();
        const isUserOrder = order.maker?.toLowerCase() === currentAccount;

        tr.innerHTML = `
            <td>${order.id}</td>
            <td>
                <div class="token-info">
                    <div class="token-icon small">
                        ${this.getTokenIcon(sellTokenDetails)}
                    </div>
                    <a href="${this.getExplorerUrl(order.sellToken)}" 
                       class="token-link" 
                       target="_blank" 
                       title="View token contract">
                        ${sellTokenDetails?.symbol || 'Unknown'}
                        <svg class="token-explorer-icon" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                        </svg>
                    </a>
                </div>
            </td>
            <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails?.decimals || 18)}</td>
            <td>
                <div class="token-info">
                    <div class="token-icon small">
                        ${this.getTokenIcon(buyTokenDetails)}
                    </div>
                    <a href="${this.getExplorerUrl(order.buyToken)}" 
                       class="token-link" 
                       target="_blank" 
                       title="View token contract">
                        ${buyTokenDetails?.symbol || 'Unknown'}
                        <svg class="token-explorer-icon" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                        </svg>
                    </a>
                </div>
            </td>
            <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails?.decimals || 18)}</td>
            <td>${formattedExpiry}</td>
            <td class="order-status">${status}</td>
            <td class="action-column">${canFill ? 
                `<button class="fill-button" data-order-id="${order.id}">Fill Order</button>` : 
                isUserOrder ?
                '<span class="your-order">Your Order</span>' : 
                ''
            }</td>`;

        // Add click handler for fill button
        const fillButton = tr.querySelector('.fill-button');
        if (fillButton) {
            fillButton.addEventListener('click', () => this.fillOrder(order.id));
        }

        // Start the expiry timer for this row
        this.startExpiryTimer(tr);
        
        return tr;
    }

    async getContractExpiryTimes() {
        try {
            const contract = window.webSocket?.contract;
            if (!contract) {
                throw new Error('Contract not initialized');
            }
            const orderExpiry = await contract.ORDER_EXPIRY();
            const gracePeriod = await contract.GRACE_PERIOD();
            return {
                orderExpiry: orderExpiry.toNumber(),
                gracePeriod: gracePeriod.toNumber()
            };
        } catch (error) {
            console.error('[ViewOrders] Error fetching expiry times:', error);
            throw error;
        }
    }

    async getExpiryTime(timestamp) {
        try {
            const { orderExpiry, gracePeriod } = await this.getContractExpiryTimes();
            return (Number(timestamp) + orderExpiry + gracePeriod) * 1000; // Convert to milliseconds
        } catch (error) {
            console.error('[ViewOrders] Error calculating expiry time:', error);
            return Number(timestamp) * 1000; // Fallback to original timestamp
        }
    }

    getOrderStatus(order, currentTime, orderExpiry, gracePeriod) {
        this.debug('Order timing:', {
            currentTime,
            orderTime: order.timestamp,
            orderExpiry,  // 420 seconds (7 minutes)
            gracePeriod   // 420 seconds (7 minutes)
        });

        // Check explicit status first
        if (order.status === 'Canceled') return 'Canceled';
        if (order.status === 'Filled') return 'Filled';

        // Then check timing
        const totalExpiry = orderExpiry + gracePeriod;
        const orderTime = Number(order.timestamp);

        if (currentTime > orderTime + totalExpiry) {
            this.debug('Order not active: Past grace period');
            return 'Expired';
        }
        if (currentTime > orderTime + orderExpiry) {
            this.debug('Order status: Awaiting Clean');
            return 'Expired';
        }

        this.debug('Order status: Active');
        return 'Active';
    }

    async canFillOrder(order) {
        try {
            // Get current account
            const accounts = await window.ethereum.request({ 
                method: 'eth_accounts' 
            });
            if (!accounts || accounts.length === 0) {
                this.debug('No wallet connected');
                return false;
            }
            const currentAccount = accounts[0].toLowerCase();

            // Convert status from number to string if needed
            const statusMap = ['Active', 'Filled', 'Canceled'];
            const orderStatus = typeof order.status === 'number' ? 
                statusMap[order.status] : order.status;
            
            if (orderStatus !== 'Active') {
                this.debug('Order not active:', orderStatus);
                return false;
            }

            // Check if order is expired - using the contract's ORDER_EXPIRY
            const contract = window.webSocket?.contract;
            const orderExpiry = (await contract.ORDER_EXPIRY()).toNumber();
            const now = Math.floor(Date.now() / 1000);
            const expiryTime = Number(order.timestamp) + orderExpiry;

            if (now >= expiryTime) {
                this.debug('Order expired', {
                    now,
                    timestamp: order.timestamp,
                    orderExpiry,
                    expiryTime
                });
                return false;
            }

            // Check if user is the maker (can't fill own orders)
            if (order.maker?.toLowerCase() === currentAccount) {
                this.debug('User is maker of order');
                return false;
            }

            // Check if order is open to all or if user is the specified taker
            const isOpenOrder = order.taker === ethers.constants.AddressZero;
            const isSpecifiedTaker = order.taker?.toLowerCase() === currentAccount;
            const canFill = isOpenOrder || isSpecifiedTaker;

            this.debug('Can fill order:', {
                isOpenOrder,
                isSpecifiedTaker,
                canFill
            });
            
            return canFill;
        } catch (error) {
            console.error('[ViewOrders] Error in canFillOrder:', error);
            return false;
        }
    }

    getTotalPages() {
        const pageSize = parseInt(this.container.querySelector('#page-size-select').value);
        if (pageSize === -1) return 1; // View all
        return Math.ceil(this.orders.size / pageSize);
    }

    updatePaginationControls(filteredOrdersCount) {
        const pageSize = parseInt(this.container.querySelector('.page-size-select').value);
        const updateControls = (container) => {
            const prevButton = container.querySelector('.prev-page');
            const nextButton = container.querySelector('.next-page');
            const pageInfo = container.querySelector('.page-info');
            const pageSizeSelect = container.querySelector('.page-size-select');
            
            if (pageSize === -1) {
                prevButton.disabled = true;
                nextButton.disabled = true;
                pageInfo.textContent = `Showing all ${filteredOrdersCount} orders`;
                return;
            }
            
            const totalPages = Math.ceil(filteredOrdersCount / pageSize);
            
            prevButton.disabled = this.currentPage === 1;
            nextButton.disabled = this.currentPage === totalPages;
            
            pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
            
            // Keep page size selects in sync
            if (pageSizeSelect) {
                pageSizeSelect.value = pageSize;
            }
        };
        
        // Update both top and bottom controls
        const controls = this.container.querySelectorAll('.filter-controls');
        controls.forEach(updateControls);
    }

    async refreshOrders() {
        try {
            this.debug('Refreshing orders view');
            const orders = this.webSocket.getOrders() || [];
            this.debug('Orders from WebSocket:', orders);

            const contract = window.webSocket?.contract;
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            console.log('🔍 Using WebSocket contract:', contract.address);
            const orderExpiry = (await contract.ORDER_EXPIRY()).toNumber();
            const gracePeriod = (await contract.GRACE_PERIOD()).toNumber();
            const currentTime = Math.floor(Date.now() / 1000);

            // Show all orders including cleaned ones
            const filteredOrders = orders.filter(order => {
                const status = this.getOrderStatus(order, currentTime, orderExpiry, gracePeriod);
                this.debug('Processing order:', {
                    orderId: order.id,
                    status,
                    timestamp: order.timestamp,
                    currentTime,
                    orderExpiry,
                    gracePeriod
                });
                return true; // Show all orders
            });

            this.debug('Orders after filtering:', filteredOrders);

            // Sort orders by timestamp descending
            const sortedOrders = [...filteredOrders].sort((a, b) => b.timestamp - a.timestamp);
            await this.displayOrders(sortedOrders);

        } catch (error) {
            this.debug('Error refreshing orders:', error);
            this.showError('Failed to refresh orders');
        }
    }

    async displayOrders(orders) {
        try {
            const contract = window.webSocket?.contract;
            const orderExpiry = (await contract.ORDER_EXPIRY()).toNumber();
            this.debug('Order expiry from contract:', {
                orderExpiry,
                inMinutes: orderExpiry / 60
            });
            
            // ... rest of the code ...
        } catch (error) {
            this.debug('Error displaying orders:', error);
            throw error;
        }
    }

    formatExpiryTime(timestamp, orderExpiry) {
        const expiryTime = timestamp + orderExpiry;
        const now = Math.floor(Date.now() / 1000);
        const timeLeft = expiryTime - now;
        
        this.debug('Expiry calculation:', {
            timestamp,
            orderExpiry,
            expiryTime,
            now,
            timeLeft,
            timeLeftMinutes: timeLeft / 60
        });
        
        if (timeLeft <= 0) {
            return 'Expired';
        }
        
        const minutes = Math.ceil(timeLeft / 60);
        return `${minutes}m`;
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

        const formatTimeDiff = (timeDiff) => {
            const absDiff = Math.abs(timeDiff);
            const days = Math.floor(absDiff / 86400); // 86400 seconds in a day
            const hours = Math.floor((absDiff % 86400) / 3600);
            const minutes = Math.floor((absDiff % 3600) / 60);
            const sign = timeDiff < 0 ? '-' : '';

            // If less than 24 hours, show only hours and minutes
            if (days === 0) {
                return `${sign}${hours}h ${minutes}m`;
            }
            
            // If days exist, show days and hours (minutes omitted for clarity)
            return `${sign}${days}d ${hours}h`;
        };

        const updateExpiry = async () => {
            const expiresCell = row.querySelector('td:nth-child(6)'); // Expires column
            if (!expiresCell) return;

            const timestamp = row.dataset.timestamp;
            const currentTime = Math.floor(Date.now() / 1000);
            const contract = window.webSocket?.contract;
            const orderExpiry = (await contract.ORDER_EXPIRY()).toNumber();
            const expiryTime = Number(timestamp) + orderExpiry;
            const timeDiff = expiryTime - currentTime;

            const newExpiryText = formatTimeDiff(timeDiff);

            if (expiresCell.textContent !== newExpiryText) {
                expiresCell.textContent = newExpiryText;
            }
        };

        // Update immediately and then every minute
        updateExpiry();
        const timerId = setInterval(updateExpiry, 60000); // Update every minute
        this.expiryTimers.set(row.dataset.orderId, timerId);
    }

    showLoadingState() {
        const tbody = this.container.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="loading-message">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Loading orders...</div>
                    </td>
                </tr>`;
        }
    }

    getExplorerUrl(address) {
        const networkConfig = getNetworkConfig();
        if (!networkConfig?.explorer) {
            console.warn('Explorer URL not configured');
            return '#';
        }
        return `${networkConfig.explorer}/address/${ethers.utils.getAddress(address)}`;
    }

    getTokenIcon(token) {
        if (!token) return '';
        
        if (token.iconUrl) {
            return `
                <div class="token-icon">
                    <img src="${token.iconUrl}" alt="${token.symbol}" class="token-icon-image">
                </div>
            `;
        }

        // Fallback to letter-based icon
        const symbol = token.symbol || '?';
        const firstLetter = symbol.charAt(0).toUpperCase();
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
            '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
        ];
        
        // Generate consistent color based on address
        const colorIndex = parseInt(token.address.slice(-6), 16) % colors.length;
        const backgroundColor = colors[colorIndex];
        
        return `
            <div class="token-icon">
                <div class="token-icon-fallback" style="background: ${backgroundColor}">
                    ${firstLetter}
                </div>
            </div>
        `;
    }

    getOrderStatusText(status) {
        const statusMap = {
            0: 'Active',
            1: 'Filled',
            2: 'Cancelled',
            3: 'Expired'
        };
        return statusMap[status] || `Unknown (${status})`;
    }
}
