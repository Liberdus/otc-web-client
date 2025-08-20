import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';
import { contractService } from '../services/ContractService.js';
import { createLogger } from '../services/LogService.js';
import { tokenIconService } from '../services/TokenIconService.js';

// Initialize logger
const logger = createLogger('CONTRACT_TOKENS');
const debug = logger.debug.bind(logger);
const error = logger.error.bind(logger);
const warn = logger.warn.bind(logger);

// Rate limiting constants
const BASE_DELAY = 500; // Increased base delay between requests (500ms)
const MAX_RETRIES = 3; // Maximum retries for rate limited requests
const BACKOFF_MULTIPLIER = 2; // Exponential backoff multiplier
const MAX_CONSECUTIVE_ERRORS = 5; // Maximum consecutive errors before aggressive backoff
const BATCH_SIZE = 3; // Process tokens in smaller batches

// Global rate limiting state
let lastRequestTime = 0;
let consecutiveRateLimitErrors = 0;
let requestQueue = [];
let isProcessingQueue = false;

/**
 * Enhanced rate limiting utility function with adaptive delays
 * @param {number} minDelay - Minimum delay in milliseconds
 * @returns {Promise<void>}
 */
async function enforceRateLimit(minDelay = BASE_DELAY) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    // Adaptive delay based on consecutive errors
    let adaptiveDelay = minDelay;
    if (consecutiveRateLimitErrors > 0) {
        adaptiveDelay = Math.max(minDelay, BASE_DELAY * Math.pow(BACKOFF_MULTIPLIER, consecutiveRateLimitErrors));
        // Cap the maximum delay to prevent excessive waiting
        adaptiveDelay = Math.min(adaptiveDelay, 10000); // Max 10 seconds
    }
    
    if (timeSinceLastRequest < adaptiveDelay) {
        const delay = adaptiveDelay - timeSinceLastRequest;
        debug(`Rate limiting: waiting ${delay}ms (consecutive errors: ${consecutiveRateLimitErrors})`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    lastRequestTime = Date.now();
}

/**
 * Process tokens in batches to reduce rate limiting
 * @param {Array} tokens - Array of token addresses
 * @param {Function} processFunction - Function to process each token
 * @returns {Promise<Array>} Array of processed results
 */
async function processTokensInBatches(tokens, processFunction) {
    const results = [];
    
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        debug(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tokens.length / BATCH_SIZE)}`);
        
        // Process batch in parallel with rate limiting
        const batchPromises = batch.map(async (token, index) => {
            try {
                // Stagger requests within the batch
                if (index > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100 * index));
                }
                return await processFunction(token);
            } catch (err) {
                error(`Error processing token ${token}:`, err);
                return null;
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(result => result !== null));
        
        // Add delay between batches
        if (i + BATCH_SIZE < tokens.length) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between batches
        }
    }
    
    return results;
}

/**
 * Get allowed tokens from contract with metadata and balances
 * @returns {Promise<Array>} Array of token objects with metadata and balances
 */
export async function getContractAllowedTokens() {
    try {
        debug('Getting contract allowed tokens...');
        
        // Get allowed tokens from contract
        const allowedTokenAddresses = await contractService.getAllowedTokens();
        debug(`Found ${allowedTokenAddresses.length} allowed tokens:`, allowedTokenAddresses);

        if (allowedTokenAddresses.length === 0) {
            debug('No allowed tokens found');
            return [];
        }

        // Reset rate limiting state for new batch
        consecutiveRateLimitErrors = 0;
        
        // Process tokens in batches to reduce rate limiting
        const processToken = async (address) => {
            try {
                await enforceRateLimit();
                
                const [metadata, balance] = await Promise.all([
                    getTokenMetadata(address),
                    getUserTokenBalance(address)
                ]);

                // Get icon URL for the token (with reduced priority to avoid rate limits)
                let iconUrl = null;
                try {
                    // Add small delay before icon request
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    const networkConfig = getNetworkConfig();
                    const chainId = parseInt(networkConfig.chainId, 16);
                    debug(`Fetching icon for token ${address} (${metadata.symbol}) on chain ${chainId}`);
                    iconUrl = await tokenIconService.getIconUrl(address, chainId);
                    debug(`Icon result for ${metadata.symbol}: ${iconUrl}`);
                } catch (err) {
                    debug(`Failed to get icon for token ${address} (${metadata.symbol}):`, err);
                    // Don't fail the entire token processing for icon errors
                }
                
                debug(`Token ${metadata.symbol} final object:`, {
                    address,
                    symbol: metadata.symbol,
                    name: metadata.name,
                    balance: balance || '0',
                    iconUrl: iconUrl
                });

                // Reset consecutive errors on success
                consecutiveRateLimitErrors = 0;
                
                return {
                    address,
                    ...metadata,
                    balance: balance || '0',
                    iconUrl: iconUrl
                };
                
            } catch (err) {
                error(`Error processing token ${address}:`, err);
                
                // Increment consecutive errors for rate limiting
                if (err.code === -32005 || err.message?.includes('rate limit')) {
                    consecutiveRateLimitErrors++;
                    warn(`Rate limit error ${consecutiveRateLimitErrors}/${MAX_CONSECUTIVE_ERRORS} for token ${address}`);
                    
                    // If too many consecutive errors, add longer delay
                    if (consecutiveRateLimitErrors >= MAX_CONSECUTIVE_ERRORS) {
                        debug(`Too many consecutive errors, adding 5 second delay`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        consecutiveRateLimitErrors = 0; // Reset after long delay
                    }
                }
                
                // Return basic token info even if metadata/balance fails
                return {
                    address,
                    symbol: 'UNKNOWN',
                    name: 'Unknown Token',
                    decimals: 18,
                    balance: '0'
                };
            }
        };
        
        const tokensWithData = await processTokensInBatches(allowedTokenAddresses, processToken);

        debug(`Successfully processed ${tokensWithData.length} tokens`);
        return tokensWithData;

    } catch (err) {
        error('Failed to get contract allowed tokens:', err);
        
        // Show toast error and return empty list as per migration plan
        if (window.showError) {
            window.showError('Unable to retrieve token list from contract');
        }
        
        return [];
    }
}

/**
 * Get token metadata (symbol, name, decimals)
 * @param {string} tokenAddress - The token address
 * @returns {Promise<Object>} Token metadata
 */
async function getTokenMetadata(tokenAddress) {
    try {
        // Known token fallbacks for common tokens
        const knownTokens = {
            // Polygon Mainnet tokens
            '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': {
                symbol: 'WBTC',
                name: 'Wrapped Bitcoin',
                decimals: 8
            },
            '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': {
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6
            },
            '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': {
                symbol: 'USDT',
                name: 'Tether USD',
                decimals: 6
            },
            '0x693ed886545970f0a3adf8c59af5ccdb6ddf0a76': {
                symbol: 'LIB',
                name: 'Liberdus',
                decimals: 18
            },
            '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': {
                symbol: 'WETH',
                name: 'Wrapped Ether',
                decimals: 18
            },
            '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': {
                symbol: 'WPOL',
                name: 'Wrapped Polygon Ecosystem Token',
                decimals: 18
            },
        };

                    /* // Amoy Testnet tokens
                    '0x224708430f2FF85E32cd77e986eE558Eb8cC77D9': {
                        symbol: 'FEE',
                        name: 'Fee Token',
                        decimals: 18
                    },
                    '0xB93D55595796D8c59beFC0C9045415B4d567f27c': {
                        symbol: 'TT1',
                        name: 'Trading Token 1',
                        decimals: 18
                    },
                    '0x963322CC131A072F333A76ac321Bb80b6cb5375C': {
                        symbol: 'TT2',
                        name: 'Trading Token 2',
                        decimals: 18
                    } */

        // Check if we have known metadata for this token
        const normalizedAddress = tokenAddress.toLowerCase();
        const knownToken = knownTokens[normalizedAddress];
        
        if (knownToken) {
            debug(`Using known metadata for ${knownToken.symbol}`);
            return knownToken;
        }

        const provider = contractService.getProvider();
        const tokenContract = new ethers.Contract(
            tokenAddress,
            [
                'function symbol() view returns (string)',
                'function name() view returns (string)',
                'function decimals() view returns (uint8)'
            ],
            provider
        );

        const [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals()
        ]);

        const metadata = {
            symbol,
            name,
            decimals: parseInt(decimals)
        };

        return metadata;

    } catch (err) {
        // Check if it's a rate limit error
        if (err.code === -32005 || err.message?.includes('rate limit')) {
            warn(`Rate limit hit while getting metadata for token ${tokenAddress}, using fallback`);
            
            // Return fallback metadata for rate-limited requests
            const fallbackMetadata = {
                symbol: 'UNKNOWN',
                name: 'Unknown Token',
                decimals: 18
            };
            
            return fallbackMetadata;
        }
        
        error(`Failed to get metadata for token ${tokenAddress}:`, err);
        
        // Return fallback metadata
        const fallbackMetadata = {
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            decimals: 18
        };
        
        return fallbackMetadata;
    }
}

/**
 * Get user's balance for a specific token
 * @param {string} tokenAddress - The token address
 * @returns {Promise<string>} Formatted balance string
 */
async function getUserTokenBalance(tokenAddress) {
    try {
        // Get user's wallet address using the same method as getAllWalletTokens
        const userAddress = await contractService.getUserAddress();
        if (!userAddress) {
            return '0';
        }
        
        const provider = contractService.getProvider();
        const tokenContract = new ethers.Contract(
            tokenAddress,
            [
                'function balanceOf(address) view returns (uint256)',
                'function decimals() view returns (uint8)'
            ],
            provider
        );

        const [rawBalance, decimals] = await Promise.all([
            tokenContract.balanceOf(userAddress),
            tokenContract.decimals()
        ]);

        const balance = ethers.utils.formatUnits(rawBalance, decimals);

        return balance;

    } catch (err) {
        // Check if it's a rate limit error
        if (err.code === -32005 || err.message?.includes('rate limit')) {
            warn(`Rate limit hit while getting balance for token ${tokenAddress}, returning 0`);
            return '0';
        }
        
        debug(`Failed to get balance for token ${tokenAddress}:`, err);
        return '0';
    }
}

/**
 * Check if a token is allowed by the contract
 * @param {string} tokenAddress - The token address to check
 * @returns {Promise<boolean>} True if token is allowed
 */
export async function isTokenAllowed(tokenAddress) {
    try {
        return await contractService.isTokenAllowed(tokenAddress);
    } catch (err) {
        error(`Failed to check if token ${tokenAddress} is allowed:`, err);
        return false;
    }
}

/**
 * Clear all caches (useful for testing or when switching networks)
 */
export function clearTokenCaches() {
    debug('Caching disabled - no caches to clear');
}

/**
 * Reset rate limiting state (useful when switching networks or after errors)
 */
export function resetRateLimiting() {
    lastRequestTime = 0;
    consecutiveRateLimitErrors = 0;
    requestQueue = [];
    isProcessingQueue = false;
    debug('Rate limiting state reset');
}

/**
 * Get current rate limiting status for debugging
 * @returns {Object} Current rate limiting state
 */
export function getRateLimitingStatus() {
    return {
        lastRequestTime,
        consecutiveRateLimitErrors,
        queueLength: requestQueue.length,
        isProcessingQueue,
        baseDelay: BASE_DELAY,
        maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
        batchSize: BATCH_SIZE
    };
}

/**
 * Get cache statistics (for debugging)
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
    return {
        tokenCacheSize: 0,
        metadataCacheSize: 0,
        balanceCacheSize: 0,
        cachingEnabled: false
    };
}

/**
 * Validate that the contract service is properly initialized
 * @returns {Promise<boolean>} True if contract service is valid
 */
export async function validateContractService() {
    try {
        return await contractService.validateContract();
    } catch (err) {
        error('Contract service validation failed:', err);
        return false;
    }
}

/**
 * Get contract information for debugging
 * @returns {Promise<Object>} Contract information
 */
export async function getContractInfo() {
    try {
        return await contractService.getContractInfo();
    } catch (err) {
        error('Failed to get contract info:', err);
        throw err;
    }
}

/**
 * Get all tokens in user's wallet (both allowed and not allowed)
 * @returns {Promise<Object>} Object with allowed and notAllowed token arrays
 */
export async function getAllWalletTokens() {
    try {
        debug('Getting all wallet tokens...');
        
        // Get allowed tokens first
        const allowedTokens = await getContractAllowedTokens();
        const allowedAddresses = new Set(allowedTokens.map(token => token.address.toLowerCase()));
        
        // Get user's wallet address
        const userAddress = await contractService.getUserAddress();
        if (!userAddress) {
            debug('No user address available');
            return { allowed: allowedTokens, notAllowed: [] };
        }

        // Get all ERC20 tokens from user's wallet
        const walletTokens = await getUserWalletTokens(userAddress);
        debug(`Found ${walletTokens.length} tokens in wallet`);

        // Separate allowed and not allowed tokens
        const notAllowedTokens = [];
        
        for (const token of walletTokens) {
            if (!allowedAddresses.has(token.address.toLowerCase())) {
                notAllowedTokens.push({
                    ...token,
                    isAllowed: false
                });
            }
        }

        // Mark allowed tokens
        const markedAllowedTokens = allowedTokens.map(token => ({
            ...token,
            isAllowed: true
        }));

        const result = {
            allowed: markedAllowedTokens,
            notAllowed: notAllowedTokens
        };

        debug(`Successfully processed ${markedAllowedTokens.length} allowed and ${notAllowedTokens.length} not allowed tokens`);
        return result;

    } catch (err) {
        error('Failed to get all wallet tokens:', err);
        return { allowed: [], notAllowed: [] };
    }
}

/**
 * Get all ERC20 tokens in user's wallet
 * @param {string} userAddress - User's wallet address
 * @returns {Promise<Array>} Array of token objects with metadata and balances
 */
async function getUserWalletTokens(userAddress) {
    try {
        debug(`Getting wallet tokens for ${userAddress}...`);
        
        const provider = contractService.getProvider();
        
        // Get recent Transfer events to find tokens the user has interacted with
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 10000); // Look back 10k blocks
        
        // Get Transfer events where user is recipient
        const filter = {
            fromBlock: fromBlock,
            toBlock: 'latest',
            topics: [
                ethers.utils.id('Transfer(address,address,uint256)'),
                null, // from address (any)
                ethers.utils.hexZeroPad(userAddress, 32) // to address (user)
            ]
        };

        const logs = await provider.getLogs(filter);
        debug(`Found ${logs.length} Transfer events to user`);

        // Extract unique token addresses from Transfer events
        const tokenAddresses = [...new Set(logs.map(log => log.address))];
        debug(`Found ${tokenAddresses.length} unique token addresses`);
        
        // Log the first few addresses for debugging
        if (tokenAddresses.length > 0) {
            debug('Sample token addresses found:', tokenAddresses.slice(0, 5));
        }

        const walletTokens = [];
        
        // Check balance for each token address from Transfer events
        for (const tokenAddress of tokenAddresses) {
            try {
                await enforceRateLimit(100); // Shorter delay for balance checks
                
                const balance = await getUserTokenBalance(tokenAddress);
                if (Number(balance) > 0) {
                    const metadata = await getTokenMetadata(tokenAddress);
                    
                    // Get icon URL for the token
                    let iconUrl = null;
                    try {
                        const chainId = 137; // Polygon - you might want to get this dynamically
                        iconUrl = await tokenIconService.getIconUrl(tokenAddress, chainId);
                    } catch (err) {
                        debug(`Failed to get icon for token ${tokenAddress}:`, err);
                    }
                    
                    walletTokens.push({
                        address: tokenAddress,
                        ...metadata,
                        balance: balance,
                        iconUrl: iconUrl
                    });
                }
            } catch (err) {
                debug(`Error checking token ${tokenAddress}:`, err.message);
                // Continue with next token
            }
        }

        debug(`Found ${walletTokens.length} tokens with balance in wallet`);
        return walletTokens;

    } catch (err) {
        error('Failed to get wallet tokens:', err);
        return [];
    }
}
