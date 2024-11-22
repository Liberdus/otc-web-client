import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { erc20Abi } from '../abi/erc20.js';

export class CreateOrder extends BaseComponent {
    constructor() {
        console.log('[CreateOrder] Constructor starting...');
        super('create-order');
        this.contract = null;
        this.cachedFee = null;
        this.lastFeeUpdate = null;
        this.FEE_CACHE_DURATION = 30000; // 30 seconds in milliseconds
        
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
        // Add partner to the inputs
        const partner = document.getElementById('partner').value;
        const sellToken = document.getElementById('sellToken').value;
        const buyToken = document.getElementById('buyToken').value;
        const sellAmount = document.getElementById('sellAmount').value;
        const buyAmount = document.getElementById('buyAmount').value;

        console.log('Input values:', {
            partner,
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
            partner: partner || ethers.constants.AddressZero, // Use zero address if no partner specified
            sellToken,
            buyToken,
            sellAmountWei,
            buyAmountWei
        };
    }

    async createOrder() {
        try {
            // Get signer first
            this.signer = await this.getSigner();
            if (!this.signer) {
                throw new Error('Please connect your wallet first');
            }

            const { partner, sellToken, buyToken, sellAmountWei, buyAmountWei } = 
                await this.getValidatedInputs();

            const contract = await this.getContract();
            
            // Check and handle token approval first
            const sellTokenContract = new ethers.Contract(
                sellToken,
                erc20Abi,
                this.signer
            );

            console.log('[CreateOrder] Checking token approval...');
            
            // Check allowance
            const address = await this.signer.getAddress();
            console.log('[CreateOrder] User address:', address);

            const allowance = await sellTokenContract.allowance(
                address,
                contract.address
            );

            console.log('[CreateOrder] Current allowance:', allowance.toString());

            if (allowance.lt(sellAmountWei)) {
                console.log('[CreateOrder] Insufficient allowance, requesting approval...');
                const approveTx = await sellTokenContract.approve(
                    contract.address,
                    sellAmountWei
                );
                console.log('[CreateOrder] Waiting for approval transaction...');
                await approveTx.wait(1);
            }

            // Get current fee
            const orderCreationFee = await this.validateOrderCreationFee();

            // Add error handling for low balance
            const balance = await this.signer.getBalance();
            if (balance.lt(orderCreationFee)) {
                throw new Error(`Insufficient POL balance for fee. Required: ${ethers.utils.formatEther(orderCreationFee)} POL`);
            }

            console.log('[CreateOrder] Sending create order transaction with params:', {
                partner,
                sellToken,
                sellAmount: sellAmountWei.toString(),
                buyToken,
                buyAmount: buyAmountWei.toString(),
                fee: orderCreationFee.toString()
            });

            // Create order with higher gas limit and explicit parameters
            const tx = await contract.createOrder(
                partner,
                sellToken,
                sellAmountWei,
                buyToken,
                buyAmountWei,
                {
                    value: orderCreationFee,
                    gasLimit: 500000,
                    gasPrice: await this.signer.getGasPrice()
                }
            );

            console.log('[CreateOrder] Transaction sent:', tx.hash);
            
            const receipt = await tx.wait(1);
            if (receipt.status === 0) {
                throw new Error('Transaction failed. Please check your token approvals and balances.');
            }
            
            return receipt;
        } catch (error) {
            console.error('[CreateOrder] Transaction failed:', error);
            if (error.message.includes('insufficient funds')) {
                throw new Error('Insufficient POL for gas fees');
            } else if (error.message.includes('user rejected')) {
                throw new Error('Transaction was rejected');
            } else if (error.message.includes('connect your wallet')) {
                throw new Error('Please connect your wallet first');
            } else {
                throw error;
            }
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

    formatFee(fee) {
        if (!fee) return '0 POL';
        return `${ethers.utils.formatEther(fee)} POL`;
    }

    async getOrderCreationFee() {
        const now = Date.now();
        if (!this.cachedFee || !this.lastFeeUpdate || (now - this.lastFeeUpdate) > this.FEE_CACHE_DURATION) {
            this.cachedFee = await this.loadOrderCreationFee();
            this.lastFeeUpdate = now;
            
            // Update UI with raw value, since loadOrderCreationFee already formats it
            const feeElement = document.getElementById('orderCreationFee');
            if (feeElement) {
                feeElement.textContent = await this.loadOrderCreationFee();
            }
        }
        return this.cachedFee;
    }

    async validateOrderCreationFee() {
        try {
            // Get current fee
            const currentFee = await this.getOrderCreationFee();
            
            // Add 20% tolerance 
            const tolerance = 0.2;
            const lowerBound = currentFee.mul(90).div(100); // 90% of current fee
            const upperBound = currentFee.mul(110).div(100); // 110% of current fee
            
            console.log('[CreateOrder] Fee validation:', {
                currentFee: currentFee.toString(),
                lowerBound: lowerBound.toString(),
                upperBound: upperBound.toString()
            });

            return currentFee; // Return the current fee for use in transaction
        } catch (error) {
            console.error('[CreateOrder] Fee validation error:', error);
            throw error;
        }
    }

    // Add auto-refresh
    startFeeAutoRefresh() {
        setInterval(async () => {
            await this.getOrderCreationFee();
        }, this.FEE_CACHE_DURATION);
    }

    // Add helper function to check token balances
    async checkTokenBalance(tokenAddress, amount) {
        const tokenContract = new ethers.Contract(
            tokenAddress,
            erc20Abi,
            this.signer
        );
        
        const address = await this.signer.getAddress();
        const balance = await tokenContract.balanceOf(address);
        
        if (balance.lt(amount)) {
            const symbol = await tokenContract.symbol();
            const decimals = await tokenContract.decimals();
            throw new Error(
                `Insufficient ${symbol} balance. Required: ${ethers.utils.formatUnits(amount, decimals)}`
            );
        }
        
        return true;
    }

    // Add or update getSigner method if you haven't already
    async getSigner() {
        try {
            if (!window.walletManager?.provider) {
                throw new Error('Please connect your wallet first');
            }
            return window.walletManager.provider.getSigner();
        } catch (error) {
            console.error('[CreateOrder] Error getting signer:', error);
            throw error;
        }
    }
}

