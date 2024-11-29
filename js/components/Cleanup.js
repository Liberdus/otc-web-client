import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';
import { isDebugEnabled } from '../config.js';

export class Cleanup extends BaseComponent {
    constructor(containerId) {
        super('cleanup-container');
        this.webSocket = window.webSocket;
        
        this.debug = (message, ...args) => {
            if (isDebugEnabled('CLEANUP')) {
                console.log('[Cleanup]', message, ...args);
            }
        };
    }

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Initializing cleanup component...');
            
            if (!this.webSocket?.isInitialized) {
                this.debug('Waiting for WebSocket service to initialize...');
                for (let i = 0; i < 10; i++) {
                    if (window.webSocket?.isInitialized) {
                        this.webSocket = window.webSocket;
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            if (!this.webSocket?.isInitialized) {
                throw new Error('WebSocket service not initialized after timeout');
            }

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

            this.cleanupButton = document.getElementById('cleanup-button');
            this.cleanupButton.addEventListener('click', () => this.performCleanup());

            this.debug('Starting cleanup opportunities check');
            await this.checkCleanupOpportunities();
            
            this.intervalId = setInterval(() => this.checkCleanupOpportunities(), 5 * 60 * 1000);
            this.debug('Initialization complete');
        } catch (error) {
            this.debug('Initialization error:', error);
            this.showError('Failed to initialize cleanup component');
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
            const orders = this.webSocket.getOrders('Active');
            const eligibleOrders = [];
            
            for (const order of orders) {
                const { isEligible } = await this.webSocket.checkCleanupEligibility(order.id);
                if (isEligible) {
                    eligibleOrders.push(order);
                }
            }
            
            this.debug('Cleanup eligible orders:', eligibleOrders);
            
            // Update UI to show eligible orders
            const container = document.getElementById('cleanup-container');
            if (eligibleOrders.length > 0) {
                container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Cleanup Expired Orders</h2>
                        <p>${eligibleOrders.length} orders eligible for cleanup</p>
                        <button id="cleanupButton" class="action-button">Clean Orders</button>
                    </div>`;
            } else {
                container.innerHTML = `
                    <div class="tab-content-wrapper">
                        <h2>Cleanup Expired Orders</h2>
                        <p>No orders eligible for cleanup</p>
                    </div>`;
            }
        } catch (error) {
            this.debug('Error checking cleanup opportunities:', error);
        }
    }

    setupWebSocket() {
        if (!this.webSocket) {
            this.debug('WebSocket not available for setup');
            return;
        }

        // Subscribe to all relevant events
        this.webSocket.subscribe('OrderCleaned', () => {
            this.debug('Order cleaned event received');
            this.checkCleanupOpportunities();
        });

        this.webSocket.subscribe('OrderCanceled', () => {
            this.debug('Order canceled event received');
            this.checkCleanupOpportunities();
        });

        this.webSocket.subscribe('OrderFilled', () => {
            this.debug('Order filled event received');
            this.checkCleanupOpportunities();
        });

        this.webSocket.subscribe('orderSyncComplete', () => {
            this.debug('Order sync complete event received');
            this.checkCleanupOpportunities();
        });
    }

    async performCleanup() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            this.cleanupButton.disabled = true;
            this.cleanupButton.textContent = 'Cleaning...';

            // Get current network conditions
            const provider = contract.provider;
            const feeData = await provider.getFeeData();
            
            // Get gas estimate
            const gasEstimate = await contract.estimateGas.cleanupExpiredOrders()
                .catch(error => {
                    console.log('[Cleanup] Gas estimation failed:', error);
                    return ethers.BigNumber.from('300000'); // Default gas limit
                });

            // Add 20% buffer to gas estimate
            const gasLimit = gasEstimate.mul(120).div(100);

            // Use legacy transaction type
            const txOptions = {
                gasLimit,
                gasPrice: feeData.gasPrice,
                type: 0  // Force legacy transaction
            };

            console.log('[Cleanup] Sending transaction with options:', txOptions);
            const tx = await contract.cleanupExpiredOrders(txOptions);
            console.log('[Cleanup] Transaction sent:', tx.hash);

            const receipt = await tx.wait();
            console.log('[Cleanup] Transaction confirmed:', receipt);
            console.log('[Cleanup] Events:', receipt.events);

            if (receipt.status === 0) {
                throw new Error('Transaction failed during execution');
            }

            // Parse cleanup events from receipt
            const cleanedOrderIds = receipt.events
                ?.filter(event => {
                    console.log('[Cleanup] Processing event:', event);
                    return event.event === 'OrderCleanedUp';
                })
                ?.map(event => {
                    console.log('[Cleanup] Cleaned order:', event.args);
                    return event.args.orderId.toString();
                });
                
            console.log('[Cleanup] Cleaned order IDs:', cleanedOrderIds);
                
            if (cleanedOrderIds?.length) {
                this.debug('Orders cleaned:', cleanedOrderIds);
                // Remove cleaned orders from WebSocket cache
                this.webSocket.removeOrders(cleanedOrderIds);
                // Force a fresh sync
                await this.webSocket.syncAllOrders(contract);
            }

            this.showSuccess('Cleanup successful! Check your wallet for rewards.');
            await this.checkCleanupOpportunities();

        } catch (error) {
            console.error('[Cleanup] Error details:', {
                message: error.message,
                code: error.code,
                error: error.error,
                reason: error.reason,
                transaction: error.transaction
            });
            this.showError(`Cleanup failed: ${error.message}`);
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