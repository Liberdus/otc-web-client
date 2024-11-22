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

    async initialize(readOnlyMode = true) {
        try {
            // Clear previous content first
            this.container.innerHTML = '';
            
            if (readOnlyMode) {
                this.showReadOnlyMessage();
                return;
            }

            // Set up the table structure
            await this.setupTable();
            
            // Load initial orders
            const activeOrders = window.webSocket?.getActiveOrders() || [];
            for (const orderData of activeOrders) {
                await this.addOrderToTable(orderData);
            }

            this.setupWebSocket();
        } catch (error) {
            console.error('[ViewOrders] Initialization error:', error);
            this.showError('Failed to initialize orders view');
        }
    }

    showReadOnlyMessage() {
        this.container.innerHTML = `
            <div class="tab-content-wrapper">
                <h2>Orders</h2>
                <p class="connect-prompt">Connect wallet to view orders</p>
            </div>`;
    }

    setupWebSocket() {
        if (!window.webSocket) {
            console.log('[ViewOrders] WebSocket not available yet, retrying in 1s...');
            setTimeout(() => this.setupWebSocket(), 1000);
            return;
        }
        
        // Subscribe to order events
        window.webSocket.subscribe('orderCreated', async (orderData) => {
            console.log('[ViewOrders] New order received:', orderData);
            await this.addOrderToTable(orderData);
            this.showSuccess('New order received');
        });
        
        window.webSocket.subscribe('orderFilled', (orderId) => {
            console.log('[ViewOrders] Order filled:', orderId);
            this.removeOrderFromTable(orderId);
        });

        window.webSocket.subscribe('orderCanceled', (orderId) => {
            console.log('[ViewOrders] Order canceled:', orderId);
            this.removeOrderFromTable(orderId);
        });

        window.webSocket.subscribe('error', (error) => {
            let userMessage = 'An error occurred';
            if (error instanceof ContractError) {
                userMessage = error.message;
            }
            this.showError(userMessage);
        });
    }

    async addOrderToTable(orderData) {
        try {
            // orderData is the event args array from the OrderCreated event
            const [orderId, maker, , sellToken, sellAmount, buyToken, buyAmount, timestamp] = orderData;
            
            // Store order in memory
            this.orders.set(orderId.toString(), {
                maker,
                sellToken,
                sellAmount,
                buyToken,
                buyAmount,
                timestamp
            });

            // Get token details
            const [sellTokenDetails, buyTokenDetails] = await Promise.all([
                this.getTokenDetails(sellToken),
                this.getTokenDetails(buyToken)
            ]);

            const tr = this.createElement('tr');
            tr.dataset.orderId = orderId.toString();
            tr.innerHTML = `
                <td>${orderId}</td>
                <td>${this.formatAddress(maker)}</td>
                <td>${sellTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(sellAmount, sellTokenDetails?.decimals || 18)}</td>
                <td>${buyTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(buyAmount, buyTokenDetails?.decimals || 18)}</td>
                <td>${this.formatTimestamp(timestamp)}</td>
                <td>${this.formatExpiry(timestamp)}</td>
                <td>
                    <button class="action-button fill-button" data-order-id="${orderId}">Fill Order</button>
                </td>
            `;
            this.tbody.appendChild(tr);
        } catch (error) {
            console.error('[ViewOrders] Error adding order to table:', error);
        }
    }

    removeOrderFromTable(orderId) {
        const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
        if (row) {
            row.remove();
            this.orders.delete(orderId.toString());
        }
    }

    setupTable() {
        // Create wrapper and table
        const wrapper = this.createElement('div', 'tab-content-wrapper');
        wrapper.innerHTML = `
            <h2>All Orders</h2>
            <div class="orders-container">
                <table class="orders-table">
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
                </table>
            </div>
        `;
        
        this.container.appendChild(wrapper);
        this.tbody = wrapper.querySelector('tbody');
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

            // Check if order is expired
            const now = Math.floor(Date.now() / 1000);
            if (now > order.timestamp + (7 * 24 * 60 * 60)) {
                throw new Error('Order has expired');
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

            // Get buy token contract with full ERC20 ABI
            const buyTokenContract = new ethers.Contract(
                order.buyToken,
                erc20Abi,  // Using full ERC20 ABI instead of minimal interface
                this.signer
            );

            // Check balance before proceeding
            const balance = await buyTokenContract.balanceOf(signerAddress);
            console.log('[ViewOrders] Token balance:', balance.toString());
            if (balance.lt(order.buyAmount)) {
                throw new Error('Insufficient token balance to fill order');
            }

            // Rest of your existing allowance checking code...
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
                
                if (receipt.status === 0) {
                    // Try to decode the revert reason
                    const reason = await this.provider.call(tx, tx.blockNumber);
                    throw new Error(`Transaction failed: ${reason || 'Unknown reason'}`);
                }

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
                console.error('[ViewOrders] Fill transaction error:', {
                    message: error.message,
                    code: error.code,
                    data: error.data,
                    receipt: error.receipt
                });
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
