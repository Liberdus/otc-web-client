import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class TakerOrders extends ViewOrders {
    constructor() {
        super('taker-orders');
    }

    async initialize(readOnlyMode = true) {
        try {
            // Clear previous content first
            this.container.innerHTML = '';
            
            if (readOnlyMode) {
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Invited Orders</h2>
                        <p class="connect-prompt">Connect wallet to view orders where you are the taker</p>
                    </div>`;
                return;
            }

            // Set up table structure
            const wrapper = this.createElement('div', 'tab-content-wrapper');
            wrapper.innerHTML = `
                <h2>Invited Orders</h2>
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

            // Load orders
            const account = await window.walletManager.getAccount();
            const orders = window.webSocket.getOrders('Active')
                .filter(order => {
                    const selectedAddress = window.ethereum.selectedAddress.toLowerCase();
                    return order.taker === '0x0000000000000000000000000000000000000000' || 
                           order.taker.toLowerCase() === selectedAddress;
                });
            
            console.log('[TakerOrders] Loading', orders.length, 'orders from cache');
            await this.refreshOrdersView(orders);

            this.setupWebSocket();
        } catch (error) {
            console.error('[TakerOrders] Initialization error:', error);
            this.showError('Failed to load orders');
        }
    }

    // Override addOrderToTable to include fill button
    async addOrderToTable(orderData) {
        // ... similar to ViewOrders but with fill button ...
    }
}
