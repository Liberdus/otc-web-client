import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
        this.userAddress = null;
    }

    async initialize() {
        try {
            // Get user address first
            const signer = await this.getSigner();
            this.userAddress = await signer.getAddress();
            
            // Set up the table structure
            await this.setupTable();

            // Wait for WebSocket to be ready
            while (!window.webSocket?.isInitialSyncComplete) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Load initial orders from WebSocket service (filtered for user)
            const activeOrders = window.webSocket.getActiveOrders();
            for (const orderData of activeOrders) {
                if (orderData[1] === this.userAddress) { // orderData[1] is maker address
                    await this.addOrderToTable(orderData);
                }
            }

            // Set up WebSocket listeners
            this.setupWebSocket();
            this.setupEventListeners();

        } catch (error) {
            console.error('[MyOrders] Initialization error:', error);
            this.showError('Failed to initialize my orders view');
        }
    }

    setupWebSocket() {
        if (!window.webSocket) {
            console.log('[MyOrders] WebSocket not available yet, retrying in 1s...');
            setTimeout(() => this.setupWebSocket(), 1000);
            return;
        }
        
        // Subscribe to order events (filtered for user)
        window.webSocket.subscribe('orderCreated', async (orderData) => {
            if (orderData[1] === this.userAddress) { // Check if maker is current user
                console.log('[MyOrders] New order received:', orderData);
                await this.addOrderToTable(orderData);
                this.showSuccess('New order created');
            }
        });
        
        window.webSocket.subscribe('orderFilled', (orderId) => {
            console.log('[MyOrders] Order filled:', orderId);
            this.removeOrderFromTable(orderId);
        });

        window.webSocket.subscribe('orderCanceled', (orderId) => {
            console.log('[MyOrders] Order canceled:', orderId);
            this.removeOrderFromTable(orderId);
        });
    }

    async addOrderToTable(orderData) {
        try {
            const [orderId, maker, , sellToken, sellAmount, buyToken, buyAmount, timestamp] = orderData;
            
            // Skip if not user's order
            if (maker !== this.userAddress) {
                return;
            }

            // Get token details
            const [sellTokenDetails, buyTokenDetails] = await Promise.all([
                this.getTokenDetails(sellToken),
                this.getTokenDetails(buyToken)
            ]);

            const tr = this.createElement('tr');
            tr.dataset.orderId = orderId.toString();
            tr.innerHTML = `
                <td>${orderId}</td>
                <td>${sellTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(sellAmount, sellTokenDetails?.decimals || 18)}</td>
                <td>${buyTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(buyAmount, buyTokenDetails?.decimals || 18)}</td>
                <td>${this.formatTimestamp(timestamp)}</td>
                <td>${this.formatExpiry(timestamp)}</td>
                <td class="order-status">Active</td>
                <td>
                    <button class="action-button cancel-button" data-order-id="${orderId}">Cancel</button>
                </td>
            `;

            this.tbody.appendChild(tr);
        } catch (error) {
            console.error('[MyOrders] Error adding order to table:', error);
        }
    }

    setupTable() {
        const table = this.createElement('table', 'orders-table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Sell Token</th>
                    <th>Sell Amount</th>
                    <th>Buy Token</th>
                    <th>Buy Amount</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th></th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        this.container.appendChild(table);
        this.tbody = table.querySelector('tbody');
    }
}