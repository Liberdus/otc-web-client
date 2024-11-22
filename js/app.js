import { BaseComponent } from './components/BaseComponent.js';
import { CreateOrder } from './components/CreateOrder.js';
import { walletManager, WalletManager, getNetworkConfig, getAllNetworks } from './config.js';
import { WalletUI } from './components/WalletUI.js';
import { WebSocketService } from './services/WebSocket.js';
import { ViewOrders } from './components/ViewOrders.js';
import { MyOrders } from './components/MyOrders.js';
import { TakerOrders } from './components/TakerOrders.js';

console.log('App.js loaded');

window.walletInitialized = new Promise((resolve) => {
    window.resolveWalletInitialized = resolve;
});

class App {
    constructor() {
        console.log('App constructor called');
        
        this.walletUI = new WalletUI();
        
        this.handleConnectWallet = async (e) => {
            e && e.preventDefault();
            await this.connectWallet();
        };

        // Initialize components
        this.components = {
            'wallet-info': this.walletUI,
            'view-orders': new ViewOrders(),
            'my-orders': new MyOrders(),
            'taker-orders': new TakerOrders()
        };

        // Render wallet UI immediately
        this.walletUI.render();

        // Handle other components
        Object.entries(this.components).forEach(([id, component]) => {
            if (component instanceof BaseComponent && 
                !(component instanceof CreateOrder) && 
                !(component instanceof ViewOrders) &&
                !(component instanceof TakerOrders) &&
                !(component instanceof WalletUI)) {
                component.render = function() {
                    if (!this.initialized) {
                        this.container.innerHTML = `
                            <div class="tab-content-wrapper">
                                <h2>${this.container.id.split('-').map(word => 
                                    word.charAt(0).toUpperCase() + word.slice(1)
                                ).join(' ')}</h2>
                                <p>Coming soon...</p>
                            </div>
                        `;
                        this.initialized = true;
                    }
                };
            }
        });

        this.currentTab = 'create-order';

        // Add wallet connect button handler
        const walletConnectBtn = document.getElementById('walletConnect');
        if (walletConnectBtn) {
            walletConnectBtn.addEventListener('click', this.handleConnectWallet);
        }

        // Add wallet disconnect button handler
        const walletDisconnectBtn = document.getElementById('walletDisconnect');
        if (walletDisconnectBtn) {
            walletDisconnectBtn.addEventListener('click', async () => {
                console.log('Disconnect button clicked');
                try {
                    await window.walletManager.disconnect();
                    this.handleWalletDisconnect();
                } catch (error) {
                    console.error('Disconnect error:', error);
                    this.showError("Failed to disconnect: " + error.message);
                }
            });
        }
    }

    async initialize() {
        try {
            // Initialize wallet first
            await this.initializeWallet();
            
            // Initialize WebSocket service
            window.webSocket = new WebSocketService();
            await window.webSocket.initialize();
            
            // Initialize components after WebSocket is ready
            await this.initializeComponents();
            
            console.log('[App] Initialization complete');
        } catch (error) {
            console.error('[App] Initialization error:', error);
        }
    }

    async initializeComponents() {
        try {
            console.log('[App] Initializing components...');
            
            // Initialize each component
            for (const [id, component] of Object.entries(this.components)) {
                if (component && typeof component.initialize === 'function') {
                    console.log(`[App] Initializing component: ${id}`);
                    await component.initialize();
                }
            }
            
            // Show the current tab
            this.showTab(this.currentTab);
            
            console.log('[App] Components initialized');
        } catch (error) {
            console.error('[App] Error initializing components:', error);
            throw error;
        }
    }

    async initializeWallet() {
        try {
            console.log('[App] Starting wallet initialization...');
            
            // Initialize wallet manager
            if (!window.walletManager?.isInitialized) {
                console.log('[App] Initializing wallet manager...');
                window.walletManager = walletManager;
                await window.walletManager.init();
            }

            // Set up wallet event handlers
            console.log('[App] Setting up wallet event handlers...');
            window.walletManager.onConnect = this.handleWalletConnect.bind(this);
            window.walletManager.onDisconnect = this.handleWalletDisconnect.bind(this);
            window.walletManager.onAccountChange = this.handleAccountChange.bind(this);
            window.walletManager.onChainChange = this.handleChainChange.bind(this);

            // Check if wallet is connected
            const isConnected = await window.walletManager.checkConnection();
            
            if (!isConnected) {
                console.log('[App] Wallet not connected, attempting connection...');
                await window.walletManager.connect();
            }

            // Only create CreateOrder component after wallet is fully initialized
            console.log('[App] Creating CreateOrder component...');
            this.components['create-order'] = new CreateOrder();
            
            // Resolve the wallet initialization promise
            window.resolveWalletInitialized();
            
            console.log('[App] Wallet initialization complete');
        } catch (error) {
            console.error('[App] Wallet initialization error:', error);
            this.showError("Failed to initialize wallet: " + error.message);
            throw error;
        }
    }

