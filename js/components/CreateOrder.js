import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { getNetworkConfig, walletManager } from '../config.js';
import { erc20Abi } from '../abi/erc20.js';
import { getContractAllowedTokens, getAllWalletTokens } from '../utils/contractTokens.js';
import { contractService } from '../services/ContractService.js';
import { createLogger } from '../services/LogService.js';
import { validateSellBalance } from '../utils/balanceValidation.js';

export class CreateOrder extends BaseComponent {
    constructor() {
        super('create-order');
        this.contract = null;
        this.provider = null;
        this.initialized = false;
        this.tokenCache = new Map();
        this.boundCreateOrderHandler = this.handleCreateOrder.bind(this);
        this.isSubmitting = false;
        this.tokens = [];
        this.sellToken = null;
        this.buyToken = null;
        this.tokenSelectorListeners = {};  // Store listeners to prevent duplicates
        
        // Initialize logger
        const logger = createLogger('CREATE_ORDER');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
    }

    // Add debounce as a class method
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
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
                this.error('Contract ABI is undefined');
                throw new Error('Contract ABI is undefined');
            }
            
            // Get provider and signer from walletManager
            const signer = walletManager.getSigner();
            if (!signer) {
                this.error('No signer available - wallet may be disconnected');
                throw new Error('No signer available - wallet may be disconnected');
            }
            
            // Initialize contract with signer from walletManager
            this.contract = new ethers.Contract(
                networkConfig.contractAddress,
                networkConfig.contractABI,
                signer
            );
            
            this.debug('Contract initialized successfully');
            return this.contract;
        } catch (error) {
            this.error('Contract initialization error:', error);
            throw error;
        }
    }

    async initialize(readOnlyMode = true) {
        if (this.initializing || this.initialized) {
            this.debug('Already initializing or initialized, skipping...');
            return;
        }
        this.initializing = true;
        
        try {
            this.debug('Starting initialization...');
            
            // Render the HTML first
            const container = document.getElementById('create-order');
            container.innerHTML = this.render();
            
            // Handle read-only mode first, before any other initialization
            if (readOnlyMode) {
                this.setReadOnlyMode();
                // Clear any existing error messages in read-only mode
                const statusElement = document.getElementById('status');
                if (statusElement) {
                    statusElement.style.display = 'none';
                }
                this.initialized = true;
                return;
            }

            // Rest of the initialization code for connected mode...
            if (window.webSocket) {
                window.webSocket.subscribe("OrderCreated", (order) => {
                    this.debug('New order created:', order);
                    // Use refreshActiveComponent instead of loadOrders
                    if (window.app?.refreshActiveComponent) {
                        window.app.refreshActiveComponent();
                    }
                });

                window.webSocket.subscribe("ordersUpdated", (orders) => {
                    this.debug('Orders updated:', orders);
                    // Use refreshActiveComponent instead of loadOrders
                    if (window.app?.refreshActiveComponent) {
                        window.app.refreshActiveComponent();
                    }
                });
            }

            // Wait for WebSocket to be fully initialized
            if (!window.webSocket?.isInitialized) {
                this.debug('Waiting for WebSocket initialization...');
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (window.webSocket?.isInitialized) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }

            // Clear existing content before re-populating
            const sellContainer = document.getElementById('sellContainer');
            const buyContainer = document.getElementById('buyContainer');
            if (sellContainer) sellContainer.innerHTML = '';
            if (buyContainer) buyContainer.innerHTML = '';

            // Use WebSocket's contract instance
            this.contract = window.webSocket.contract;
            this.provider = window.webSocket.provider;

            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            
            // Initialize contract service
            contractService.initialize();
            
            // Enable form when wallet is connected
            this.setConnectedMode();
            
            // Setup UI immediately
            this.populateTokenDropdowns();
            this.setupTokenInputListeners();
            this.setupCreateOrderListener();
            
            // Wait for contract to be ready
            await this.waitForContract();
            
            // Load data with retries
            await Promise.all([
                this.loadOrderCreationFee(),
                this.loadContractTokens()
            ]);

            this.updateFeeDisplay();
            
            // Initialize token selectors
            this.initializeTokenSelectors();
            
            // Initialize amount input listeners
            this.initializeAmountInputs();
            
            this.initialized = true;
            this.debug('Initialization complete');

        } catch (error) {
            this.error('Error in initialization:', error);
            // Only show errors if not in read-only mode
            if (!readOnlyMode) {
                this.showError('Failed to initialize. Please try again.');
            }
        } finally {
            this.initializing = false;
        }
    }

    async loadOrderCreationFee() {
        try {
            // Check if we have a cached value
            if (this.feeToken?.address && this.feeToken?.amount &&this.feeToken?.symbol) {
                this.debug('Using cached fee token data');
                return;
            }

            const maxRetries = 3;
            let retryCount = 0;
            let lastError;

            while (retryCount < maxRetries) {
                try {
                    const feeTokenAddress = await this.contract.feeToken();
                    this.debug('Fee token address:', feeTokenAddress);

                    const feeAmount = await this.contract.orderCreationFeeAmount();
                    this.debug('Fee amount:', feeAmount);

                    // Get token details
                    const tokenContract = new ethers.Contract(
                        feeTokenAddress,
                        [
                            'function symbol() view returns (string)',
                            'function decimals() view returns (uint8)'
                        ],
                        this.provider
                    );

                    const [symbol, decimals] = await Promise.all([
                       tokenContract.symbol(),
                        tokenContract.decimals()
                    ]);

                    // Cache the results
                    this.feeToken = {
                        address: feeTokenAddress,
                        amount: feeAmount,
                        symbol: symbol,
                        decimals: decimals
                    };

                    // Update the fee display
                    const feeDisplay = document.querySelector('.fee-amount');
                    if (feeDisplay) {
                        const formattedAmount = ethers.utils.formatUnits(feeAmount, decimals);
                        feeDisplay.textContent = `${formattedAmount} ${symbol}`;
                    }

                    return;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    if (retryCount < maxRetries) {
                        // Exponential backoff: 1s, 2s, 4s, etc.
                        const delay = Math.pow(2, retryCount - 1) * 1000;
                        this.debug(`Retry ${retryCount}/${maxRetries} after ${delay}ms`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            throw lastError;
        } catch (error) {
            this.debug('Error loading fee:', error);
            throw error;
        }
    }

    // Add a method to check if contract is ready
    async waitForContract(timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (this.contract && await this.contract.provider.getNetwork()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Contract not ready after timeout');
    }

    setReadOnlyMode() {
        console.log('[CreateOrder] Setting read-only mode');
        const createOrderBtn = document.getElementById('createOrderBtn');
        const orderCreationFee = document.getElementById('orderCreationFee');
        
        // Ensure UI is hidden per styles by removing wallet-connected
        const swapSection = document.querySelector('.swap-section');
        if (swapSection) {
            swapSection.classList.remove('wallet-connected');
        }

        if (createOrderBtn) {
            createOrderBtn.disabled = true;
            createOrderBtn.textContent = 'Connect Wallet to Create Order';
        }
        
        // Disable input fields
        ['partner', 'sellToken', 'sellAmount', 'buyToken', 'buyAmount'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.disabled = true;
        });
    }

    setConnectedMode() {
        const createOrderBtn = document.getElementById('createOrderBtn');
        const orderCreationFee = document.getElementById('orderCreationFee');
        
        // Make sure the swap section is marked as wallet-connected so CSS reveals inputs
        const swapSection = document.querySelector('.swap-section');
        if (swapSection) {
            swapSection.classList.add('wallet-connected');
        }

        if (createOrderBtn) {
            createOrderBtn.disabled = false;
            createOrderBtn.textContent = 'Create Order';
        }
        
        // Enable input fields
        ['partner', 'sellToken', 'sellAmount', 'buyToken', 'buyAmount'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.disabled = false;
        });

        // Reload fee if we have it cached
        if (this.feeToken) {
            const feeElement = document.getElementById('orderFee');
            if (feeElement) {
                const formattedFee = ethers.utils.formatUnits(this.feeToken.amount, this.feeToken.decimals);
                feeElement.textContent = `${formattedFee} ${this.feeToken.symbol}`;
            }
        }
    }

    async updateTokenBalance(tokenAddress, elementId) {
        try {
            const balanceElement = document.getElementById(elementId);
            if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
                balanceElement.textContent = '';
                return;
            }

            const tokenDetails = await this.getTokenDetails([tokenAddress]);
            if (tokenDetails && tokenDetails[0]?.symbol) {
                const token = tokenDetails[0];
                const formattedBalance = parseFloat(token.formattedBalance).toFixed(4);
                
                // Update token selector button
                const type = elementId.includes('sell') ? 'sell' : 'buy';
                const selector = document.getElementById(`${type}TokenSelector`);
                selector.innerHTML = `
                    <span class="token-selector-content">
                        <div class="token-icon small">
                            ${this.getTokenIcon(token)}
                        </div>
                        <span>${token.symbol}</span>
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </span>
                `;
                
                // Update balance display
                balanceElement.innerHTML = `Balance: ${formattedBalance}`;
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
            if (ethers.utils.isAddress(tokenAddress)) {
                const container = input.parentElement;
                const existingTooltip = container.querySelector('.token-address-tooltip');
                if (existingTooltip) {
                    existingTooltip.remove();
                }
                
                const tooltip = document.createElement('div');
                tooltip.className = 'token-address-tooltip';
                tooltip.innerHTML = `
                    Verify token at: 
                    <a href="${this.getExplorerUrl(tokenAddress)}" 
                       target="_blank"
                       style="color: #fff; text-decoration: underline;">
                       ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}
                    </a>
                `;
                container.appendChild(tooltip);
            }
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

        // Setup taker toggle functionality
        const takerToggle = document.querySelector('.taker-toggle');
        if (takerToggle) {
            console.log('[CreateOrder] Setting up taker toggle functionality');
            // Remove existing listeners using clone technique
            const newTakerToggle = takerToggle.cloneNode(true);
            takerToggle.parentNode.replaceChild(newTakerToggle, takerToggle);
            
            // Add click listener
            newTakerToggle.addEventListener('click', function(e) {
                console.log('[CreateOrder] Taker toggle clicked');
                e.preventDefault();
                e.stopPropagation();
                
                this.classList.toggle('active');
                const takerInputContent = document.querySelector('.taker-input-content');
                if (takerInputContent) {
                    takerInputContent.classList.toggle('hidden');
                }
                
                // Update chevron direction
                const chevron = this.querySelector('.chevron-down');
                if (chevron) {
                    if (this.classList.contains('active')) {
                        chevron.style.transform = 'rotate(180deg)';
                    } else {
                        chevron.style.transform = 'rotate(0deg)';
                    }
                }
            });
        } else {
            console.log('[CreateOrder] Taker toggle button not found');
        }
    }

    async handleCreateOrder(event) {
        event.preventDefault();
        
        if (this.isSubmitting) {
            this.debug('Already processing a transaction');
            return;
        }
        
        const createOrderBtn = document.getElementById('createOrderBtn');
        
        try {
            this.isSubmitting = true;
            createOrderBtn.disabled = true;
            createOrderBtn.classList.add('disabled');

            // Get fresh signer and reinitialize contract
            const signer = walletManager.getSigner();
            if (!signer) {
                throw new Error('No signer available - wallet may be disconnected');
            }

            // Reinitialize contract with fresh signer
            const networkConfig = getNetworkConfig();
            this.contract = new ethers.Contract(
                networkConfig.contractAddress,
                networkConfig.contractABI,
                signer
            );

            // Debug logs to check token state
            this.debug('Current sellToken:', this.sellToken);
            this.debug('Current buyToken:', this.buyToken);
            
            // Get form values
            let taker = document.getElementById('takerAddress')?.value.trim() || '';
            
            // Validate sell token
            if (!this.sellToken || !this.sellToken.address) {
                this.debug('Invalid sell token:', this.sellToken);
                this.showError('Please select a valid token to sell');
                return;
            }

            // Validate buy token
            if (!this.buyToken || !this.buyToken.address) {
                this.debug('Invalid buy token:', this.buyToken);
                this.showError('Please select a valid token to buy');
                return;
            }

            // Check if the same token is selected for both buy and sell
            if (this.sellToken.address.toLowerCase() === this.buyToken.address.toLowerCase()) {
                this.showError(`Cannot create an order with the same token (${this.sellToken.symbol}) for both buy and sell. Please select different tokens.`);
                return;
            }

            // Validate that both tokens are allowed in the contract
            try {
                const [sellTokenAllowed, buyTokenAllowed] = await Promise.all([
                    contractService.isTokenAllowed(this.sellToken.address),
                    contractService.isTokenAllowed(this.buyToken.address)
                ]);

                if (!sellTokenAllowed) {
                    this.showError(`Sell token ${this.sellToken.symbol} is not allowed for trading. Please select an allowed token.`);
                    return;
                }

                if (!buyTokenAllowed) {
                    this.showError(`Buy token ${this.buyToken.symbol} is not allowed for trading. Please select an allowed token.`);
                    return;
                }

                this.debug('Token validation passed - both tokens are allowed');
            } catch (validationError) {
                this.debug('Token validation error:', validationError);
                this.showError('Unable to validate tokens. Please try again.');
                return;
            }

            // Validate addresses
            if (!ethers.utils.isAddress(this.sellToken.address)) {
                this.debug('Invalid sell token address:', this.sellToken.address);
                this.showError('Invalid sell token address');
                return;
            }
            if (!ethers.utils.isAddress(this.buyToken.address)) {
                this.debug('Invalid buy token address:', this.buyToken.address);
                this.showError('Invalid buy token address');
                return;
            }

            const sellAmount = document.getElementById('sellAmount')?.value.trim();
            const buyAmount = document.getElementById('buyAmount')?.value.trim();

            // Validate inputs
            if (!sellAmount || isNaN(sellAmount) || parseFloat(sellAmount) <= 0) {
                this.showError('Please enter a valid sell amount');
                return;
            }
            if (!buyAmount || isNaN(buyAmount) || parseFloat(buyAmount) <= 0) {
                this.showError('Please enter a valid buy amount');
                return;
            }

            // Validate sell balance before proceeding
            try {
                this.debug('Validating sell balance...');
                const balanceValidation = await validateSellBalance(
                    this.sellToken.address, 
                    sellAmount, 
                    this.sellToken.decimals
                );

                if (!balanceValidation.hasSufficientBalance) {
                    const errorMessage = `Insufficient ${balanceValidation.symbol} balance for selling.\n\n` +
                        `Required: ${Number(balanceValidation.formattedRequired).toLocaleString()} ${balanceValidation.symbol}\n` +
                        `Available: ${Number(balanceValidation.formattedBalance).toLocaleString()} ${balanceValidation.symbol}\n\n` +
                        `Please reduce the sell amount or ensure you have sufficient balance.`;
                    
                    this.showError(errorMessage);
                    return;
                }

                this.debug('Sell balance validation passed');
            } catch (balanceError) {
                this.debug('Balance validation error:', balanceError);
                this.showError(`Failed to validate balance: ${balanceError.message}`);
                return;
            }

            // If taker is empty, use zero address for public order
            if (!taker) {
                taker = ethers.constants.AddressZero;
                this.debug('No taker specified, using zero address for public order');
            } else if (!ethers.utils.isAddress(taker)) {
                throw new Error('Invalid taker address format');
            }

            // Convert amounts to wei
            const sellTokenDecimals = await this.getTokenDecimals(this.sellToken.address);
            const buyTokenDecimals = await this.getTokenDecimals(this.buyToken.address);
            const sellAmountWei = ethers.utils.parseUnits(sellAmount, sellTokenDecimals);
            const buyAmountWei = ethers.utils.parseUnits(buyAmount, buyTokenDecimals);

            // Debug logs to check amounts and allowance
            this.debug('Sell amount in wei:', sellAmountWei.toString());
            this.debug('Buy amount in wei:', buyAmountWei.toString());

            // Check and approve tokens with retry mechanism
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                try {
                    // Check and approve tokens
                    const sellTokenApproved = await this.checkAndApproveToken(this.sellToken.address, sellAmountWei);
                    if (!sellTokenApproved) {
                        return;
                    }

                    const feeTokenApproved = await this.checkAndApproveToken(this.feeToken.address, this.feeToken.amount);
                    if (!feeTokenApproved) {
                        return;
                    }

                    // Add small delay after approvals
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Create order
                    this.showInfo('Creating order...');
                    const tx = await this.contract.createOrder(
                        taker,
                        this.sellToken.address,
                        sellAmountWei,
                        this.buyToken.address,
                        buyAmountWei
                    ).catch(error => {
                        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
                            this.showWarning('Order creation declined');
                            return null;
                        }
                        throw error;
                    });

                    if (!tx) return; // User rejected the transaction

                    this.showInfo('Waiting for confirmation...');
                    await tx.wait();
                    
                    // Force a sync of all orders after successful creation
                    if (window.webSocket) {
                        await window.webSocket.syncAllOrders(this.contract);
                    }

                    // If we get here, the transaction was successful
                    break;

                } catch (error) {
                    retryCount++;
                    this.debug(`Create order attempt ${retryCount} failed:`, error);

                    if (retryCount <= maxRetries && 
                        (error.message?.includes('nonce') || 
                         error.message?.includes('replacement fee too low'))) {
                        this.showInfo('Retrying transaction...');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                    throw error;
                }
            }

            this.showSuccess('Order created successfully!');
            this.resetForm();
            
            // Reload orders if needed
            if (window.app?.loadOrders) {
                window.app.loadOrders();
            }

            // Clear form inputs
            document.getElementById('sellAmount').value = '';
            document.getElementById('buyAmount').value = '';
            document.getElementById('takerAddress').value = '';
            
            // Reset token selectors if needed
            this.sellToken = null;
            this.buyToken = null;
            
            // Update UI to reflect cleared state
            const sellTokenSelector = document.getElementById('sellTokenSelector');
            const buyTokenSelector = document.getElementById('buyTokenSelector');
            
            if (sellTokenSelector) {
                sellTokenSelector.innerHTML = 'Select Token';
            }
            if (buyTokenSelector) {
                buyTokenSelector.innerHTML = 'Select Token';
            }
            
            // Reset any other UI elements
            this.updateCreateButtonState();
            
            // Show success message
            this.showSuccess('Order created successfully!');

        } catch (error) {
            this.debug('Create order error:', error);
            const userMessage = this.getUserFriendlyError(error);
            this.showError(userMessage);
        } finally {
            this.isSubmitting = false;
            createOrderBtn.disabled = false;
            createOrderBtn.classList.remove('disabled');
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
        // Clear token inputs and amounts
        document.getElementById('sellToken').value = '';
        document.getElementById('sellAmount').value = '';
        document.getElementById('buyToken').value = '';
        document.getElementById('buyAmount').value = '';
        
        // Clear taker address input
        const takerInput = document.getElementById('takerAddress');
        if (takerInput) {
            takerInput.value = '';
        }
        
        // Clear token balances
        const sellTokenBalance = document.getElementById('sellTokenBalance');
        const buyTokenBalance = document.getElementById('buyTokenBalance');
        if (sellTokenBalance) sellTokenBalance.textContent = '';
        if (buyTokenBalance) buyTokenBalance.textContent = '';
        
        // Clear component state
        this.sellToken = null;
        this.buyToken = null;
        
        // Reset token selectors to default state
        ['sell', 'buy'].forEach(type => {
            const selector = document.getElementById(`${type}TokenSelector`);
            if (selector) {
                selector.innerHTML = `
                    <span class="token-selector-content">
                        <span>Select Token</span>
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </span>
                `;
            }
        });
        
        // Remove any token address tooltips
        document.querySelectorAll('.token-address-tooltip').forEach(tooltip => {
            tooltip.remove();
        });
        
        // Remove USD amount displays
        ['sell', 'buy'].forEach(type => {
            const usdDisplay = document.getElementById(`${type}AmountUSD`);
            if (usdDisplay) {
                usdDisplay.remove();
            }
        });
        
        // Update create button state
        this.updateCreateButtonState();
    }

    async loadContractTokens() {
        try {
            this.debug('Loading all wallet tokens...');
            
            // Get all wallet tokens (both allowed and not allowed)
            const { allowed, notAllowed } = await getAllWalletTokens();
            this.tokens = allowed; // Keep allowed tokens for backward compatibility
            this.allowedTokens = allowed;
            this.notAllowedTokens = notAllowed;
            
            this.debug('Loaded allowed tokens:', allowed);
            this.debug('Loaded not allowed tokens:', notAllowed);

            ['sell', 'buy'].forEach(type => {
                const modal = document.getElementById(`${type}TokenModal`);
                if (!modal) {
                    this.debug(`No modal found for ${type}`);
                    return;
                }

                // Display allowed tokens
                const allowedTokensList = modal.querySelector(`#${type}AllowedTokenList`);
                if (allowedTokensList) {
                    this.displayTokens(allowed, allowedTokensList, type);
                }

                // Display not allowed tokens if any exist
                const notAllowedSection = modal.querySelector(`#${type}NotAllowedSection`);
                if (notAllowedSection && notAllowed.length > 0) {
                    this.displayNotAllowedTokens(notAllowed, notAllowedSection, type);
                }
            });
        } catch (error) {
            this.debug('Error loading wallet tokens:', error);
            this.showError('Failed to load tokens. Please try again.');
        }
    }

    populateTokenDropdowns() {
        ['sell', 'buy'].forEach(type => {
            const currentContainer = document.getElementById(`${type}Container`);
            if (!currentContainer) return;
            
            // Create the unified input container
            const container = document.createElement('div');
            container.className = 'unified-token-input';
            
            // Create input wrapper with label
            const inputWrapper = document.createElement('div');
            inputWrapper.className = 'token-input-wrapper';
            
            // Add the label
            const label = document.createElement('span');
            label.className = 'token-input-label';
            label.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            
            // Create amount input
            const amountInput = document.createElement('input');
            amountInput.type = 'text';
            amountInput.id = `${type}Amount`;
            amountInput.className = 'token-amount-input';
            amountInput.placeholder = '0.0';
            
            // Assemble input wrapper
            inputWrapper.appendChild(label);
            inputWrapper.appendChild(amountInput);
            
            // Create token selector button
            const tokenSelector = document.createElement('button');
            tokenSelector.className = 'token-selector-button';
            tokenSelector.id = `${type}TokenSelector`;
            tokenSelector.innerHTML = `
                <span class="token-selector-content">
                    <span>Select token</span>
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </span>
            `;
            
            // Hidden input for token address
            const tokenInput = document.createElement('input');
            tokenInput.type = 'hidden';
            tokenInput.id = `${type}Token`;
            
            // Assemble the components
            container.appendChild(inputWrapper);
            container.appendChild(tokenSelector);
            container.appendChild(tokenInput);
            
            // Create balance display
            const balanceDisplay = document.createElement('div');
            balanceDisplay.id = `${type}TokenBalance`;
            balanceDisplay.className = 'token-balance-display';
            
            currentContainer.appendChild(container);
            currentContainer.appendChild(balanceDisplay);
            
            // Add event listeners
            tokenSelector.addEventListener('click', () => {
                const modal = document.getElementById(`${type}TokenModal`);
                if (modal) modal.classList.add('show');
            });
            
            // Create modal if it doesn't exist
            if (!document.getElementById(`${type}TokenModal`)) {
                const modal = this.createTokenModal(type);
                document.body.appendChild(modal);
            }
        });
    }

    createTokenModal(type) {
        const modal = document.createElement('div');
        modal.className = 'token-modal';
        modal.id = `${type}TokenModal`;
        
        modal.innerHTML = `
            <div class="token-modal-content">
                <div class="token-modal-header">
                    <h3>Select Token</h3>
                    <button class="token-modal-close">&times;</button>
                </div>
                <div class="token-modal-search">
                    <input type="text" 
                           class="token-search-input" 
                           placeholder="Search by name or paste address"
                           id="${type}TokenSearch">
                </div>
                <div class="token-sections">
                    <div id="${type}ContractResult"></div>
                    <div class="token-section">
                        <h4>Allowed tokens</h4>
                        <div class="token-list" id="${type}AllowedTokenList"></div>
                    </div>
                    <div class="token-section">
                        <h4>Not Allowed Tokens</h4>
                        <div class="token-list" id="${type}NotAllowedSection"></div>
                    </div>
                </div>
            </div>
        `;

        // Update to use the class method debounce
        const searchInput = modal.querySelector(`#${type}TokenSearch`);
        searchInput.addEventListener('input', this.debounce((e) => {
            this.handleTokenSearch(e.target.value, type);
        }, 300));

        return modal;
    }

    async handleTokenSearch(searchTerm, type) {
        try {
            const contractResult = document.getElementById(`${type}ContractResult`);
            
            searchTerm = searchTerm.trim().toLowerCase();
            
            // Clear previous contract result only
            contractResult.innerHTML = '';

            // If search is empty, just clear the contract result
            if (!searchTerm) {
                return;
            }

            // Check if input is an address
            if (ethers.utils.isAddress(searchTerm)) {
                // Show loading state for contract result
                contractResult.innerHTML = `
                    <div class="token-section">
                        <h4>Token Contract</h4>
                        <div class="contract-loading">
                            <div class="spinner"></div>
                            <span>Loading token info...</span>
                        </div>
                    </div>
                `;

                try {
                    const tokenContract = new ethers.Contract(
                        searchTerm,
                        erc20Abi,
                        this.provider
                    );

                    const [name, symbol, decimals, balance] = await Promise.all([
                        tokenContract.name().catch(() => null),
                        tokenContract.symbol().catch(() => null),
                        tokenContract.decimals().catch(() => null),
                        tokenContract.balanceOf(await walletManager.getCurrentAddress()).catch(() => null)
                    ]);

                    if (name && symbol && decimals !== null) {
                        // Check if token is allowed in the contract
                        const isAllowed = await contractService.isTokenAllowed(searchTerm);
                        
                        const token = {
                            address: searchTerm,
                            name,
                            symbol,
                            decimals,
                            balance: balance ? ethers.utils.formatUnits(balance, decimals) : '0'
                        };

                        // Get USD price and calculate USD value
                        const usdPrice = window.pricingService?.getPrice(token.address) || 0;
                        const usdValue = Number(token.balance) * usdPrice;
                        const formattedUsdValue = usdValue.toLocaleString(undefined, {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        });

                        // Format balance
                        const formattedBalance = Number(token.balance).toLocaleString(undefined, { 
                            minimumFractionDigits: 2, 
                            maximumFractionDigits: 4,
                            useGrouping: true
                        });

                        contractResult.innerHTML = `
                            <div class="token-section">
                                <h4>Token Contract</h4>
                                <div class="token-list">
                                    <div class="token-item ${isAllowed ? 'token-allowed' : 'token-not-allowed'}" data-address="${token.address}">
                                        <div class="token-item-left">
                                            <div class="token-icon">
                                                ${this.getTokenIcon(token)}
                                            </div>
                                            <div class="token-item-info">
                                                <div class="token-item-symbol">
                                                    ${token.symbol}
                                                </div>
                                                <div class="token-item-name">
                                                    ${token.name}
                                                    <a href="${this.getExplorerUrl(token.address)}" 
                                                       target="_blank"
                                                       class="token-explorer-link"
                                                       onclick="event.stopPropagation();">
                                                        <svg class="token-explorer-icon" viewBox="0 0 24 24">
                                                            <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                                        </svg>
                                                    </a>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="token-item-right">
                                            <div class="token-balance-with-usd">
                                                <div class="token-balance-amount">${formattedBalance}</div>
                                                <div class="token-balance-usd">${formattedUsdValue}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                ${!isAllowed ? `
                                    <div class="token-not-allowed-message">
                                        This token is not allowed for trading. Only tokens from the allowed list can be used.
                                    </div>
                                ` : ''}
                            </div>
                        `;

                        // Add click handler only if token is allowed
                        const tokenItem = contractResult.querySelector('.token-item');
                        if (isAllowed) {
                            tokenItem.addEventListener('click', () => this.handleTokenItemClick(type, tokenItem));
                        } else {
                            tokenItem.style.cursor = 'not-allowed';
                            tokenItem.title = 'This token is not allowed for trading';
                        }
                    }
                } catch (error) {
                    contractResult.innerHTML = `
                        <div class="token-section">
                            <h4>Token Contract</h4>
                            <div class="contract-error">
                                Invalid or unsupported token contract
                            </div>
                        </div>
                    `;
                }
            } else {
                // Search in allowed tokens by name/symbol
                const searchResults = this.tokens.filter(token => 
                    token.name.toLowerCase().includes(searchTerm) ||
                    token.symbol.toLowerCase().includes(searchTerm)
                );

                if (searchResults.length > 0) {
                    contractResult.innerHTML = `
                        <div class="token-section">
                            <h4>Search Results</h4>
                            <div class="token-list">
                                ${searchResults.map(token => {
                                    const balance = Number(token.balance) || 0;
                                    const formattedBalance = balance.toLocaleString(undefined, { 
                                        minimumFractionDigits: 2, 
                                        maximumFractionDigits: 4,
                                        useGrouping: true
                                    });
                                    const usdPrice = window.pricingService?.getPrice(token.address) || 0;
                                    const usdValue = balance * usdPrice;
                                    const formattedUsdValue = usdValue.toLocaleString(undefined, {
                                        style: 'currency',
                                        currency: 'USD',
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    });

                                    return `
                                        <div class="token-item token-allowed" data-address="${token.address}">
                                            <div class="token-item-left">
                                                <div class="token-icon">
                                                    ${this.getTokenIcon(token)}
                                                </div>
                                                <div class="token-item-info">
                                                    <div class="token-item-symbol">
                                                        ${token.symbol}
                                                    </div>
                                                    <div class="token-item-name">
                                                        ${token.name}
                                                        <a href="${this.getExplorerUrl(token.address)}" 
                                                           target="_blank"
                                                           class="token-explorer-link"
                                                           onclick="event.stopPropagation();">
                                                            <svg class="token-explorer-icon" viewBox="0 0 24 24">
                                                                <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                                            </svg>
                                                        </a>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="token-item-right">
                                                <div class="token-balance-with-usd">
                                                    <div class="token-balance-amount">${formattedBalance}</div>
                                                    <div class="token-balance-usd">${formattedUsdValue}</div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;

                    // Add click handlers for search results
                    const tokenItems = contractResult.querySelectorAll('.token-item');
                    tokenItems.forEach(item => {
                        item.addEventListener('click', () => this.handleTokenItemClick(type, item));
                    });
                } else {
                    contractResult.innerHTML = `
                        <div class="token-section">
                            <h4>Search Results</h4>
                            <div class="token-list-empty">
                                No tokens found matching "${searchTerm}"
                            </div>
                        </div>
                    `;
                }
            }
        } catch (error) {
            this.debug('Search error:', error);
            this.showError('Error searching for token');
        }
    }

    displayTokens(tokens, container, type) {
        if (!container) return;

        if (!tokens || tokens.length === 0) {
            container.innerHTML = `
                <div class="token-list-empty">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No allowed tokens found</div>
                    <div class="empty-state-subtext">Contact the contract owner to add tokens to the allowed list</div>
                </div>
            `;
            return;
        }

        // Clear existing content
        container.innerHTML = '';

        // Sort tokens: tokens with balance first, then alphabetically by symbol
        const sortedTokens = [...tokens].sort((a, b) => {
            const aBalance = Number(a.balance) || 0;
            const bBalance = Number(b.balance) || 0;
            
            // First sort by balance (non-zero first)
            if (aBalance > 0 && bBalance === 0) return -1;
            if (aBalance === 0 && bBalance > 0) return 1;
            
            // Then sort alphabetically by symbol
            return a.symbol.localeCompare(b.symbol);
        });

        // Add each token to the container
        sortedTokens.forEach(token => {
            const tokenElement = document.createElement('div');
            const balance = Number(token.balance) || 0;
            const hasBalance = balance > 0;
            
            tokenElement.className = `token-item ${hasBalance ? 'token-has-balance' : 'token-no-balance'}`;
            
            // For sell tokens, add disabled class if no balance
            if (type === 'sell' && !hasBalance) {
                tokenElement.classList.add('token-disabled');
            }
            tokenElement.dataset.address = token.address;
            
            // Format balance with up to 4 decimal places if they exist
            const formattedBalance = balance.toLocaleString(undefined, { 
                minimumFractionDigits: 2, 
                maximumFractionDigits: 4,
                useGrouping: true // Keeps the thousand separators
            });
            
            // Get USD price and calculate USD value
            const usdPrice = window.pricingService?.getPrice(token.address) || 0;
            const usdValue = balance * usdPrice;
            const formattedUsdValue = usdValue.toLocaleString(undefined, {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

            // Generate background color for fallback icon
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
                '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
            ];
            const colorIndex = token.address ? 
                parseInt(token.address.slice(-6), 16) % colors.length :
                Math.floor(Math.random() * colors.length);
            const backgroundColor = colors[colorIndex];
            
            tokenElement.innerHTML = `
                <div class="token-item-content">
                    <div class="token-item-left">
                        <div class="token-icon">
                            ${token.logoURI ? `
                                <img src="${token.logoURI}" 
                                    alt="${token.symbol}" 
                                    class="token-icon-image"
                                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                                <div class="token-icon-fallback" style="display:none;background:${backgroundColor}">
                                    ${token.symbol.charAt(0).toUpperCase()}
                                </div>` : `
                                <div class="token-icon-fallback" style="background:${backgroundColor}">
                                    ${token.symbol.charAt(0).toUpperCase()}
                                </div>`
                            }
                        </div>
                        <div class="token-item-info">
                            <div class="token-item-symbol">
                                ${token.symbol}
                            </div>
                            <div class="token-item-name">${token.name}</div>
                        </div>
                    </div>
                    <div class="token-item-right">
                        <div class="token-balance-with-usd">
                            <div class="token-balance-amount ${hasBalance ? 'has-balance' : 'no-balance'}">
                                ${formattedBalance}
                                ${!hasBalance ? '<span class="no-balance-text">(No balance)</span>' : ''}
                            </div>
                            <div class="token-balance-usd">${formattedUsdValue}</div>
                        </div>
                        <div class="token-item-actions">
                            <a href="${this.getExplorerUrl(token.address)}" 
                               target="_blank"
                               class="token-explorer-link"
                               onclick="event.stopPropagation();"
                               title="View on Explorer">
                                <svg class="token-explorer-icon" viewBox="0 0 24 24">
                                    <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>
            `;

            // Add click handler
            tokenElement.addEventListener('click', () => this.handleTokenItemClick(type, tokenElement));
            
            // Add to container
            container.appendChild(tokenElement);
        });

        // Add summary information
        const tokensWithBalance = sortedTokens.filter(token => Number(token.balance) > 0).length;
        const totalTokens = sortedTokens.length;
        
        if (totalTokens > 0) {
            const summaryElement = document.createElement('div');
            summaryElement.className = 'token-list-summary';
            summaryElement.innerHTML = `
                <div class="summary-text">
                    Showing ${totalTokens} allowed tokens
                    ${tokensWithBalance > 0 ? `(${tokensWithBalance} with balance)` : ''}
                    ${type === 'sell' && tokensWithBalance < totalTokens ? ` - ${totalTokens - tokensWithBalance} disabled (no balance)` : ''}
                </div>
            `;
            container.appendChild(summaryElement);
        }
    }

    displayNotAllowedTokens(notAllowed, container, type) {
        if (!container) return;

        if (!notAllowed || notAllowed.length === 0) {
            container.innerHTML = `
                <div class="token-list-empty">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No not allowed tokens found</div>
                    <div class="empty-state-subtext">This token is not allowed for trading.</div>
                </div>
            `;
            return;
        }

        // Clear existing content
        container.innerHTML = '';

        // Sort tokens alphabetically by symbol
        const sortedTokens = [...notAllowed].sort((a, b) => a.symbol.localeCompare(b.symbol));

        // Add each token to the container
        sortedTokens.forEach(token => {
            const tokenElement = document.createElement('div');
            const balance = Number(token.balance) || 0;
            const hasBalance = balance > 0;
            
            tokenElement.className = `token-item token-not-allowed`;
            tokenElement.dataset.address = token.address;
            
            // Format balance with up to 4 decimal places if they exist
            const formattedBalance = balance.toLocaleString(undefined, { 
                minimumFractionDigits: 2, 
                maximumFractionDigits: 4,
                useGrouping: true // Keeps the thousand separators
            });
            
            // Get USD price and calculate USD value
            const usdPrice = window.pricingService?.getPrice(token.address) || 0;
            const usdValue = balance * usdPrice;
            const formattedUsdValue = usdValue.toLocaleString(undefined, {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

            // Generate background color for fallback icon
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
                '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
            ];
            const colorIndex = token.address ? 
                parseInt(token.address.slice(-6), 16) % colors.length :
                Math.floor(Math.random() * colors.length);
            const backgroundColor = colors[colorIndex];
            
            tokenElement.innerHTML = `
                <div class="token-item-content">
                    <div class="token-item-left">
                        <div class="token-icon">
                            ${token.logoURI ? `
                                <img src="${token.logoURI}" 
                                    alt="${token.symbol}" 
                                    class="token-icon-image"
                                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                                <div class="token-icon-fallback" style="display:none;background:${backgroundColor}">
                                    ${token.symbol.charAt(0).toUpperCase()}
                                </div>` : `
                                <div class="token-icon-fallback" style="background:${backgroundColor}">
                                    ${token.symbol.charAt(0).toUpperCase()}
                                </div>`
                            }
                        </div>
                        <div class="token-item-info">
                            <div class="token-item-symbol">
                                ${token.symbol}
                            </div>
                            <div class="token-item-name">${token.name}</div>
                        </div>
                    </div>
                    <div class="token-item-right">
                        <div class="token-balance-with-usd">
                            <div class="token-balance-amount">${formattedBalance}</div>
                            <div class="token-balance-usd">${formattedUsdValue}</div>
                        </div>
                        <div class="token-item-actions">
                            <a href="${this.getExplorerUrl(token.address)}" 
                               target="_blank"
                               class="token-explorer-link"
                               onclick="event.stopPropagation();"
                               title="View on Explorer">
                                <svg class="token-explorer-icon" viewBox="0 0 24 24">
                                    <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>
            `;

            // Add click handler
            tokenElement.addEventListener('click', () => this.handleTokenItemClick(type, tokenElement));
            
            // Add to container
            container.appendChild(tokenElement);
        });
    }

    getExplorerUrl(address) {
        const networkConfig = getNetworkConfig();
        if (!networkConfig?.explorer) {
            console.warn('Explorer URL not configured');
            return '#';
        }
        return `${networkConfig.explorer}/address/${ethers.utils.getAddress(address)}`;
    }

    // Add helper method for token icons
    getTokenIcon(token) {
        if (token.iconUrl) {
            return `
                <div class="token-icon">
                    <img src="${token.iconUrl}" alt="${token.symbol}" class="token-icon-image">
                </div>
            `;
        }

        // Fallback to letter-based icon
        const symbol = token.symbol || '?';
        const firstLetter = symbol.charAt(0).toUpperCase();
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
            '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
        ];
        
        // Generate consistent color based on address
        const colorIndex = parseInt(token.address.slice(-6), 16) % colors.length;
        const backgroundColor = colors[colorIndex];
        
        return `
            <div class="token-icon">
                <div class="token-icon-fallback" style="background: ${backgroundColor}">
                    ${firstLetter}
                </div>
            </div>
        `;
    }

    cleanup() {
        // Only clear timers, keep table structure
        if (this.expiryTimers) {
            this.expiryTimers.forEach(timerId => clearInterval(timerId));
            this.expiryTimers.clear();
        }
    }

    // Add this method to the CreateOrder class
    showStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `status ${type}`;
        }
        this.debug(`Status update (${type}): ${message}`);
    }

    // Use toast system for error and success messages
    showError(message, duration = 0) {
        this.debug('Showing error toast:', message);
        if (window.showError) {
            return window.showError(message, duration);
        } else {
            // Fallback to status display if toast is not available
            this.showStatus(message, 'error');
        }
    }

    showSuccess(message, duration = 5000) {
        this.debug('Showing success toast:', message);
        if (window.showSuccess) {
            return window.showSuccess(message, duration);
        } else {
            // Fallback to status display if toast is not available
            this.showStatus(message, 'success');
        }
    }

    showWarning(message, duration = 5000) {
        this.debug('Showing warning toast:', message);
        if (window.showWarning) {
            return window.showWarning(message, duration);
        } else {
            // Fallback to status display if toast is not available
            this.showStatus(message, 'warning');
        }
    }

    showInfo(message, duration = 5000) {
        this.debug('Showing info toast:', message);
        if (window.showInfo) {
            return window.showInfo(message, duration);
        } else {
            // Fallback to status display if toast is not available
            this.showStatus(message, 'info');
        }
    }

    async getTokenDecimals(tokenAddress) {
        try {
            // Check if token is in cache
            const normalizedAddress = tokenAddress.toLowerCase();
            const cachedToken = this.tokenCache.get(normalizedAddress);
            
            if (cachedToken?.decimals) {
                this.debug(`Cache hit for decimals: ${tokenAddress}`);
                return cachedToken.decimals;
            }

            // If not in cache, fetch from contract
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function decimals() view returns (uint8)'],
                this.provider
            );
            
            const decimals = await tokenContract.decimals();
            this.debug(`Fetched decimals for token ${tokenAddress}: ${decimals}`);
            
            // Update cache
            if (cachedToken) {
                cachedToken.decimals = decimals;
                this.tokenCache.set(normalizedAddress, cachedToken);
            } else {
                this.tokenCache.set(normalizedAddress, { decimals });
            }
            
            return decimals;
        } catch (error) {
            this.debug(`Error getting token decimals: ${error.message}`);
            throw new Error(`Failed to get decimals for token ${tokenAddress}`);
        }
    }

    async checkAndApproveToken(tokenAddress, amount) {
        try {
            this.debug(`Checking allowance for token: ${tokenAddress}`);
            
            // Get signer and current address
            const signer = walletManager.getSigner();
            const currentAddress = await walletManager.getCurrentAddress();
            if (!signer || !currentAddress) {
                throw new Error('Wallet not connected');
            }

            // Calculate required amount, accounting for fee token if same as sell token
            let requiredAmount = ethers.BigNumber.from(amount);
            
            if (tokenAddress.toLowerCase() === this.feeToken?.address?.toLowerCase() &&
                tokenAddress.toLowerCase() === this.sellToken?.address?.toLowerCase()) {
                const sellAmountStr = document.getElementById('sellAmount')?.value;
                if (sellAmountStr) {
                    const tokenDecimals = await this.getTokenDecimals(tokenAddress);
                    const sellAmountWei = ethers.utils.parseUnits(sellAmountStr, tokenDecimals);
                    const feeAmountWei = ethers.BigNumber.from(this.feeToken.amount);
                    requiredAmount = sellAmountWei.add(feeAmountWei);
                    this.debug(`Combined amount for approval (sell + fee): ${requiredAmount.toString()}`);
                }
            }

            // Create token contract instance
            const tokenContract = new ethers.Contract(
                tokenAddress,
                [
                    'function allowance(address owner, address spender) view returns (uint256)',
                    'function approve(address spender, uint256 amount) returns (bool)'
                ],
                signer
            );

            // Get current allowance
            const currentAllowance = await tokenContract.allowance(
                currentAddress,
                this.contract.address
            );
            this.debug(`Current allowance: ${currentAllowance.toString()}`);
            this.debug(`Required amount: ${requiredAmount.toString()}`);

            // If allowance is insufficient, reset and approve new amount
            if (currentAllowance.lt(requiredAmount)) {
                if (!currentAllowance.isZero()) {
                    this.debug('Resetting existing allowance');
                    const resetTx = await tokenContract.approve(this.contract.address, 0);
                    await resetTx.wait();
                    this.debug('Allowance reset successful');
                }

                this.showInfo('Requesting token approval...');
                const approveTx = await tokenContract.approve(this.contract.address, requiredAmount);
                this.showInfo('Please confirm the approval in your wallet...');
                
                await approveTx.wait();
                this.showSuccess('Token approved successfully');

                const newAllowance = await tokenContract.allowance(currentAddress, this.contract.address);
                this.debug(`New allowance after approval: ${newAllowance.toString()}`);
            }

            return true;
        } catch (error) {
            this.debug('Token approval error:', error);
            const userMessage = this.getUserFriendlyError(error);
            this.showError(userMessage);
            return false;
        }
    }

    // Add new helper method for user-friendly error messages
    getUserFriendlyError(error) {
        // Check for common error codes and messages
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            return 'Transaction was declined';
        }
        
        // Handle contract revert errors with detailed messages
        if (error.code === -32603 && error.data?.message) {
            return error.data.message;
        }
        
        // Handle other specific error cases
        if (error.message?.includes('insufficient funds')) {
            return 'Insufficient funds for gas fees';
        }
        if (error.message?.includes('nonce')) {
            return 'Transaction error - please refresh and try again';
        }
        if (error.message?.includes('gas required exceeds allowance')) {
            return 'Transaction requires too much gas';
        }
        
        // Try to extract error from ethers error structure
        if (error.error?.data?.message) {
            return error.error.data.message;
        }
        
        // Default generic message
        return 'Transaction failed - please try again';
    }

    // Update the fee display in the UI
    updateFeeDisplay() {
        if (!this.feeToken?.amount || !this.feeToken?.symbol || !this.feeToken?.decimals) {
            this.debug('Fee token data not complete:', this.feeToken);
            return;
        }

        const feeDisplay = document.querySelector('.fee-amount');
        if (feeDisplay) {
            const formattedAmount = ethers.utils.formatUnits(this.feeToken.amount, this.feeToken.decimals);
            feeDisplay.textContent = `${formattedAmount} ${this.feeToken.symbol}`;
        }
    }

    handleTokenSelect(type, token) {
        try {
            this.debug(`Token selected for ${type}:`, token);
            
            // Clear USD display if no token is selected
            if (!token) {
                this[`${type}Token`] = null;
                const usdDisplay = document.getElementById(`${type}AmountUSD`);
                if (usdDisplay) {
                    usdDisplay.remove();
                }
                return;
            }
            
            // Get USD price from pricing service
            this.debug('Pricing service state:', {
                exists: !!window.pricingService,
                hasGetPrice: !!window.pricingService?.getPrice,
                tokenAddress: token.address
            });
            const usdPrice = window.pricingService?.getPrice(token.address) || 0;
            // Handle zero balance case
            const balance = parseFloat(token.balance) || 0;
            const balanceUSD = balance > 0 ? (balance * usdPrice).toFixed(2) : '0.00';
            const formattedBalance = balance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
                useGrouping: true
            });
            
            // Store token in the component
            this[`${type}Token`] = {
                address: token.address,
                symbol: token.symbol,
                decimals: token.decimals || 18,
                balance: token.balance || '0',
                logoURI: token.logoURI,
                usdPrice: usdPrice
            };

            // Generate background color for fallback icon
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
                '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
            ];
            const colorIndex = token.address ? 
                parseInt(token.address.slice(-6), 16) % colors.length :
                Math.floor(Math.random() * colors.length);
            const backgroundColor = colors[colorIndex];
            
            // Update the selector display
            const selector = document.getElementById(`${type}TokenSelector`);
            if (selector) {
                selector.innerHTML = `
                    <div class="token-selector-content">
                        <div class="token-selector-left">
                            <div class="token-icon small">
                                ${token.logoURI ? `
                                    <img src="${token.logoURI}" 
                                        alt="${token.symbol}" 
                                        class="token-icon-image"
                                        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                                    <div class="token-icon-fallback" style="display:none;background:${backgroundColor}">
                                        ${token.symbol.charAt(0).toUpperCase()}
                                    </div>` : `
                                    <div class="token-icon-fallback" style="background:${backgroundColor}">
                                        ${token.symbol.charAt(0).toUpperCase()}
                                    </div>`
                                }
                            </div>
                            <div class="token-info">
                                <span class="token-symbol">${token.symbol}</span>
                                <div class="token-balance-info">
                                    <div class="amount-container">
                                        <span class="token-balance">${formattedBalance}</span>
                                        <span class="token-balance-usd">$${balanceUSD}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
                        </svg>
                    </div>
                `;
            }

            // Update amount USD value immediately
            this.updateTokenAmounts(type);

            // Add input event listener for amount changes
            const amountInput = document.getElementById(`${type}Amount`);
            if (amountInput) {
                // Remove existing listeners
                const newInput = amountInput.cloneNode(true);
                amountInput.parentNode.replaceChild(newInput, amountInput);
                // Add new listener
                newInput.addEventListener('input', () => this.updateTokenAmounts(type));
            }
        } catch (error) {
            this.debug('Error in handleTokenSelect:', error);
            this.showError(`Failed to select ${type} token: ${error.message}`);
        }
    }

    async handleTokenItemClick(type, tokenItem) {
        try {
            const address = tokenItem.dataset.address;
            
            // Check if this is a not allowed token
            const isNotAllowedToken = tokenItem.classList.contains('token-not-allowed');
            
            if (isNotAllowedToken) {
                // Find the token in not allowed tokens
                const token = this.notAllowedTokens?.find(t => t.address.toLowerCase() === address.toLowerCase());
                if (token) {
                    this.showWarning(`${token.symbol} is not allowed for trading on this platform. You can view your balance but cannot use it for orders.`);
                }
                return; // Don't allow selection of not allowed tokens
            }
            
            // Handle allowed tokens
            const token = this.tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
            
            this.debug('Token item clicked:', {
                type,
                address,
                token,
                isNotAllowed: isNotAllowedToken
            });
            
            if (token) {
                // For sell tokens, check if balance is zero
                if (type === 'sell') {
                    const balance = Number(token.balance) || 0;
                    if (balance <= 0) {
                        this.showWarning(`${token.symbol} has no balance available for selling. Please select a token with a balance.`);
                        return; // Don't allow selection of tokens with zero balance for selling
                    }
                }
                
                // Validate that the token is allowed in the contract
                try {
                    const isAllowed = await contractService.isTokenAllowed(address);
                    
                    if (!isAllowed) {
                        this.showError(`Token ${token.symbol} is not allowed for trading. Please select an allowed token.`);
                        return;
                    }
                    
                    this.handleTokenSelect(type, token);
                    
                    // Close the modal after selection
                    const modal = document.getElementById(`${type}TokenModal`);
                    if (modal) {
                        modal.style.display = 'none';
                    }
                } catch (validationError) {
                    this.debug('Token validation error:', validationError);
                    this.showError('Unable to validate token. Please try again.');
                }
            }
        } catch (error) {
            this.debug('Error in handleTokenItemClick:', error);
            this.showError('Failed to select token');
        }
    }

    updateCreateButtonState() {
        try {
            const createButton = document.getElementById('createOrderButton');
            if (!createButton) return;

            // Check if we have both tokens selected and valid amounts
            const hasTokens = this.sellToken && this.buyToken;
            const sellAmount = document.getElementById('sellAmount')?.value;
            const buyAmount = document.getElementById('buyAmount')?.value;
            const hasAmounts = sellAmount && buyAmount && 
                             Number(sellAmount) > 0 && 
                             Number(buyAmount) > 0;

            // Enable button only if we have both tokens and valid amounts
            createButton.disabled = !(hasTokens && hasAmounts);
        } catch (error) {
            this.debug('Error updating create button state:', error);
        }
    }

    updateSellAmountMax() {
        try {
            if (!this.sellToken) return;
            
            const maxButton = document.getElementById('sellAmountMax');
            if (!maxButton) return;

            // Update max button visibility based on token balance
            if (this.sellToken.balance) {
                maxButton.style.display = 'inline';
                maxButton.onclick = () => {
                    const sellAmount = document.getElementById('sellAmount');
                    if (sellAmount) {
                        sellAmount.value = this.sellToken.balance;
                        this.updateTokenAmounts('sell');
                    }
                };
            } else {
                maxButton.style.display = 'none';
            }
        } catch (error) {
            this.debug('Error updating sell amount max:', error);
        }
    }

    updateTokenAmounts(type) {
        try {
            const amount = document.getElementById(`${type}Amount`)?.value || '0';
            const token = this[`${type}Token`];
            
            // Find USD display element
            let usdDisplay = document.getElementById(`${type}AmountUSD`);
            
            // If no token selected or amount is 0/empty, remove the USD display
            if (!token || !amount || amount === '0') {
                if (usdDisplay) {
                    usdDisplay.remove();
                }
                return;
            }
            
            if (token && amount) {
                const usdValue = Number(amount) * token.usdPrice;
                // Create USD display element if it doesn't exist
                if (!usdDisplay) {
                    usdDisplay = document.createElement('div');
                    usdDisplay.id = `${type}AmountUSD`;
                    usdDisplay.className = 'amount-usd';
                    const amountInput = document.getElementById(`${type}Amount`);
                    amountInput.parentNode.insertBefore(usdDisplay, amountInput.nextSibling);
                }
                usdDisplay.textContent = `$${usdValue.toFixed(2)}`;
            }
            
            this.updateCreateButtonState();
        } catch (error) {
            this.debug('Error updating token amounts:', error);
        }
    }

    initializeTokenSelectors() {
        ['sell', 'buy'].forEach(type => {
            const selector = document.getElementById(`${type}TokenSelector`);
            const modal = document.getElementById(`${type}TokenModal`);
            const closeButton = modal?.querySelector('.token-modal-close');
            
            if (selector && modal) {
                // Remove existing listener if any
                if (this.tokenSelectorListeners[type]) {
                    selector.removeEventListener('click', this.tokenSelectorListeners[type]);
                }

                // Create new listener for opening modal
                this.tokenSelectorListeners[type] = () => {
                    modal.style.display = 'block';
                };

                // Add new listener
                selector.addEventListener('click', this.tokenSelectorListeners[type]);

                // Add close button listener
                if (closeButton) {
                    closeButton.onclick = () => {
                        modal.style.display = 'none';
                    };
                }

                // Close modal when clicking outside
                window.addEventListener('click', (event) => {
                    if (event.target.classList.contains('token-modal')) {
                        event.target.style.display = 'none';
                    }
                });
            }
        });
    }

    renderTokenList(type, tokens) {
        const modalContent = document.querySelector(`#${type}TokenModal .token-list`);
        if (!modalContent) return;

        modalContent.innerHTML = tokens.map(token => {
            const usdPrice = window.pricingService?.getPrice(token.address) || 0;
            const balance = parseFloat(token.balance) || 0;
            const balanceUSD = balance > 0 ? (balance * usdPrice).toFixed(2) : '0.00';
            
            return `
                <div class="token-item" data-address="${token.address}">
                    <div class="token-item-left">
                        <div class="token-icon">
                            ${token.logoURI ? 
                                `<img src="${token.logoURI}" alt="${token.symbol}" class="token-icon-image">` :
                                `<div class="token-icon-fallback">${token.symbol.charAt(0)}</div>`
                            }
                        </div>
                        <div class="token-info">
                            <span class="token-symbol">${token.symbol}</span>
                            <span class="token-name">${token.name || ''}</span>
                        </div>
                    </div>
                    <div class="token-balance">
                        ${balance.toFixed(2)} ($${balanceUSD})
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers to token items
        modalContent.querySelectorAll('.token-item').forEach(item => {
            item.addEventListener('click', () => this.handleTokenItemClick(type, item));
        });
    }

    // Add this method to initialize amount input listeners
    initializeAmountInputs() {
        ['sell', 'buy'].forEach(type => {
            const amountInput = document.getElementById(`${type}Amount`);
            if (amountInput) {
                amountInput.addEventListener('input', () => this.updateTokenAmounts(type));
            }
        });
    }

    // Add new render method
    render() {
        return `
            <!-- Token swap form interface -->
            <div class="form-container card">
                <div class="swap-section">
                    <!-- Sell token input section -->
                    <div id="sellContainer" class="swap-input-container">
                        <div class="amount-input-wrapper">
                            <input type="number" id="sellAmount" placeholder="0.0" />
                            <button id="sellAmountMax" class="max-button">MAX</button>
                        </div>
                        <div class="amount-usd" id="sellAmountUSD">≈ $0.00</div>
                        <div id="sellTokenSelector" class="token-selector">
                            <div class="token-selector-content">
                                <span>Select Token</span>
                            </div>
                        </div>
                    </div>

                    <!-- Swap direction arrow -->
                    <div class="swap-arrow">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M12 5l0 14M5 12l7 7 7-7" stroke-width="2" stroke-linecap="round" />
                        </svg>
                    </div>

                    <!-- Buy token input section -->
                    <div id="buyContainer" class="swap-input-container">
                        <div class="amount-input-wrapper">
                            <input type="number" id="buyAmount" placeholder="0.0" />
                        </div>
                        <div class="amount-usd" id="buyAmountUSD">≈ $0.00</div>
                        <div id="buyTokenSelector" class="token-selector">
                            <div class="token-selector-content">
                                <span>Select Token</span>
                            </div>
                        </div>
                    </div>

                    <!-- Optional taker address input -->
                    <div class="taker-input-container">
                        <button class="taker-toggle">
                            <div class="taker-toggle-content">
                                <span class="taker-toggle-text">Specify Taker Address</span>
                                <span class="info-tooltip">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <circle cx="12" cy="12" r="10" stroke-width="2" />
                                        <path d="M12 16v-4" stroke-width="2" stroke-linecap="round" />
                                        <circle cx="12" cy="8" r="1" fill="currentColor" />
                                    </svg>
                                    <span class="tooltip-text">
                                        Specify a wallet address that can take this order.
                                        Leave empty to allow anyone to take it.
                                    </span>
                                </span>
                                <span class="optional-text">(optional)</span>
                            </div>
                            <svg class="chevron-down" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                        </button>
                        <div class="taker-input-content hidden">
                            <input type="text" id="takerAddress" class="taker-address-input" placeholder="0x..." />
                        </div>
                    </div>

                    <!-- Fee display section -->
                    <div class="form-group fee-group">
                        <label>
                            Order Creation Fee:
                            <span class="info-tooltip">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <circle cx="12" cy="12" r="10" stroke-width="2" />
                                    <path d="M12 16v-4" stroke-width="2" stroke-linecap="round" />
                                    <circle cx="12" cy="8" r="1" fill="currentColor" />
                                </svg>
                                <span class="tooltip-text">
                                    <strong>Order Creation Fee:</strong> A small fee in USDC is required to create an order. 
                                    This helps prevent spam and incentivizes users who assist in cleaning up expired orders.
                                </span>
                            </span>
                        </label>
                        <div id="orderCreationFee">
                            <span class="fee-amount"></span>
                        </div>
                    </div>

                    <!-- Create order button -->
                    <button class="action-button" id="createOrderBtn" disabled>
                        Connect Wallet to Create Order
                    </button>

                    <!-- Status messages -->
                    <div id="status" class="status"></div>
                </div>
            </div>
        `;
    }
}

