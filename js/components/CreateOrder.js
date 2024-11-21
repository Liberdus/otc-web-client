import { BaseComponent } from './BaseComponent.js';
import { ethers } from 'ethers';

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
            console.log('[CreateOrder] Raw fee received:', fee?.toString());
            
            if (!fee || fee.toString() === '0') {
                console.warn('[CreateOrder] Warning: Fee returned as zero or undefined');
                document.getElementById('orderCreationFee').textContent = 'Fee unavailable';
                return;
            }
            
            const formattedFee = ethers.utils.formatEther(fee);
            console.log('[CreateOrder] Formatted fee:', formattedFee);
            
            const displayFee = parseFloat(formattedFee) < 0.000001 
                ? parseFloat(formattedFee).toExponential(6) 
                : parseFloat(formattedFee).toFixed(6).replace(/\.?0+$/, '');
            
            console.log('[CreateOrder] Setting display fee:', displayFee);
            document.getElementById('orderCreationFee').textContent = `${displayFee} POL`;
        } catch (error) {
            console.error('[CreateOrder] Error in loadOrderCreationFee:', error);
            document.getElementById('orderCreationFee').textContent = 'Error loading fee';
        }
    }

    setupEventListeners() {
        document.getElementById('sellToken').addEventListener('change', 
            () => this.updateTokenBalance('sell'));
        document.getElementById('buyToken').addEventListener('change', 
            () => this.updateTokenBalance('buy'));
        document.getElementById('createOrderBtn').addEventListener('click', 
            () => this.createOrder());
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

    async createOrder() {
        try {
            const contract = await this.getContract();
            if (!contract) {
                throw new Error('Contract not initialized');
            }

            // Get input values
            const partner = document.getElementById('partner').value.trim();
            const sellToken = document.getElementById('sellToken').value.trim();
            const buyToken = document.getElementById('buyToken').value.trim();
            const sellAmount = document.getElementById('sellAmount').value.trim();
            const buyAmount = document.getElementById('buyAmount').value.trim();

            // Validate inputs
            if (!sellToken || !ethers.utils.isAddress(sellToken)) {
                this.showError('Please enter a valid sell token address');
                return;
            }

            if (!buyToken || !ethers.utils.isAddress(buyToken)) {
                this.showError('Please enter a valid buy token address');
                return;
            }

            if (!sellAmount || isNaN(sellAmount) || parseFloat(sellAmount) <= 0) {
                this.showError('Please enter a valid sell amount');
                return;
            }

            if (!buyAmount || isNaN(buyAmount) || parseFloat(buyAmount) <= 0) {
                this.showError('Please enter a valid buy amount');
                return;
            }

            if (partner && !ethers.utils.isAddress(partner)) {
                this.showError('Please enter a valid partner address or leave empty');
                return;
            }

            // Get token decimals and convert amounts to Wei
            let sellAmountWei, buyAmountWei;
            try {
                const sellTokenContract = new ethers.Contract(
                    sellToken,
                    ['function decimals() view returns (uint8)'],
                    await this.getSigner()
                );
                const buyTokenContract = new ethers.Contract(
                    buyToken,
                    ['function decimals() view returns (uint8)'],
                    await this.getSigner()
                );

                const [sellDecimals, buyDecimals] = await Promise.all([
                    sellTokenContract.decimals(),
                    buyTokenContract.decimals()
                ]);

                sellAmountWei = ethers.utils.parseUnits(sellAmount, sellDecimals);
                buyAmountWei = ethers.utils.parseUnits(buyAmount, buyDecimals);
            } catch (error) {
                console.error('[CreateOrder] Error getting token decimals:', error);
                this.showError('Error processing token amounts. Please check the token addresses.');
                return;
            }

            // Create ERC20 interface for the sell token
            const erc20Interface = new ethers.utils.Interface([
                "function name() public view returns (string)",
                "function symbol() public view returns (string)",
                "function decimals() public view returns (uint8)",
                "function totalSupply() public view returns (uint256)",
                "function balanceOf(address account) public view returns (uint256)",
                "function transfer(address to, uint256 amount) public returns (bool)",
                "function allowance(address owner, address spender) public view returns (uint256)",
                "function approve(address spender, uint256 amount) public returns (bool)",
                "function transferFrom(address from, address to, uint256 amount) public returns (bool)",
                "event Transfer(address indexed from, address indexed to, uint256 value)",
                "event Approval(address indexed owner, address indexed spender, uint256 value)"
            ]);

            // Create contract instance for the sell token
            const sellTokenContract = new ethers.Contract(
                sellToken,
                erc20Interface,
                await this.getSigner()
            );

            console.log('[CreateOrder] Starting approval process...');
            try {
                // Log token addresses and contract details
                console.log('[CreateOrder] Token contract address:', sellToken);
                console.log('[CreateOrder] Contract address:', contract.address);
                
                // Verify token contract first
                const code = await this.getSigner().provider.getCode(sellToken);
                console.log('[CreateOrder] Token contract bytecode:', code);
                
                if (code === '0x' || code === '0x0') {
                    throw new Error('Invalid token contract address');
                }

                // Log signer details
                const signerAddress = await this.getSigner().getAddress();
                console.log('[CreateOrder] Signer address:', signerAddress);

                // Add delay before allowance check
                console.log('[CreateOrder] Waiting before allowance check...');
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Log allowance check parameters
                console.log('[CreateOrder] Checking allowance with params:', {
                    owner: signerAddress,
                    spender: contract.address,
                    sellAmount: sellAmountWei.toString()
                });

                const currentAllowance = await this.retryContractCall(async () => {
                    const allowance = await sellTokenContract.allowance(
                        signerAddress,
                        contract.address
                    );
                    console.log('[CreateOrder] Raw allowance response:', allowance);
                    return allowance;
                }, 3);

                console.log('[CreateOrder] Current allowance:', currentAllowance.toString());
                console.log('[CreateOrder] Required amount:', sellAmountWei.toString());

                if (currentAllowance.lt(sellAmountWei)) {
                    console.log('[CreateOrder] Insufficient allowance, requesting approval...');
                    this.showStatus('Requesting token approval...');
                    
                    // Log approval transaction parameters
                    console.log('[CreateOrder] Approval params:', {
                        spender: contract.address,
                        amount: sellAmountWei.toString(),
                        from: signerAddress,
                        gasLimit: 100000
                    });

                    const approveTx = await sellTokenContract.approve(
                        contract.address,
                        sellAmountWei,
                        {
                            from: signerAddress,
                            gasLimit: 100000
                        }
                    );
                    
                    console.log('[CreateOrder] Approval transaction created:', approveTx);
                    console.log('[CreateOrder] Approval transaction hash:', approveTx.hash);
                    
                    this.showStatus('Confirming approval...');
                    const receipt = await approveTx.wait(1);
                    console.log('[CreateOrder] Approval receipt:', receipt);
                    
                } else {
                    console.log('[CreateOrder] Sufficient allowance exists');
                }
            } catch (error) {
                console.error('[CreateOrder] Approval error details:', {
                    message: error.message,
                    code: error.code,
                    data: error.data,
                    transaction: error.transaction,
                    receipt: error.receipt
                });
                
                if (error.message.includes('Invalid token contract')) {
                    this.showError('Invalid token contract address. Please verify the address.');
                } else {
                    this.showError('Failed to approve token transfer. Please try again.');
                }
                throw error;
            }

            // Get the order creation fee
            const fee = await contract.orderCreationFee();
            console.log('[CreateOrder] Order creation fee:', ethers.utils.formatEther(fee));

            // Calculate min and max acceptable fees
            const minFee = fee.mul(90).div(100);  // 90% of fee
            const maxFee = fee.mul(150).div(100); // 150% of fee

            console.log('[CreateOrder] Min fee:', ethers.utils.formatEther(minFee));
            console.log('[CreateOrder] Max fee:', ethers.utils.formatEther(maxFee));
            console.log('[CreateOrder] Sending fee:', ethers.utils.formatEther(fee));

            // Add the fee to transaction options
            const txOptions = {
                value: fee,
                gasLimit: 500000  // Add explicit gas limit
            };

            // Add this before the transaction
            console.log('[CreateOrder] Transaction params:', {
                partner: partner || ethers.constants.AddressZero,
                sellToken,
                sellAmount: sellAmountWei.toString(),
                buyToken,
                buyAmount: buyAmountWei.toString(),
                fee: fee.toString(),
                minFee: minFee.toString(),
                maxFee: maxFee.toString()
            });

            // Proceed with actual transaction
            const transaction = await contract.createOrder(
                partner || ethers.constants.AddressZero,
                sellToken,
                sellAmountWei,
                buyToken,
                buyAmountWei,
                txOptions
            );

            console.log('[CreateOrder] Transaction sent:', transaction.hash);
            const receipt = await transaction.wait();
            console.log('[CreateOrder] Transaction confirmed:', receipt);

            this.showStatus(`Transaction sent: ${transaction.hash}`);
            this.showStatus('Order created successfully!');

        } catch (error) {
            // Enhanced error handling
            const errorDetails = {
                code: error.code,
                message: error.message,
                data: error.error?.data || error.data,
                reason: error.reason,
                transaction: error.transaction,
                receipt: error.receipt
            };
            
            console.error('[CreateOrder] Transaction failed:', errorDetails);

            let userMessage = 'Transaction failed. ';
            if (error.code === -32603) {
                userMessage += 'Network is experiencing issues. Please try again later.';
            } else if (error.code === 'CALL_EXCEPTION') {
                userMessage += 'Contract rejected the transaction. Please check your inputs.';
            } else {
                userMessage += error.message;
            }
            
            this.showError(userMessage);
        }
    }
}

