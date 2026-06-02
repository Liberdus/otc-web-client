import { abi as CONTRACT_ABI } from './abi/OTCSwap.js';
import { ethers } from 'ethers';
import { createLogger } from './services/LogService.js';
import { createWalletCore } from '../vendor/liberdus-wallet-module/index.js';
import { switchOrAddEthereumChain } from '../vendor/liberdus-wallet-module/adapters/chain.js';

export const APP_BRAND = 'LiberdusOTC';
export const APP_LOGO = 'assets/1.png';
const WALLET_SESSION_KEY = 'liberdus-otc-wallet-session';

const networkConfig = {
    "80002": {
    name: "Amoy",
    displayName: "Polygon Amoy Testnet",
    isDefault: true,
    contractAddress: "0x7A64764074971839bd5A3022beA2450CBc51dEC8",
    contractABI: CONTRACT_ABI,
    explorer: "https://www.oklink.com/amoy",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    fallbackRpcUrls: [
        "https://rpc.ankr.com/polygon_amoy",
        "https://polygon-amoy.blockpi.network/v1/rpc/public",
        "https://polygon-amoy.public.blastapi.io"
    ],
    chainId: "0x13882",
    nativeCurrency: {
        name: "POL",
        symbol: "POL",
        decimals: 18
    },
    // multicall address amoy testnet
    multicallAddress: "0xca11bde05977b3631167028862be2a173976ca11",
    wsUrl: "wss://polygon-amoy-bor-rpc.publicnode.com",
    fallbackWsUrls: [
        "wss://polygon-amoy.public.blastapi.io"
    ]
},
};

// replace above with this when testing amoy
/* "80002": {
    name: "Amoy",
    displayName: "Polygon Amoy Testnet",
    isDefault: true,
    contractAddress: "0x0BE723F88aDb867022fA0a71EB82365556cb3c8C",
    contractABI: CONTRACT_ABI,
    explorer: "https://www.oklink.com/amoy",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    fallbackRpcUrls: [
        "https://rpc.ankr.com/polygon_amoy",
        "https://polygon-amoy.blockpi.network/v1/rpc/public",
        "https://polygon-amoy.public.blastapi.io"
    ],
    chainId: "0x13882",
    nativeCurrency: {
        name: "POL",
        symbol: "POL",
        decimals: 18
    },
    // multicall address amoy testnet
    multicallAddress: "0xca11bde05977b3631167028862be2a173976ca11",
    wsUrl: "wss://polygon-amoy-bor-rpc.publicnode.com",
    fallbackWsUrls: [
        "wss://polygon-amoy.public.blastapi.io"
    ]
}, */

// "137": {
//     name: "Polygon",
//     displayName: "Polygon Mainnet",
//     isDefault: false,
//     contractAddress: "0x2F786290BAe87D1e8c01A97e6529030bbCF9f147", // New contract with allowed tokens 08/15/25
//     /* "0x34396a792510d6fb8ec0f70b68b8739456af06c6",  */// old 08/14/25
//     /* "0x8F37e9b4980340b9DE777Baa4B9c5B2fc1BDc837", */ // old 08/13/25
//     contractABI: CONTRACT_ABI,
//     explorer: "https://polygonscan.com",
//     rpcUrl: "https://polygon-rpc.com",
//     fallbackRpcUrls: [
//         "https://rpc-mainnet.matic.network",
//         "https://polygon-bor.publicnode.com",
//         "https://polygon.api.onfinality.io/public"
//     ],
//     chainId: "0x89",
//     nativeCurrency: {
//         name: "MATIC",
//         symbol: "MATIC",
//         decimals: 18
//     },
//     // Multicall2 contract (Uniswap) deployed on Polygon mainnet
//     multicallAddress: "0x275617327c958bD06b5D6b871E7f491D76113dd8",
//     wsUrl: "wss://polygon.gateway.tenderly.co",
//     fallbackWsUrls: [
//         "wss://polygon-bor.publicnode.com",
//         "wss://polygon-bor-rpc.publicnode.com",
//         "wss://polygon.api.onfinality.io/public-ws"
//     ]
// },


