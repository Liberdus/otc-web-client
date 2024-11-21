import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';

export class CreateOrder extends BaseComponent {
    constructor() {
        console.log('[CreateOrder] Constructor starting...');
        super('create-order');
        this.contract = null;
        
        // Verify elements exist
        const elements = {
            sellToken: document.getElementById('sellToken'),
            buyToken: document.getElementById('buyToken'),
            orderCreationFee: document.getElementById('orderCreationFee')
        };
        
        console.log('[CreateOrder] Required elements:', {
            sellToken: !!elements.sellToken,
            buyToken: !!elements.buyToken,
            orderCreationFee: !!elements.orderCreationFee
        });

        if (!elements.sellToken || !elements.buyToken || !elements.orderCreationFee) {
            console.error('[CreateOrder] Missing required elements');
            return;
        }
        
        // Initialize component
        this.initializeComponent();
    }

    async initializeComponent() {
        try {
            console.log('[CreateOrder] Waiting for wallet initialization...');
            
            // Make sure wallet is initialized before proceeding
            if (!window.walletManager?.isInitialized) {
                console.log('[CreateOrder] Waiting for wallet manager...');
                await window.walletInitialized;
            }
            
            console.log('[CreateOrder] Wallet initialized, starting initialization...');
            await this.initialize();
            
            // Set up event listeners after initialization
            this.setupEventListeners();
        } catch (error) {
            console.error('[CreateOrder] Initialization error:', error);
            document.getElementById('orderCreationFee').textContent = 'Initialization failed';
        }
    }

    async initialize() {
        try {
            console.log('[CreateOrder] Starting initialization...');
            
            console.log('[CreateOrder] Contract config:', {
                address: window.walletManager?.contractAddress,
                hasABI: !!window.walletManager?.contractABI
            });
            
            const signer = await this.getSigner();
            if (!window.walletManager?.contractAddress || !window.walletManager?.contractABI) {
                throw new Error('Contract configuration not found');
            }
            
            this.contract = new ethers.Contract(
                window.walletManager.contractAddress,
                window.walletManager.contractABI,
                signer
            );
            
            console.log('[CreateOrder] Contract initialized:', this.contract.address);
            
            await this.loadOrderCreationFee();
            console.log('[CreateOrder] Fee loaded, setting up event listeners...');
            this.setupEventListeners();
            console.log('[CreateOrder] Initialization complete');
        } catch (error) {
            console.error('[CreateOrder] Error in initialization:', error);
            throw error;
        }
    }

    async getContract() {
        if (!this.contract) {
            const signer = await this.getSigner();
            this.contract = new ethers.Contract(
                window.walletManager.contractAddress,
                window.walletManager.contractABI,
                signer
            );
        }
        return this.contract;
    }

    async loadOrderCreationFee() {
        try {
            console.log('[CreateOrder] Starting loadOrderCreationFee...');
            const contract = await this.getContract();
            if (!contract) {
                console.warn('[CreateOrder] Contract not available for fee loading');
                document.getElementById('orderCreationFee').textContent = 'Waiting for contract...';
                setTimeout(() => this.loadOrderCreationFee(), 2000);
                return;
            }

            console.log('[CreateOrder] Contract available, calling orderCreationFee...');
            const fee = await this.retryContractCall(() => contract.orderCreationFee());
            
            console.log('[CreateOrder] Fee loaded:', fee.toString());
            document.getElementById('orderCreationFee').textContent = 
                `${ethers.utils.formatEther(fee)} POL`;
            return fee;
        } catch (error) {
            console.error('[CreateOrder] Error in loadOrderCreationFee:', error);
            document.getElementById('orderCreationFee').textContent = 'Error loading fee';
            throw error;
        }
    }

    setupEventListeners() {
        const createOrderBtn = document.getElementById('createOrderBtn');
        // Remove existing listeners
        createOrderBtn.replaceWith(createOrderBtn.cloneNode(true));
        // Add new listener
        document.getElementById('createOrderBtn').addEventListener('click', 
            () => this.createOrder());
        
        // Add token input listeners
        document.getElementById('sellToken').addEventListener('input', 
            () => this.updateTokenBalance('sell'));
        document.getElementById('buyToken').addEventListener('input', 
            () => this.updateTokenBalance('buy'));
    }

