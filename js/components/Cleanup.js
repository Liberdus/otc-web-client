import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';

export class Cleanup extends BaseComponent {
    constructor() {
        super('cleanup-container');
    }

    async initialize(readOnlyMode = true) {
        try {
            // Clear previous content first
            this.container.innerHTML = '';
            
            if (readOnlyMode) {
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Cleanup Expired Orders</h2>
                        <p class="connect-prompt">Connect wallet to view cleanup opportunities</p>
                    </div>`;
                return;
            }

            // Set up UI
            const wrapper = this.createElement('div', 'tab-content-wrapper');
            wrapper.innerHTML = `
                <div class="cleanup-section">
                    <h2>Cleanup Expired Orders</h2>
                    <div class="cleanup-info">
                        <p>Earn fees by cleaning up old orders (14+ days old)</p>
                        <div class="cleanup-stats">
                            <div>Potential Reward: <span id="cleanup-reward">Loading...</span></div>
                            <div>Orders Ready: <span id="cleanup-ready">Loading...</span></div>
                        </div>
                    </div>
                    <button id="cleanup-button" class="action-button" disabled>
                        Clean Orders
                    </button>
                </div>
            `;
            
            this.container.appendChild(wrapper);

            // Add event listeners
            this.cleanupButton = document.getElementById('cleanup-button');
            this.cleanupButton.addEventListener('click', () => this.performCleanup());

            // Start checking for cleanup opportunities
            await this.checkCleanupOpportunities();
            
            // Check every 5 minutes
            this.intervalId = setInterval(() => this.checkCleanupOpportunities(), 5 * 60 * 1000);
        } catch (error) {
            console.error('[Cleanup] Initialization error:', error);
        }
    }

    cleanup() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    async checkCleanupOpportunities() {
        try {
            const contract = await this.getContract();
            if (!contract) return;

            // Calculate potential reward
            const reward = await this.calculateCleanupReward(contract);
            const rewardElement = document.getElementById('cleanup-reward');
            rewardElement.textContent = `${ethers.utils.formatEther(reward)} ETH`;

            // Count ready orders
            const readyOrders = await this.countReadyOrders(contract);
            const readyElement = document.getElementById('cleanup-ready');
            readyElement.textContent = readyOrders;

            // Enable button if there's work to do
            this.cleanupButton.disabled = readyOrders === 0;

        } catch (error) {
            console.error('[Cleanup] Error checking opportunities:', error);
        }
    }

    async calculateCleanupReward(contract) {
        const currentTime = Math.floor(Date.now() / 1000);
        const firstOrderId = await contract.firstOrderId();
        const nextOrderId = await contract.nextOrderId();
        let reward = ethers.BigNumber.from(0);
        
        // Look at up to MAX_CLEANUP_BATCH orders
        const batchEndId = Math.min(
            firstOrderId.toNumber() + 10, 
            nextOrderId.toNumber()
        );
        
        for (let orderId = firstOrderId; orderId < batchEndId; orderId++) {
            const order = await contract.orders(orderId);
            
            // Skip empty orders
            if (order.maker === '0x0000000000000000000000000000000000000000') {
                continue;
            }
            
            // Check if grace period has passed
            if (currentTime > order.timestamp.toNumber() + (14 * 24 * 60 * 60)) {
                reward = reward.add(order.orderCreationFee);
            } else {
                break; // Stop at first non-cleanable order
            }
        }
        
        return reward;
    }

    async countReadyOrders(contract) {
        const currentTime = Math.floor(Date.now() / 1000);
        const firstOrderId = await contract.firstOrderId();
        const nextOrderId = await contract.nextOrderId();
        let count = 0;
        
        // Look at up to MAX_CLEANUP_BATCH orders
        const batchEndId = Math.min(
            firstOrderId.toNumber() + 10, 
            nextOrderId.toNumber()
        );
        
        for (let orderId = firstOrderId; orderId < batchEndId; orderId++) {
            const order = await contract.orders(orderId);
            
            // Skip empty orders
            if (order.maker === '0x0000000000000000000000000000000000000000') {
                continue;
            }
            
            // Check if grace period has passed
            if (currentTime > order.timestamp.toNumber() + (14 * 24 * 60 * 60)) {
                count++;
            } else {
                break; // Stop at first non-cleanable order
            }
        }
        
        return count;
    }

    async performCleanup() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            this.cleanupButton.disabled = true;
            this.cleanupButton.textContent = 'Cleaning...';

            // Call the cleanup function
            const tx = await contract.cleanupExpiredOrders();
            await tx.wait();

            // Show success message
            this.showSuccess('Cleanup successful! Check your wallet for rewards.');

            // Refresh stats
            await this.checkCleanupOpportunities();

        } catch (error) {
            console.error('[Cleanup] Error performing cleanup:', error);
            this.showError('Cleanup failed: ' + error.message);
        } finally {
            this.cleanupButton.textContent = 'Clean Orders';
            this.cleanupButton.disabled = false;
        }
    }

    showSuccess(message) {
        // Implement your success notification
        console.log('[Cleanup] Success:', message);
    }

    showError(message) {
        // Implement your error notification
        console.error('[Cleanup] Error:', message);
    }
} 