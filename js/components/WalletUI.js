import { BaseComponent } from './BaseComponent.js';
import { walletManager, getNetworkConfig, getNetworkById } from '../config.js';
import { createLogger } from '../services/LogService.js';

export class WalletUI extends BaseComponent {
    constructor() {
        super('wallet-container');
        
        const logger = createLogger('WALLET_UI');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
        
        try {
            this.debug('Constructor starting...');
            if (!this.initialized) {
                this.initializeElements();
                this.init();
                this.initialized = true;
            }
            this.debug('Constructor completed');
        } catch (error) {
            this.error('Error in constructor:', error);
        }
    }

    initializeElements() {
        try {
            this.debug('Initializing elements...');
            
            // Initialize DOM elements with error checking
            this.connectButton = document.getElementById('walletConnect');
            this.disconnectButton = document.getElementById('walletDisconnect');
            this.walletInfo = document.getElementById('walletInfo');
            this.accountAddress = document.getElementById('accountAddress');

            if (!this.connectButton || !this.disconnectButton || !this.walletInfo || !this.accountAddress) {
                this.error('Required wallet UI elements not found');
                throw new Error('Required wallet UI elements not found');
            }

            // Add click listener with explicit binding
            const handleClick = (e) => {
                this.debug('Connect button clicked!', e);
                this.handleConnectClick(e);
            };

            this.connectButton.addEventListener('click', handleClick);
            this.debug('Click listener added to connect button');

        } catch (error) {
            this.error('Error in initializeElements:', error);
            throw error;
        }
    }

    async handleConnectClick(e) {
        try {
            this.debug('Handle connect click called');
            e.preventDefault();
            
            // Disable connect button while connecting
            if (this.connectButton) {
                this.connectButton.disabled = true;
                this.connectButton.textContent = 'Connecting...';
            }

            const result = await this.connectWallet();
            this.debug('Connect result:', result);
            if (result && result.account) {
                this.updateUI(result.account);
                if (window.app && typeof window.app.handleWalletConnect === 'function') {
                    await window.app.handleWalletConnect(result.account);
                }
            }
        } catch (error) {
            this.error('Error in handleConnectClick:', error);
        } finally {
            // Re-enable connect button
            if (this.connectButton) {
                this.connectButton.disabled = false;
                this.connectButton.textContent = 'Connect Wallet';
            }
        }
    }

    async connectWallet() {
        try {
            this.debug('Connecting wallet...');
            
            if (walletManager.isConnecting) {
                this.debug('Connection already in progress, skipping...');
                return null;
            }

            // Add a small delay to ensure any previous pending requests are cleared
            await new Promise(resolve => setTimeout(resolve, 500));

            const result = await walletManager.connect();
            return result;
        } catch (error) {
            this.error('Failed to connect wallet:', error);
            this.showError("Failed to connect wallet: " + error.message);
            return null;
        }
    }

    async init() {
        try {
            this.debug('Starting init...');
            
            if (typeof window.ethereum === 'undefined') {
                this.error('MetaMask is not installed!');
                return false;
            }

            // Setup event listeners
            this.setupEventListeners();
            
            // Check if already connected, but only if not already connecting
            if (!walletManager.isConnecting) {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    this.debug('Found existing connection, connecting...');
                    await this.connectWallet();
                }
            }
            
            return true;
        } catch (error) {
            this.error('Error in init:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Update disconnect button handler
        this.disconnectButton.addEventListener('click', async (e) => {
            e.preventDefault();
            this.debug('Disconnect button clicked');
            try {
                // Clean up CreateOrder component before disconnecting
                if (window.app?.components['create-order']?.cleanup) {
                    window.app.components['create-order'].cleanup();
                }
                
                // Update create order button
                const createOrderBtn = document.getElementById('createOrderBtn');
                if (createOrderBtn) {
                    createOrderBtn.disabled = true;
                    createOrderBtn.textContent = 'Connect Wallet to Create Order';
                }
                
                // Single disconnect call
                await walletManager.disconnect();
                
                // Reset UI
                this.showConnectButton();
                this.accountAddress.textContent = '';
                
                // Clear any cached provider state
                if (window.ethereum) {
                    window.ethereum.removeAllListeners();
                    this.setupEventListeners();
                }
                
                // Update tab visibility
                if (window.app?.updateTabVisibility) {
                    window.app.updateTabVisibility(false);
                }
                
                // Only trigger app-level disconnect handler (which will show the message)
                if (window.app?.handleWalletDisconnect) {
                    window.app.handleWalletDisconnect();
                }
            } catch (error) {
                console.error('[WalletUI] Error disconnecting:', error);
            }
        });

        // Setup wallet manager listeners
        walletManager.addListener((event, data) => {
            this.debug('Wallet event:', event, data);
            switch (event) {
                case 'connect':
                    this.debug('Connect event received');
                    this.updateUI(data.account);
                    if (window.app && typeof window.app.handleWalletConnect === 'function') {
                        window.app.handleWalletConnect(data.account);
                    }
                    break;
                case 'disconnect':
                    this.debug('Disconnect event received');
                    this.showConnectButton();
                    break;
                case 'accountsChanged':
                    this.debug('Account change event received');
                    // Clean up CreateOrder component when account changes
                    if (window.app?.components['create-order']?.cleanup) {
                        window.app.components['create-order'].cleanup();
                    }
                    this.updateUI(data.account);
                    break;
                case 'chainChanged':
                    this.debug('Chain change event received');
                    this.updateNetworkBadge(data.chainId);
                    break;
            }
        });
    }

    updateUI(account) {
        try {
            this.debug('Updating UI with account:', account);
            if (!account) {
                this.debug('No account provided, showing connect button');
                this.showConnectButton();
                // Remove wallet-connected class
                document.querySelector('.swap-section')?.classList.remove('wallet-connected');
                return;
            }

            const shortAddress = `${account.slice(0, 6)}...${account.slice(-4)}`;
            this.debug('Setting short address:', shortAddress);
            
            this.connectButton.classList.add('hidden');
            this.walletInfo.classList.remove('hidden');
            this.accountAddress.textContent = shortAddress;
            
            // Add wallet-connected class
            document.querySelector('.swap-section')?.classList.add('wallet-connected');
            
            if (walletManager.chainId) {
                this.updateNetworkBadge(walletManager.chainId);
            }
            
            this.debug('UI updated successfully');
        } catch (error) {
            console.error('[WalletUI] Error in updateUI:', error);
        }
    }

    showConnectButton() {
        try {
            this.debug('Showing connect button');
            this.connectButton.classList.remove('hidden');
            this.walletInfo.classList.add('hidden');
            // Remove wallet-connected class
            document.querySelector('.swap-section')?.classList.remove('wallet-connected');
            this.debug('Connect button shown');
        } catch (error) {
            console.error('[WalletUI] Error in showConnectButton:', error);
        }
    }

    updateNetworkBadge(chainId) {
        try {
            this.debug('Updating network badge for chain:', chainId);
            const networkBadge = document.querySelector('.network-badge');
            if (!networkBadge) {
                console.error('[WalletUI] Network badge element not found');
                return;
            }

            const network = getNetworkById(chainId);
            
            if (network?.isDefault) {
                networkBadge.textContent = network.name;
                networkBadge.classList.remove('wrong-network');
                networkBadge.classList.add('connected');
            } else {
                networkBadge.textContent = "Wrong Network";
                networkBadge.classList.add('wrong-network');
                networkBadge.classList.remove('connected');
            }
            this.debug('Network badge updated');
        } catch (error) {
            console.error('[WalletUI] Error updating network badge:', error);
        }
    }
} 