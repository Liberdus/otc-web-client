import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';
import { isDebugEnabled } from '../config.js';

export class Cleanup extends BaseComponent {
    constructor() {
        super('cleanup-container');
        
        // Initialize debug logger
        this.debug = (message, ...args) => {
            if (isDebugEnabled('CLEANUP_ORDERS')) {
                console.log('[Cleanup]', message, ...args);
            }
        };
    }

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Initializing cleanup component...');
            // Clear previous content first
            this.container.innerHTML = '';
            
            if (readOnlyMode) {
                this.debug('Read-only mode, showing connect prompt');
                this.container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Cleanup Expired Orders</h2>
                        <p class="connect-prompt">Connect wallet to view cleanup opportunities</p>
                    </div>`;
                return;
            }

            // Set up UI
            this.debug('Setting up UI components');
            const wrapper = this.createElement('div', 'tab-content-wrapper');
            wrapper.innerHTML = `
                <div class="cleanup-section">
                    <h2>Cleanup Expired Orders</h2>
                    <div class="cleanup-info">
                        <p>Earn fees by cleaning up expired orders (14+ minutes old)</p>
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

            this.debug('Starting cleanup opportunities check');
            await this.checkCleanupOpportunities();
            
            // Check every 5 minutes
            this.intervalId = setInterval(() => this.checkCleanupOpportunities(), 5 * 60 * 1000);
            this.debug('Initialization complete');
        } catch (error) {
            console.error('[Cleanup] Initialization error:', error);
        }
    }

    cleanup() {
        if (this.intervalId) {
            this.debug('Cleaning up interval');
            clearInterval(this.intervalId);
        }
    }

    async checkCleanupOpportunities() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            // Get expiry times from contract
            const orderExpiry = await contract.ORDER_EXPIRY();
            const gracePeriod = await contract.GRACE_PERIOD();
            const totalExpiry = orderExpiry.add(gracePeriod);
            
            this.debug('Checking cleanup opportunities with timings:', {
                orderExpiry: orderExpiry.toString(),
                gracePeriod: gracePeriod.toString(),
                totalExpiry: totalExpiry.toString()
            });

            // Count ready orders and calculate potential reward
            const readyOrders = await this.countReadyOrders(contract, totalExpiry);
            const reward = await this.calculateCleanupReward(contract, totalExpiry);

            // Update UI
            const rewardSpan = document.getElementById('cleanup-reward');
            const readySpan = document.getElementById('cleanup-ready');
            const cleanupButton = document.getElementById('cleanup-button');

            if (rewardSpan) {
                rewardSpan.textContent = ethers.utils.formatEther(reward) + ' POL';
            }
            if (readySpan) {
                readySpan.textContent = readyOrders.toString();
            }
            if (cleanupButton) {
                cleanupButton.disabled = readyOrders === 0;
            }

        } catch (error) {
            console.error('[Cleanup] Error checking cleanup opportunities:', error);
            this.showError('Failed to check cleanup opportunities');
        }
    }

    async countReadyOrders(contract, totalExpiry) {
        const currentTime = Math.floor(Date.now() / 1000);
        const firstOrderId = await contract.firstOrderId();
        const nextOrderId = await contract.nextOrderId();
        let count = 0;

        this.debug('Counting ready orders:', {
            firstOrderId: firstOrderId.toString(),
            nextOrderId: nextOrderId.toString(),
            currentTime
        });

        for (let orderId = firstOrderId; orderId < nextOrderId; orderId++) {
            const order = await contract.orders(orderId);
            
            // Skip empty orders
            if (order.maker === '0x0000000000000000000000000000000000000000') {
                continue;
            }
            
            // Check if both expiry AND grace period have passed
            if (currentTime > order.timestamp.toNumber() + totalExpiry.toNumber()) {
                count++;
                this.debug(`Order ${orderId} ready for cleanup`);
            } else {
                this.debug(`Order ${orderId} not ready, stopping count`);
                break;
            }
        }
        
        return count;
    }

    async calculateCleanupReward(contract, totalExpiry) {
        const currentTime = Math.floor(Date.now() / 1000);
        const firstOrderId = await contract.firstOrderId();
        const nextOrderId = await contract.nextOrderId();
        let reward = ethers.BigNumber.from(0);

        for (let orderId = firstOrderId; orderId < nextOrderId; orderId++) {
            const order = await contract.orders(orderId);
            
            // Skip empty orders
            if (order.maker === '0x0000000000000000000000000000000000000000') {
                continue;
            }
            
            // Check if both expiry AND grace period have passed
            if (currentTime > order.timestamp.toNumber() + totalExpiry.toNumber()) {
                reward = reward.add(order.orderCreationFee);
                this.debug(`Order ${orderId} cleanup reward:`, order.orderCreationFee.toString());
            } else {
                break;
            }
        }
        
        return reward;
    }

    async performCleanup() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            this.debug('Starting cleanup process');
            this.cleanupButton.disabled = true;
            this.cleanupButton.textContent = 'Cleaning...';

            // Call the cleanup function
            const tx = await contract.cleanupExpiredOrders();
            this.debug('Cleanup transaction sent:', tx.hash);
            await tx.wait();
            this.debug('Cleanup transaction confirmed');

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
        this.debug('Success:', message);
        // Implement your success notification
    }

    showError(message) {
        this.debug('Error:', message);
        // Implement your error notification
    }
} 