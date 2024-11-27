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
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            const orderExpiry = await contract.ORDER_EXPIRY();
            const gracePeriod = await contract.GRACE_PERIOD();
            const totalExpiry = orderExpiry.add(gracePeriod);
            
            const currentTime = Math.floor(Date.now() / 1000);
            const orders = this.webSocket.getOrders('Active') || [];
            
            this.debug('Checking cleanup opportunities:', {
                currentTime,
                orderExpiry: orderExpiry.toString(),
                gracePeriod: gracePeriod.toString(),
                totalExpiry: totalExpiry.toString(),
                activeOrders: orders.length
            });

            const readyOrders = orders.filter(order => {
                const isPastGracePeriod = currentTime > order.timestamp + totalExpiry.toNumber();
                this.debug('Order cleanup check:', {
                    orderId: order.orderId,
                    orderTime: order.timestamp,
                    expiryTime: order.timestamp + totalExpiry.toNumber(),
                    isPastGracePeriod
                });
                return isPastGracePeriod;
            });

            const reward = readyOrders.reduce((total, order) => {
                return total.add(ethers.BigNumber.from(order.orderCreationFee));
            }, ethers.BigNumber.from(0));

            const rewardSpan = document.getElementById('cleanup-reward');
            const readySpan = document.getElementById('cleanup-ready');
            const cleanupButton = document.getElementById('cleanup-button');

            if (rewardSpan) {
                rewardSpan.textContent = ethers.utils.formatEther(reward) + ' POL';
            }
            if (readySpan) {
                readySpan.textContent = readyOrders.length.toString();
            }
            if (cleanupButton) {
                cleanupButton.disabled = readyOrders.length === 0;
            }

            this.debug('Cleanup check complete:', {
                readyOrders: readyOrders.length,
                reward: reward.toString()
            });

        } catch (error) {
            this.debug('Error checking cleanup opportunities:', error);
            throw error;
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

            console.log('[Cleanup] Starting cleanup process');  // Temporary console.log for debugging
            this.cleanupButton.disabled = true;
            this.cleanupButton.textContent = 'Cleaning...';

            // Get current network conditions
            const provider = contract.provider;
            const feeData = await provider.getFeeData();
            console.log('[Cleanup] Fee data:', {  // Temporary console.log for debugging
                gasPrice: ethers.utils.formatUnits(feeData.gasPrice, 'gwei') + ' gwei',
                maxFeePerGas: feeData.maxFeePerGas ? ethers.utils.formatUnits(feeData.maxFeePerGas, 'gwei') + ' gwei' : null,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') + ' gwei' : null
            });

            // Get gas estimate with higher buffer
            const gasEstimate = await contract.estimateGas.cleanupExpiredOrders()
                .catch(error => {
                    console.log('[Cleanup] Gas estimation failed:', error);  // Temporary console.log for debugging
                    return ethers.BigNumber.from('300000'); // Lower default gas limit
                });

            // Add 50% buffer to gas estimate
            const gasLimit = gasEstimate.mul(150).div(100);

            console.log('[Cleanup] Transaction parameters:', {  // Temporary console.log for debugging
                gasLimit: gasLimit.toString(),
                gasPrice: ethers.utils.formatUnits(feeData.gasPrice, 'gwei') + ' gwei'
            });

            // Use legacy transaction type for compatibility
            const txOptions = {
                gasLimit,
                gasPrice: feeData.gasPrice,
                type: 0  // Force legacy transaction
            };

            console.log('[Cleanup] Sending cleanup transaction with options:', txOptions);  // Temporary console.log for debugging

            const tx = await contract.cleanupExpiredOrders(txOptions);
            console.log('[Cleanup] Transaction sent:', tx.hash);  // Temporary console.log for debugging

            const receipt = await tx.wait();
            console.log('[Cleanup] Transaction confirmed:', receipt);  // Temporary console.log for debugging

            if (receipt.status === 0) {
                throw new Error('Transaction failed during execution');
            }

            this.showSuccess('Cleanup successful! Check your wallet for rewards.');
            await this.checkCleanupOpportunities();

        } catch (error) {
            console.error('[Cleanup] Error details:', {  // Temporary console.log for debugging
                message: error.message,
                code: error.code,
                error: error.error,
                reason: error.reason,
                transaction: error.transaction
            });
            
            let errorMessage = 'Cleanup failed: ';
            if (error.error?.message) {
                errorMessage += error.error.message;
            } else if (error.reason) {
                errorMessage += error.reason;
            } else if (error.message) {
                errorMessage += error.message;
            } else {
                errorMessage += 'Unknown error occurred';
            }
            
            this.showError(errorMessage);
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