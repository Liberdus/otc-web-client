import { ethers } from 'ethers';
import { BaseComponent } from './BaseComponent.js';
import { walletManager } from '../config.js';

console.log('WalletUI module loaded');

export class WalletUI extends BaseComponent {
    constructor() {
        try {
            console.log('[WalletUI] Constructor starting...');
            super('wallet-container');
            console.log('[WalletUI] BaseComponent initialized');
            this.initializeElements();
            console.log('[WalletUI] Creating walletInitialized promise');
            window.walletInitialized = new Promise(async (resolve) => {
                await this.init();
                console.log('[WalletUI] Wallet initialization complete, resolving promise');
                resolve(true);
            });
        } catch (error) {
            console.error('[WalletUI] Error in constructor:', error);
        }
    }

    initializeElements() {
        try {
            console.log('Initializing elements...');
            
            // Initialize DOM elements with error checking
            this.connectButton = document.getElementById('walletConnect');
            console.log('Connect button found:', this.connectButton);
            
            this.disconnectButton = document.getElementById('walletDisconnect');
            console.log('Disconnect button found:', this.disconnectButton);
            
            this.walletInfo = document.getElementById('walletInfo');
            console.log('Wallet info found:', this.walletInfo);
            
            this.accountAddress = document.getElementById('accountAddress');
            console.log('Account address found:', this.accountAddress);

            if (!this.connectButton || !this.disconnectButton || !this.walletInfo || !this.accountAddress) {
                throw new Error('Required wallet UI elements not found');
            }

            // Add click listener with explicit binding
            const handleClick = (e) => {
                console.log('Connect button clicked!', e);
                this.handleConnectClick(e);
            };

            this.connectButton.addEventListener('click', handleClick);
            console.log('Click listener added to connect button');

        } catch (error) {
            console.error('Error in initializeElements:', error);
        }
    }

    async handleConnectClick(e) {
        try {
            console.log('[WalletUI] Handle connect click called');
            e.preventDefault();
            const result = await this.connectWallet();
            console.log('[WalletUI] Connect result:', result);
            if (result && result.account) {
                this.updateUI(result.account);
            }
        } catch (error) {
            console.error('[WalletUI] Error in handleConnectClick:', error);
        }
    }

    async connectWallet() {
        try {
            console.log('[WalletUI] Connecting wallet...');
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
            console.log('[WalletUI] Starting init...');
            
            // Check if MetaMask is already connected
            if (window.ethereum) {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    console.log('[WalletUI] Found existing connection:', accounts[0]);
                    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                    this.updateUI(accounts[0]);
                    this.updateNetworkBadge(chainId);
                }
            }

            if (typeof window.ethereum === 'undefined') {
                console.error('[WalletUI] MetaMask is not installed!');
                return false;
            }

            console.log('[WalletUI] Initializing wallet manager...');
            await walletManager.init();
            
            // Add click handler for disconnect button
            this.disconnectButton.addEventListener('click', async (e) => {
                e.preventDefault();
                console.log('[WalletUI] Disconnect button clicked');
                await walletManager.disconnect();
                this.showConnectButton();
            });

            // Setup wallet manager listeners
            walletManager.addListener((event, data) => {
                console.log('[WalletUI] Wallet event:', event, data);
                switch (event) {
                    case 'connect':
                        console.log('[WalletUI] Connect event received');
                        this.updateUI(data.account);
                        break;
                    case 'disconnect':
                        console.log('[WalletUI] Disconnect event received');
                        this.showConnectButton();
                        break;
                    case 'accountsChanged':
                        console.log('[WalletUI] Account change event received');
                        this.updateUI(data.account);
                        break;
                    case 'chainChanged':
                        console.log('[WalletUI] Chain change event received');
                        this.updateNetworkBadge(data.chainId);
                        break;
                }
            });

            // Check initial connection state
            if (walletManager.isWalletConnected()) {
                console.log('[WalletUI] Wallet already connected, updating UI');
                this.updateUI(walletManager.getAccount());
                this.updateNetworkBadge(walletManager.chainId);
            }
            
            return true;
        } catch (error) {
            console.error('[WalletUI] Error in init:', error);
            throw error;
        }
    }

    updateUI(account) {
        try {
            console.log('[WalletUI] Updating UI with account:', account);
            if (!account) {
                console.log('[WalletUI] No account provided, showing connect button');
                this.showConnectButton();
                return;
            }

            const shortAddress = `${account.slice(0, 6)}...${account.slice(-4)}`;
            console.log('[WalletUI] Setting short address:', shortAddress);
            
            // Force display style changes
            this.connectButton.style.display = 'none';
            this.walletInfo.style.display = 'flex';
            
            this.accountAddress.textContent = shortAddress;
            
            // Update network badge if chainId is available
            if (walletManager.chainId) {
                this.updateNetworkBadge(walletManager.chainId);
            }
            
            console.log('[WalletUI] UI updated successfully');
        } catch (error) {
            console.error('[WalletUI] Error in updateUI:', error);
        }
    }

    showConnectButton() {
        try {
            console.log('[WalletUI] Showing connect button');
            
            // Force display style changes
            this.connectButton.style.display = 'block';
            this.walletInfo.style.display = 'none';
            
            console.log('[WalletUI] Connect button shown');
        } catch (error) {
            console.error('[WalletUI] Error in showConnectButton:', error);
        }
    }

    updateNetworkBadge(chainId) {
        try {
            console.log('[WalletUI] Updating network badge for chain:', chainId);
            const networkBadge = document.querySelector('.network-badge');
            if (!networkBadge) {
                console.error('[WalletUI] Network badge element not found');
                return;
            }

            const decimalChainId = parseInt(chainId, 16).toString();
            console.log('[WalletUI] Decimal chain ID:', decimalChainId);

            if (decimalChainId === "80002") {
                networkBadge.textContent = "Amoy";
                networkBadge.classList.remove('wrong-network');
                networkBadge.classList.add('connected');
            } else {
                networkBadge.textContent = "Wrong Network";
                networkBadge.classList.add('wrong-network');
                networkBadge.classList.remove('connected');
            }
            console.log('[WalletUI] Network badge updated');
        } catch (error) {
            console.error('[WalletUI] Error updating network badge:', error);
        }
    }
} 