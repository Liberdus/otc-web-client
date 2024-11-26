import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { getNetworkConfig, isDebugEnabled } from '../config.js';

export class CreateOrder extends BaseComponent {
    constructor() {
        super('create-order');
        this.contract = null;
        this.provider = null;
        this.initialized = false;
        this.tokenCache = new Map();
        this.boundCreateOrderHandler = this.handleCreateOrder.bind(this);
        this.isSubmitting = false;
        
        // Initialize debug logger
        this.debug = (message, ...args) => {
            if (isDebugEnabled('CREATE_ORDER')) {
                console.log('[CreateOrder]', message, ...args);
            }
        };
    }

    async initializeContract() {
        try {
            this.debug('Initializing contract...');
            const networkConfig = getNetworkConfig();
            
            this.debug('Network config:', {
                address: networkConfig.contractAddress,
                abiLength: networkConfig.contractABI?.length
            });

            if (!networkConfig.contractABI) {
                throw new Error('Contract ABI is undefined');
            }
            
            // Get provider and signer
            this.provider = new ethers.providers.Web3Provider(window.ethereum);
            const signer = this.provider.getSigner();
            
            // Initialize contract with explicit ABI check
            this.contract = new ethers.Contract(
                networkConfig.contractAddress,
                networkConfig.contractABI,
                signer
            );
            
            this.debug('Contract initialized successfully');
            return this.contract;
        } catch (error) {
            console.error('[CreateOrder] Contract initialization error:', error);
            throw error;
        }
    }

    async initialize(readOnlyMode = true) {
        if (this.initialized) return;
        try {
            this.debug('Starting initialization...');
            
            if (readOnlyMode) {
                this.setReadOnlyMode();
                return;
            }

            // Enable form when wallet is connected
            this.setConnectedMode();
            
            // Initialize contract and load fee
            await this.initializeContract();
            await this.loadOrderCreationFee();
            
            // Setup all event listeners
            this.setupTokenInputListeners();
            this.setupCreateOrderListener();
            
            this.debug('Initialization complete');
            this.initialized = true;
        } catch (error) {
            console.error('[CreateOrder] Error in initialization:', error);
            this.showError('Failed to initialize. Please refresh the page.');
        }
    }

    async loadOrderCreationFee() {
        try {
            this.debug('Loading order creation fee...');
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const fee = await this.contract.orderCreationFee();
            const averageGas = await this.contract.averageGasUsed();
            const feeInEth = ethers.utils.formatEther(fee);
            
            // Format the fee to be more readable
            const formattedFee = parseFloat(feeInEth).toFixed(6); // Show 6 decimal places
            const formattedGas = averageGas.toNumber().toLocaleString(); // Add thousands separator
            
            const orderCreationFee = document.getElementById('orderCreationFee');
            if (orderCreationFee) {
                orderCreationFee.innerHTML = `
                    <div class="fee-details">
                        <div class="fee-amount">${formattedFee} POL</div>
                        <div class="fee-gas">Average Gas: ${formattedGas}</div>
                    </div>`;
                orderCreationFee.classList.remove('placeholder-text');
            }
            this.debug('Fee loaded:', feeInEth, 'Average Gas:', averageGas);
        } catch (error) {
            console.error('[CreateOrder] Error loading fee:', error);
            const orderCreationFee = document.getElementById('orderCreationFee');
            if (orderCreationFee) {
                orderCreationFee.textContent = 'Error loading fee';
            }
        }
    }

