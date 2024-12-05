import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';
import { walletManager, isDebugEnabled } from '../config.js';

export class WalletUI extends BaseComponent {
    constructor() {
        super('wallet-container');
        
        this.debug = (message, ...args) => {
            if (isDebugEnabled('WALLET_UI')) {
                console.log('[WalletUI]', message, ...args);
            }
        };
        
        try {
            this.debug('Constructor starting...');
            this.initializeElements();
            this.init();
            this.debug('Constructor completed');
        } catch (error) {
            console.error('[WalletUI] Error in constructor:', error);
        }
    }

    initializeElements() {
        try {
            this.debug('Initializing elements...');
            
            // Initialize DOM elements with error checking
            this.connectButton = document.getElementById('walletConnect');
            this.debug('Connect button found:', this.connectButton);
            
            this.disconnectButton = document.getElementById('walletDisconnect');
            this.debug('Disconnect button found:', this.disconnectButton);
            
            this.walletInfo = document.getElementById('walletInfo');
            this.debug('Wallet info found:', this.walletInfo);
            
            this.accountAddress = document.getElementById('accountAddress');
            this.debug('Account address found:', this.accountAddress);

            if (!this.connectButton || !this.disconnectButton || !this.walletInfo || !this.accountAddress) {
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
            console.error('Error in initializeElements:', error);
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
            console.error('[WalletUI] Error in handleConnectClick:', error);
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
            console.error('[WalletUI] Failed to connect wallet:', error);
            this.showError("Failed to connect wallet: " + error.message);
            return null;
        }
    }

    async init() {
        try {
            this.debug('Starting init...');
            
            if (typeof window.ethereum === 'undefined') {
                console.error('[WalletUI] MetaMask is not installed!');
                return false;
            }

            // Setup event listeners
            this.setupEventListeners();
            
            // Check if already connected
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts && accounts.length > 0) {
                this.debug('Found existing connection, connecting...');
                await this.connectWallet();
            }
            
            return true;
        } catch (error) {
            console.error('[WalletUI] Error in init:', error);
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
                
                await walletManager.disconnect();
                this.showConnectButton();
                
                // Clear our app's connection state
                await walletManager.disconnect();
                
                // Clean up CreateOrder component
                if (window.app?.components['create-order']?.cleanup) {
                    window.app.components['create-order'].cleanup();
                }
                
                // Reset UI
                this.showConnectButton();
                this.accountAddress.textContent = '';
                
                // Clear any cached provider state
                if (window.ethereum) {
                    // Remove all listeners to ensure clean slate
                    window.ethereum.removeAllListeners();
                    // Re-initialize necessary listeners
                    this.setupEventListeners();
                }
                
                // Update tab visibility
                if (window.app && typeof window.app.updateTabVisibility === 'function') {
                    window.app.updateTabVisibility(false);
                }
                
                // Show more detailed message to user
                const message = "Wallet disconnected from this site. For complete security:\n" +
                              "1. Open MetaMask extension\n" +
                              "2. Click on your account icon\n" +
                              "3. Select 'Lock' or 'Disconnect this site'";
                
                if (window.app && typeof window.app.showSuccess === 'function') {
                    window.app.showSuccess(message);
                }
                
                // Trigger app-level disconnect handler
                if (window.app && typeof window.app.handleWalletDisconnect === 'function') {
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
                return;
            }

            const shortAddress = `${account.slice(0, 6)}...${account.slice(-4)}`;
            this.debug('Setting short address:', shortAddress);
            
            this.connectButton.classList.add('hidden');
            this.walletInfo.classList.remove('hidden');
            this.accountAddress.textContent = shortAddress;
            
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

            const decimalChainId = parseInt(chainId, 16).toString();
            this.debug('Decimal chain ID:', decimalChainId);

            if (decimalChainId === "80002") {
                networkBadge.textContent = "Amoy";
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