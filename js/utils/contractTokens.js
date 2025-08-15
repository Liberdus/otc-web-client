import { ethers } from 'ethers';
import { contractService } from '../services/ContractService.js';
import { createLogger } from '../services/LogService.js';

// Initialize logger
const logger = createLogger('CONTRACT_TOKENS');
const debug = logger.debug.bind(logger);
const error = logger.error.bind(logger);
const warn = logger.warn.bind(logger);

// Create an in-memory cache for token data
const tokenCache = new Map();
const metadataCache = new Map();
const balanceCache = new Map();

// Cache TTL constants
const TOKEN_LIST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const METADATA_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const BALANCE_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Get allowed tokens from contract with metadata and balances
 * @returns {Promise<Array>} Array of token objects with metadata and balances
 */
export async function getContractAllowedTokens() {
    try {
        debug('Getting contract allowed tokens...');
        
        // Check cache first
        const cacheKey = 'allowedTokens';
        const cachedData = tokenCache.get(cacheKey);
        if (cachedData && Date.now() - cachedData.timestamp < TOKEN_LIST_CACHE_TTL) {
            debug('Using cached allowed tokens');
            return cachedData.data;
        }

        // Get allowed tokens from contract
        const allowedTokenAddresses = await contractService.getAllowedTokens();
        debug(`Found ${allowedTokenAddresses.length} allowed tokens`);

        if (allowedTokenAddresses.length === 0) {
            debug('No allowed tokens found');
            return [];
        }

        // Get metadata and balances for each token
        const tokensWithData = await Promise.all(
            allowedTokenAddresses.map(async (address) => {
                try {
                    const [metadata, balance] = await Promise.all([
                        getTokenMetadata(address),
                        getUserTokenBalance(address)
                    ]);

                    return {
                        address,
                        ...metadata,
                        balance: balance || '0'
                    };
                } catch (error) {
                    error(`Error processing token ${address}:`, error);
                    // Return basic token info even if metadata/balance fails
                    return {
                        address,
                        symbol: 'UNKNOWN',
                        name: 'Unknown Token',
                        decimals: 18,
                        balance: '0'
                    };
                }
            })
        );

        // Cache the result
        tokenCache.set(cacheKey, {
            timestamp: Date.now(),
            data: tokensWithData
        });

        debug(`Successfully processed ${tokensWithData.length} tokens`);
        return tokensWithData;

    } catch (error) {
        error('Failed to get contract allowed tokens:', error);
        
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
        // Check cache first
        const cachedMetadata = metadataCache.get(tokenAddress);
        if (cachedMetadata && Date.now() - cachedMetadata.timestamp < METADATA_CACHE_TTL) {
            return cachedMetadata.data;
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

        // Cache the metadata
        metadataCache.set(tokenAddress, {
            timestamp: Date.now(),
            data: metadata
        });

        return metadata;

    } catch (error) {
        error(`Failed to get metadata for token ${tokenAddress}:`, error);
        throw error;
    }
}

/**
 * Get user's balance for a specific token
 * @param {string} tokenAddress - The token address
 * @returns {Promise<string>} Formatted balance string
 */
async function getUserTokenBalance(tokenAddress) {
    try {
        // Check if wallet is connected
        if (!window.ethereum || !window.ethereum.selectedAddress) {
            return '0';
        }

        const userAddress = window.ethereum.selectedAddress;
        const cacheKey = `${tokenAddress}-${userAddress}`;
        
        // Check cache first
        const cachedBalance = balanceCache.get(cacheKey);
        if (cachedBalance && Date.now() - cachedBalance.timestamp < BALANCE_CACHE_TTL) {
            return cachedBalance.data;
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

        // Cache the balance
        balanceCache.set(cacheKey, {
            timestamp: Date.now(),
            data: balance
        });

        return balance;

    } catch (error) {
        debug(`Failed to get balance for token ${tokenAddress}:`, error);
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
    } catch (error) {
        error(`Failed to check if token ${tokenAddress} is allowed:`, error);
        return false;
    }
}

/**
 * Clear all caches (useful for testing or when switching networks)
 */
export function clearTokenCaches() {
    tokenCache.clear();
    metadataCache.clear();
    balanceCache.clear();
    debug('All token caches cleared');
}

/**
 * Get cache statistics for debugging
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
    return {
        tokenCacheSize: tokenCache.size,
        metadataCacheSize: metadataCache.size,
        balanceCacheSize: balanceCache.size
    };
}

/**
 * Validate that the contract service is properly initialized
 * @returns {Promise<boolean>} True if contract service is valid
 */
export async function validateContractService() {
    try {
        return await contractService.validateContract();
    } catch (error) {
        error('Contract service validation failed:', error);
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
    } catch (error) {
        error('Failed to get contract info:', error);
        throw error;
    }
}
