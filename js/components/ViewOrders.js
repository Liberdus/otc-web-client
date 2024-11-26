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
        this.setupErrorHandling();
        this.eventSubscriptions = new Set();
        
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
            console.error('[ViewOrders] Order error:', {
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
                const order = this.orders.get(Number(orderData.id));
                if (order) {
                    order.status = 'Filled';
                    this.orders.set(Number(orderData.id), order);
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
                this.removeOrderFromTable(orderData.id);
                this.refreshOrdersView().catch(error => {
                    console.error('[ViewOrders] Error refreshing view after order cancel:', error);
                });
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

            // Check if we have any orders
            if (!this.orders || this.orders.size === 0) {
                this.debug('No orders to display');
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="no-orders-message">
                            <div class="placeholder-text">
                                No orders found
                            </div>
                        </td>
                    </tr>`;
                return;
            }

            // Get token details for all orders
            const tokenAddresses = new Set();
            this.orders.forEach(order => {
                if (order?.sellToken) tokenAddresses.add(order.sellToken);
                if (order?.buyToken) tokenAddresses.add(order.buyToken);
            });

            this.debug('Getting token details for addresses:', Array.from(tokenAddresses));
            const tokenDetails = await this.getTokenDetails(Array.from(tokenAddresses));
            
            const tokenDetailsMap = new Map();
            tokenDetails.forEach((details, index) => {
                if (details) {
                    tokenDetailsMap.set(Array.from(tokenAddresses)[index], details);
                }
            });

            // Sort orders before adding to table
            const sortedOrders = Array.from(this.orders.values()).sort((a, b) => {
                const direction = this.sortConfig.direction === 'asc' ? 1 : -1;
                
                switch (this.sortConfig.column) {
                    case 'id':
                        return (Number(a.id) - Number(b.id)) * direction;
                    case 'sell':
                        const sellTokenA = tokenDetailsMap.get(a.sellToken)?.symbol || '';
                        const sellTokenB = tokenDetailsMap.get(b.sellToken)?.symbol || '';
                        return sellTokenA.localeCompare(sellTokenB) * direction;
                    case 'sellAmount':
                        const sellAmountA = ethers.utils.formatUnits(a.sellAmount, tokenDetailsMap.get(a.sellToken)?.decimals || 18);
                        const sellAmountB = ethers.utils.formatUnits(b.sellAmount, tokenDetailsMap.get(b.sellToken)?.decimals || 18);
                        return (Number(sellAmountA) - Number(sellAmountB)) * direction;
                    case 'buy':
                        const buyTokenA = tokenDetailsMap.get(a.buyToken)?.symbol || '';
                        const buyTokenB = tokenDetailsMap.get(b.buyToken)?.symbol || '';
                        return buyTokenA.localeCompare(buyTokenB) * direction;
                    case 'buyAmount':
                        const buyAmountA = ethers.utils.formatUnits(a.buyAmount, tokenDetailsMap.get(a.buyToken)?.decimals || 18);
                        const buyAmountB = ethers.utils.formatUnits(b.buyAmount, tokenDetailsMap.get(b.buyToken)?.decimals || 18);
                        return (Number(buyAmountA) - Number(buyAmountB)) * direction;
                    case 'created':
                        return (Number(a.timestamp) - Number(b.timestamp)) * direction;
                    case 'expires':
                        const expiryA = this.getExpiryTime(a.timestamp);
                        const expiryB = this.getExpiryTime(b.timestamp);
                        return (expiryA - expiryB) * direction;
                    case 'status':
                        const statusA = this.getOrderStatus(a, this.getExpiryTime(a.timestamp));
                        const statusB = this.getOrderStatus(b, this.getExpiryTime(b.timestamp));
                        return statusA.localeCompare(statusB) * direction;
                    default:
                        return 0;
                }
            });

            // Add sorted orders to table
            for (const order of sortedOrders) {
                if (order) {
                    const row = await this.createOrderRow(order, tokenDetailsMap);
                    tbody.appendChild(row);
                }
            }
        } catch (error) {
            console.error('[ViewOrders] Error refreshing orders view:', error);
            throw error;
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
        const table = this.createElement('table', 'orders-table');
        
        const thead = this.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th data-sort="id">ID <span class="sort-icon">↕</span></th>
                <th data-sort="sell">Sell <span class="sort-icon">↕</span></th>
                <th data-sort="sellAmount">Amount <span class="sort-icon">↕</span></th>
                <th data-sort="buy">Buy <span class="sort-icon">↕</span></th>
                <th data-sort="buyAmount">Amount <span class="sort-icon">↕</span></th>
                <th data-sort="created">Created <span class="sort-icon">↕</span></th>
                <th data-sort="expires">Expires <span class="sort-icon">↕</span></th>
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

    formatExpiry(timestamp) {
        const expiryTime = this.getExpiryTime(timestamp);
        const days = Math.floor((expiryTime - Date.now()) / (1000 * 60 * 60 * 24));
        return `${days}d`;
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
            const buyToken = new ethers.Contract(
                order.buyToken,
                erc20Abi,
                this.provider
            );
            
            const userAddress = await window.walletManager.getAccount();
            
            // Check balance first
            const balance = await buyToken.balanceOf(userAddress);
            this.debug('Current balance:', balance.toString());
            this.debug('Required amount:', order.buyAmount.toString());

            if (balance.lt(order.buyAmount)) {
                throw new Error(`Insufficient token balance. Have ${ethers.utils.formatEther(balance)}, need ${ethers.utils.formatEther(order.buyAmount)}`);
            }

            // Check allowance
            const allowance = await buyToken.allowance(userAddress, this.contract.address);
            this.debug('Current allowance:', allowance.toString());

            if (allowance.lt(order.buyAmount)) {
                this.showSuccess('Requesting token approval...');
                
                try {
                    // Use a default gas limit for approval if estimation fails
                    let gasLimit;
                    try {
                        const approveGasEstimate = await buyToken.estimateGas.approve(
                            this.contract.address,
                            order.buyAmount
                        );
                        gasLimit = Math.floor(approveGasEstimate.toNumber() * 1.2); // 20% buffer
                    } catch (error) {
                        this.debug('Gas estimation failed for approval, using default:', error);
                        gasLimit = 100000; // Default gas limit for ERC20 approvals
                    }

                    const approveTx = await buyToken.connect(this.provider.getSigner()).approve(
                        this.contract.address,
                        order.buyAmount,
                        {
                            gasLimit,
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

            // Estimate gas for fillOrder with fallback
            let fillGasLimit;
            try {
                const fillGasEstimate = await this.contract.estimateGas.fillOrder(orderId);
                fillGasLimit = Math.floor(fillGasEstimate.toNumber() * 1.2); // 20% buffer
                this.debug('Fill order gas estimate:', fillGasEstimate.toString());
            } catch (error) {
                this.debug('Gas estimation failed for fill order, using default:', error);
                fillGasLimit = 300000; // Default gas limit for fill orders
            }

            this.debug('Sending fill order transaction with params:', {
                orderId,
                gasLimit: fillGasLimit,
                gasPrice: (await this.provider.getGasPrice()).toString()
            });

            const tx = await this.contract.fillOrder(orderId, {
                gasLimit: fillGasLimit,
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

        const sellTokenDetails = tokenDetailsMap.get(order.sellToken);
        const buyTokenDetails = tokenDetailsMap.get(order.buyToken);
        const canFill = await this.canFillOrder(order);
        const expiryTime = this.getExpiryTime(order.timestamp);
        const status = this.getOrderStatus(order, expiryTime);
        
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
            <td>${this.formatTimestamp(order.timestamp)}</td>
            <td>${this.formatExpiry(order.timestamp)}</td>
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

        return tr;
    }

    getExpiryTime(timestamp) {
        const ORDER_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
        return (Number(timestamp) + ORDER_EXPIRY) * 1000; // Convert to milliseconds
    }

    getOrderStatus(order, expiryTime) {
        if (order.status === 'Filled') return 'Filled';
        if (order.status === 'Canceled') return 'Canceled';
        if (Date.now() > expiryTime) return 'Expired';
        return 'Active';
    }

    async canFillOrder(order) {
        try {
            // Get current account
            const accounts = await window.ethereum.request({ 
                method: 'eth_accounts' 
            });
            if (!accounts || accounts.length === 0) {
                console.log('[ViewOrders] No wallet connected');
                return false;
            }
            const currentAccount = accounts[0].toLowerCase();

            // Convert status from number to string if needed
            const statusMap = ['Active', 'Filled', 'Canceled'];
            const orderStatus = typeof order.status === 'number' ? 
                statusMap[order.status] : order.status;
            
            if (orderStatus !== 'Active') {
                console.log('[ViewOrders] Order not active:', orderStatus);
                return false;
            }

            // Check if order is expired
            const expiryTime = this.getExpiryTime(order.timestamp);
            if (Date.now() >= expiryTime) {
                console.log('[ViewOrders] Order expired');
                return false;
            }

            // Check if user is the maker (can't fill own orders)
            if (order.maker?.toLowerCase() === currentAccount) {
                console.log('[ViewOrders] User is maker of order');
                return false;
            }

            // Check if order is open to all or if user is the specified taker
            const isOpenOrder = order.taker === ethers.constants.AddressZero;
            const isSpecifiedTaker = order.taker?.toLowerCase() === currentAccount;
            const canFill = isOpenOrder || isSpecifiedTaker;

            console.log('[ViewOrders] Can fill order:', {
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
}
