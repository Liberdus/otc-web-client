import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class TakerOrders extends ViewOrders {
    constructor() {
        super('taker-orders');
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

            // Load initial orders from WebSocket service (filtered for taker)
            const activeOrders = window.webSocket.getActiveOrders();
            for (const orderData of activeOrders) {
                if (orderData[2] === this.userAddress) { // orderData[2] is taker address
                    await this.addOrderToTable(orderData);
                }
            }

            // Set up WebSocket listeners
            this.setupWebSocket();
            this.setupEventListeners();

        } catch (error) {
            console.error('[TakerOrders] Initialization error:', error);
            this.showError('Failed to initialize taker orders view');
        }
    }

    setupWebSocket() {
        if (!window.webSocket) {
            console.log('[TakerOrders] WebSocket not available yet, retrying in 1s...');
            setTimeout(() => this.setupWebSocket(), 1000);
            return;
        }
        
        // Subscribe to order events (filtered for taker)
        window.webSocket.subscribe('orderCreated', async (orderData) => {
            if (orderData[2] === this.userAddress) { // Check if taker is current user
                console.log('[TakerOrders] New order received:', orderData);
                await this.addOrderToTable(orderData);
                this.showSuccess('New order available to fill');
            }
        });
        
        window.webSocket.subscribe('orderFilled', (orderId) => {
            console.log('[TakerOrders] Order filled:', orderId);
            this.removeOrderFromTable(orderId);
        });

        window.webSocket.subscribe('orderCanceled', (orderId) => {
            console.log('[TakerOrders] Order canceled:', orderId);
            this.removeOrderFromTable(orderId);
        });
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
        this.container.innerHTML = ''; // Clear existing content
        this.container.appendChild(table);
        this.tbody = table.querySelector('tbody');
    }

    async addOrderToTable(orderData) {
        try {
            const [orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp] = orderData;
            
            // Skip if not for this taker
            if (taker !== this.userAddress) {
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
            console.error('[TakerOrders] Error adding order to table:', error);
        }
    }

    // Inherit other methods from ViewOrders
}
