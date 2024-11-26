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
                this.debug('Contract not available');
                return;
            }

            this.debug('Calculating cleanup reward');
            const reward = await this.calculateCleanupReward(contract);
            const rewardElement = document.getElementById('cleanup-reward');
            rewardElement.textContent = `${ethers.utils.formatEther(reward)} ETH`;

            this.debug('Counting ready orders');
            const readyOrders = await this.countReadyOrders(contract);
            const readyElement = document.getElementById('cleanup-ready');
            readyElement.textContent = readyOrders;

            this.debug(`Found ${readyOrders} orders ready for cleanup`);
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
        
        this.debug('Calculating rewards for orders:', {
            firstOrderId: firstOrderId.toString(),
            nextOrderId: nextOrderId.toString()
        });
        
        const batchEndId = Math.min(
            firstOrderId.toNumber() + 10, 
            nextOrderId.toNumber()
        );
        
        for (let orderId = firstOrderId; orderId < batchEndId; orderId++) {
            const order = await contract.orders(orderId);
            
            // Skip empty orders
            if (order.maker === '0x0000000000000000000000000000000000000000') {
                this.debug(`Order ${orderId} is empty, skipping`);
                continue;
            }
            
            // Check if grace period has passed
            if (currentTime > order.timestamp.toNumber() + (14 * 24 * 60 * 60)) {
                reward = reward.add(order.orderCreationFee);
                this.debug(`Order ${orderId} eligible for cleanup, fee:`, order.orderCreationFee.toString());
            } else {
                this.debug(`Order ${orderId} not yet eligible for cleanup`);
                break;
            }
        }
        
        return reward;
    }

    async countReadyOrders(contract) {
        const currentTime = Math.floor(Date.now() / 1000);
        const firstOrderId = await contract.firstOrderId();
        const nextOrderId = await contract.nextOrderId();
        let count = 0;
        
        const batchEndId = Math.min(
            firstOrderId.toNumber() + 10, 
            nextOrderId.toNumber()
        );
        
        this.debug('Counting ready orders in range:', {
            firstOrderId: firstOrderId.toString(),
            batchEndId
        });
        
        for (let orderId = firstOrderId; orderId < batchEndId; orderId++) {
            const order = await contract.orders(orderId);
            
            // Skip empty orders
            if (order.maker === '0x0000000000000000000000000000000000000000') {
                continue;
            }
            
            // Check if grace period has passed
            if (currentTime > order.timestamp.toNumber() + (14 * 24 * 60 * 60)) {
                count++;
                this.debug(`Order ${orderId} ready for cleanup`);
            } else {
                this.debug(`Order ${orderId} not ready, stopping count`);
                break;
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