    setReadOnlyMode() {
        const createOrderBtn = document.getElementById('createOrderBtn');
        const orderCreationFee = document.getElementById('orderCreationFee');
        
        createOrderBtn.disabled = true;
        createOrderBtn.textContent = 'Connect Wallet to Create Order';
        orderCreationFee.textContent = 'Connect wallet to view fee';
        orderCreationFee.classList.add('placeholder-text');
        
        // Disable input fields
        ['partner', 'sellToken', 'sellAmount', 'buyToken', 'buyAmount'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.disabled = true;
        });
    }

    setConnectedMode() {
        const createOrderBtn = document.getElementById('createOrderBtn');
        const orderCreationFee = document.getElementById('orderCreationFee');
        
        createOrderBtn.disabled = false;
        createOrderBtn.textContent = 'Create Order';
        orderCreationFee.classList.remove('placeholder-text');
        
        // Enable input fields
        ['partner', 'sellToken', 'sellAmount', 'buyToken', 'buyAmount'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.disabled = false;
        });
    }

    async updateTokenBalance(tokenAddress, elementId) {
        try {
            if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
                document.getElementById(elementId).textContent = '';
                return;
            }

            const tokenDetails = await this.getTokenDetails(tokenAddress);
            if (tokenDetails && tokenDetails.symbol) {
                const balanceElement = document.getElementById(elementId);
                const formattedBalance = parseFloat(tokenDetails.formattedBalance).toFixed(4);
                balanceElement.textContent = `Balance: ${formattedBalance} ${tokenDetails.symbol}`;
            }
        } catch (error) {
            console.error(`Error updating token balance:`, error);
            document.getElementById(elementId).textContent = 'Error loading balance';
        }
    }

    setupTokenInputListeners() {
        const sellTokenInput = document.getElementById('sellToken');
        const buyTokenInput = document.getElementById('buyToken');

        const updateBalance = async (input, balanceId) => {
            const tokenAddress = input.value.trim();
            await this.updateTokenBalance(tokenAddress, balanceId);
        };

        sellTokenInput.addEventListener('change', () => updateBalance(sellTokenInput, 'sellTokenBalance'));
        buyTokenInput.addEventListener('change', () => updateBalance(buyTokenInput, 'buyTokenBalance'));
    }

    setupCreateOrderListener() {
        const createOrderBtn = document.getElementById('createOrderBtn');
        // Remove ALL existing listeners using clone technique
        const newButton = createOrderBtn.cloneNode(true);
        createOrderBtn.parentNode.replaceChild(newButton, createOrderBtn);
        // Add single new listener
        newButton.addEventListener('click', this.boundCreateOrderHandler);
    }

    async handleCreateOrder(event) {
        event.preventDefault();
        
        // Prevent double submission
        if (this.isSubmitting) {
            this.debug('Order submission already in progress');
            return;
        }

        const createOrderBtn = document.getElementById('createOrderBtn');
        try {
            this.isSubmitting = true;
            createOrderBtn.disabled = true;
            createOrderBtn.textContent = 'Processing...';
            
            if (!this.provider || !this.contract) {
                throw new Error('Contract or provider not initialized');
            }

            // Get form values
            const partner = document.getElementById('partner').value.trim();
            const sellToken = document.getElementById('sellToken').value.trim();
            const sellAmount = document.getElementById('sellAmount').value.trim();
            const buyToken = document.getElementById('buyToken').value.trim();
            const buyAmount = document.getElementById('buyAmount').value.trim();

            // Validation
            if (!ethers.utils.isAddress(sellToken)) {
                throw new Error('Invalid sell token address');
            }
            if (!ethers.utils.isAddress(buyToken)) {
                throw new Error('Invalid buy token address');
            }
            if (!sellAmount || isNaN(sellAmount)) {
                throw new Error('Invalid sell amount');
            }
            if (!buyAmount || isNaN(buyAmount)) {
                throw new Error('Invalid buy amount');
            }
            if (partner && !ethers.utils.isAddress(partner)) {
                throw new Error('Invalid partner address');
            }

            // Get token contracts and decimals
            const sellTokenContract = new ethers.Contract(
                sellToken,
                ['function decimals() view returns (uint8)', 'function approve(address spender, uint256 amount) returns (bool)'],
                this.provider
            );
            const buyTokenContract = new ethers.Contract(
                buyToken,
                ['function decimals() view returns (uint8)'],
                this.provider
            );
            
            // Get decimals in parallel
            const [sellDecimals, buyDecimals] = await Promise.all([
                sellTokenContract.decimals(),
                buyTokenContract.decimals()
            ]);

            // Convert amounts to Wei
            const sellAmountWei = ethers.utils.parseUnits(sellAmount, sellDecimals);
            const buyAmountWei = ethers.utils.parseUnits(buyAmount, buyDecimals);

            // Check and request token approval if needed
            const signer = await this.getSigner();
            const signerAddress = await signer.getAddress();
            const allowance = await this.checkAllowance(sellToken, signerAddress, sellAmountWei);
            
            if (!allowance) {
                this.showSuccess('Requesting token approval...');
                const approveTx = await sellTokenContract.connect(signer).approve(
                    this.contract.address,
                    sellAmountWei
                );
                await approveTx.wait();
                this.showSuccess('Token approval granted');
            }

            // Get the order creation fee
            const fee = await this.contract.orderCreationFee();

            this.debug('Sending create order transaction with params:', {
                taker: partner || ethers.constants.AddressZero,
                sellToken,
                sellAmount,
                buyToken,
                buyAmount,
                value: fee
            });

            const tx = await this.contract.createOrder(
                partner || ethers.constants.AddressZero,
                sellToken,
                sellAmountWei,
                buyToken,
                buyAmountWei,
                { value: fee }
            );

            this.debug('Transaction sent:', tx.hash);
            this.showSuccess('Order creation transaction submitted');

            const receipt = await tx.wait();
            this.debug('Transaction confirmed:', receipt);
            
            // Refresh the fee after order creation
            await this.loadOrderCreationFee();

            // Look for OrderCreated event
            const orderCreatedEvent = receipt.events?.find(e => e.event === 'OrderCreated');
            if (orderCreatedEvent) {
                this.debug('OrderCreated event found:', orderCreatedEvent);
            } else {
                console.warn('[CreateOrder] No OrderCreated event found in receipt');
            }

            this.showSuccess('Order created successfully!');
            this.resetForm();
            
        } catch (error) {
            console.error('[CreateOrder] Detailed error:', {
                code: error.code,
                message: error.message,
                data: error.data,
                transaction: error.transaction,
                receipt: error.receipt,
                stack: error.stack
            });
            
            const errorMessage = this.getReadableError(error);
            this.showError(errorMessage);
        } finally {
            this.isSubmitting = false;
            createOrderBtn.disabled = false;
            createOrderBtn.textContent = 'Create Order';
        }
    }

    async checkAllowance(tokenAddress, owner, amount) {
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function allowance(address owner, address spender) view returns (uint256)'],
                this.provider
            );
            const allowance = await tokenContract.allowance(owner, this.contract.address);
            return allowance.gte(amount);
        } catch (error) {
            console.error('[CreateOrder] Error checking allowance:', error);
            return false;
        }
    }

    getReadableError(error) {
        // Add more specific error cases
        switch (error.code) {
            case 'ACTION_REJECTED':
                return 'Transaction was rejected by user';
            case 'INSUFFICIENT_FUNDS':
                return 'Insufficient funds for transaction';
            case -32603:
                return 'Network error. Please check your connection';
            case 'UNPREDICTABLE_GAS_LIMIT':
                return 'Error estimating gas. The transaction may fail';
            default:
                return error.reason || error.message || 'Error creating order';
        }
    }

    resetForm() {
        ['sellAmount', 'buyAmount'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        ['sellTokenBalance', 'buyTokenBalance'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = '';
        });
    }
}

