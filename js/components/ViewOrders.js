import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { ContractError, CONTRACT_ERRORS } from '../errors/ContractErrors.js';
import { isDebugEnabled } from '../config.js';

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
            // Cleanup previous state
            this.cleanup();
            this.container.innerHTML = '';
            
            await this.setupTable();
            
            // Wait for WebSocket to be initialized
            if (!window.webSocket?.isInitialized) {
                this.debug('Waiting for WebSocket initialization...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }
            
            // Setup WebSocket event handlers
            await this.setupWebSocket();

            // Get initial orders from cache
            const cachedOrders = window.webSocket.getOrders();
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
            console.error('[ViewOrders] Initialization error:', error);
            throw error;
        }
    }

    async setupWebSocket() {
        this.debug('Setting up WebSocket subscriptions');
        
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
        this.debug('Refreshing orders view');
        try {
            // Get contract instance first
            this.contract = await this.getContract();
            
            // Clear existing orders from table
            const tbody = this.container.querySelector('tbody');
            if (!tbody) {
                this.debug('Table body not found');
                return;
            }
            tbody.innerHTML = '';

            // Get filter and pagination state
            const showOnlyFillable = this.container.querySelector('#fillable-orders-toggle')?.checked;
            const pageSize = parseInt(this.container.querySelector('#page-size-select').value);
            
            // Filter orders if necessary
            let ordersToDisplay = Array.from(this.orders.values());
            
            // Debug log the orders
            this.debug('Orders before filtering:', ordersToDisplay);

            if (showOnlyFillable && this.contract) {
                ordersToDisplay = await Promise.all(ordersToDisplay.map(async order => {
                    const canFill = await this.canFillOrder(order);
                    return canFill ? order : null;
                }));
                ordersToDisplay = ordersToDisplay.filter(order => order !== null);
            }

            // Get token details
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

            // Debug log the orders
            this.debug('Orders after filtering:', ordersToDisplay);

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

            // Debug log the orders after sorting
            this.debug('Orders after sorting:', ordersToDisplay);

            // Apply pagination if not viewing all
            const totalOrders = ordersToDisplay.length;
            if (pageSize !== -1) {
                const startIndex = (this.currentPage - 1) * pageSize;
                ordersToDisplay = ordersToDisplay.slice(startIndex, startIndex + pageSize);
            }

            // Update pagination controls
            this.updatePaginationControls(totalOrders);

            // Check if we have any orders after filtering
            if (!ordersToDisplay || ordersToDisplay.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                ${showOnlyFillable ? 'No fillable orders found' : 'No orders found'}
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            // Add orders to table with lowercase token addresses
            for (const order of ordersToDisplay) {
                if (order) {
                    const orderWithLowercase = {
                        ...order,
                        sellToken: order.sellToken.toLowerCase(),
                        buyToken: order.buyToken.toLowerCase()
                    };
                    const row = await this.createOrderRow(orderWithLowercase, tokenDetailsMap);
                    tbody.appendChild(row);
                }
            }
        } catch (error) {
            console.error('[ViewOrders] Error refreshing orders view:', error);
            const tbody = this.container.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                ${!this.contract ? 
                                    'Connect wallet to view orders' : 
                                    'Unable to load orders. Please try again later.'}
                            </div>
                        </td>
                    </tr>`;
            }
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
        const row = this.container.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            const statusCell = row.querySelector('.order-status');
            if (statusCell) {
                statusCell.textContent = status;
                statusCell.className = `order-status status-${status.toLowerCase()}`;
            }
        }
    }

    async addOrderToTable(order, tokenDetailsMap) {
        try {
            const sellTokenDetails = tokenDetailsMap.get(order.sellToken);
            const buyTokenDetails = tokenDetailsMap.get(order.buyToken);

            const row = document.createElement('tr');
            row.setAttribute('data-order-id', order.id);
            
            row.innerHTML = `
                <td>${order.id}</td>
                <td>${order.maker}</td>
                <td>${order.taker || 'Any'}</td>
                <td>${sellTokenDetails.symbol} (${order.sellToken})</td>
                <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails.decimals)}</td>
                <td>${buyTokenDetails.symbol} (${order.buyToken})</td>
                <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails.decimals)}</td>
                <td>${new Date(order.timestamp * 1000).toLocaleString()}</td>
                <td class="order-status status-${order.status.toLowerCase()}">${order.status}</td>
            `;

            const tableBody = this.container.querySelector('tbody');
            if (tableBody) {
                tableBody.appendChild(row);
            }
        } catch (error) {
            console.error('[ViewOrders] Error adding order to table:', error);
            throw error;
        }
    }

    removeOrderFromTable(orderId) {
        const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            row.remove();
            this.orders.delete(orderId.toString());
        }
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
                    <input type="checkbox" id="fillable-orders-toggle">
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
                <th>Buy</th>
                <th>Amount</th>
                <th>Sell</th>
                <th>Amount</th>
                <th>Expires</th>
                <th data-sort="status">Status <span class="sort-icon">↕</span></th>
                <th>Taker</th>
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
        
        // Toggle direction if clicking same column
        if (this.sortConfig.column === column) {
            this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortConfig.column = column;
            this.sortConfig.direction = 'asc';
        }

        // Update sort icons and active states
        const headers = this.container.querySelectorAll('th[data-sort]');
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

        // Refresh the view with new sort
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
            const contract = await this.getContract();
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

    async fillOrder(orderId) {
        const button = this.container.querySelector(`button[data-order-id="${orderId}"]`);
        try {
            if (button) {
                button.disabled = true;
                button.textContent = 'Filling...';
            }

            this.debug('Starting fill order process for orderId:', orderId);
            const order = this.orders.get(orderId);
            this.debug('Order details:', order);

            // Create token contract instance with full ERC20 ABI
            // Use buyToken since the taker is selling what the maker wants to buy
            const takerToken = new ethers.Contract(
                order.buyToken,  // This is what the taker needs to sell (maker wants to buy)
                erc20Abi,
                this.provider
            );
            
            const userAddress = await window.walletManager.getAccount();
            
            // Check balance and allowance for what taker needs to sell
            const balance = await takerToken.balanceOf(userAddress);
            const allowance = await takerToken.allowance(userAddress, this.contract.address);

            if (balance.lt(order.buyAmount)) {
                throw new Error(`Insufficient token balance. Have ${ethers.utils.formatEther(balance)}, need ${ethers.utils.formatEther(order.buyAmount)}`);
            }

            if (allowance.lt(order.buyAmount)) {
                this.showSuccess('Requesting token approval...');
                
                try {
                    const approveTx = await takerToken.connect(this.provider.getSigner()).approve(
                        this.contract.address,
                        order.buyAmount,  // Amount the taker needs to sell (maker's buyAmount)
                        {
                            gasLimit: 70000,
                            gasPrice: await this.provider.getGasPrice()
                        }
                    );
                    
                    this.debug('Approval transaction sent:', approveTx.hash);
                    await approveTx.wait();
                    this.showSuccess('Token approval granted');
                } catch (error) {
                    this.debug('Approval failed:', error);
                    throw new Error('Token approval failed. Please try again.');
                }
            }

            // Use standard gas limit for fill order
            const tx = await this.contract.fillOrder(orderId, {
                gasLimit: 300000,  // Standard gas limit for fill orders
                gasPrice: await this.provider.getGasPrice()
            });
            
            this.debug('Transaction sent:', tx.hash);
            await tx.wait();
            this.debug('Transaction confirmed');

            // Update order status in memory
            const orderToUpdate = this.orders.get(Number(orderId));
            if (orderToUpdate) {
                orderToUpdate.status = 'Filled';
                this.orders.set(Number(orderId), orderToUpdate);
                await this.refreshOrdersView();
            }

            this.showSuccess(`Order ${orderId} filled successfully!`);
        } catch (error) {
            this.debug('Fill order error details:', {
                message: error.message,
                code: error.code,
                data: error?.error?.data,
                reason: error?.reason,
                stack: error.stack
            });
            
            let errorMessage = 'Failed to fill order: ';
            
            // Try to decode the error
            if (error?.error?.data) {
                try {
                    const decodedError = this.contract.interface.parseError(error.error.data);
                    errorMessage += `${decodedError.name}: ${decodedError.args}`;
                    this.debug('Decoded error:', decodedError);
                } catch (e) {
                    // If we can't decode the error, fall back to basic messages
                    if (error.code === -32603) {
                        errorMessage += 'Transaction would fail. Check order status and token approvals.';
                    } else {
                        errorMessage += error.message;
                    }
                }
            }
            
            this.showError(errorMessage);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = 'Fill Order';
            }
        }
    }

    getReadableError(error) {
        // Reuse the same error handling from CreateOrder
        switch (error.code) {
            case 'ACTION_REJECTED':
                return 'Transaction was rejected by user';
            case 'INSUFFICIENT_FUNDS':
                return 'Insufficient funds for transaction';
            case -32603:
                return 'Network error. Please check your connection';
            case 'UNPREDICTABLE_GAS_LIMIT':
                return 'Error estimating gas. The transaction may fail';
            default:
                return error.reason || error.message || 'Error filling order';
        }
    }

    async getOrderDetails(orderId) {
        try {
            const contract = await this.getContract();
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

        // Format taker display
        const takerDisplay = order.taker === ethers.constants.AddressZero 
            ? '<span class="open-order">Open to All</span>'
            : `<span class="targeted-order" title="${order.taker}">Private</span>`;

        tr.innerHTML = `
            <td>${order.id}</td>
            <td>${sellTokenDetails?.symbol || 'Unknown'}</td>
            <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails?.decimals || 18)}</td>
            <td>${buyTokenDetails?.symbol || 'Unknown'}</td>
            <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails?.decimals || 18)}</td>
            <td>${formattedExpiry}</td>
            <td class="order-status">${status}</td>
            <td class="taker-column">${takerDisplay}</td>
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
            const contract = await this.getContract();
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
            const contract = await this.getContract();
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

            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

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
            const contract = await this.getContract();
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

        const updateExpiry = async () => {
            const expiresCell = row.querySelector('td:nth-child(6)'); // Expires column
            if (!expiresCell) return;

            const timestamp = row.dataset.timestamp;
            const status = row.dataset.status;

            // For cancelled orders, show 'Cancelled' instead of expiry time
            if (status === 'Canceled') {
                expiresCell.textContent = 'Cancelled';
                return;
            }
            
            // For filled orders, show 'Filled' instead of expiry time
            if (status === 'Filled') {
                expiresCell.textContent = 'Filled';
                return;
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const contract = await this.getContract();
            const orderExpiry = (await contract.ORDER_EXPIRY()).toNumber();
            const expiryTime = Number(timestamp) + orderExpiry;
            const timeDiff = expiryTime - currentTime;

            // Format time difference
            const absHours = Math.floor(Math.abs(timeDiff) / 3600);
            const absMinutes = Math.floor((Math.abs(timeDiff) % 3600) / 60);
            const sign = timeDiff < 0 ? '-' : '';
            const newExpiryText = `${sign}${absHours}h ${absMinutes}m`;

            if (expiresCell.textContent !== newExpiryText) {
                expiresCell.textContent = newExpiryText;
            }
        };

        // Update immediately and then every minute
        updateExpiry();
        const timerId = setInterval(updateExpiry, 60000); // Update every minute
        this.expiryTimers.set(row.dataset.orderId, timerId);
    }
}
