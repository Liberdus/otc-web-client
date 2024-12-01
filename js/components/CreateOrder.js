import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { getNetworkConfig, isDebugEnabled } from '../config.js';
import { erc20Abi } from '../abi/erc20.js';
import { getTokenList } from '../utils/tokens.js';

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
            
            // Setup UI immediately
            this.populateTokenDropdowns();
            this.setupTokenInputListeners();
            this.setupCreateOrderListener();
            
            // Load data asynchronously
            Promise.all([
                this.loadOrderCreationFee(),
                this.loadTokens()
            ]).catch(error => {
                console.error('[CreateOrder] Error loading data:', error);
            });
            
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

            const tokenDetails = await this.getTokenDetails([tokenAddress]);
            if (tokenDetails && tokenDetails[0]?.symbol) {
                const balanceElement = document.getElementById(elementId);
                const formattedBalance = parseFloat(tokenDetails[0].formattedBalance).toFixed(4);
                balanceElement.innerHTML = `
                    <div class="balance-with-icon">
                        <div class="token-icon small">
                            ${this.getTokenIcon(tokenDetails[0])}
                        </div>
                        <span>Balance: ${formattedBalance} ${tokenDetails[0].symbol}</span>
                    </div>
                `;
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

            // Get token contracts with full ERC20 ABI for better interaction
            const sellTokenContract = new ethers.Contract(
                sellToken,
                erc20Abi, // Use full ERC20 ABI
                this.provider
            );
            const buyTokenContract = new ethers.Contract(
                buyToken,
                erc20Abi, // Use full ERC20 ABI
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

            // Check balance first
            const signer = await this.getSigner();
            const signerAddress = await signer.getAddress();
            const balance = await sellTokenContract.balanceOf(signerAddress);
            
            this.debug('Balance check:', {
                balance: balance.toString(),
                required: sellAmountWei.toString(),
                decimals: sellDecimals
            });

            if (balance.lt(sellAmountWei)) {
                throw new Error(
                    `Insufficient token balance. Have ${ethers.utils.formatUnits(balance, sellDecimals)}, ` +
                    `need ${ethers.utils.formatUnits(sellAmountWei, sellDecimals)}`
                );
            }

            // Check and request token approval if needed
            const allowance = await sellTokenContract.allowance(signerAddress, this.contract.address);
            this.debug('Current allowance:', allowance.toString());

            if (allowance.lt(sellAmountWei)) {
                this.showSuccess('Requesting token approval...');
                
                try {
                    // Skip gas estimation and use standard parameters
                    const approveTx = await sellTokenContract.connect(signer).approve(
                        this.contract.address,
                        sellAmountWei,
                        {
                            gasLimit: 70000,  // Standard gas limit for ERC20 approvals
                            gasPrice: await this.provider.getGasPrice()
                        }
                    );
                    
                    this.debug('Approval transaction sent:', approveTx.hash);
                    await approveTx.wait();
                    this.showSuccess('Token approval granted');
                } catch (error) {
                    // Check if the error is due to user rejection
                    if (error.code === 4001) { // MetaMask user rejected
                        this.showError('Token approval was rejected');
                        throw new Error('Token approval rejected by user');
                    }
                    
                    // If it's a revert with specific error code
                    if (error?.error?.data?.data === '0xe602df050000000000000000000000000000000000000000000000000000000000000000') {
                        this.debug('Known contract error during approval:', error);
                        throw new Error('Token approval failed - contract rejected the transaction');
                    }
                    
                    this.debug('Approval failed:', error);
                    throw new Error('Token approval failed. Please try again.');
                }
            }

            // Get the order creation fee
            const fee = await this.contract.orderCreationFee();

            // Estimate gas for createOrder with fallback
            let createOrderGasLimit;
            try {
                const createOrderGasEstimate = await this.contract.estimateGas.createOrder(
                    partner || ethers.constants.AddressZero,
                    sellToken,
                    sellAmountWei,
                    buyToken,
                    buyAmountWei,
                    { value: fee }
                );
                this.debug('Create order gas estimate:', createOrderGasEstimate.toString());
                createOrderGasLimit = Math.floor(createOrderGasEstimate.toNumber() * 1.2); // 20% buffer
            } catch (error) {
                this.debug('Gas estimation failed for create order, using default:', error);
                createOrderGasLimit = 300000; // Default gas limit for order creation
            }

            this.debug('Sending create order transaction with params:', {
                taker: partner || ethers.constants.AddressZero,
                sellToken,
                sellAmount: sellAmountWei.toString(),
                buyToken,
                buyAmount: buyAmountWei.toString(),
                fee: fee.toString(),
                gasLimit: createOrderGasLimit,
                gasPrice: (await this.provider.getGasPrice()).toString()
            });

            const tx = await this.contract.createOrder(
                partner || ethers.constants.AddressZero,
                sellToken,
                sellAmountWei,
                buyToken,
                buyAmountWei,
                {
                    value: fee,
                    gasLimit: createOrderGasLimit,
                    gasPrice: await this.provider.getGasPrice()
                }
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
            this.debug('Create order error details:', {
                message: error.message,
                code: error.code,
                data: error?.error?.data,
                reason: error?.reason,
                stack: error.stack,
                transactionHash: error?.transaction?.hash
            });
            
            // Check for specific revert code 0xe602df05
            if (error?.error?.data?.data === '0xe602df050000000000000000000000000000000000000000000000000000000000000000') {
                try {
                    // Try to decode the error using contract interface
                    const decodedError = this.contract.interface.parseError(error.error.data.data);
                    this.debug('Decoded contract error:', decodedError);
                    
                    // If transaction actually succeeded despite the error
                    if (error?.transaction?.hash) {
                        const receipt = await this.provider.getTransactionReceipt(error.transaction.hash);
                        if (receipt && receipt.status === 1) {
                            this.showSuccess('Order created successfully despite RPC error');
                            this.resetForm();
                            return;
                        }
                    }
                    
                    // If we get here, it's a real error
                    this.showError(`Contract error: ${decodedError.name}`);
                } catch (decodeError) {
                    this.debug('Failed to decode contract error:', decodeError);
                    this.showError('Failed to create order: Contract reverted');
                }
                return;
            }

            let errorMessage = 'Failed to create order: ';
            
            // Try to decode the error
            if (error?.error?.data) {
                try {
                    const decodedError = this.contract.interface.parseError(error.error.data);
                    errorMessage += `${decodedError.name}: ${decodedError.args}`;
                    this.debug('Decoded error:', decodedError);
                } catch (e) {
                    // If we can't decode the error, fall back to basic messages
                    errorMessage += this.getReadableError(error);
                }
            } else {
                errorMessage += this.getReadableError(error);
            }
            
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
        // Clear all input fields
        ['partner', 'sellToken', 'sellAmount', 'buyToken', 'buyAmount'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        
        // Clear balance displays
        ['sellTokenBalance', 'buyTokenBalance'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = '';
        });
    }

    async loadTokens() {
        try {
            this.tokens = await getTokenList();
            // Update the modal content after tokens are loaded
            ['sell', 'buy'].forEach(type => {
                const modal = document.getElementById(`${type}TokenModal`);
                if (modal) {
                    const tokenList = modal.querySelector('.token-list');
                    if (tokenList) {
                        if (this.tokens.length === 0) {
                            tokenList.innerHTML = `
                                <div class="token-list-empty">
                                    No tokens found in wallet
                                </div>
                            `;
                        } else {
                            tokenList.innerHTML = this.tokens.map(token => `
                                <div class="token-item" data-address="${token.address}">
                                    <div class="token-item-left">
                                        <div class="token-icon">
                                            ${this.getTokenIcon(token)}
                                        </div>
                                        <div class="token-item-info">
                                            <div class="token-item-symbol">${token.symbol}</div>
                                            <div class="token-item-name">
                                                ${token.name}
                                                <a href="${this.getExplorerUrl(token.address)}" 
                                                   class="token-explorer-link"
                                                   target="_blank"
                                                   title="View contract on explorer">
                                                    <svg class="token-explorer-icon" viewBox="0 0 24 24">
                                                        <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
                                                    </svg>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                    ${token.balance ? `
                                        <div class="token-item-balance">
                                            ${Number(token.balance).toFixed(2)}
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('');
                            
                            // Reattach event listeners to new token items
                            tokenList.querySelectorAll('.token-item').forEach(item => {
                                item.addEventListener('click', () => {
                                    const address = item.dataset.address;
                                    const input = document.getElementById(`${type}Token`);
                                    input.value = address;
                                    this.updateTokenBalance(address, `${type}TokenBalance`);
                                    modal.classList.remove('show');
                                });
                            });
                        }
                    }
                }
            });
        } catch (error) {
            console.error('[CreateOrder] Error loading tokens:', error);
            ['sell', 'buy'].forEach(type => {
                const modal = document.getElementById(`${type}TokenModal`);
                if (modal) {
                    const tokenList = modal.querySelector('.token-list');
                    if (tokenList) {
                        tokenList.innerHTML = `
                            <div class="token-list-error">
                                Error loading tokens. Please try again.
                            </div>
                        `;
                    }
                }
            });
        }
    }

    populateTokenDropdowns() {
        ['sell', 'buy'].forEach(type => {
            const currentInput = document.getElementById(`${type}Token`);
            
            // Check if already initialized
            if (currentInput.parentElement.classList.contains('token-input-container')) {
                return; // Skip if already set up
            }
            
            // Create container
            const container = document.createElement('div');
            container.className = 'token-input-container';
            
            // Create input
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `${type}Token`;
            input.className = 'token-input';
            input.placeholder = 'Enter token address (0x...)';
            
            // Create token select button
            const selectButton = document.createElement('button');
            selectButton.className = 'token-select-button';
            selectButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M12 3v18M3 12h18" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
            selectButton.title = 'Select known token';
            
            // Create modal (only if it doesn't exist)
            if (!document.getElementById(`${type}TokenModal`)) {
                const modal = this.createTokenModal(type);
                document.body.appendChild(modal);
            }
            
            // Add event listeners
            selectButton.addEventListener('click', () => {
                const modal = document.getElementById(`${type}TokenModal`);
                modal.classList.add('show');
            });
            
            input.addEventListener('input', (e) => {
                if (ethers.utils.isAddress(e.target.value)) {
                    this.updateTokenBalance(e.target.value, `${type}TokenBalance`);
                }
            });
            
            input.addEventListener('change', (e) => {
                if (ethers.utils.isAddress(e.target.value)) {
                    const tooltip = document.createElement('div');
                    tooltip.className = 'token-address-tooltip';
                    tooltip.innerHTML = `
                        Verify token at: 
                        <a href="${this.getExplorerUrl(e.target.value)}" 
                           target="_blank"
                           style="color: #fff; text-decoration: underline;">
                           ${e.target.value.slice(0, 6)}...${e.target.value.slice(-4)}
                        </a>
                    `;
                    container.appendChild(tooltip);
                }
            });
            
            // Replace existing input
            container.appendChild(input);
            container.appendChild(selectButton);
            currentInput.parentNode.replaceChild(container, currentInput);
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
                <div class="token-list">
                    <div class="token-list-loading">
                        <div class="spinner"></div>
                        <div>Loading tokens...</div>
                    </div>
                </div>
            </div>
        `;
        
        // Add event listeners
        modal.querySelector('.token-modal-close').addEventListener('click', () => {
            modal.classList.remove('show');
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
        
        return modal;
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
        const symbol = token.symbol || '?';
        const firstLetter = symbol.charAt(0).toUpperCase();
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
            '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
        ];
        
        // Generate consistent color based on address
        const colorIndex = parseInt(token.address.slice(-6), 16) % colors.length;
        const backgroundColor = colors[colorIndex];
        
        if (token.iconUrl) {
            return `
                <div class="token-icon" style="background: ${backgroundColor}">
                    <img src="${token.iconUrl}" 
                         alt="${symbol}"
                         onerror="this.parentElement.innerHTML='<div class=\'token-icon-fallback\' style=\'background: ${backgroundColor}\'>${firstLetter}</div>'">
                </div>
            `;
        }
        
        return `
            <div class="token-icon">
                <div class="token-icon-fallback" style="background: ${backgroundColor}">
                    ${firstLetter}
                </div>
            </div>
        `;
    }
}

