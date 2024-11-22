import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { ContractError, CONTRACT_ERRORS } from '../errors/ContractErrors.js';

export class ViewOrders extends BaseComponent {
    constructor(containerId = 'view-orders') {
        super(containerId);
        this.orders = new Map();
        this.tokenCache = new Map();
        this.provider = new ethers.providers.Web3Provider(window.ethereum);
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
                    <th></th>
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
            
            // indicates no orders exist yet
            if (firstOrderId.eq(nextOrderId)) {
                console.log('[ViewOrders] No orders exist yet');
                this.showMessage('No orders have been created yet');
                return;
            }

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
            console.log(`[ViewOrders] Loading order ${orderId}`);
            const contract = await this.getContract();
            const order = await contract.orders(orderId);

            // Skip empty/invalid orders silently
            if (order.maker === ethers.constants.AddressZero || order.status !== 0) {
                console.log(`[ViewOrders] Order ${orderId} is empty or inactive - skipping`);
                return null;
            }

            // Check if order is expired
            const expiryTime = (order.timestamp * 1000) + (7 * 24 * 60 * 60 * 1000);
            if (Date.now() > expiryTime) {
                console.log(`[ViewOrders] Order ${orderId} is expired - skipping`);
                return null;
            }

            // Store valid order in memory
            this.orders.set(orderId, order);

            // Load token details for valid orders only
            console.log('[ViewOrders] Loading token details for order', orderId);
            const [sellTokenDetails, buyTokenDetails] = await Promise.all([
                this.getTokenDetails(order.sellToken),
                this.getTokenDetails(order.buyToken)
            ]);

            // Create and return table row for valid order
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
            
            return order;
        } catch (error) {
            console.warn(`[ViewOrders] Error loading order ${orderId}:`, error);
            return null;
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
            console.log('[ViewOrders] Starting fill order process for orderId:', orderId);
            
            const order = await this.getOrderDetails(orderId);
            console.log('[ViewOrders] Order details:', {
                maker: order.maker,
                taker: order.taker,
                sellToken: order.sellToken,
                sellAmount: order.sellAmount.toString(),
                buyToken: order.buyToken,
                buyAmount: order.buyAmount.toString(),
                status: order.status,
                timestamp: order.timestamp
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // Verify order status
            if (order.status !== 0) {
                throw new Error('Order is no longer available');
            }
            // Get contract and signer
            const contract = await this.getContract();
            this.signer = await this.getSigner();
            const signerAddress = await this.signer.getAddress();
            console.log('[ViewOrders] Signer address:', signerAddress);
            
            const contractWithSigner = contract.connect(this.signer);
            console.log('[ViewOrders] Contract address:', contract.address);

            // Get buy token contract
            const buyTokenContract = new ethers.Contract(
                order.buyToken,
                ['function allowance(address,address) view returns (uint256)',
                 'function approve(address,uint256)'],
                this.signer
            );
            // Check allowance with explicit error handling
            try {
                console.log('[ViewOrders] Checking allowance...');
                const allowance = await buyTokenContract.allowance(
                    signerAddress,
                    contract.address
                );
                console.log('[ViewOrders] Current allowance:', allowance.toString());
                console.log('[ViewOrders] Required amount:', order.buyAmount.toString());

                if (allowance.lt(order.buyAmount)) {
                    console.log('[ViewOrders] Insufficient allowance, requesting approval...');
                    const approveTx = await buyTokenContract.approve(
                        contract.address,
                        order.buyAmount
                    );
                    console.log('[ViewOrders] Approval transaction:', approveTx.hash);
                    const approveReceipt = await approveTx.wait();
                    console.log('[ViewOrders] Approval receipt:', {
                        status: approveReceipt.status,
                        gasUsed: approveReceipt.gasUsed.toString(),
                        blockNumber: approveReceipt.blockNumber
                    });
                }
            } catch (error) {
                console.error('[ViewOrders] Allowance/Approval error:', {
                    message: error.message,
                    code: error.code,
                    transaction: error.transaction,
                    receipt: error.receipt,
                    data: error.data
                });
                throw new Error('Failed to check/set token allowance');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                console.log('[ViewOrders] Sending fillOrder transaction...');
                const tx = await contractWithSigner.fillOrder(orderId, {
                    gasLimit: 300000
                });
                console.log('[ViewOrders] Fill transaction hash:', tx.hash);
                const receipt = await tx.wait();
                console.log('[ViewOrders] Fill transaction receipt:', {
                    status: receipt.status,
                    gasUsed: receipt.gasUsed.toString(),
                    blockNumber: receipt.blockNumber,
                    events: receipt.events?.map(e => ({
                        event: e.event,
                        args: e.args
                    }))
                });

                this.showSuccess('Order filled successfully!');
                await this.loadOrders();
                
            } catch (error) {
                console.log('[ViewOrders] Fill order error:', error);
                this.showError('Failed to fill order: ' + (error.message || 'Unknown error'));
                throw error;
            }
        } catch (error) {
            console.log('[ViewOrders] Fill order error:', error);
            this.showError('Failed to fill order: ' + (error.message || 'Unknown error'));
            throw error;
        }
    }

    async getOrderDetails(orderId) {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            // Get order details from contract
            const order = await this.retryCall(
                () => contract.orders(orderId)
            );

            if (!order || !order.maker) {
                throw new Error('Order not found');
            }

            return {
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
}