export const DEBUG_CONFIG = {
    APP: false,
    WEBSOCKET: true, // Enable to debug status calculation
    WALLET: false,
    VIEW_ORDERS: true, // Enable to debug status updates
    CREATE_ORDER: false,
    MY_ORDERS: false,
    TAKER_ORDERS: false,
    CLEANUP_ORDERS: false,
    WALLET_UI: false,
    BASE_COMPONENT: false,
    PRICING: false,
    TOKENS: false,
    TOKEN_ICON_SERVICE: false, // Add token icon service debugging
    TOAST: false, // Enable toast debugging for testing
    PRICING_DEFAULT_TO_ONE: false, // Default missing prices to 1 for testing, false for production
    LIBERDUS_VALIDATION: true, // Enable frontend Liberdus token validation
    // Add more specific flags as needed
};

// Centralized order-related constants
export const ORDER_CONSTANTS = {
    STATUS_MAP: ['Active', 'Filled', 'Canceled'],
    DEFAULT_ORDER_EXPIRY_SECS: 7 * 24 * 60 * 60, // 7 days
    DEFAULT_GRACE_PERIOD_SECS: 7 * 24 * 60 * 60 // 7 days
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
        '80002': 'polygon-amoy',
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

function getBrowserStorage() {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function normalizeAccount(account) {
    return typeof account === 'string' && ethers.utils.isAddress(account) ? account : null;
}

function toHexChainId(chainId) {
    if (chainId === null || chainId === undefined || chainId === '') {
        return null;
    }
    if (typeof chainId === 'string' && chainId.startsWith('0x')) {
        return chainId;
    }
    const numericChainId = Number(chainId);
    return Number.isFinite(numericChainId) ? ethers.utils.hexValue(numericChainId) : null;
}

function getWalletChainConfig(network) {
    return {
        chainId: parseInt(network.chainId, 16),
        chainName: network.displayName || network.name,
        nativeCurrency: network.nativeCurrency,
        rpcUrls: [network.rpcUrl, ...(network.fallbackRpcUrls || [])].filter(Boolean),
        blockExplorerUrls: [network.explorer].filter(Boolean)
    };
}

export class WalletManager {
    constructor() {
        const logger = createLogger('WALLET');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);

        this.listeners = new Set();
        this.isConnecting = false;
        this.account = null;
        this.chainId = null;
        this._isConnected = false;
        this.onAccountChange = null;
        this.onChainChange = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.walletCore = createWalletCore({
            storage: getBrowserStorage(),
            walletSessionKey: WALLET_SESSION_KEY
        });
        this.injectedProvider = null;
        this.providerSource = null;
        this.walletUnsubscribe = null;
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.contractAddress = getDefaultNetwork().contractAddress;
        this.contractABI = getDefaultNetwork().contractABI;
        this.isInitialized = false;
        this.contractInitialized = false;
        this.userDisconnected = false;
        this.STORAGE_KEY = 'wallet_user_disconnected';
    }

    async init() {
        try {
            this.debug('Starting initialization...');
            const networkCfg = getNetworkConfig();
            this.contractAddress = networkCfg.contractAddress;
            this.contractABI = CONTRACT_ABI;

            await this.walletCore.discoverWallets();
            this.bindWalletCoreEvents();
            this.loadUserDisconnectPreference();

            const availableProvider = this.walletCore.getEip1193Provider?.();
            if (!availableProvider) {
                this.debug('No compatible wallet detected, initializing in read-only mode');
                this.provider = null;
                this.isInitialized = true;
                return;
            }

            if (!this.userDisconnected) {
                const state = await this.walletCore.sync();
                this.applyWalletState(state);
                if (this.account) {
                    this.debug('Auto-connecting to existing wallet session');
                    this.ensureProvider();
                    await this.switchToDefaultNetwork();
                    await this.refreshChainId();
                    await this.initializeSigner(this.account);
                    this.notifyListeners('connect', {
                        account: this.account,
                        chainId: this.chainId
                    });
                } else {
                    this.ensureProvider();
                    await this.refreshChainId().catch(() => null);
                }
            } else {
                this.debug('User has manually disconnected, skipping auto-connect');
                await this.walletCore.sync();
                this.ensureProvider();
                await this.refreshChainId().catch(() => null);
            }

            this.isInitialized = true;
            this.debug('Initialization complete');
        } catch (error) {
            console.error('[WalletManager] Error in init:', error);
            throw error;
        }
    }

    bindWalletCoreEvents() {
        if (this.walletUnsubscribe) {
            return;
        }

        this.walletUnsubscribe = this.walletCore.subscribe(async (event, data) => {
            if (event === 'connected') {
                this.applyWalletState(this.walletCore.getState());
                this.ensureProvider();
                if (this.account) {
                    await this.initializeSigner(this.account).catch(error => {
                        this.error('Error initializing signer after wallet connect:', error);
                    });
                }
                return;
            }

            if (event === 'disconnected') {
                this.handleDisconnect();
                return;
            }

            if (event === 'accountChanged') {
                const nextAccount = normalizeAccount(data);
                await this.handleAccountsChanged(nextAccount ? [nextAccount] : []);
                return;
            }

            if (event === 'chainChanged') {
                this.handleChainChanged(toHexChainId(data) || data);
            }
        });
    }

    applyWalletState(state = this.walletCore.getState()) {
        const injectedProvider = this.walletCore.getEip1193Provider?.() || null;
        this.injectedProvider = injectedProvider;
        if (this.providerSource !== injectedProvider) {
            this.provider = null;
            this.providerSource = null;
            this.signer = null;
            this.contract = null;
            this.contractInitialized = false;
        }

        this.account = normalizeAccount(state.account);
        this.chainId = toHexChainId(state.chainId);
        this._isConnected = Boolean(this.account);
    }

    ensureProvider() {
        const injectedProvider = this.walletCore.getEip1193Provider?.() || this.injectedProvider;
        if (!injectedProvider) {
            this.provider = null;
            this.providerSource = null;
            return null;
        }

        if (!this.provider || this.providerSource !== injectedProvider) {
            this.injectedProvider = injectedProvider;
            this.provider = new ethers.providers.Web3Provider(injectedProvider, 'any');
            this.providerSource = injectedProvider;
            this.signer = null;
            this.contract = null;
            this.contractInitialized = false;
        }

        return this.provider;
    }

    async refreshChainId() {
        const injectedProvider = this.walletCore.getEip1193Provider?.() || this.injectedProvider;
        if (!injectedProvider) {
            this.chainId = null;
            return null;
        }
        const chainId = await injectedProvider.request({ method: 'eth_chainId' });
        this.chainId = toHexChainId(chainId);
        return this.chainId;
    }

    async checkConnection() {
        try {
            const state = await this.walletCore.sync();
            this.applyWalletState(state);
            if (!this.account) {
                return false;
            }
            this.ensureProvider();
            return true;
        } catch (error) {
            console.error('[WalletManager] Connection check failed:', error);
            return false;
        }
    }

    async initializeSigner() {
        try {
            if (!this.ensureProvider()) {
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

            this.debug('Contract initialized with ABI:', this.contract.interface.format());
            this.contractInitialized = true;
            return this.contract;
        } catch (error) {
            console.error('[WalletManager] Error initializing contract:', error);
            throw error;
        }
    }

    selectPrimaryWallet(wallets = []) {
        const state = this.walletCore.getState?.() || {};
        const sessionWalletId = state.sessionWalletId || state.selectedWalletId;
        if (sessionWalletId) {
            const persistedWallet = wallets.find(wallet => wallet.id === sessionWalletId);
            if (persistedWallet) {
                return persistedWallet;
            }
        }

        return wallets.find(wallet => {
            const name = String(wallet.info?.name || '').toLowerCase();
            const rdns = String(wallet.info?.rdns || '').toLowerCase();
            return name.includes('metamask') || rdns.includes('metamask');
        }) || wallets.find(wallet => wallet.source === 'eip6963') || wallets[0] || null;
    }

    async connect() {
        if (this.isConnecting) {
            console.log('[WalletManager] Connection already in progress');
            return null;
        }

        const wallets = await this.walletCore.discoverWallets();
        const selectedWallet = this.selectPrimaryWallet(wallets);
        if (!selectedWallet) {
            throw new Error('No compatible browser wallet was detected.');
        }

        this.isConnecting = true;
        try {
            this.debug('Requesting accounts...');
            const account = await this.walletCore.connect({ walletId: selectedWallet.id });
            this.applyWalletState(this.walletCore.getState());
            this.ensureProvider();

            let chainId = await this.refreshChainId();
            this.debug('Chain ID:', chainId);

            const defaultNetwork = getDefaultNetwork();
            if (parseInt(chainId, 16).toString() !== parseInt(defaultNetwork.chainId, 16).toString()) {
                await this.switchToDefaultNetwork();
                chainId = await this.refreshChainId();
            }

            this.account = normalizeAccount(account) || this.account;
            this.chainId = chainId;
            this._isConnected = Boolean(this.account);
            this.saveUserDisconnectPreference(false);
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

    async completeWalletModuleConnection(account = null) {
        this.applyWalletState(this.walletCore.getState());
        this.ensureProvider();

        let chainId = await this.refreshChainId();
        const defaultNetwork = getDefaultNetwork();
        if (chainId && parseInt(chainId, 16).toString() !== parseInt(defaultNetwork.chainId, 16).toString()) {
            await this.switchToDefaultNetwork();
            chainId = await this.refreshChainId();
        }

        this.account = normalizeAccount(account) || this.account;
        this.chainId = chainId;
        this._isConnected = Boolean(this.account);
        this.saveUserDisconnectPreference(false);
        await this.initializeSigner(this.account);

        this.notifyListeners('connect', {
            account: this.account,
            chainId: this.chainId
        });

        return {
            account: this.account,
            chainId: this.chainId
        };
    }

    getWalletCore() {
        return this.walletCore;
    }

    async switchToDefaultNetwork() {
        const targetNetwork = getDefaultNetwork();
        await this.switchToNetwork(targetNetwork.chainId);
    }

    async switchToNetwork(chainId) {
        const network = getNetworkById(chainId);
        if (!network) {
            throw new Error(`Network configuration not found for chain ID: ${chainId}`);
        }
        const injectedProvider = this.walletCore.getEip1193Provider?.() || this.injectedProvider;
        if (!injectedProvider) {
            throw new Error('No compatible browser wallet was detected.');
        }
        await switchOrAddEthereumChain(injectedProvider, getWalletChainConfig(network));
        await this.refreshChainId();
    }

    async handleAccountsChanged(accounts) {
        this.debug('Accounts changed:', accounts);
        if (accounts.length === 0) {
            this.account = null;
            this._isConnected = false;
            this.signer = null;
            this.contract = null;
            this.contractInitialized = false;
            this.debug('No accounts, triggering disconnect');
            this.notifyListeners('disconnect', {});
        } else if (accounts[0] !== this.account) {
            this.account = normalizeAccount(accounts[0]);
            this._isConnected = Boolean(this.account);
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
        this.chainId = toHexChainId(chainId) || chainId;
        this.notifyListeners('chainChanged', { chainId: this.chainId });
        if (this.onChainChange) {
            this.onChainChange(this.chainId);
        }

        const network = getNetworkById(this.chainId);
        if (!network?.isDefault) {
            this.switchToDefaultNetwork().catch(error => {
                this.warn('Failed to switch to default network:', error);
            });
        }
    }

    handleConnect(connectInfo) {
        if (this.onConnect) {
            this.onConnect(connectInfo);
        }
    }

    handleDisconnect(error) {
        this.account = null;
        this._isConnected = false;
        this.signer = null;
        this.contract = null;
        this.contractInitialized = false;
        if (this.onDisconnect) {
            this.onDisconnect(error);
        }
    }

    getAccount() {
        return this.account;
    }

    isWalletConnected() {
        if (!this.provider) {
            return false;
        }
        return this._isConnected;
    }

    disconnect() {
        this.debug('User manually disconnecting wallet');
        this.saveUserDisconnectPreference(true);
        this.account = null;
        this.chainId = null;
        this._isConnected = false;
        this.signer = null;
        this.contract = null;
        this.contractInitialized = false;
        this.walletCore.disconnect().catch(error => {
            this.warn('Wallet module disconnect failed:', error);
        });
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

    getSigner() {
        if (!this.ensureProvider()) {
            return null;
        }
        return this.signer;
    }

    getContract() {
        if (!this.ensureProvider()) {
            return null;
        }
        return this.contract;
    }

    getProvider() {
        return this.ensureProvider();
    }

    async initializeProvider() {
        try {
            const config = getNetworkConfig();
            let provider;
            let error;

            try {
                provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
                await provider.getNetwork();
                return provider;
            } catch (e) {
                error = e;
            }

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

    isWalletInitialized() {
        return this.isInitialized;
    }

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
            this.debug('User has manually disconnected from the wallet.');
        } else {
            this.userDisconnected = false;
            this.debug('User has not manually disconnected from the wallet.');
        }
    }

    saveUserDisconnectPreference(disconnected) {
        localStorage.setItem(this.STORAGE_KEY, disconnected);
        this.userDisconnected = disconnected;
        this.debug(`User disconnect preference saved: ${disconnected}`);
    }

    hasUserDisconnected() {
        return this.userDisconnected;
    }

    clearDisconnectPreference() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.userDisconnected = false;
        this.debug('User disconnect preference cleared');
    }
}

export const walletManager = new WalletManager();
