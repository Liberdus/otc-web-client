import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';

export class ViewOrders extends BaseComponent {
    constructor() {
        super('view-orders');
        this.orders = new Map();
        this.tokenCache = new Map();
        this.setupErrorHandling();
        this.initialize();
    }

    setupErrorHandling() {
        if (!window.webSocket) {
            console.log('[ViewOrders] WebSocket not available for error handling, retrying in 1s...');
            setTimeout(() => this.setupErrorHandling(), 1000);
            return;
        }

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

    async initialize() {
        try {
            await this.setupTable();
            await this.loadOrders();
            this.setupEventListeners();
            this.setupWebSocket();
            this.setupFilters();
        } catch (error) {
            console.error('[ViewOrders] Initialization error:', error);
            this.showError('Failed to initialize orders view');
        }
    }

    setupWebSocket() {
        if (!window.webSocket) {
            console.log('[ViewOrders] WebSocket not available yet, retrying in 1s...');
            setTimeout(() => this.setupWebSocket(), 1000);
            return;
        }
        
        // Subscribe to order events
        window.webSocket.subscribe('orderCreated', (data) => this.handleNewOrder(data));
        window.webSocket.subscribe('orderFilled', (data) => this.handleOrderFilled(data));
        window.webSocket.subscribe('orderCanceled', (data) => this.handleOrderCanceled(data));
        window.webSocket.subscribe('error', (error) => this.showError(error.message));
    }

    async handleNewOrder(data) {
        const { orderId } = data;
        await this.loadOrder(orderId);
        this.showSuccess('New order received');
    }

    handleOrderFilled(data) {
        const { orderId } = data;
        const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            row.remove();
            this.orders.delete(orderId);
        }
    }

