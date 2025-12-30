import { walletManager } from '../config.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';
import { createLogger } from '../services/LogService.js';

/**
 * BaseComponent - Base class for all UI components
 * 
 * LIFECYCLE CONTRACT:
 * 
 * 1. constructor(containerId)
 *    - MUST be side-effect free (no network calls, no event subscriptions)
 *    - Sets up container reference and default state
 *    - Initializes logger
 * 
 * 2. initialize(readOnlyMode = true)
 *    - Called by App when component should set up
 *    - Handles rendering, event subscriptions, data loading
 *    - readOnlyMode=true means no wallet connected
 *    - Should be idempotent (safe to call multiple times)
 * 
 * 3. cleanup()
 *    - Called by App before switching away from component
 *    - Removes event listeners, clears timers, unsubscribes from services
 *    - Should NOT clear rendered content (preserve for quick tab switches)
 * 
 * INITIALIZATION FLAGS:
 * - this.initialized: true after first successful initialize()
 * - this.initializing: true while initialize() is running (prevents concurrent calls)
 * 
 * For backward compatibility, isInitialized/isInitializing getters are provided.
 */
export class BaseComponent {
    constructor(containerId) {
        // Initialize logger
        const logger = createLogger('BASE_COMPONENT');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);

        this.debug('Constructor called with:', containerId);
        this.container = document.querySelector(`#${containerId}, .${containerId}`);
        if (!this.container) {
            this.error(`Container not found: ${containerId}`);
            throw new Error(`Container with id or class ${containerId} not found`);
        }
        
        // Standardized initialization flags
        this.initialized = false;
        this.initializing = false;
        
