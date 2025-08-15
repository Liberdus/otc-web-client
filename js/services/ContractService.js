import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';
import { createLogger } from './LogService.js';

// Initialize logger
const logger = createLogger('CONTRACT_SERVICE');
const debug = logger.debug.bind(logger);
const error = logger.error.bind(logger);
const warn = logger.warn.bind(logger);

class ContractService {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the contract service (uses existing WebSocket instances)
     */
    initialize() {
        this.initialized = true;
        debug('Contract service initialized');
    }

    /**
     * Get the contract instance from WebSocket service
     * @returns {ethers.Contract|null} The contract instance
     */
    getContract() {
        if (!this.initialized) {
            throw new Error('Contract service not initialized');
        }
        if (!window.webSocket?.contract) {
            throw new Error('WebSocket contract not available');
        }
        return window.webSocket.contract;
    }

    /**
     * Get the provider instance from WebSocket service
     * @returns {ethers.providers.Provider|null} The provider instance
     */
    getProvider() {
        if (!this.initialized) {
            throw new Error('Contract service not initialized');
        }
        if (!window.webSocket?.provider) {
            throw new Error('WebSocket provider not available');
        }
        return window.webSocket.provider;
    }

    /**
     * Get all allowed tokens from the contract
     * @returns {Promise<string[]>} Array of allowed token addresses
     */
    async getAllowedTokens() {
        try {
            const contract = this.getContract();
            debug('Fetching allowed tokens from contract...');
            const allowedTokens = await contract.getAllowedTokens();
            debug(`Found ${allowedTokens.length} allowed tokens`);
            
            return allowedTokens;
        } catch (error) {
            error('Failed to get allowed tokens:', error);
            throw new Error(`Failed to get allowed tokens: ${error.message}`);
        }
    }

    /**
     * Get the count of allowed tokens
     * @returns {Promise<number>} Number of allowed tokens
     */
    async getAllowedTokensCount() {
        try {
            const contract = this.getContract();
            debug('Fetching allowed tokens count...');
            const count = await contract.getAllowedTokensCount();
            debug(`Allowed tokens count: ${count}`);
            
            return count.toNumber();
        } catch (error) {
            error('Failed to get allowed tokens count:', error);
            throw new Error(`Failed to get allowed tokens count: ${error.message}`);
        }
    }

    /**
     * Check if a specific token is allowed
     * @param {string} tokenAddress - The token address to check
     * @returns {Promise<boolean>} True if token is allowed
     */
    async isTokenAllowed(tokenAddress) {
        try {
            const contract = this.getContract();
            
            if (!ethers.utils.isAddress(tokenAddress)) {
                return false;
            }

            debug(`Checking if token ${tokenAddress} is allowed...`);
            const isAllowed = await contract.allowedTokens(tokenAddress);
            debug(`Token ${tokenAddress} allowed: ${isAllowed}`);
            
            return isAllowed;
        } catch (error) {
            error(`Failed to check if token ${tokenAddress} is allowed:`, error);
            return false;
        }
    }

    /**
     * Validate that the contract has the required functions
     * @returns {Promise<boolean>} True if contract has required functions
     */
    async validateContract() {
        try {
            const contract = this.getContract();
            debug('Validating contract functions...');
            
            // Check if required functions exist
            const hasGetAllowedTokens = typeof contract.getAllowedTokens === 'function';
            const hasGetAllowedTokensCount = typeof contract.getAllowedTokensCount === 'function';
            const hasAllowedTokens = typeof contract.allowedTokens === 'function';

            if (!hasGetAllowedTokens || !hasGetAllowedTokensCount || !hasAllowedTokens) {
                error('Contract missing required functions');
                return false;
            }

            // Test the functions
            await this.getAllowedTokensCount();
            debug('Contract validation successful');
            
            return true;
        } catch (error) {
            error('Contract validation failed:', error);
            return false;
        }
    }

    /**
     * Get contract information for debugging
     * @returns {Promise<Object>} Contract information
     */
    async getContractInfo() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            const networkConfig = getNetworkConfig();
            const allowedTokensCount = await this.getAllowedTokensCount();
            const allowedTokens = await this.getAllowedTokens();

            return {
                address: networkConfig.contractAddress,
                network: networkConfig.name,
                allowedTokensCount,
                allowedTokens: allowedTokens.slice(0, 5), // First 5 for display
                hasMoreTokens: allowedTokens.length > 5
            };
        } catch (error) {
            error('Failed to get contract info:', error);
            throw error;
        }
    }
}

// Create singleton instance
const contractService = new ContractService();

export { ContractService, contractService };
