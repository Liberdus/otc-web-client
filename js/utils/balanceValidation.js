import { ethers } from 'ethers';
import { contractService } from '../services/ContractService.js';
import { createLogger } from '../services/LogService.js';

// Initialize logger
const logger = createLogger('BALANCE_VALIDATION');
const debug = logger.debug.bind(logger);
const error = logger.error.bind(logger);
const warn = logger.warn.bind(logger);

/**
 * Check if user has sufficient balance for selling a token
 * @param {string} tokenAddress - The token address to check
 * @param {string} sellAmount - The amount to sell (in human readable format)
 * @param {number} decimals - Token decimals
 * @returns {Promise<{hasSufficientBalance: boolean, userBalance: string, requiredAmount: string, formattedBalance: string, formattedRequired: string}>}
 */
export async function validateSellBalance(tokenAddress, sellAmount, decimals = 18) {
    try {
        debug(`Validating sell balance for token ${tokenAddress}, amount: ${sellAmount}`);
        
        // Validate inputs
        if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
            throw new Error('Invalid token address');
        }
        
        if (!sellAmount || isNaN(sellAmount) || parseFloat(sellAmount) <= 0) {
            throw new Error('Invalid sell amount');
        }
        
        // Check if wallet is connected
        if (!window.ethereum || !window.ethereum.selectedAddress) {
            throw new Error('Wallet not connected');
        }

        const userAddress = window.ethereum.selectedAddress;
        const provider = contractService.getProvider();
        
        if (!provider) {
            throw new Error('Provider not available');
        }

        // Create token contract instance
        const tokenContract = new ethers.Contract(
            tokenAddress,
            [
                'function balanceOf(address) view returns (uint256)',
                'function decimals() view returns (uint8)',
                'function symbol() view returns (string)'
            ],
            provider
        );

        // Get token details and user balance
        const [rawBalance, tokenDecimals, symbol] = await Promise.all([
            tokenContract.balanceOf(userAddress),
            tokenContract.decimals(),
            tokenContract.symbol()
        ]);

        // Convert sell amount to wei for comparison
        const sellAmountWei = ethers.utils.parseUnits(sellAmount, tokenDecimals);
        
        // Format values for display
        const formattedBalance = ethers.utils.formatUnits(rawBalance, tokenDecimals);
        const formattedRequired = ethers.utils.formatUnits(sellAmountWei, tokenDecimals);

        const hasSufficientBalance = rawBalance.gte(sellAmountWei);

        debug(`Balance validation result:`, {
            symbol,
            userBalance: formattedBalance,
            requiredAmount: formattedRequired,
            hasSufficientBalance
        });

        return {
            hasSufficientBalance,
            userBalance: rawBalance.toString(),
            requiredAmount: sellAmountWei.toString(),
            formattedBalance,
            formattedRequired,
            symbol
        };

    } catch (err) {
        // Check if it's a rate limit error
        if (err.code === -32005 || err.message?.includes('rate limit')) {
            warn(`Rate limit hit while validating balance for token ${tokenAddress}`);
            throw new Error('Network rate limit reached. Please try again.');
        }
        
        error(`Error validating sell balance for token ${tokenAddress}:`, err);
        throw new Error(`Failed to validate balance: ${err.message}`);
    }
}

/**
 * Get formatted balance information for display
 * @param {string} tokenAddress - The token address
 * @returns {Promise<{balance: string, symbol: string, decimals: number}>}
 */
export async function getTokenBalanceInfo(tokenAddress) {
    try {
        // Validate input
        if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
            debug(`Invalid token address provided: ${tokenAddress}`);
            return { balance: '0', symbol: 'N/A', decimals: 18 };
        }
        
        if (!window.ethereum || !window.ethereum.selectedAddress) {
            debug('Wallet not connected');
            return { balance: '0', symbol: 'N/A', decimals: 18 };
        }

        const userAddress = window.ethereum.selectedAddress;
        const provider = contractService.getProvider();
        
        if (!provider) {
            debug('Provider not available');
            return { balance: '0', symbol: 'N/A', decimals: 18 };
        }

        const tokenContract = new ethers.Contract(
            tokenAddress,
            [
                'function balanceOf(address) view returns (uint256)',
                'function decimals() view returns (uint8)',
                'function symbol() view returns (string)'
            ],
            provider
        );

        const [rawBalance, decimals, symbol] = await Promise.all([
            tokenContract.balanceOf(userAddress),
            tokenContract.decimals(),
            tokenContract.symbol()
        ]);

        const balance = ethers.utils.formatUnits(rawBalance, decimals);

        return {
            balance,
            symbol,
            decimals
        };

    } catch (err) {
        // Check if it's a rate limit error
        if (err.code === -32005 || err.message?.includes('rate limit')) {
            warn(`Rate limit hit while getting balance info for token ${tokenAddress}`);
            return { balance: '0', symbol: 'N/A', decimals: 18 };
        }
        
        debug(`Failed to get balance info for token ${tokenAddress}:`, err);
        return { balance: '0', symbol: 'N/A', decimals: 18 };
    }
}

/**
 * Validate that the balance validation service is properly initialized
 * @returns {Promise<boolean>} True if service is valid
 */
export async function validateBalanceService() {
    try {
        // Check if wallet is connected
        if (!window.ethereum || !window.ethereum.selectedAddress) {
            debug('Balance service validation failed: Wallet not connected');
            return false;
        }
        
        // Check if provider is available
        const provider = contractService.getProvider();
        if (!provider) {
            debug('Balance service validation failed: Provider not available');
            return false;
        }
        
        debug('Balance service validation passed');
        return true;
    } catch (err) {
        error('Balance service validation failed:', err);
        return false;
    }
}

/**
 * Get validation statistics (for debugging)
 * @returns {Object} Validation statistics
 */
export function getValidationStats() {
    return {
        serviceValid: validateBalanceService(),
        walletConnected: !!(window.ethereum && window.ethereum.selectedAddress),
        providerAvailable: !!contractService.getProvider()
    };
}
