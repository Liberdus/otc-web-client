import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
    }

    async initialize(readOnlyMode = true) {
        try {
            // Clear previous content first
            this.container.innerHTML = '';
            
            if (readOnlyMode) {
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>My Orders</h2>
                        <p class="connect-prompt">Connect wallet to view your orders</p>
                    </div>`;
                return;
            }

            // Set up table structure
            const wrapper = this.createElement('div', 'tab-content-wrapper');
            wrapper.innerHTML = `
                <h2>My Orders</h2>
                <div class="orders-container">
                    <table class="orders-table">
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
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            `;
            
            this.container.appendChild(wrapper);
            this.tbody = wrapper.querySelector('tbody');

            // Load orders
            const account = await window.walletManager.getAccount();
            const activeOrders = window.webSocket?.getActiveOrders() || [];
            for (const orderData of activeOrders) {
                if (orderData[1].toLowerCase() === account.toLowerCase()) {
                    await this.addOrderToTable(orderData);
                }
            }

            this.setupWebSocket();
        } catch (error) {
            console.error('[MyOrders] Initialization error:', error);
            this.showError('Failed to load your orders');
        }
    }

    // Override addOrderToTable to include cancel button
    async addOrderToTable(orderData) {
        try {
            const [orderId, maker, , sellToken, sellAmount, buyToken, buyAmount, timestamp] = orderData;
            
            // Skip if not user's order
            const account = await window.walletManager.getAccount();
            if (maker.toLowerCase() !== account.toLowerCase()) {
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
        
        // Clear existing content and add table
        this.container.innerHTML = `
            <div class="tab-content-wrapper">
                <h2>My Orders</h2>
                <div class="orders-container"></div>
            </div>`;
        
        const ordersContainer = this.container.querySelector('.orders-container');
        ordersContainer.appendChild(table);
        this.tbody = table.querySelector('tbody');
    }

    setupEventListeners() {
        // Add click handler for cancel buttons
        this.container.addEventListener('click', async (event) => {
            if (event.target.classList.contains('cancel-button')) {
                const orderId = event.target.dataset.orderId;
                await this.cancelOrder(orderId);
            }
        });
    }

    async cancelOrder(orderId) {
        try {
            // Disable the cancel button and update status
            const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
            const cancelButton = row.querySelector('.cancel-button');
            const statusCell = row.querySelector('.order-status');
            
            cancelButton.disabled = true;
            statusCell.textContent = 'Canceling...';

            // Get the contract instance and cancel the order
            const contract = await this.getContract();
            const tx = await contract.cancelOrder(orderId);
            await tx.wait();

            // Success message
            this.showSuccess('Order canceled successfully');
            
            // Note: The order will be removed from the table when we receive the
            // orderCanceled event through WebSocket
        } catch (error) {
            console.error('[MyOrders] Error canceling order:', error);
            this.showError('Failed to cancel order');
            
            // Reset the button and status on error
            const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
            if (row) {
                const cancelButton = row.querySelector('.cancel-button');
                const statusCell = row.querySelector('.order-status');
                cancelButton.disabled = false;
                statusCell.textContent = 'Active';
            }
        }
    }
}