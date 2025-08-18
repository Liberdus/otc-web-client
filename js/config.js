import { abi as CONTRACT_ABI } from './abi/OTCSwap.js';
import { ethers } from 'ethers';
import { createLogger } from './services/LogService.js';

export const APP_BRAND = 'LiberdusOTC';
export const APP_LOGO = 'assets/1.png';

const networkConfig = {
    "137": {
        name: "Polygon",
        displayName: "Polygon Mainnet",
        isDefault: true,
        contractAddress: "0x2F786290BAe87D1e8c01A97e6529030bbCF9f147", // New contract with allowed tokens 08/15/25
        /* "0x34396a792510d6fb8ec0f70b68b8739456af06c6",  */// old 08/14/25
        /* "0x8F37e9b4980340b9DE777Baa4B9c5B2fc1BDc837", */ // old 08/13/25
        contractABI: CONTRACT_ABI,
        explorer: "https://polygonscan.com",
        rpcUrl: "https://polygon-rpc.com",
        fallbackRpcUrls: [
            "https://rpc-mainnet.matic.network",
            "https://polygon-bor.publicnode.com",
            "https://polygon.api.onfinality.io/public"
        ],
        chainId: "0x89",
        nativeCurrency: {
            name: "MATIC",
            symbol: "MATIC",
            decimals: 18
        },
        wsUrl: "wss://polygon.gateway.tenderly.co",
        fallbackWsUrls: [
            "wss://polygon-bor.publicnode.com",
            "wss://polygon-bor-rpc.publicnode.com",
            "wss://polygon.api.onfinality.io/public-ws"
        ]
    },
};


export const DEBUG_CONFIG = {
    APP: false,
    WEBSOCKET: false,
    WALLET: false,
    VIEW_ORDERS: false,
    CREATE_ORDER: false,
    MY_ORDERS: false,
    TAKER_ORDERS: false,
    CLEANUP_ORDERS: false,
    WALLET_UI: false,
    BASE_COMPONENT: false,
    PRICING: false,
    TOKENS: false,
    TOKEN_ICON_SERVICE: true, // Add token icon service debugging
    TOAST: true, // Enable toast debugging for testing
    // Add more specific flags as needed
};

// Token Icon Service Configuration
export const TOKEN_ICON_CONFIG = {
    // CoinGecko API configuration
    COINGECKO_API_BASE: 'https://api.coingecko.com/api/v3',
    COINGECKO_ICON_BASE: 'https://assets.coingecko.com/coins/images',
    
    // CoinGecko chain mapping
    CHAIN_ID_MAP: {
        '1': 'ethereum',
        '137': 'polygon-pos',
        '56': 'binance-smart-chain',
        '42161': 'arbitrum-one',
        '10': 'optimistic-ethereum',
        '43114': 'avalanche',
        '250': 'fantom',
        '25': 'cronos'
    },
    
    // Known token mappings for Polygon (expandable)
    KNOWN_TOKENS: {
        "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "usd-coin", // USDC
        "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "tether", // USDT
        "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": "weth", // WETH
        "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": "matic-network", // WMATIC
        "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": "wrapped-bitcoin", // WBTC
    },
    
    // Special cases
    SPECIAL_TOKENS: {
        "0x693ed886545970f0a3adf8c59af5ccdb6ddf0a76": "assets/32.png" // Liberdus
    },
    
    // Rate limiting configuration
    RATE_LIMIT_DELAY: 100, // ms between requests
    MAX_CACHE_SIZE: 1000, // Maximum number of cached icons
    CACHE_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours in ms
    
    // Icon validation configuration
    VALIDATION_TIMEOUT: 5000, // 5 seconds timeout for icon validation
    MAX_RETRIES: 3, // Maximum retries for failed icon requests
    
    // Fallback configuration
    ENABLE_FALLBACK_ICONS: true, // Enable color-based fallback icons
    FALLBACK_COLORS: [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
        '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
    ]
};

export const getAllNetworks = () => Object.values(networkConfig);

export const isDebugEnabled = (component) => {
    // Check if debug mode is forced via localStorage
    const localDebug = localStorage.getItem('debug');
    if (localDebug) {
        const debugSettings = JSON.parse(localDebug);
        return debugSettings[component] ?? DEBUG_CONFIG[component];
    }
    return DEBUG_CONFIG[component];
};

export const getDefaultNetwork = () => {
    // Find the first network marked as default
    const defaultNetwork = Object.values(networkConfig).find(net => net.isDefault);
    if (!defaultNetwork) {
        throw new Error('No default network configured');
    }
    return defaultNetwork;
};

export const getNetworkById = (chainId) => {
    // Convert hex chainId to decimal if needed
    const decimalChainId = chainId.startsWith('0x') 
        ? parseInt(chainId, 16).toString()
        : chainId.toString();
    
    return networkConfig[decimalChainId];
};

export const getNetworkConfig = (chainId = null) => {
    if (chainId) {
        const network = getNetworkById(chainId);
        if (!network) {
            throw new Error(`Network configuration not found for chain ID: ${chainId}`);
        }
        return network;
    }
    return getDefaultNetwork();
};

