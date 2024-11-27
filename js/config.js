import { abi as CONTRACT_ABI } from './abi/OTCSwap.js';
import { ethers } from 'ethers';

const networkConfig = {
    "80002": {
        name: "Amoy",
        displayName: "Amoy Testnet",
        contractAddress: "0x34CDA334d156C7881F36996A54eCa7d0468BE2dc", // 0x3e6326657B7130613c943D013EC84cE1F33027Ba 0xF9D874860d5801233dd84569fad8513e0037A5d9 0xaeefe2dfe3be401ff26dcd8884c4b1c1913156bf 0x34CDA334d156C7881F36996A54eCa7d0468BE2dc 0xE21D96107B2ca99fD1210B850a21b8627688bf32
        contractABI: CONTRACT_ABI,
        explorer: "https://www.oklink.com/amoy",
        rpcUrl: "https://rpc.ankr.com/polygon_amoy",
        fallbackRpcUrls: [
            "https://rpc.ankr.com/polygon_amoy",
            "https://polygon-amoy.blockpi.network/v1/rpc/public",
            "wss://polygon-amoy-bor-rpc.publicnode.com",
            "https://polygon-amoy.public.blastapi.io"
        ],
        chainId: "0x13882",
        nativeCurrency: {
            name: "POLYGON Ecosystem Token",
            symbol: "POL",
            decimals: 18
        },
        wsUrl: 'wss://polygon-amoy-bor.publicnode.com'
    },
};

export const getAllNetworks = () => Object.values(networkConfig);

export const DEBUG_CONFIG = {
    APP: false,
    WEBSOCKET: false,
    COMPONENTS: false,
    WALLET: false,
    VIEW_ORDERS: false,
    CREATE_ORDER: false,
    MY_ORDERS: false,
    TAKER_ORDERS: false,
    CLEANUP_ORDERS: false,
    WALLET_UI: false,
    BASE_COMPONENT: false,
    // Add more specific flags as needed
};

export const isDebugEnabled = (component) => {
    // Check if debug mode is forced via localStorage
    const localDebug = localStorage.getItem('debug');
    if (localDebug) {
        const debugSettings = JSON.parse(localDebug);
        return debugSettings[component] ?? DEBUG_CONFIG[component];
    }
    return DEBUG_CONFIG[component];
};

export class WalletManager {
    constructor() {
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
        this.contractAddress = networkConfig["80002"].contractAddress;
        this.contractABI = CONTRACT_ABI;
        this.isInitialized = false;
        this.debug = (message, ...args) => {
            if (isDebugEnabled('WALLET')) {
                console.log('[WalletManager]', message, ...args);
            }
        };
    }

    async init() {
        try {
            this.debug('Starting initialization...');
            
            if (typeof window.ethereum === 'undefined') {
                throw new Error("MetaMask is not installed!");
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

            // Check if already connected
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                await this.initializeSigner(accounts[0]);
                const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                this.handleChainChanged(chainId);
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
            const accounts = await this.provider.listAccounts();
            return accounts.length > 0;
        } catch (error) {
            console.error('[WalletManager] Connection check failed:', error);
            return false;
        }
    }

    async initializeSigner(account) {
        try {
            this.signer = this.provider.getSigner();
            await this.initializeContract();
            return this.signer;
        } catch (error) {
            console.error('[WalletManager] Error initializing signer:', error);
            throw error;
        }
    }

    async initializeContract() {
        try {
            const networkConfig = getNetworkConfig();
            this.contract = new ethers.Contract(
                networkConfig.contractAddress,
                CONTRACT_ABI,
                this.signer
            );
            
            console.log('[WalletManager] Contract initialized with ABI:', 
                this.contract.interface.format());
            return this.contract;
        } catch (error) {
            console.error('[WalletManager] Error initializing contract:', error);
            throw error;
        }
    }

    async connect() {
        if (!window.ethereum) {
            throw new Error("MetaMask is not installed!");
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
            
            if (decimalChainId !== "80002") {
                await this.switchToAmoy();
            }

            this.account = accounts[0];
            this.chainId = chainId;
            this.isConnected = true;

            this.debug('Notifying listeners of connection');
            this.notifyListeners('connect', {
                account: this.account,
                chainId: this.chainId
            });

            const result = await this.initializeSigner(this.account);
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

    async switchToAmoy() {
        const config = networkConfig["80002"];
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: config.chainId }],
            });
        } catch (error) {
            if (error.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: config.chainId,
                        chainName: config.name,
                        nativeCurrency: config.nativeCurrency,
                        rpcUrls: [config.rpcUrl, ...config.fallbackRpcUrls],
                        blockExplorerUrls: [config.explorer]
                    }],
                });
            } else {
                throw error;
            }
        }
    }

    handleAccountsChanged(accounts) {
        this.debug('Accounts changed:', accounts);
        if (accounts.length === 0) {
            this.account = null;
            this.isConnected = false;
            this.debug('No accounts, triggering disconnect');
            this.notifyListeners('disconnect', {});
        } else if (accounts[0] !== this.account) {
            this.account = accounts[0];
            this.isConnected = true;
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
        
        const decimalChainId = parseInt(chainId, 16).toString();
        if (decimalChainId !== "80002") {
            this.switchToAmoy();
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
        return this.isConnected;
    }

    disconnect() {
        this.account = null;
        this.isConnected = false;
        if (this.onDisconnect) {
            this.onDisconnect();
        }
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
        return this.signer;
    }

    getContract() {
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
}

export const walletManager = new WalletManager();
export const getNetworkConfig = () => networkConfig["80002"];