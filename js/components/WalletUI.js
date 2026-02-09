import { BaseComponent } from './BaseComponent.js';
import { walletManager, getDefaultNetwork, getNetworkById, getNetworkBySlug } from '../config.js';
import { createLogger } from '../services/LogService.js';

export class WalletUI extends BaseComponent {
    constructor() {
        super('wallet-container');
        
        const logger = createLogger('WALLET_UI');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
        
        // Store bound handlers for cleanup
        this._boundConnectHandler = null;
        this._boundDisconnectHandler = null;
        this._boundWalletListener = null;
        
        this.debug('Constructor completed (no side effects)');
    }

    /**
     * Initialize the WalletUI component
     * Sets up DOM references, event listeners, and checks connection state
     */
    async initialize(readOnlyMode = true) {
        if (this.initializing) {
            this.debug('Already initializing, skipping...');
            return;
        }
        
        if (this.initialized) {
            this.debug('Already initialized, skipping...');
            return;
        }
        
        this.initializing = true;
        
        try {
            this.debug('Initializing WalletUI...');
            
            // Initialize DOM elements
            this.initializeElements();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Check connection state
            await this.checkInitialConnectionState();
            
            this.initialized = true;
            this.debug('WalletUI initialization complete');
        } catch (error) {
            this.error('Error in initialize:', error);
        } finally {
            this.initializing = false;
        }
    }

    /**
     * Cleanup event listeners and subscriptions
     */
    cleanup() {
        this.debug('Cleaning up WalletUI...');
        
        // Remove connect button listener
        if (this.connectButton && this._boundConnectHandler) {
            this.connectButton.removeEventListener('click', this._boundConnectHandler);
        }
        
        // Remove disconnect button listener
        if (this.disconnectButton && this._boundDisconnectHandler) {
            this.disconnectButton.removeEventListener('click', this._boundDisconnectHandler);
        }
        
        // Remove wallet manager listener
        if (this._boundWalletListener) {
            walletManager.removeListener(this._boundWalletListener);
        }
        
        this.debug('WalletUI cleanup complete');
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

            this.debug('DOM elements initialized');
        } catch (error) {
            this.error('Error in initializeElements:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Create bound handler for connect button
        this._boundConnectHandler = (e) => {
            this.debug('Connect button clicked!', e);
            this.handleConnectClick(e);
        };
        this.connectButton.addEventListener('click', this._boundConnectHandler);
        this.debug('Click listener added to connect button');

        // Create bound handler for disconnect button
        this._boundDisconnectHandler = async (e) => {
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
                
                // Use the new disconnect method that saves user preference
                walletManager.disconnect();
                
                // Reset UI
                this.showConnectButton();
                this.accountAddress.textContent = '';
                
                // Update tab visibility
                if (window.app?.updateTabVisibility) {
                    window.app.updateTabVisibility(false);
                }
                
                // Only trigger app-level disconnect handler (which will show the message)
                if (window.app?.handleWalletDisconnect) {
                    window.app.handleWalletDisconnect();
                }
            } catch (error) {
                this.error('[WalletUI] Error disconnecting:', error);
            }
        };
        this.disconnectButton.addEventListener('click', this._boundDisconnectHandler);

        // Setup wallet manager listener
        this._boundWalletListener = (event, data) => {
            this.debug('Wallet event:', event, data);
            switch (event) {
                case 'connect':
                    this.debug('Connect event received');
                    this.updateUI(data.account);
                    break;
                case 'disconnect':
                    this.debug('Disconnect event received');
                    this.showConnectButton();
                    break;
                case 'accountsChanged':
                    this.debug('Account change event received');
                    this.updateUI(data.account);
                    break;
                case 'chainChanged':
                    this.debug('Chain change event received');
                    this.updateNetworkBadge(data.chainId);
                    break;
            }
        };
        walletManager.addListener(this._boundWalletListener);
    }

    async checkInitialConnectionState() {
        try {
            this.debug('Checking initial connection state...');
            
            if (typeof window.ethereum === 'undefined') {
                this.debug('MetaMask is not installed, initializing in read-only mode');
                return;
            }
            
            // Check if user has manually disconnected
            if (walletManager.hasUserDisconnected()) {
                this.debug('User has manually disconnected, showing connect button');
                this.showConnectButton();
                return;
            }
            
            // Check if already connected, but only if not already connecting
            if (!walletManager.isConnecting) {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    this.debug('Found existing connection, connecting...');
                    await this.connectWallet();
                }
            }
        } catch (error) {
            this.error('Error checking initial connection state:', error);
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
            this.error('[WalletUI] Error in updateUI:', error);
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
            this.error('[WalletUI] Error in showConnectButton:', error);
        }
    }

    updateNetworkBadge(chainId) {
        try {
            this.debug('Updating network badge for chain:', chainId);

            if (window.app?.ctx?.setWalletChainId) {
                window.app.ctx.setWalletChainId(chainId ?? null);
            }

            if (typeof window.syncNetworkBadgeFromState === 'function') {
                window.syncNetworkBadgeFromState();
                return;
            }

            const networkBadge = document.querySelector('.network-badge');
            if (!networkBadge) {
                this.error('[WalletUI] Network badge element not found');
                return;
            }

            const selectedSlug = window.app?.ctx?.getSelectedChainSlug?.() || getDefaultNetwork().slug;
            const selectedNetwork = getNetworkBySlug(selectedSlug) || getDefaultNetwork();
            const walletNetwork = getNetworkById(chainId);

            networkBadge.textContent = selectedNetwork.displayName || selectedNetwork.name;
            networkBadge.classList.remove('wrong-network', 'connected');
            if (walletNetwork && walletNetwork.slug === selectedNetwork.slug) {
                networkBadge.classList.add('connected');
            } else {
                networkBadge.classList.add('wrong-network');
            }
            this.debug('Network badge updated');
        } catch (error) {
            this.error('[WalletUI] Error updating network badge:', error);
        }
    }
}
