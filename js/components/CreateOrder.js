import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';

export class CreateOrder extends BaseComponent {
    constructor() {
        super('create-order');
        this.contract = null;
        this.provider = null;
        this.initialized = false;
    }

    async initializeContract() {
        try {
            console.log('[CreateOrder] Initializing contract...');
            const networkConfig = getNetworkConfig();
            
            // Debug log to check network config
            console.log('[CreateOrder] Network config:', {
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
            
            console.log('[CreateOrder] Contract initialized successfully');
            return this.contract;
        } catch (error) {
            console.error('[CreateOrder] Contract initialization error:', error);
            throw error;
        }
    }

    async initialize(readOnlyMode = true) {
        if (this.initialized) return;
        try {
            console.log('[CreateOrder] Starting initialization...');
            
            if (readOnlyMode) {
                this.setReadOnlyMode();
                return;
            }

            // Enable form when wallet is connected
            this.setConnectedMode();
            
            // Initialize contract and load fee
            await this.initializeContract();
            await this.loadOrderCreationFee();
            
            // Setup token balance listeners
            this.setupTokenInputListeners();
            
            console.log('[CreateOrder] Initialization complete');
            this.initialized = true;
        } catch (error) {
            console.error('[CreateOrder] Error in initialization:', error);
            const orderCreationFee = document.getElementById('orderCreationFee');
            if (orderCreationFee) {
                orderCreationFee.textContent = 'Error loading fee';
            }
        }
    }

    async loadOrderCreationFee() {
        try {
            console.log('[CreateOrder] Loading order creation fee...');
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }
            const fee = await this.contract.orderCreationFee();
            const feeInEth = ethers.utils.formatEther(fee);
            const orderCreationFee = document.getElementById('orderCreationFee');
            if (orderCreationFee) {
                orderCreationFee.textContent = `${feeInEth} MATIC`;
                orderCreationFee.classList.remove('placeholder-text');
            }
            console.log('[CreateOrder] Fee loaded:', feeInEth);
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

            const tokenDetails = await this.getTokenDetails(tokenAddress, true);
            if (tokenDetails) {
                const balanceElement = document.getElementById(elementId);
                balanceElement.textContent = `Balance: ${Number(tokenDetails.formattedBalance).toFixed(4)} ${tokenDetails.symbol}`;
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
}