    async updateTokenBalance(type) {
        console.log(`[CreateOrder] Starting updateTokenBalance for ${type}...`);
        const tokenAddress = document.getElementById(`${type}Token`).value;
        const balanceSpan = document.getElementById(`${type}TokenBalance`);
        
        try {
            if (!tokenAddress) {
                console.log(`[CreateOrder] No ${type} token address provided`);
                balanceSpan.textContent = '';
                return;
            }

            console.log(`[CreateOrder] Fetching details for ${type} token:`, tokenAddress);
            balanceSpan.textContent = 'Loading...';
            
            const tokenDetails = await this.getTokenDetails(tokenAddress);
            console.log(`[CreateOrder] Token details received for ${type}:`, tokenDetails);
            
            if (!tokenDetails) {
                console.warn(`[CreateOrder] Invalid ${type} token details`);
                balanceSpan.textContent = 'Invalid token';
                return;
            }

            const displayBalance = `Balance: ${parseFloat(tokenDetails.formattedBalance).toFixed(4)} ${tokenDetails.symbol}`;
            console.log(`[CreateOrder] Setting ${type} balance display:`, displayBalance);
            balanceSpan.textContent = displayBalance;
        } catch (error) {
            console.error(`[CreateOrder] Error updating ${type} token balance:`, error);
            balanceSpan.textContent = 'Error loading balance';
        }
    }

