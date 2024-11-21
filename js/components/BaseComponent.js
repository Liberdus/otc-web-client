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
            await window.walletInitialized;
            return walletManager.getSigner();
        } catch (error) {
            console.error('[BaseComponent] Error in getSigner:', error);
            throw error;
        }
    }

    // Add this method to BaseComponent.js
    async getTokenDetails(tokenAddress) {
        try {
            console.log('[BaseComponent] Getting token details for:', tokenAddress);
            
            if (!ethers.utils.isAddress(tokenAddress)) {
                console.warn('[BaseComponent] Invalid token address format:', tokenAddress);
                return null;
            }

            // Check cache
            if (this.tokenCache?.has(tokenAddress)) {
                console.log('[BaseComponent] Returning cached token details');
                return this.tokenCache.get(tokenAddress);
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
                    : '0'
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
        const retryableMessages = [
            'header not found',
            'Internal JSON-RPC error',
            'timeout',
            'network error',
            'missing response',
            'missing trie node'
        ];

        return retryableMessages.some(msg => 
            error.message?.toLowerCase().includes(msg.toLowerCase()) ||
            error.data?.message?.toLowerCase().includes(msg.toLowerCase())
        );
    }

    // New helper method for detailed error logging
    logDetailedError(prefix, error) {
        console.error(prefix, {
            error: error,
            code: error.code,
            message: error.message,
            data: error.data,
            reason: error.reason,
            stack: error.stack,
            rpcError: error.error?.data || error.data,
            transaction: error.transaction,
            receipt: error.receipt
        });
    }

    // Modified retry call with better logging
    async retryCall(fn, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                const isRetryable = 
                    error.code === 'CALL_EXCEPTION' ||
                    error.message?.includes('header not found') ||
                    error.message?.includes('Internal JSON-RPC error') ||
                    error.data?.message?.includes('header not found');

                if (i === maxRetries - 1 || !isRetryable) throw error;
                
                console.log(`[BaseComponent] Retry ${i + 1}/${maxRetries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}