    initializeEventListeners() {
        // Remove old listeners first
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
        });

        // Add new listeners
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const tabId = button.dataset.tab;
                this.showTab(tabId);
            });
        });

        // Add wallet connect button handler
        const walletConnectBtn = document.getElementById('walletConnect');
        if (walletConnectBtn) {
            walletConnectBtn.addEventListener('click', this.handleConnectWallet);
        }

        // Add wallet disconnect button handler - moved outside constructor
        const walletDisconnectBtn = document.getElementById('walletDisconnect');
        if (walletDisconnectBtn) {
            walletDisconnectBtn.addEventListener('click', async () => {
                try {
                    await window.walletManager.disconnect();
                    this.handleWalletDisconnect();
                } catch (error) {
                    this.showError("Failed to disconnect: " + error.message);
                }
            });
        } else {
            console.error('Wallet disconnect button not found');
        }
    }

    async connectWallet() {
        try {
            const loader = this.showLoader();
            await walletManager.connect();
            this.hideLoader(loader);
            
        } catch (error) {
            this.hideLoader(loader);
            this.showError("Failed to connect wallet: " + error.message);
        }
    }

    handleWalletConnect(connectionInfo) {
        const walletConnectBtn = document.getElementById('walletConnect');
        const walletInfo = document.getElementById('walletInfo');
        const accountAddress = document.getElementById('accountAddress');
        
        if (walletConnectBtn) {
            walletConnectBtn.style.display = 'none';
        }
        
        if (walletInfo) {
            walletInfo.classList.remove('hidden');
        }
        
        if (accountAddress && connectionInfo.address) {
            accountAddress.textContent = `${connectionInfo.address.slice(0, 6)}...${connectionInfo.address.slice(-4)}`;
        }
        
        this.showSuccess("Wallet connected successfully!");
    }

    handleWalletDisconnect() {
        const walletConnectBtn = document.getElementById('walletConnect');
        const walletInfo = document.getElementById('walletInfo');
        const accountAddress = document.getElementById('accountAddress');
        
        if (walletConnectBtn) {
            walletConnectBtn.style.display = 'flex';
        }
        
        if (walletInfo) {
            walletInfo.classList.add('hidden');
        }
        
        if (accountAddress) {
            accountAddress.textContent = '';
        }
        
        this.showSuccess("Wallet disconnected successfully");
    }

    handleAccountChange(account) {
        
    }

    handleChainChange(chainId) {
        
    }

    showLoader() {
        const loader = document.createElement('div');
        loader.className = 'loader-overlay';
        loader.innerHTML = '<div class="loader"></div>';
        document.body.appendChild(loader);
        return loader;
    }

    hideLoader(loader) {
        if (loader && loader.parentElement) {
            loader.parentElement.removeChild(loader);
        }
    }

    showError(message) {
        const error = document.createElement('div');
        error.className = 'status error';
        error.textContent = message;
        document.body.appendChild(error);
        setTimeout(() => error.remove(), 5000);
    }

    showSuccess(message) {
        const success = document.createElement('div');
        success.className = 'status success';
        success.textContent = message;
        document.body.appendChild(success);
        setTimeout(() => success.remove(), 5000);
    }

    showTab(tabId) {
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
            if (button.dataset.tab === tabId) {
                button.classList.add('active');
            }
        });

        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => {
            content.classList.remove('active');
        });
        
        const activeContent = document.getElementById(tabId);
        if (activeContent) {
            activeContent.classList.add('active');
        }

        const component = this.components[tabId];
        if (component && !component.initialized) {
            component.render();
            component.initialized = true;
        }

        this.currentTab = tabId;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.app = new App();
        window.app.initializeEventListeners();
        window.app.showTab(window.app.currentTab);
        
        // Wait for wallet initialization to complete
        await window.app.initialize().catch(error => {
            console.error('[App] Failed to initialize wallet:', error);
            throw error;
        });
        
        console.log('[App] Initialization complete');
    } catch (error) {
        console.error('[App] App initialization error:', error);
    }
});

// Initialize WebSocket after wallet connection
window.walletInitialized.then(async () => {
    try {
        if (!window.webSocket) {
            window.webSocket = new WebSocketService();
            await window.webSocket.initialize();
        }
    } catch (error) {
        console.error('[App] WebSocket initialization error:', error);
    }
});

// Network selector functionality
const networkButton = document.querySelector('.network-button');
const networkDropdown = document.querySelector('.network-dropdown');
const networkBadge = document.querySelector('.network-badge');

// Dynamically populate network options
const populateNetworkOptions = () => {
    const networks = getAllNetworks();
    
    // If only one network, hide dropdown functionality
    if (networks.length <= 1) {
        networkButton.classList.add('single-network');
        return;
    }
    
    networkDropdown.innerHTML = networks.map(network => `
        <div class="network-option" data-network="${network.name.toLowerCase()}" data-chain-id="${network.chainId}">
            ${network.displayName}
        </div>
    `).join('');
    
    // Re-attach click handlers only if multiple networks
    document.querySelectorAll('.network-option').forEach(option => {
        option.addEventListener('click', async () => {
            try {
                networkBadge.textContent = option.textContent;
                networkDropdown.classList.add('hidden');
                
                if (window.walletManager && window.walletManager.isConnected()) {
                    const chainId = option.dataset.chainId;
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId }],
                    });
                }
            } catch (error) {
                console.error('Failed to switch network:', error);
                networkBadge.textContent = networkButton.querySelector('.network-badge').textContent;
                app.showError('Failed to switch network: ' + error.message);
            }
        });
    });
};

// Initialize network dropdown
populateNetworkOptions();
