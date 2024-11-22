import { walletManager } from '../config.js';
import { ethers } from 'ethers';

console.log('BaseComponent.js loaded');

export class BaseComponent {
    constructor(containerId) {
        console.log('BaseComponent constructor called with:', containerId);
        this.container = document.querySelector(`#${containerId}, .${containerId}`);
        if (!this.container) {
            throw new Error(`Container with id or class ${containerId} not found`);
        }
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
            console.log('[BaseComponent] Getting contract...');
            await window.walletInitialized;
            return walletManager.getContract();
        } catch (error) {
            console.error('[BaseComponent] Error in getContract:', error);
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
    async getTokenDetails(tokenAddress, forceRefresh = false) {
        try {
            console.log('[BaseComponent] Getting token details for:', tokenAddress);
            
            if (!ethers.utils.isAddress(tokenAddress)) {
                console.warn('[BaseComponent] Invalid token address format:', tokenAddress);
                return null;
            }

            // Check cache only if not forcing refresh
            if (!forceRefresh && this.tokenCache?.has(tokenAddress)) {
                const cachedData = this.tokenCache.get(tokenAddress);
                const cacheAge = Date.now() - (cachedData.timestamp || 0);
                
                // Invalidate cache after 30 seconds for balances
                if (cacheAge < 30000) {
                    console.log('[BaseComponent] Returning cached token details');
                    return cachedData;
                }
            }

            console.log('[BaseComponent] Getting signer for token contract...');
            const signer = await this.getSigner();
            if (!signer) {
                console.warn('[BaseComponent] No signer available');
                return null;
            }

            const minABI = [
                'function name() view returns (string)',
                'function symbol() view returns (string)',
                'function decimals() view returns (uint8)',
                'function balanceOf(address) view returns (uint256)'
            ];

            console.log('[BaseComponent] Creating token contract instance...');
            const tokenContract = new ethers.Contract(tokenAddress, minABI, signer);
            const address = await signer.getAddress();
            console.log('[BaseComponent] Signer address:', address);

            console.log('[BaseComponent] Fetching token details...');
            const [nameResult, symbolResult, decimalsResult, balanceResult] = await Promise.allSettled([
                this.retryCall(() => tokenContract.name(), 3),
                this.retryCall(() => tokenContract.symbol(), 3),
                this.retryCall(() => tokenContract.decimals(), 3),
                this.retryCall(() => tokenContract.balanceOf(address), 3)
            ]);

            console.log('[BaseComponent] Token details results:', {
                name: nameResult,
                symbol: symbolResult,
                decimals: decimalsResult,
                balance: balanceResult
            });

            const details = {
                name: nameResult.status === 'fulfilled' ? nameResult.value : 'Unknown',
                symbol: symbolResult.status === 'fulfilled' ? symbolResult.value : 'Unknown',
                decimals: decimalsResult.status === 'fulfilled' ? decimalsResult.value : 18,
                balance: balanceResult.status === 'fulfilled' ? balanceResult.value : ethers.BigNumber.from(0),
                formattedBalance: balanceResult.status === 'fulfilled' 
                    ? ethers.utils.formatUnits(
                        balanceResult.value, 
                        decimalsResult.status === 'fulfilled' ? decimalsResult.value : 18
                    ) 
                    : '0',
                timestamp: Date.now()
            };

            // Cache the result
            if (!this.tokenCache) this.tokenCache = new Map();
            this.tokenCache.set(tokenAddress, details);

            console.log('[BaseComponent] Returning token details:', details);
            return details;
        } catch (error) {
            this.logDetailedError('[BaseComponent] Error getting token details:', error);
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

        console.error(prefix, JSON.stringify(errorDetails, null, 2));
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