    async retryContractCall(callFn, maxRetries = 5) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const result = await callFn();
                console.log(`[CreateOrder] Attempt ${i + 1} succeeded`);
                return result;
            } catch (error) {
                lastError = error;
                console.log(`[CreateOrder] Attempt ${i + 1} failed:`, error.message);
                
                // Check for common RPC errors
                if (
                    error.message.includes('header not found') || 
                    error.message.includes('missing trie node') ||
                    error.message.includes('Internal JSON-RPC error') ||
                    error.code === -32603
                ) {
                    const delay = Math.min(1000 * Math.pow(2, i), 10000); // Exponential backoff
                    console.log(`[CreateOrder] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    async getValidatedInputs() {
        // Get values from input fields
        const sellToken = document.getElementById('sellToken').value;
        const buyToken = document.getElementById('buyToken').value;
        const sellAmount = document.getElementById('sellAmount').value;
        const buyAmount = document.getElementById('buyAmount').value;

        console.log('Input values:', {
            sellToken,
            buyToken,
            sellAmount,
            buyAmount
        });

        // Validation checks
        if (!sellToken || sellToken.trim() === '') {
            throw new Error('Sell token address is required');
        }
        if (!buyToken || buyToken.trim() === '') {
            throw new Error('Buy token address is required');
        }
        if (!sellAmount || parseFloat(sellAmount) <= 0) {
            throw new Error('Valid sell amount is required');
        }
        if (!buyAmount || parseFloat(buyAmount) <= 0) {
            throw new Error('Valid buy amount is required');
        }

        // Convert amounts to Wei using cached token details
        const sellAmountWei = ethers.utils.parseUnits(
            sellAmount.toString(),
            this.sellTokenDetails?.decimals || 18
        );
        const buyAmountWei = ethers.utils.parseUnits(
            buyAmount.toString(),
            this.buyTokenDetails?.decimals || 18
        );

        return {
            sellToken,
            buyToken,
            sellAmountWei,
            buyAmountWei
        };
    }

    async createOrder() {
        try {
            const { sellToken, buyToken, sellAmountWei, buyAmountWei } = 
                await this.getValidatedInputs();

            const contract = await this.getContract();
            
            // Validate and get current fee
            const orderCreationFee = await this.validateOrderCreationFee();

            // Rest of your createOrder implementation...
            const tx = await contract.createOrder(
                ethers.constants.AddressZero,
                sellToken,
                sellAmountWei,
                buyToken,
                buyAmountWei,
                {
                    value: orderCreationFee,
                    gasLimit: 300000
                }
            );

            console.log('[CreateOrder] Transaction sent:', tx.hash);
            return await tx.wait(1);
        } catch (error) {
            console.error('[CreateOrder] Transaction failed:', error);
            throw error;
        }
    }

    // Add this helper method to handle retries
    async retryOperation(operation, operationName, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[CreateOrder] Attempting ${operationName} (attempt ${i + 1}/${maxRetries})`);
                return await operation();
            } catch (error) {
                console.error(`[CreateOrder] ${operationName} failed:`, error);
                
                const isRetryable = 
                    error.code === 'CALL_EXCEPTION' ||
                    error.message?.includes('header not found') ||
                    error.message?.includes('Internal JSON-RPC error') ||
                    error.data?.message?.includes('header not found');

                if (i === maxRetries - 1 || !isRetryable) throw error;
                
                console.log(`[CreateOrder] Retrying ${operationName} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async approveToken(tokenContract, spender, amount) {
        try {
            const address = await this.signer.getAddress();
            const currentAllowance = await tokenContract.allowance(address, spender);
            
            if (currentAllowance.gte(amount)) {
                console.log('[CreateOrder] Sufficient allowance already exists');
                return true;
            }

            // Get current gas price with a small buffer
            const provider = tokenContract.provider;
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice.mul(120).div(100); // 20% buffer
            
            console.log('[CreateOrder] Current gas price:', gasPrice.toString());

            // First try to estimate gas
            const gasEstimate = await tokenContract.estimateGas.approve(spender, amount);
            const gasLimit = gasEstimate.mul(130).div(100); // 30% buffer

            console.log('[CreateOrder] Approval parameters:', {
                from: address,
                spender,
                amount: amount.toString(),
                gasLimit: gasLimit.toString(),
                gasPrice: gasPrice.toString()
            });

            // Send the transaction with explicit parameters
            const tx = await tokenContract.approve(spender, amount, {
                from: address,
                gasLimit,
                gasPrice,
                nonce: await provider.getTransactionCount(address)
            });
            
            console.log('[CreateOrder] Approval transaction sent:', tx.hash);
            const receipt = await tx.wait(1); // Wait for 1 confirmation
            
            if (receipt.status === 0) {
                throw new Error('Approval transaction failed');
            }
            
            return true;
        } catch (error) {
            console.error('[CreateOrder] Detailed approval error:', {
                error,
                code: error.code,
                message: error.message,
                data: error.data,
                reason: error.reason
            });
            throw error;
        }
    }

    async validateTokenAndBalance(tokenContract, amount) {
        try {
            const address = await this.signer.getAddress();
            const [balance, decimals] = await Promise.all([
                tokenContract.balanceOf(address),
                tokenContract.decimals()
            ]);
            
            if (balance.lt(amount)) {
                const formattedAmount = ethers.utils.formatUnits(amount, decimals);
                const formattedBalance = ethers.utils.formatUnits(balance, decimals);
                throw new Error(
                    `Insufficient balance. Required: ${formattedAmount}, Available: ${formattedBalance}`
                );
            }
            return true;
        } catch (error) {
            throw new Error(`Token validation failed: ${error.message}`);
        }
    }

    async validateOrderCreationFee() {
        try {
            const contract = await this.getContract();
            const currentFee = await contract.orderCreationFee();
            
            // If this is our first fee check, store it and proceed
            if (!this._currentFee) {
                this._currentFee = currentFee;
                return currentFee;
            }

            // Get contract's fee boundaries
            const [minPercent, maxPercent] = await Promise.all([
                contract.MIN_FEE_PERCENTAGE(),
                contract.MAX_FEE_PERCENTAGE()
            ]);

            // Calculate acceptable range based on contract's parameters
            const minFee = this._currentFee.mul(minPercent).div(100);
            const maxFee = this._currentFee.mul(maxPercent).div(100);

            // Check if new fee is within acceptable range
            if (currentFee.lt(minFee) || currentFee.gt(maxFee)) {
                await this.loadOrderCreationFee(); // Update stored fee
                throw new Error('Order creation fee has changed outside acceptable range. Please try again.');
            }

            return currentFee;
        } catch (error) {
            console.error('[CreateOrder] Fee validation error:', error);
            throw error;
        }
    }
}