        // Initialize the token cache
        this.tokenCache = new Map();
        // Initialize provider from window.walletManager if available
        this.provider = window.walletManager?.provider || null;
    }

    // Backward compatibility getters for components using isInitialized/isInitializing
    get isInitialized() {
        return this.initialized;
    }
    
    set isInitialized(value) {
        this.initialized = value;
    }
    
    get isInitializing() {
        return this.initializing;
    }
    
    set isInitializing(value) {
        this.initializing = value;
    }

    createElement(tag, className = '', textContent = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }

    showError(message, duration = 0) {
        this.debug('Showing error toast:', message);
        if (window.showError) {
            return window.showError(message, duration);
        } else {
            // Fallback to console if toast is not available
            this.error(message);
        }
    }

    showSuccess(message, duration = 5000) {
        this.debug('Showing success toast:', message);
        if (window.showSuccess) {
            return window.showSuccess(message, duration);
        } else {
            // Fallback to console if toast is not available
            this.debug(message);
        }
    }

    showWarning(message, duration = 5000) {
        this.debug('Showing warning toast:', message);
        if (window.showWarning) {
            return window.showWarning(message, duration);
        } else {
            // Fallback to console if toast is not available
            this.warn(message);
        }
    }

    showInfo(message, duration = 5000) {
        this.debug('Showing info toast:', message);
        if (window.showInfo) {
            return window.showInfo(message, duration);
        } else {
            // Fallback to console if toast is not available
            this.debug(message);
        }
    }

    /**
     * Default initialize method - subclasses should override
     * @param {boolean} readOnlyMode - true if no wallet connected
     */
    async initialize(readOnlyMode = true) {
        // Default implementation - subclasses override
        if (!this.initialized) {
            this.initialized = true;
        }
    }

    /**
     * Default cleanup method - subclasses should override
     * Cleans up event listeners, timers, subscriptions
     */
    cleanup() {
        // Default implementation - subclasses override
        this.debug('Base cleanup called');
    }

    // Legacy render method - deprecated, use initialize() instead
    render() {
        if (!this.initialized) {
            this.initialized = true;
        }
    }

    // Add method to get contract (used by CreateOrder)
    async getContract() {
        try {
            // If we're in read-only mode, return null without throwing
            if (!window.walletManager?.provider) {
                this.debug('No wallet connected - running in read-only mode');
                return null;
            }

            await window.walletInitialized;
            const contract = await walletManager.getContract();
            if (!contract) {
                this.warn('Contract not initialized');
                return null;
            }
            return contract;
        } catch (error) {
            this.error('Error getting contract:', error);
            return null;
        }
    }

    // Add method to get signer (used by CreateOrder)
    async getSigner() {
        try {
            if (!window.walletManager?.provider) {
                this.error('No wallet provider available');
                throw new Error('Please connect your wallet first');
            }
            this.signer = await window.walletManager.provider.getSigner();
            return this.signer;
        } catch (error) {
            this.error('Error getting signer:', error);
            throw error;
        }
    }

    // Add this method to BaseComponent.js
    async getTokenDetails(tokenAddresses) {
        try {
            this.debug('Getting token details for:', tokenAddresses);
            
            // Ensure tokenAddresses is always an array
            const addressArray = Array.isArray(tokenAddresses) ? tokenAddresses : [tokenAddresses];
            
            // Get signer for balance check
            let userAddress = null;
            try {
                const signer = await this.getSigner().catch(() => null);
                userAddress = signer ? await signer.getAddress() : null;
            } catch (error) {
                this.debug('No signer available - skipping balance check');
            }

            const validAddresses = addressArray
                .filter(addr => typeof addr === 'string' && ethers.utils.isAddress(addr))
                .map(addr => addr.toLowerCase());

            if (validAddresses.length === 0) {
                this.warn('No valid token addresses provided');
                return addressArray.map(() => null);
            }

            const results = await Promise.all(validAddresses.map(async (tokenAddress) => {
                // Check cache first with lowercase address
                if (this.tokenCache.has(tokenAddress)) {
                    this.debug('Cache hit for token:', tokenAddress);
                    // If we have a user address, update balance even for cached tokens
                    if (userAddress) {
                        const tokenContract = new ethers.Contract(
                            tokenAddress,
                            erc20Abi,
                            this.provider
                        );
                        const balance = await tokenContract.balanceOf(userAddress);
                        const cachedDetails = this.tokenCache.get(tokenAddress);
                        return {
                            ...cachedDetails,
                            balance,
                            formattedBalance: ethers.utils.formatUnits(balance, cachedDetails.decimals)
                        };
                    }
                    return this.tokenCache.get(tokenAddress);
                }

                try {
                    const tokenContract = new ethers.Contract(
                        tokenAddress,
                        erc20Abi,
                        this.provider
                    );

                    // Use Promise.all for parallel requests
                    const [name, symbol, decimals, balance] = await Promise.all([
                        tokenContract.name().catch(() => null),
                        tokenContract.symbol().catch(() => null),
                        tokenContract.decimals().catch(() => 18),
                        userAddress ? tokenContract.balanceOf(userAddress).catch(() => '0') : '0'
                    ]);

                    // If both name and symbol failed, use formatted address
                    const shortAddr = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
                    const details = {
                        name: name || shortAddr,
                        symbol: symbol || 'UNK',
                        decimals,
                        address: tokenAddress,
                        balance,
                        formattedBalance: ethers.utils.formatUnits(balance, decimals)
                    };

                    // Cache the result with lowercase address
                    this.tokenCache.set(tokenAddress, details);
                    this.debug('Added token to cache:', { address: tokenAddress, details });
                    return details;
                } catch (error) {
                    this.debug('Error fetching token details:', {
                        address: tokenAddress,
                        error: error.message
                    });
                    return null;
                }
            }));

            this.debug('Token cache after update:', Array.from(this.tokenCache.entries()));
            return results;
        } catch (error) {
            this.error('Error in getTokenDetails:', error);
            return Array.isArray(tokenAddresses) ? tokenAddresses.map(() => null) : null;
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
            this.debug('Retryable RPC code detected:', rpcCode);
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
            this.debug('Retryable message detected:', {
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

        this.error('Detailed error:', prefix, errorDetails);
        return errorDetails;
    }

    // Modified retry call with better logging
    async retryCall(fn, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                this.debug(`Attempt ${i + 1}/${maxRetries}`);
                return await fn();
            } catch (error) {
                const errorDetails = this.logDetailedError(
                    `Attempt ${i + 1} failed:`,
                    error
                );

                const isRetryable = this.isRetryableError(error);
                this.debug('Error is retryable:', isRetryable, {
                    errorCode: errorDetails.code,
                    rpcCode: errorDetails.rpcCode,
                    message: errorDetails.message
                });

                if (i === maxRetries - 1 || !isRetryable) {
                    this.error('Max retries reached or non-retryable error');
                    throw error;
                }
                
                const waitTime = delay * Math.pow(2, i);
                this.warn(`Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
}