    handleOrderCanceled(data) {
        const { orderId } = data;
        const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            row.remove();
            this.orders.delete(orderId);
        }
    }

    setupTable() {
        const table = this.createElement('table', 'orders-table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Maker</th>
                    <th>Sell Token</th>
                    <th>Sell Amount</th>
                    <th>Buy Token</th>
                    <th>Buy Amount</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        this.container.appendChild(table);
        this.tbody = table.querySelector('tbody');
    }

    async loadOrders() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                console.log('[ViewOrders] No contract available');
                return;
            }

            // Add retry logic for RPC calls
            const firstOrderId = await this.retryCall(
                () => contract.firstOrderId(),
                3,
                (error) => error.message.includes('header not found')
            );
            
            const nextOrderId = await this.retryCall(
                () => contract.nextOrderId(),
                3,
                (error) => error.message.includes('header not found')
            );
            
            console.log('[ViewOrders] Loading orders from', firstOrderId.toString(), 'to', nextOrderId.toString());

            // Clear existing orders
            this.tbody.innerHTML = '';
            this.orders.clear();

            // Load orders in batches of 10
            for (let i = firstOrderId.toNumber(); i < nextOrderId.toNumber(); i += 10) {
                console.log('[ViewOrders] Loading batch starting at order', i);
                const promises = [];
                for (let j = 0; j < 10 && i + j < nextOrderId.toNumber(); j++) {
                    promises.push(this.loadOrder(i + j));
                }
                await Promise.all(promises);
            }
        } catch (error) {
            console.error('[ViewOrders] Error loading orders:', error);
            this.showError('Failed to load orders. Please try again.');
        }
    }

    async loadOrder(orderId) {
        try {
            const contract = await this.getContract();
            const order = await contract.orders(orderId);
            
            // Validate order data
            if (order.maker === ethers.constants.AddressZero) {
                throw new ContractError(
                    CONTRACT_ERRORS.INVALID_ORDER.message,
                    CONTRACT_ERRORS.INVALID_ORDER.code,
                    { orderId }
                );
            }

            // Check if order is expired
            const expiryTime = (order.timestamp * 1000) + (7 * 24 * 60 * 60 * 1000);
            if (Date.now() > expiryTime) {
                throw new ContractError(
                    CONTRACT_ERRORS.EXPIRED_ORDER.message,
                    CONTRACT_ERRORS.EXPIRED_ORDER.code,
                    { orderId, timestamp: order.timestamp }
                );
            }

            console.log('[ViewOrders] Loading order', orderId, ':', order);
            
            // Skip if order is empty or not active
            if (order.maker === ethers.constants.AddressZero || order.status !== 0) {
                console.log('[ViewOrders] Skipping order', orderId, '- Empty or inactive');
                return;
            }

            // Store order in memory
            this.orders.set(orderId, order);

            // Load token details
            console.log('[ViewOrders] Loading token details for order', orderId);
            const [sellTokenDetails, buyTokenDetails] = await Promise.all([
                this.getTokenDetails(order.sellToken),
                this.getTokenDetails(order.buyToken)
            ]);
            
            console.log('[ViewOrders] Token details loaded:', {
                sellToken: sellTokenDetails,
                buyToken: buyTokenDetails
            });

            // Create table row
            const tr = this.createElement('tr');
            tr.innerHTML = `
                <td>${orderId}</td>
                <td>${this.formatAddress(order.maker)}</td>
                <td>${sellTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails?.decimals || 18)}</td>
                <td>${buyTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails?.decimals || 18)}</td>
                <td>${this.formatTimestamp(order.timestamp)}</td>
                <td>${this.formatExpiry(order.timestamp)}</td>
                <td>
                    <button class="action-button fill-button" data-order-id="${orderId}">Fill Order</button>
                </td>
            `;

            this.tbody.appendChild(tr);
        } catch (error) {
            if (error instanceof ContractError) {
                console.error(`[ViewOrders] Contract error loading order ${orderId}:`, {
                    code: error.code,
                    message: error.message,
                    details: error.details
                });
            } else {
                console.error(`[ViewOrders] Error loading order ${orderId}:`, error);
            }
            throw error;
        }
    }

    formatAddress(address) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatTimestamp(timestamp) {
        return new Date(timestamp * 1000).toLocaleString();
    }

    formatExpiry(timestamp) {
        const expiryTime = (timestamp * 1000) + (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds
        const now = Date.now();
        const timeLeft = expiryTime - now;

        if (timeLeft <= 0) return 'Expired';
        
        const days = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
        const hours = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        return `${days}d ${hours}h`;
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

    async fillOrder(orderId) {
        try {
            const contract = await this.getContract();
            
            // Pre-fill checks
            const order = await contract.orders(orderId);
            
            // Check if order exists
            if (order.maker === ethers.constants.AddressZero) {
                throw new ContractError(
                    CONTRACT_ERRORS.INVALID_ORDER.message,
                    CONTRACT_ERRORS.INVALID_ORDER.code,
                    { orderId }
                );
            }

            // Check if order is expired
            const expiryTime = (order.timestamp * 1000) + (7 * 24 * 60 * 60 * 1000);
            if (Date.now() > expiryTime) {
                throw new ContractError(
                    CONTRACT_ERRORS.EXPIRED_ORDER.message,
                    CONTRACT_ERRORS.EXPIRED_ORDER.code,
                    { orderId, timestamp: order.timestamp }
                );
            }

            // Check allowance
            const tokenContract = new ethers.Contract(
                order.sellToken,
                ['function allowance(address,address) view returns (uint256)'],
                contract.provider
            );
            
            const allowance = await tokenContract.allowance(
                await window.walletManager.getCurrentAddress(),
                contract.address
            );
            
            if (allowance.lt(order.sellAmount)) {
                throw new ContractError(
                    CONTRACT_ERRORS.INSUFFICIENT_ALLOWANCE.message,
                    CONTRACT_ERRORS.INSUFFICIENT_ALLOWANCE.code,
                    { 
                        orderId,
                        required: order.sellAmount.toString(),
                        current: allowance.toString()
                    }
                );
            }

            const button = this.tbody.querySelector(`[data-order-id="${orderId}"]`);
            button.disabled = true;
            button.textContent = 'Processing...';

            const tx = await contract.fillOrder(orderId);
            await tx.wait();
            
            this.showSuccess('Order filled successfully!');
            await this.loadOrders();
            
        } catch (error) {
            if (error instanceof ContractError) {
                this.showError(error.message);
                console.error('[ViewOrders] Contract error filling order:', {
                    code: error.code,
                    message: error.message,
                    details: error.details
                });
            } else {
                this.showError('Failed to fill order. Please try again.');
                console.error('[ViewOrders] Error filling order:', error);
            }
            
            // Reset button state
            const button = this.tbody.querySelector(`[data-order-id="${orderId}"]`);
            if (button) {
                button.disabled = false;
                button.textContent = 'Fill Order';
            }
        }
    }
}
