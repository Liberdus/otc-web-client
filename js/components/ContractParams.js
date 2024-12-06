import { BaseComponent } from './BaseComponent.js';
import { isDebugEnabled } from '../config.js';
import { ethers } from 'ethers';

export class ContractParams extends BaseComponent {
    constructor() {
        super('contract-params');
        
        this.debug = (message, ...args) => {
            if (isDebugEnabled('CONTRACT_PARAMS')) {
                console.log('[ContractParams]', message, ...args);
            }
        };
    }

    async initialize(readOnlyMode = true) {
        try {
            this.debug('Initializing ContractParams component');
            
            // Create basic structure
            this.container.innerHTML = `
                <div class="tab-content-wrapper">
                    <h2>Contract Parameters</h2>
                    <div class="params-container">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Loading parameters...</div>
                    </div>
                </div>`;

            // Get contract instance
            const contract = await this.getContract();
            if (!contract) {
                this.showError('Contract not initialized');
                return;
            }

            // Fetch all parameters
            const [
                orderCreationFee,
                firstOrderId,
                nextOrderId,
                isDisabled,
                feeToken,
                owner,
                accumulatedFees,
                gracePeriod,
                orderExpiry,
                maxRetryAttempts
            ] = await Promise.all([
                contract.orderCreationFeeAmount(),
                contract.firstOrderId(),
                contract.nextOrderId(),
                contract.isDisabled(),
                contract.feeToken(),
                contract.owner(),
                contract.accumulatedFees(),
                contract.GRACE_PERIOD(),
                contract.ORDER_EXPIRY(),
                contract.MAX_RETRY_ATTEMPTS()
            ]);

            // Update UI
            const paramsContainer = this.container.querySelector('.params-container');
            paramsContainer.innerHTML = `
                <div class="param-grid">
                    <div class="param-section">
                        <h3>Contract State</h3>
                        <div class="param-item">
                            <h4>Order Creation Fee</h4>
                            <p>${this.formatEther(orderCreationFee)} ETH</p>
                        </div>
                        <div class="param-item">
                            <h4>Fee Token</h4>
                            <p>${feeToken}</p>
                        </div>
                        <div class="param-item">
                            <h4>Accumulated Fees</h4>
                            <p>${this.formatEther(accumulatedFees)} ETH</p>
                        </div>
                        <div class="param-item">
                            <h4>Contract Status</h4>
                            <p class="${isDisabled ? 'status-disabled' : 'status-enabled'}">
                                ${isDisabled ? 'Disabled' : 'Enabled'}
                            </p>
                        </div>
                    </div>

                    <div class="param-section">
                        <h3>Order Tracking</h3>
                        <div class="param-item">
                            <h4>First Order ID</h4>
                            <p>${firstOrderId.toString()}</p>
                        </div>
                        <div class="param-item">
                            <h4>Next Order ID</h4>
                            <p>${nextOrderId.toString()}</p>
                        </div>
                        <div class="param-item">
                            <h4>Total Orders</h4>
                            <p>${nextOrderId.sub(firstOrderId).toString()}</p>
                        </div>
                    </div>

                    <div class="param-section">
                        <h3>Contract Configuration</h3>
                        <div class="param-item">
                            <h4>Owner</h4>
                            <p>${owner}</p>
                        </div>
                        <div class="param-item">
                            <h4>Grace Period</h4>
                            <p>${this.formatTime(gracePeriod)}</p>
                        </div>
                        <div class="param-item">
                            <h4>Order Expiry</h4>
                            <p>${this.formatTime(orderExpiry)}</p>
                        </div>
                        <div class="param-item">
                            <h4>Max Retry Attempts</h4>
                            <p>${maxRetryAttempts.toString()}</p>
                        </div>
                    </div>

                    <div class="param-section">
                        <h3>Network Info</h3>
                        <div class="param-item">
                            <h4>Chain ID</h4>
                            <p>${await contract.provider.getNetwork().then(n => n.chainId)}</p>
                        </div>
                        <div class="param-item">
                            <h4>Contract Address</h4>
                            <p>${contract.address}</p>
                        </div>
                    </div>
                </div>`;

        } catch (error) {
            console.error('[ContractParams] Initialization error:', error);
            this.showError('Failed to load contract parameters');
        }
    }

    formatTime(seconds) {
        const days = Math.floor(seconds / (24 * 60 * 60));
        const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
        const minutes = Math.floor((seconds % (60 * 60)) / 60);
        
        return `${days}d ${hours}h ${minutes}m`;
    }

    formatEther(wei) {
        return ethers.utils.formatEther(wei);
    }
} 