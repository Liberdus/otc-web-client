import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';
import { isDebugEnabled } from '../config.js';

export class Cleanup extends BaseComponent {
    constructor(containerId) {
        super('cleanup-container');
        this.webSocket = window.webSocket;
        
        this.debug = (message, ...args) => {
            if (isDebugEnabled('CLEANUP_ORDERS')) {
                console.log('[Cleanup]', message, ...args);
            }
        };
    }

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Starting Cleanup initialization...');
            this.debug('ReadOnly mode:', readOnlyMode);
            
            // Wait for both WebSocket and Contract to be ready
            if (!this.webSocket?.isInitialized || !this.webSocket?.contract) {
                this.debug('WebSocket status:', {
                    exists: !!this.webSocket,
                    isInitialized: this.webSocket?.isInitialized,
                    hasContract: !!this.webSocket?.contract
                });
                
                let attempts = 0;
                while (attempts < 10) {
                    if (window.webSocket?.isInitialized && window.webSocket?.contract) {
                        this.webSocket = window.webSocket;
                        this.debug('WebSocket connection successful:', {
                            isInitialized: this.webSocket.isInitialized,
                            contractAddress: this.webSocket.contract.address
                        });
                        break;
                    }
                    this.debug(`Attempt ${attempts + 1}: WebSocket status:`, {
                        windowWebSocket: !!window.webSocket,
                        isInitialized: window.webSocket?.isInitialized,
                        hasContract: !!window.webSocket?.contract
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    attempts++;
                }
            }

            // Verify both WebSocket and Contract are available
            if (!this.webSocket?.isInitialized || !this.webSocket?.contract) {
                const error = new Error('WebSocket service or contract not properly initialized');
                this.debug('Initialization failed:', {
                    webSocketExists: !!this.webSocket,
                    isInitialized: this.webSocket?.isInitialized,
                    hasContract: !!this.webSocket?.contract,
                    error
                });
                throw error;
            }

            // Setup WebSocket event listeners
            this.setupWebSocket();

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
                        <p>Earn fees by cleaning up expired orders</p>
                        <div class="cleanup-stats">
                            <div class="cleanup-category">
                                <h3>Active Orders</h3>
                                <div>Count: <span id="active-orders-count">Loading...</span></div>
                                <div>Fees: <span id="active-orders-fees">Loading...</span></div>
                            </div>
                            <div class="cleanup-category">
                                <h3>Cancelled Orders</h3>
                                <div>Count: <span id="cancelled-orders-count">Loading...</span></div>
                                <div>Fees: <span id="cancelled-orders-fees">Loading...</span></div>
                            </div>
                            <div class="cleanup-category">
                                <h3>Filled Orders</h3>
                                <div>Count: <span id="filled-orders-count">Loading...</span></div>
                                <div>Fees: <span id="filled-orders-fees">Loading...</span></div>
                            </div>
                            <div class="cleanup-total">
                                <h3>Total</h3>
                                <div>Orders Ready: <span id="cleanup-ready">Loading...</span></div>
                                <div>Total Reward: <span id="cleanup-reward">Loading...</span></div>
                            </div>
                        </div>
                    </div>
                    <button id="cleanup-button" class="action-button" disabled>
                        Clean Orders
                    </button>
                </div>
                <div class="admin-controls-toggle">
                    <button id="toggle-admin" class="toggle-button">
                        <span>Admin Controls</span>
                        <svg class="chevron-icon" viewBox="0 0 24 24">
                            <path d="M7 10l5 5 5-5z"/>
                        </svg>
                    </button>
                </div>
                <div id="admin-section" class="admin-section collapsed">
                    <p class="admin-note">Note: These actions can only be performed by the contract owner</p>
                    <button id="disable-contract-button" class="action-button warning">
                        Disable Contract
                    </button>
                </div>
            `;
            
            this.container.appendChild(wrapper);

            this.cleanupButton = document.getElementById('cleanup-button');
            this.cleanupButton.addEventListener('click', () => this.performCleanup());

            this.disableContractButton = document.getElementById('disable-contract-button');
            this.disableContractButton.addEventListener('click', () => this.disableContract());

            this.toggleAdminButton = document.getElementById('toggle-admin');
            this.adminSection = document.getElementById('admin-section');
            this.toggleAdminButton.addEventListener('click', () => {
                this.adminSection.classList.toggle('collapsed');
                this.toggleAdminButton.classList.toggle('active');
            });

            this.debug('Starting cleanup opportunities check');
            await this.checkCleanupOpportunities();
            
            this.intervalId = setInterval(() => this.checkCleanupOpportunities(), 5 * 60 * 1000);
            this.debug('Initialization complete');
        } catch (error) {
            this.debug('Initialization error details:', {
                error,
                stack: error.stack,
                webSocketState: {
                    exists: !!this.webSocket,
                    isInitialized: this.webSocket?.isInitialized,
                    hasContract: !!this.webSocket?.contract
                }
            });
            this.showError('Failed to initialize cleanup component');
            this.updateUIForError();
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
            // Verify WebSocket and contract before proceeding
            if (!this.webSocket?.contract) {
                throw new Error('Contract not available for cleanup check');
            }

            const orders = this.webSocket.getOrders();
            if (!Array.isArray(orders)) {
                throw new Error('Invalid orders data received from WebSocket');
            }

            const eligibleOrders = {
                active: [],
                cancelled: [],
                filled: []
            };
            let activeFees = 0;
            let cancelledFees = 0;
            let filledFees = 0;
            
            const currentTime = Math.floor(Date.now() / 1000);
            const contract = await this.getContract();
            const orderExpiry = await contract.ORDER_EXPIRY();
            const gracePeriod = await contract.GRACE_PERIOD();

            for (const order of orders) {
                // Check if grace period has passed (now 14 minutes total)
                if (currentTime > order.timestamp + orderExpiry.toNumber() + gracePeriod.toNumber()) {
                    if (order.status === 'Active') {
                        eligibleOrders.active.push(order);
                        activeFees += Number(order.orderCreationFee || 0);
                    } else if (order.status === 'Canceled') {
                        eligibleOrders.cancelled.push(order);
                        cancelledFees += Number(order.orderCreationFee || 0);
                    } else if (order.status === 'Filled') {
                        eligibleOrders.filled.push(order);
                        filledFees += Number(order.orderCreationFee || 0);
                    }
                }
            }
            
            const totalEligible = eligibleOrders.active.length + 
                eligibleOrders.cancelled.length + 
                eligibleOrders.filled.length;
            const totalFees = activeFees + cancelledFees + filledFees;
            
            // Update UI elements
            const elements = {
                activeCount: document.getElementById('active-orders-count'),
                activeFees: document.getElementById('active-orders-fees'),
                cancelledCount: document.getElementById('cancelled-orders-count'),
                cancelledFees: document.getElementById('cancelled-orders-fees'),
                filledCount: document.getElementById('filled-orders-count'),
                filledFees: document.getElementById('filled-orders-fees'),
                totalReward: document.getElementById('cleanup-reward'),
                totalReady: document.getElementById('cleanup-ready'),
                cleanupButton: document.getElementById('cleanup-button')
            };
            
            if (elements.activeCount) {
                elements.activeCount.textContent = eligibleOrders.active.length.toString();
            }
            if (elements.activeFees) {
                elements.activeFees.textContent = `${this.formatEth(activeFees)} POL`;
            }
            if (elements.cancelledCount) {
                elements.cancelledCount.textContent = eligibleOrders.cancelled.length.toString();
            }
            if (elements.cancelledFees) {
                elements.cancelledFees.textContent = `${this.formatEth(cancelledFees)} POL`;
            }
            if (elements.filledCount) {
                elements.filledCount.textContent = eligibleOrders.filled.length.toString();
            }
            if (elements.filledFees) {
                elements.filledFees.textContent = `${this.formatEth(filledFees)} POL`;
            }
            if (elements.totalReward) {
                elements.totalReward.textContent = `${this.formatEth(totalFees)} POL`;
            }
            if (elements.totalReady) {
                elements.totalReady.textContent = totalEligible.toString();
            }
            if (elements.cleanupButton) {
                elements.cleanupButton.disabled = totalEligible === 0;
                const batchSize = Math.min(totalEligible, 10); // Using contract's MAX_CLEANUP_BATCH
                if (totalEligible > 10) {
                    elements.cleanupButton.textContent = `Clean ${batchSize} of ${totalEligible} Orders`;
                } else {
                    elements.cleanupButton.textContent = `Clean ${batchSize} Order${batchSize !== 1 ? 's' : ''}`;
                }
            }

            this.debug('Cleanup stats:', {
                active: {
                    count: eligibleOrders.active.length,
                    fees: this.formatEth(activeFees)
                },
                cancelled: {
                    count: eligibleOrders.cancelled.length,
                    fees: this.formatEth(cancelledFees)
                },
                filled: {
                    count: eligibleOrders.filled.length,
                    fees: this.formatEth(filledFees)
                },
                total: {
                    count: totalEligible,
                    fees: this.formatEth(totalFees)
                }
            });

        } catch (error) {
            this.debug('Error checking cleanup opportunities:', error);
            this.showError('Failed to check cleanup opportunities');
            this.updateUIForError();
        }
    }

    updateUIForError() {
        const errorText = 'Error';
        ['active-orders-count', 'active-orders-fees', 
         'cancelled-orders-count', 'cancelled-orders-fees',
         'filled-orders-count', 'filled-orders-fees',
         'cleanup-reward', 'cleanup-ready'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = errorText;
        });
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
            const contract = this.webSocket?.contract;
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            if (!window.walletManager?.provider) {
                throw new Error('Wallet not connected');
            }

            // Get signer from wallet manager
            const signer = await window.walletManager.getSigner();
            if (!signer) {
                throw new Error('No signer available');
            }

            const contractWithSigner = contract.connect(signer);

            this.cleanupButton.disabled = true;
            this.cleanupButton.textContent = 'Cleaning...';

            // Get eligible orders first
            const orders = this.webSocket.getOrders();
            const currentTime = Math.floor(Date.now() / 1000);
            const ORDER_EXPIRY = await contract.ORDER_EXPIRY();
            const GRACE_PERIOD = await contract.GRACE_PERIOD();

            const eligibleOrders = orders.filter(order => 
                currentTime > Number(order.timestamp) + ORDER_EXPIRY.toNumber() + GRACE_PERIOD.toNumber()
            );

            if (eligibleOrders.length === 0) {
                throw new Error('No eligible orders to clean');
            }

            // More accurate base gas calculation for single order cleanup
            const baseGasEstimate = ethers.BigNumber.from('85000')  // Base transaction cost
                .add(ethers.BigNumber.from('65000'))               // Single order cost
                .add(ethers.BigNumber.from('25000'));             // Buffer for contract state changes

            // Try multiple gas estimation attempts with fallback
            let gasEstimate;
            try {
                // Try actual contract estimation first
                gasEstimate = await contractWithSigner.estimateGas.cleanupExpiredOrders();
                this.debug('Initial gas estimation:', gasEstimate.toString());
            } catch (estimateError) {
                this.debug('Primary gas estimation failed:', estimateError);
                try {
                    // Fallback: Try estimation with higher gas limit
                    gasEstimate = await contractWithSigner.estimateGas.cleanupExpiredOrders({
                        gasLimit: baseGasEstimate.mul(2) // Double the base estimate
                    });
                    this.debug('Fallback gas estimation succeeded:', gasEstimate.toString());
                } catch (fallbackError) {
                    this.debug('Fallback gas estimation failed:', fallbackError);
                    // Use calculated estimate as last resort
                    gasEstimate = baseGasEstimate;
                    this.debug('Using base gas estimate:', gasEstimate.toString());
                }
            }

            // Add 30% buffer for safety (increased from 20% due to retry mechanism)
            const gasLimit = gasEstimate.mul(130).div(100);

            const feeData = await contract.provider.getFeeData();
            if (!feeData?.gasPrice) {
                throw new Error('Unable to get current gas prices');
            }

            const txOptions = {
                gasLimit,
                gasPrice: feeData.gasPrice,
                type: 0  // Legacy transaction
            };

            this.debug('Transaction options:', {
                gasLimit: gasLimit.toString(),
                gasPrice: feeData.gasPrice.toString(),
                estimatedCost: ethers.utils.formatEther(gasLimit.mul(feeData.gasPrice)) + ' ETH'
            });

            // Execute cleanup with retry mechanism
            const maxRetries = 3;
            let attempt = 0;
            let lastError;

            while (attempt < maxRetries) {
                try {
                    console.log('[Cleanup] Sending transaction with options:', txOptions);
                    const tx = await contractWithSigner.cleanupExpiredOrders(txOptions);
                    console.log('[Cleanup] Transaction sent:', tx.hash);

                    const receipt = await tx.wait();
                    console.log('[Cleanup] Transaction confirmed:', receipt);

                    if (receipt.status === 1) {
                        // Parse cleanup events from receipt
                        const events = receipt.events || [];
                        const cleanedOrderIds = [];
                        const retryOrderIds = new Map(); // Map old order IDs to new ones

                        for (const event of events) {
                            if (event.event === 'OrderCleanedUp') {
                                cleanedOrderIds.push(event.args.orderId.toString());
                            } else if (event.event === 'RetryOrder') {
                                retryOrderIds.set(
                                    event.args.oldOrderId.toString(),
                                    event.args.newOrderId.toString()
                                );
                            }
                        }

                        if (cleanedOrderIds.length || retryOrderIds.size) {
                            this.debug('Cleanup results:', {
                                cleaned: cleanedOrderIds,
                                retried: Array.from(retryOrderIds.entries())
                            });

                            // Remove cleaned orders from WebSocket cache
                            if (cleanedOrderIds.length) {
                                this.webSocket.removeOrders(cleanedOrderIds);
                            }

                            // Update retried orders in WebSocket cache
                            if (retryOrderIds.size) {
                                await this.webSocket.syncAllOrders(contract);
                            }

                            this.showSuccess('Cleanup successful! Check your wallet for rewards.');
                        }
                        return;
                    }
                    throw new Error('Transaction failed during execution');
                } catch (error) {
                    lastError = error;
                    attempt++;
                    if (attempt < maxRetries) {
                        this.debug(`Attempt ${attempt} failed, retrying...`, error);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }

            throw lastError;

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
            await this.checkCleanupOpportunities();
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

    // Add helper method to format ETH values
    formatEth(wei) {
        return ethers.utils.formatEther(wei.toString());
    }

    async disableContract() {
        try {
            const contract = this.webSocket?.contract;
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            // Get signer from wallet manager
            const signer = await window.walletManager.getSigner();
            if (!signer) {
                throw new Error('No signer available');
            }

            const contractWithSigner = contract.connect(signer);

            this.disableContractButton.disabled = true;
            this.disableContractButton.textContent = 'Disabling...';

            const tx = await contractWithSigner.disableContract();
            await tx.wait();

            this.showSuccess('Contract successfully disabled');
            this.disableContractButton.textContent = 'Contract Disabled';

        } catch (error) {
            this.debug('Error disabling contract:', error);
            this.showError(`Failed to disable contract: ${error.message}`);
            this.disableContractButton.disabled = false;
            this.disableContractButton.textContent = 'Disable Contract';
        }
    }
} 