export class WalletManager {
    constructor() {
        // Initialize logger
        const logger = createLogger('WALLET');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);

        this.listeners = new Set();
        this.isConnecting = false;
        this.account = null;
        this.chainId = null;
        this.isConnected = false;
        this.onAccountChange = null;
        this.onChainChange = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.contractAddress = getDefaultNetwork().contractAddress;
        this.contractABI = getDefaultNetwork().contractABI;
        this.isInitialized = false;
        this.contractInitialized = false;
        
        // Add user preference tracking for disconnect state
        this.userDisconnected = false;
        this.STORAGE_KEY = 'wallet_user_disconnected';
    }

    async init() {
        try {
            this.debug('Starting initialization...');
            
            if (typeof window.ethereum === 'undefined') {
                this.debug('MetaMask is not installed, initializing in read-only mode');
                this.provider = null;
                this.isInitialized = true;
                return;
            }

            this.provider = new ethers.providers.Web3Provider(window.ethereum);
            
            // Set contract configuration
            const networkCfg = getNetworkConfig();
            this.contractAddress = networkCfg.contractAddress;
            this.contractABI = CONTRACT_ABI;
            
            this.debug('Provider initialized');
            this.debug('Contract config:', {
                address: this.contractAddress,
                hasABI: !!this.contractABI
            });

            // Setup event listeners
            window.ethereum.on('accountsChanged', this.handleAccountsChanged.bind(this));
            window.ethereum.on('chainChanged', this.handleChainChanged.bind(this));
            window.ethereum.on('connect', this.handleConnect.bind(this));
            window.ethereum.on('disconnect', this.handleDisconnect.bind(this));

            // Check user disconnect preference before auto-connecting
            this.loadUserDisconnectPreference();
            
            // Only auto-connect if user hasn't manually disconnected
            if (!this.userDisconnected) {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    this.debug('Auto-connecting to existing MetaMask session');
                    await this.initializeSigner(accounts[0]);
                    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                    this.handleChainChanged(chainId);
                }
            } else {
                this.debug('User has manually disconnected, skipping auto-connect');
            }

            this.isInitialized = true;
            this.debug('Initialization complete');
        } catch (error) {
            console.error("[WalletManager] Error in init:", error);
            throw error;
        }
    }

    async checkConnection() {
        try {
            if (!this.provider) {
                return false;
            }
            const accounts = await this.provider.listAccounts();
            return accounts.length > 0;
        } catch (error) {
            console.error('[WalletManager] Connection check failed:', error);
            return false;
        }
    }

    async initializeSigner(account) {
        try {
            if (!this.provider) {
                throw new Error('No provider available');
            }
            this.signer = this.provider.getSigner();
            await this.initializeContract();
            return this.signer;
        } catch (error) {
            console.error('[WalletManager] Error initializing signer:', error);
            throw error;
        }
    }

    async initializeContract() {
        if (this.contractInitialized) {
            this.debug('Contract already initialized, skipping...');
            return this.contract;
        }

        try {
            const networkConfig = getNetworkConfig();
            this.contract = new ethers.Contract(
                networkConfig.contractAddress,
                CONTRACT_ABI,
                this.signer
            );
            
            this.debug('Contract initialized with ABI:', 
                this.contract.interface.format());
            this.contractInitialized = true;
            return this.contract;
        } catch (error) {
            console.error('[WalletManager] Error initializing contract:', error);
            throw error;
        }
    }

    async connect() {
        if (this.isConnecting) {
            console.log('[WalletManager] Connection already in progress');
            return null;
        }

        if (!this.provider) {
            throw new Error('MetaMask is not installed');
        }

        this.isConnecting = true;
        try {
            this.debug('Requesting accounts...');
            const accounts = await window.ethereum.request({ 
                method: 'eth_requestAccounts' 
            });
            
            this.debug('Accounts received:', accounts);
            
            const chainId = await window.ethereum.request({ 
                method: 'eth_chainId' 
            });
            this.debug('Chain ID:', chainId);

            const decimalChainId = parseInt(chainId, 16).toString();
            this.debug('Decimal Chain ID:', decimalChainId);
            
            if (decimalChainId !== "137") {
                await this.switchToDefaultNetwork();
            }

            this.account = accounts[0];
            this.chainId = chainId;
            this.isConnected = true;

            // Clear user disconnect preference when they manually connect
            this.saveUserDisconnectPreference(false);

            // Initialize signer before notifying listeners
            await this.initializeSigner(this.account);

            this.debug('Notifying listeners of connection');
            this.notifyListeners('connect', {
                account: this.account,
                chainId: this.chainId
            });

            return {
                account: this.account,
                chainId: this.chainId
            };
        } catch (error) {
            this.debug('Connection error:', error);
            throw error;
        } finally {
            this.isConnecting = false;
        }
    }

    async switchToDefaultNetwork() {
        const targetNetwork = getDefaultNetwork();
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: targetNetwork.chainId }],
            });
        } catch (error) {
            if (error.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: targetNetwork.chainId,
                        chainName: targetNetwork.name,
                        nativeCurrency: targetNetwork.nativeCurrency,
                        rpcUrls: [targetNetwork.rpcUrl, ...targetNetwork.fallbackRpcUrls],
                        blockExplorerUrls: [targetNetwork.explorer]
                    }],
                });
            } else {
                throw error;
            }
        }
    }

    async handleAccountsChanged(accounts) {
        this.debug('Accounts changed:', accounts);
        if (accounts.length === 0) {
            this.account = null;
            this.isConnected = false;
            this.signer = null;
            this.contract = null;
            this.contractInitialized = false;
            this.debug('No accounts, triggering disconnect');
            this.notifyListeners('disconnect', {});
        } else if (accounts[0] !== this.account) {
            this.account = accounts[0];
            this.isConnected = true;
            try {
                await this.initializeSigner(this.account);
            } catch (e) {
                this.error('Error reinitializing signer on account change:', e);
            }
            this.debug('New account:', this.account);
            this.notifyListeners('accountsChanged', { account: this.account });
        }
    }

    handleChainChanged(chainId) {
        this.chainId = chainId;
        this.notifyListeners('chainChanged', { chainId });
        if (this.onChainChange) {
            this.onChainChange(chainId);
        }
        
        const network = getNetworkById(chainId);
        if (!network?.isDefault) {
            this.switchToDefaultNetwork();
        }
    }

    handleConnect(connectInfo) {
        if (this.onConnect) {
            this.onConnect(connectInfo);
        }
    }

    handleDisconnect(error) {
        this.isConnected = false;
        if (this.onDisconnect) {
            this.onDisconnect(error);
        }
    }

    // Utility methods
    getAccount() {
        return this.account;
    }

    isWalletConnected() {
        if (!this.provider) {
            return false;
        }
        return this.isConnected;
    }

    disconnect() {
        this.debug('User manually disconnecting wallet');
        
        // Save user's disconnect preference
        this.saveUserDisconnectPreference(true);
        
        // Clear connection state
        this.account = null;
        this.chainId = null;
        this.isConnected = false;
        this.signer = null;
        this.contract = null;
        this.contractInitialized = false;
        
        // Notify listeners of disconnect
        this.notifyListeners('disconnect', {});
        
        if (this.onDisconnect) {
            this.onDisconnect();
        }
        
        this.debug('Wallet disconnected and preference saved');
    }

    addListener(callback) {
        this.listeners.add(callback);
    }

    removeListener(callback) {
        this.listeners.delete(callback);
    }

    notifyListeners(event, data) {
        this.listeners.forEach(callback => callback(event, data));
    }

    // Add getter methods
    getSigner() {
        if (!this.provider) {
            return null;
        }
        return this.signer;
    }

    getContract() {
        if (!this.provider) {
            return null;
        }
        return this.contract;
    }

    getProvider() {
        return this.provider;
    }

    async initializeProvider() {
        try {
            const config = getNetworkConfig();
            let provider;
            let error;

            // Try main RPC URL first
            try {
                provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
                await provider.getNetwork();
                return provider;
            } catch (e) {
                error = e;
            }

            // Try fallback URLs
            for (const rpcUrl of config.fallbackRpcUrls) {
                try {
                    provider = new ethers.providers.JsonRpcProvider(rpcUrl);
                    await provider.getNetwork();
                    return provider;
                } catch (e) {
                    error = e;
                }
            }

            throw error;
        } catch (error) {
            console.error('[WalletManager] Error initializing provider:', error);
            throw error;
        }
    }

    // Add method to check initialization status
    isWalletInitialized() {
        return this.isInitialized;
    }

    // Add method to get contract configuration
    getContractConfig() {
        return {
            address: this.contractAddress,
            abi: this.contractABI
        };
    }

    getFallbackProviders() {
        const config = getNetworkConfig();
        return config.fallbackRpcUrls.map(url => 
            new ethers.providers.JsonRpcProvider(url)
        );
    }

    // Add this new method
    async getCurrentAddress() {
        if (!this.signer) {
            throw new Error('No signer available');
        }
        return await this.signer.getAddress();
    }

    isConnected() {
        return this.account !== null && this.chainId !== null;
    }

    loadUserDisconnectPreference() {
        const disconnected = localStorage.getItem(this.STORAGE_KEY);
        if (disconnected === 'true') {
            this.userDisconnected = true;
            this.debug('User has manually disconnected from MetaMask.');
        } else {
            this.userDisconnected = false;
            this.debug('User has not manually disconnected from MetaMask.');
        }
    }

    saveUserDisconnectPreference(disconnected) {
        localStorage.setItem(this.STORAGE_KEY, disconnected);
        this.userDisconnected = disconnected;
        this.debug(`User disconnect preference saved: ${disconnected}`);
    }

    /**
     * Check if the user has manually disconnected
     * @returns {boolean} True if user has manually disconnected
     */
    hasUserDisconnected() {
        return this.userDisconnected;
    }

    /**
     * Clear the user's disconnect preference (useful for testing or admin actions)
     */
    clearDisconnectPreference() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.userDisconnected = false;
        this.debug('User disconnect preference cleared');
    }
}

export const walletManager = new WalletManager();
