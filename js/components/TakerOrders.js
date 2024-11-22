import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';

export class TakerOrders extends BaseComponent {
    constructor() {
        super('taker-orders');
        this.orders = new Map();
        this.initialize();
    }

    async initialize() {
        try {
            await this.setupTable();
            this.setupEventListeners();
            // Don't load orders here - they'll be loaded in render()
        } catch (error) {
            console.error('[TakerOrders] Initialization error:', error);
            this.showError('Failed to initialize taker orders view');
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
        this.container.innerHTML = ''; // Clear existing content
        this.container.appendChild(table);
        this.tbody = table.querySelector('tbody');
    }

    render() {
        if (!this.initialized) {
            this.initialized = true;
            this.loadOrders();
        }
    }

    async loadOrders() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                console.log('[TakerOrders] No contract available');
                return;
            }

            // Clear existing orders
            this.tbody.innerHTML = '';
            this.orders.clear();

            const firstOrderId = await contract.firstOrderId();
            const nextOrderId = await contract.nextOrderId();

            if (firstOrderId.eq(nextOrderId)) {
                console.log('[TakerOrders] No orders exist yet');
                this.showMessage('No orders available');
                return;
            }

            // Load orders in batches of 10
            for (let i = firstOrderId.toNumber(); i < nextOrderId.toNumber(); i += 10) {
                const promises = [];
                for (let j = 0; j < 10 && i + j < nextOrderId.toNumber(); j++) {
                    promises.push(this.loadOrder(i + j));
                }
                await Promise.all(promises);
            }
        } catch (error) {
            console.error('[TakerOrders] Error loading orders:', error);
            this.showError('Failed to load orders');
        }
    }

    async loadOrder(orderId) {
        try {
            const contract = await this.getContract();
            const signer = await this.getSigner();
            const userAddress = await signer.getAddress();
            const order = await contract.orders(orderId);

            // Skip if:
            // 1. Order has no specific taker (taker is zero address)
            // 2. Current user is not the designated taker
            // 3. Order is not active (status !== 0)
            if (order.taker === ethers.constants.AddressZero || 
                order.taker !== userAddress ||
                order.status !== 0) {
                return null;
            }

            // Store order in memory
            this.orders.set(orderId, order);

            // Get token details
            const [sellTokenDetails, buyTokenDetails] = await Promise.all([
                this.getTokenDetails(order.sellToken),
                this.getTokenDetails(order.buyToken)
            ]);

            const tr = this.createElement('tr');
            tr.dataset.orderId = orderId;
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
            console.warn(`[TakerOrders] Error loading order ${orderId}:`, error);
            return null;
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

    async fillOrder(orderId) {
        // You can copy the fillOrder implementation from ViewOrders.js
        // or implement your own version here
    }
}
