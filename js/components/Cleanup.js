import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';
import { createLogger } from '../services/LogService.js';

export class Cleanup extends BaseComponent {
    constructor(containerId) {
        super('cleanup-container');
        this.webSocket = window.webSocket;
        this.contract = null;
        this.isInitializing = false;
        this.isInitialized = false;
        
        // Initialize logger
        const logger = createLogger('CLEANUP');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
    }

    async initialize(readOnlyMode = true) {
        if (this.isInitializing) {
            this.debug('Already initializing, skipping...');
            return;
        }

        if (this.isInitialized) {
            this.debug('Already initialized, skipping...');
            return;
        }

        this.isInitializing = true;

        try {
            this.debug('Starting Cleanup initialization...');
            this.debug('ReadOnly mode:', readOnlyMode);
            
            // Wait for WebSocket to be fully initialized
            if (!window.webSocket?.isInitialized) {
                this.debug('Waiting for WebSocket initialization...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }

            // Update WebSocket reference and get contract
            this.webSocket = window.webSocket;
            this.contract = this.webSocket.contract;

            // Verify contract is available
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            // Wait for contract to be ready
            await this.waitForContract();

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
                
                // Add wallet connection listener to reinitialize when wallet connects
                if (window.walletManager) {
                    window.walletManager.addListener((event, data) => {
                        if (event === 'connect') {
                            this.debug('Wallet connected in read-only mode, reinitializing...');
                            this.initialize(false); // Reinitialize in connected mode
                        }
                    });
                }
                return;
            }

            this.debug('Setting up UI components');
            const wrapper = this.createElement('div', 'tab-content-wrapper');
            wrapper.innerHTML = `
                <div class="cleanup-section">
                    <h2>Cleanup Expired Orders</h2>
                    <div class="cleanup-info">
                        <p>Help maintain the orderbook by cleaning up expired orders</p>
                        <div class="cleanup-stats">
                            <div class="cleanup-rewards">
                                <h3>Cleanup Information</h3>
                                <div>Next cleanup reward: <span id="current-reward">Loading...</span></div>
                                <div>Orders ready: <span id="cleanup-ready">Loading...</span></div>
                            </div>
                        </div>
                    </div>
                    <button id="cleanup-button" class="action-button" disabled>
                        Clean Orders
                    </button>
                </div>`;
            
            this.container.appendChild(wrapper);

            // Only set up the cleanup button event listener
            this.cleanupButton = document.getElementById('cleanup-button');
            if (this.cleanupButton) {
                this.cleanupButton.addEventListener('click', () => this.performCleanup());
            }

            this.debug('Starting cleanup opportunities check');
            await this.checkCleanupOpportunities();
            
            this.intervalId = setInterval(() => this.checkCleanupOpportunities(), 5 * 60 * 1000);
            
            this.isInitialized = true;
            this.debug('Initialization complete');

            this.debug('WebSocket connection successful:', {
                isInitialized: this.webSocket.isInitialized,
                contractAddress: this.webSocket.contract.address
            });

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
        } finally {
            this.isInitializing = false;
        }
    }

    // Add method to check if contract is ready (similar to CreateOrder)
    async waitForContract(timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (this.contract && await this.contract.provider.getNetwork()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Contract not ready after timeout');
    }

    // Update cleanup method to use class contract reference
    async checkCleanupOpportunities() {
        try {
            if (!this.webSocket?.contract) {
                this.warn('Waiting for WebSocket contract initialization...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.checkCleanupOpportunities();
            }

            // Get all orders from WebSocket cache
            const orders = this.webSocket.getOrders();
            const currentTime = Math.floor(Date.now() / 1000);
            
            // Filter eligible orders
            const eligibleOrders = orders.filter(order => 
                currentTime > order.timings.graceEndsAt
            );

            // Get the first order that will be cleaned (lowest ID)
            const nextOrderToClean = eligibleOrders.length > 0 
                ? eligibleOrders.reduce((lowest, order) => 
                    (!lowest || order.id < lowest.id) ? order : lowest
                , null)
                : null;

            this.debug('Next order to clean:', nextOrderToClean);

            // Update UI elements
            const elements = {
                cleanupButton: document.getElementById('cleanup-button'),
                cleanupReady: document.getElementById('cleanup-ready'),
                currentReward: document.getElementById('current-reward')
            };
            
            if (elements.cleanupReady) {
                elements.cleanupReady.textContent = eligibleOrders.length.toString();
            }

            // Display reward for next cleanup
            if (elements.currentReward && nextOrderToClean) {
                try {
                    // Get fee information directly from contract
                    const [feeToken, feeAmount] = await Promise.all([
                        this.webSocket.contract.feeToken(),
                        this.webSocket.contract.orderCreationFeeAmount()
                    ]);

                    this.debug('Fee info from contract:', { feeToken, feeAmount: feeAmount.toString() });

                    const tokenInfo = await this.webSocket.getTokenInfo(feeToken);
                    
                    // Format with proper decimals and round to 6 decimal places
                    const formattedAmount = parseFloat(
                        ethers.utils.formatUnits(feeAmount, tokenInfo.decimals)
                    ).toFixed(6);

                    elements.currentReward.textContent = `${formattedAmount} ${tokenInfo.symbol}`;

                    this.debug('Reward formatting:', {
                        feeToken,
                        feeAmount: feeAmount.toString(),
                        decimals: tokenInfo.decimals,
                        formatted: formattedAmount,
                        symbol: tokenInfo.symbol
                    });
                } catch (error) {
                    this.debug('Error formatting reward:', error);
                    elements.currentReward.textContent = 'Error getting reward amount';
                }
            } else if (elements.currentReward) {
                elements.currentReward.textContent = 'No orders to clean';
            }

            if (elements.cleanupButton) {
                // Check if wallet is connected
                const isWalletConnected = window.walletManager?.isWalletConnected();
                
                if (!isWalletConnected) {
                    elements.cleanupButton.disabled = true;
                    elements.cleanupButton.textContent = 'Connect Wallet';
                } else if (eligibleOrders.length === 0) {
                    elements.cleanupButton.disabled = true;
                    elements.cleanupButton.textContent = 'Clean Orders';
                } else {
                    elements.cleanupButton.disabled = false;
                    elements.cleanupButton.textContent = 'Clean Orders';
                }
            }

            this.debug('Cleanup opportunities:', {
                totalEligible: eligibleOrders.length,
                nextOrderToClean: nextOrderToClean ? {
                    id: nextOrderToClean.id,
                    fullOrder: nextOrderToClean
                } : null
            });

        } catch (error) {
            this.error('Error checking cleanup opportunities:', error);
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
            this.warn('WebSocket not available for setup');
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

        // Add wallet connection event listeners
        if (window.walletManager) {
            window.walletManager.addListener((event, data) => {
                if (event === 'connect') {
                    this.debug('Wallet connected, updating cleanup button state');
                    this.checkCleanupOpportunities();
                } else if (event === 'disconnect') {
                    this.debug('Wallet disconnected, updating cleanup button state');
                    this.checkCleanupOpportunities();
                }
            });
        }
    }

    async performCleanup() {
        try {
            // Check if wallet is connected first
            if (!window.walletManager?.isWalletConnected()) {
                this.debug('Wallet not connected, attempting to connect...');
                try {
                    await window.walletManager.connect();
                    // After successful connection, refresh the button state
                    await this.checkCleanupOpportunities();
                    return;
                } catch (error) {
                    this.error('Failed to connect wallet:', error);
                    this.showError('Failed to connect wallet: ' + error.message);
                    return;
                }
            }

            const contract = this.webSocket?.contract;
            if (!contract) {
                this.error('Contract not initialized');
                throw new Error('Contract not initialized');
            }

            const signer = await window.walletManager.getSigner();
            if (!signer) {
                throw new Error('No signer available');
            }

            const contractWithSigner = contract.connect(signer);

            this.cleanupButton.disabled = true;
            this.cleanupButton.textContent = 'Cleaning...';

            const orders = this.webSocket.getOrders();
            const currentTime = Math.floor(Date.now() / 1000);
            const eligibleOrders = orders.filter(order => 
                currentTime > order.timings.graceEndsAt
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
                this.warn('Primary gas estimation failed:', estimateError);
                try {
                    // Fallback: Try estimation with higher gas limit
                    gasEstimate = await contractWithSigner.estimateGas.cleanupExpiredOrders({
                        gasLimit: baseGasEstimate.mul(2) // Double the base estimate
                    });
                    this.debug('Fallback gas estimation succeeded:', gasEstimate.toString());
                } catch (fallbackError) {
                    this.warn('Fallback gas estimation failed:', fallbackError);
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
            this.error('Cleanup failed:', {
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
        
        // Create success message element
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message';
        successMessage.textContent = message;

        // Find the fee config form and add message
        const feeConfigForm = document.querySelector('.fee-config-form');
        if (feeConfigForm) {
            // Remove any existing messages
            const existingMessage = feeConfigForm.querySelector('.success-message, .error-message');
            if (existingMessage) {
                existingMessage.remove();
            }

            // Add new message
            feeConfigForm.appendChild(successMessage);
            feeConfigForm.classList.add('update-success');

            // Clear form inputs
            const feeTokenInput = document.getElementById('fee-token');
            const feeAmountInput = document.getElementById('fee-amount');
            if (feeTokenInput) feeTokenInput.value = '';
            if (feeAmountInput) feeAmountInput.value = '';

            // Remove message and animation after delay
            setTimeout(() => {
                successMessage.remove();
                feeConfigForm.classList.remove('update-success');
            }, 3000);
        }
    }

    showError(message) {
        this.error('Error:', message);
        
        // Create error message element
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = message;

        // Find the fee config form and add message
        const feeConfigForm = document.querySelector('.fee-config-form');
        if (feeConfigForm) {
            // Remove any existing messages
            const existingMessage = feeConfigForm.querySelector('.success-message, .error-message');
            if (existingMessage) {
                existingMessage.remove();
            }

            // Add new message
            feeConfigForm.appendChild(errorMessage);

            // Remove message after delay
            setTimeout(() => {
                errorMessage.remove();
            }, 3000);
        }
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

    cleanup() {
        this.debug('Cleaning up Cleanup component');
        if (this.intervalId) {
            this.debug('Cleaning up cleanup check interval');
            clearInterval(this.intervalId);
        }
        
        // Remove wallet listeners
        if (window.walletManager) {
            // Note: We can't easily remove specific listeners, but the component will be recreated
            // when needed, so this is acceptable for now
            this.debug('Wallet listeners will be cleaned up on component recreation');
        }
        
        this.debug('Resetting component state');
        this.isInitialized = false;
        this.isInitializing = false;
        this.contract = null;
    }

    async updateFeeConfig() {
        try {
            const contract = this.webSocket?.contract;
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            const signer = await window.walletManager.getSigner();
            if (!signer) {
                throw new Error('No signer available');
            }

            const contractWithSigner = contract.connect(signer);

            const feeToken = document.getElementById('fee-token').value;
            const feeAmount = document.getElementById('fee-amount').value;

            if (!ethers.utils.isAddress(feeToken)) {
                throw new Error('Invalid fee token address');
            }

            if (!feeAmount || isNaN(feeAmount)) {
                throw new Error('Invalid fee amount');
            }

            this.updateFeeConfigButton.disabled = true;
            this.updateFeeConfigButton.textContent = 'Updating...';

            const tx = await contractWithSigner.updateFeeConfig(feeToken, feeAmount);
            await tx.wait();

            // Clear the form
            document.getElementById('fee-token').value = '';
            document.getElementById('fee-amount').value = '';

            // Add success message
            const feeConfigForm = document.querySelector('.fee-config-form');
            const successMessage = document.createElement('div');
            successMessage.className = 'success-message';
            successMessage.textContent = 'Fee configuration updated successfully!';
            feeConfigForm.appendChild(successMessage);

            // Add success animation class
            feeConfigForm.classList.add('update-success');

            // Remove success message and animation after 3 seconds
            setTimeout(() => {
                successMessage.remove();
                feeConfigForm.classList.remove('update-success');
            }, 3000);

            this.showSuccess('Fee configuration updated successfully');
        } catch (error) {
            this.debug('Error updating fee config:', error);
            this.showError(`Failed to update fee config: ${error.message}`);
        } finally {
            this.updateFeeConfigButton.disabled = false;
            this.updateFeeConfigButton.textContent = 'Update Fee Config';
        }
    }
} 