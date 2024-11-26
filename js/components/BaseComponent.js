import { walletManager } from '../config.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { isDebugEnabled } from '../config.js';

console.log('BaseComponent.js loaded');

export class BaseComponent {
    constructor(containerId) {
        console.log('BaseComponent constructor called with:', containerId);
        this.container = document.querySelector(`#${containerId}, .${containerId}`);
        if (!this.container) {
            throw new Error(`Container with id or class ${containerId} not found`);
        }
        
        // Initialize the token cache
        this.tokenCache = new Map();
        // Initialize provider from window.walletManager if available
        this.provider = window.walletManager?.provider || null;

        this.debug = (message, ...args) => {
            if (isDebugEnabled('COMPONENTS')) {
                console.log(`[${this.constructor.name}]`, message, ...args);
            }
        };
    }

    createElement(tag, className = '', textContent = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'status error';
        errorDiv.textContent = message;
        this.container.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }

    showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'status success';
        successDiv.textContent = message;
        this.container.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 5000);
    }

    // Add default render method
    render() {
        if (!this.initialized) {
            this.initialized = true;
        }
    }

    // Add method to get contract (used by CreateOrder)
    async getContract() {
        try {
            await window.walletInitialized;
            const contract = await walletManager.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }
            return contract;
        } catch (error) {
            console.error('[BaseComponent] Error getting contract:', error);
            return null;
        }
    }

    // Add method to get signer (used by CreateOrder)
    async getSigner() {
        try {
            if (!window.walletManager?.provider) {
                throw new Error('Please connect your wallet first');
            }
            this.signer = await window.walletManager.provider.getSigner();
            return this.signer;
        } catch (error) {
            console.error('[BaseComponent] Error getting signer:', error);
            throw error;
        }
    }

    // Add this method to BaseComponent.js
    async getTokenDetails(tokenAddresses) {
        try {
            console.log('[BaseComponent] Getting token details for:', tokenAddresses);
            
            // Cache verification
            if (!this.tokenCache) {
                console.warn('[BaseComponent] Token cache not initialized');
                this.tokenCache = new Map();
            }

            // Ensure we have a provider
            if (!this.provider) {
                this.provider = window.walletManager?.provider;
                if (!this.provider) {
                    throw new Error('Provider not available');
                }
            }

            // Get signer for balance check
            const signer = await this.getSigner().catch(() => null);
            const userAddress = signer ? await signer.getAddress() : null;

            // Ensure tokenAddresses is an array
            if (!Array.isArray(tokenAddresses)) {
                tokenAddresses = [tokenAddresses];
            }

            const validAddresses = tokenAddresses.filter(addr => 
                typeof addr === 'string' && 
                ethers.utils.isAddress(addr)
            );

            if (validAddresses.length === 0) {
                console.warn('[BaseComponent] No valid token addresses provided');
                return null;
            }

            const results = await Promise.all(validAddresses.map(async (tokenAddress) => {
                if (this.tokenCache.has(tokenAddress)) {
                    return this.tokenCache.get(tokenAddress);
                }

                try {
                    const tokenContract = new ethers.Contract(
                        tokenAddress,
                        erc20Abi,
                        this.provider
                    );

                    const [name, symbol, decimals, balance] = await Promise.all([
                        tokenContract.name().catch(() => 'Unknown'),
                        tokenContract.symbol().catch(() => 'UNK'),
                        tokenContract.decimals().catch(() => 18),
                        userAddress ? tokenContract.balanceOf(userAddress).catch(() => '0') : '0'
                    ]);

                    const formattedBalance = ethers.utils.formatUnits(balance, decimals);
                    
                    const details = { 
                        name, 
                        symbol, 
                        decimals, 
                        balance,
                        formattedBalance
                    };
                    
                    this.tokenCache.set(tokenAddress, details);
                    return details;
                } catch (error) {
                    console.error(`[BaseComponent] Error getting details for token ${tokenAddress}:`, error);
                    return null;
                }
            }));

            // Log cache updates
            console.log('[BaseComponent] Token cache after update:', 
                Array.from(this.tokenCache.entries()));

            return results.length === 1 ? results[0] : results;
        } catch (error) {
            console.error('[BaseComponent] Error in getTokenDetails:', error);
            return null;
        }
    }

    // New helper method to determine if an error is retryable
    isRetryableError(error) {
        const retryableCodes = [-32603, -32000]; // Common RPC error codes
        const retryableMessages = [
            'header not found',
            'Internal JSON-RPC error',
            'timeout',
            'network error',
            'missing response',
            'missing trie node',
            'connection reset',
            'connection refused'
        ];

        // Check RPC error codes
        const rpcCode = error.error?.code || error.code;
        if (retryableCodes.includes(rpcCode)) {
            console.log('[BaseComponent] Retryable RPC code detected:', rpcCode);
            return true;
        }

        // Check error messages
        const errorMessage = (error.message || '').toLowerCase();
        const rpcMessage = (error.error?.message || '').toLowerCase();
        const dataMessage = (error.data?.message || '').toLowerCase();

        const hasRetryableMessage = retryableMessages.some(msg => 
            errorMessage.includes(msg.toLowerCase()) ||
            rpcMessage.includes(msg.toLowerCase()) ||
            dataMessage.includes(msg.toLowerCase())
        );

        if (hasRetryableMessage) {
            console.log('[BaseComponent] Retryable message detected:', {
                errorMessage,
                rpcMessage,
                dataMessage
            });
            return true;
        }

        return false;
    }

    // New helper method for detailed error logging
    logDetailedError(prefix, error) {
        const errorDetails = {
            message: error.message,
            code: error.code,
            data: error.data,
            reason: error.reason,
            // RPC specific details
            rpcError: error.error?.data || error.data,
            rpcCode: error.error?.code || error.code,
            rpcMessage: error.error?.message,
            // Transaction details if available
            transaction: error.transaction && {
                from: error.transaction.from,
                to: error.transaction.to,
                data: error.transaction.data,
                value: error.transaction.value?.toString(),
            },
            // Receipt if available
            receipt: error.receipt && {
                status: error.receipt.status,
                gasUsed: error.receipt.gasUsed?.toString(),
                blockNumber: error.receipt.blockNumber,
            },
            // Stack trace
            stack: error.stack,
        };

        this.debug('Detailed error:', prefix, errorDetails);
        return errorDetails;
    }

    // Modified retry call with better logging
    async retryCall(fn, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[BaseComponent] Attempt ${i + 1}/${maxRetries}`);
                return await fn();
            } catch (error) {
                const errorDetails = this.logDetailedError(
                    `[BaseComponent] Attempt ${i + 1} failed:`,
                    error
                );

                const isRetryable = this.isRetryableError(error);
                console.log('[BaseComponent] Error is retryable:', isRetryable, {
                    errorCode: errorDetails.code,
                    rpcCode: errorDetails.rpcCode,
                    message: errorDetails.message
                });

                if (i === maxRetries - 1 || !isRetryable) {
                    console.error('[BaseComponent] Max retries reached or non-retryable error');
                    throw error;
                }
                
                const waitTime = delay * Math.pow(2, i); // Exponential backoff
                console.log(`[BaseComponent] Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
}
