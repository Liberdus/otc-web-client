import { BaseComponent } from './components/BaseComponent.js';
import { CreateOrder } from './components/CreateOrder.js';
import { walletManager, WalletManager, getNetworkConfig, getAllNetworks } from './config.js';
import { WalletUI } from './components/WalletUI.js';
import { WebSocketService } from './services/WebSocket.js';
import { ViewOrders } from './components/ViewOrders.js';
import { MyOrders } from './components/MyOrders.js';
import { TakerOrders } from './components/TakerOrders.js';

console.log('App.js loaded');

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

        // Add wallet connection state handler
        walletManager.addListener((event, data) => {
            if (event === 'connect') {
                console.log('[App] Wallet connected, reinitializing components...');
                this.reinitializeComponents();
            }
        });

        // Add tab switching event listeners
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Add click handlers for tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const tabId = e.target.dataset.tab;
                if (tabId) {
                    this.showTab(tabId);
                }
            });
        });
    }

    async initialize() {
        try {
            // Initialize wallet manager without connecting
            window.walletManager = walletManager;
            await walletManager.init(false); // Pass false to prevent auto-connect
            
            // Initialize WebSocket service
            window.webSocket = new WebSocketService();
            await window.webSocket.initialize();
            
            // Initialize components in read-only mode
            await this.initializeComponents(true);
            
            console.log('[App] Initialization complete');
        } catch (error) {
            console.error('[App] Initialization error:', error);
        }
    }

    async initializeComponents(readOnlyMode) {
        try {
            console.log('[App] Initializing components...');
            
            // Initialize each component
            for (const [id, component] of Object.entries(this.components)) {
                if (component && typeof component.initialize === 'function') {
                    console.log(`[App] Initializing component: ${id}`);
                    await component.initialize(readOnlyMode);
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

    handleWalletConnect = async (account) => {
        console.log('[App] Wallet connected:', account);
        try {
            await this.reinitializeComponents();
            // Refresh the current tab view
            this.showTab(this.currentTab);
        } catch (error) {
            console.error('[App] Error handling wallet connection:', error);
        }
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
        try {
            console.log(`[App] Showing tab: ${tabId}`);
            
            // Update tab buttons
            document.querySelectorAll('.tab-button').forEach(button => {
                button.classList.remove('active');
                if (button.dataset.tab === tabId) {
                    button.classList.add('active');
                }
            });

            // Update tab contents
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            const activeContent = document.getElementById(tabId);
            if (activeContent) {
                activeContent.classList.add('active');
                
                // Get component for this tab
                const component = this.components[tabId];
                if (!component) {
                    console.log(`[App] No component found for tab: ${tabId}`);
                    return;
                }

                // Initialize component if needed
                if (!component.initialized) {
                    component.render();
                    component.initialized = true;
                }

                // Initialize with readOnlyMode if wallet is not connected
                const readOnlyMode = !window.walletManager?.account;
                if (typeof component.initialize === 'function') {
                    component.initialize(readOnlyMode);
                }
            }

            this.currentTab = tabId;
        } catch (error) {
            console.error('[App] Error showing tab:', error);
        }
    }

    // Add new method to reinitialize components
    async reinitializeComponents() {
        try {
            console.log('[App] Reinitializing components with wallet...');
            
            // Create and initialize CreateOrder component when wallet is connected
            const createOrderComponent = new CreateOrder();
            this.components['create-order'] = createOrderComponent;
            await createOrderComponent.initialize(false);
            
            // Reinitialize all other components with readOnlyMode = false
            for (const [id, component] of Object.entries(this.components)) {
                if (component && typeof component.initialize === 'function' && id !== 'create-order') {
                    console.log(`[App] Reinitializing component: ${id}`);
                    try {
                        await component.initialize(false);
                    } catch (error) {
                        console.error(`[App] Error reinitializing ${id}:`, error);
                    }
                }
            }

            // Re-show the current tab
            this.showTab(this.currentTab);
            
            console.log('[App] Components reinitialized');
        } catch (error) {
            console.error('[App] Error reinitializing components:', error);
        }
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
