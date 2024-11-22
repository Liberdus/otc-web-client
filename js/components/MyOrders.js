import { ViewOrders } from './ViewOrders.js';
import { ethers } from 'ethers';

export class MyOrders extends ViewOrders {
    constructor() {
        super('my-orders');
    }

    // Override loadOrder to filter for user's orders only
    async loadOrder(orderId) {
        try {
            const contract = await this.getContract();
            const signer = await this.getSigner();
            const userAddress = await signer.getAddress();
            const order = await contract.orders(orderId);

            // Skip if not user's order or if order is invalid/inactive
            if (order.maker !== userAddress || 
                order.maker === ethers.constants.AddressZero || 
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
                <td>${sellTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(order.sellAmount, sellTokenDetails?.decimals || 18)}</td>
                <td>${buyTokenDetails?.symbol || 'Unknown'}</td>
                <td>${ethers.utils.formatUnits(order.buyAmount, buyTokenDetails?.decimals || 18)}</td>
                <td>${this.formatTimestamp(order.timestamp)}</td>
                <td>${this.formatExpiry(order.timestamp)}</td>
                <td class="order-status">Active</td>
                <td>
                    <button class="action-button cancel-button" data-order-id="${orderId}">Cancel</button>
                </td>
            `;

            this.tbody.appendChild(tr);
            return order;
        } catch (error) {
            console.warn(`[MyOrders] Error loading order ${orderId}:`, error);
            return null;
        }
    }

    // Override setupEventListeners to handle cancel instead of fill
    setupEventListeners() {
        this.tbody.addEventListener('click', async (e) => {
            if (e.target.classList.contains('cancel-button')) {
                const orderId = e.target.dataset.orderId;
                await this.cancelOrder(orderId);
            }
        });
    }

    async cancelOrder(orderId) {
        try {
            console.log('[MyOrders] Canceling order:', orderId);
            const contract = await this.getContract();
            const signer = await this.getSigner();
            
            const tx = await contract.connect(signer).cancelOrder(orderId, {
                gasLimit: 300000
            });
            
            console.log('[MyOrders] Cancel transaction:', tx.hash);
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                this.showSuccess('Order canceled successfully');
                const row = this.tbody.querySelector(`tr[data-order-id="${orderId}"]`);
                if (row) row.remove();
                this.orders.delete(orderId);
            }
        } catch (error) {
            console.error('[MyOrders] Cancel order error:', error);
            this.showError('Failed to cancel order: ' + (error.message || 'Unknown error'));
        }
    }

    // Add setupTable method if it doesn't exist
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