import { BaseComponent } from './components/BaseComponent.js';
import { CreateOrder } from './components/CreateOrder.js';
import { walletManager, WalletManager, getNetworkConfig, getAllNetworks, isDebugEnabled } from './config.js';
import { WalletUI } from './components/WalletUI.js';
import { WebSocketService } from './services/WebSocket.js';
import { ViewOrders } from './components/ViewOrders.js';
import { MyOrders } from './components/MyOrders.js';
import { TakerOrders } from './components/TakerOrders.js';
import { Cleanup } from './components/Cleanup.js';

console.log('App.js loaded');

class App {
    constructor() {
        this.debug = (message, ...args) => {
            if (isDebugEnabled('APP')) {
                console.log('[App]', message, ...args);
            }
        };

        this.debug('App constructor called');
        
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
            'taker-orders': new TakerOrders(),
            'cleanup-orders': new Cleanup()
        };

        // Render wallet UI immediately
        this.walletUI.render();

        // Handle other components
        Object.entries(this.components).forEach(([id, component]) => {
            if (component instanceof BaseComponent && 
                !(component instanceof CreateOrder) && 
                !(component instanceof ViewOrders) &&
                !(component instanceof TakerOrders) &&
                !(component instanceof WalletUI) &&
                !(component instanceof Cleanup)) {
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
                this.debug('Wallet connected, reinitializing components...');
                this.updateTabVisibility(true);
                this.reinitializeComponents();
            } else if (event === 'disconnect') {
                this.debug('Wallet disconnected, updating tab visibility...');
                this.updateTabVisibility(false);
            }
        });

        // Add tab switching event listeners
        this.initializeEventListeners();

        // Initialize cleanup component
        const cleanup = new Cleanup();

        // Add WebSocket event handlers for order updates
        window.webSocket?.subscribe('OrderCreated', () => {
            this.debug('Order created, refreshing components...');
            this.refreshActiveComponent();
        });

        window.webSocket?.subscribe('OrderFilled', () => {
            this.debug('Order filled, refreshing components...');
            this.refreshActiveComponent();
        });

        window.webSocket?.subscribe('OrderCanceled', () => {
            this.debug('Order canceled, refreshing components...');
            this.refreshActiveComponent();
        });

        // Initialize debug panel
        this.initializeDebugPanel();

        // Add new method to update tab visibility
        this.updateTabVisibility = (isConnected) => {
            const tabButtons = document.querySelectorAll('.tab-button');
            tabButtons.forEach(button => {
                if (button.dataset.tab === 'create-order') return; // Always show create-order
                button.style.display = isConnected ? 'block' : 'none';
            });
            
            // If disconnected and not on create-order tab, switch to it
            if (!isConnected && this.currentTab !== 'create-order') {
                this.showTab('create-order');
            }
        };

        // Update initial tab visibility
        this.updateTabVisibility(false);

        // Add this to your existing JavaScript
        document.querySelector('.taker-toggle').addEventListener('click', function() {
            this.classList.toggle('active');
            document.querySelector('.taker-input-content').classList.toggle('hidden');
        });
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

    initializeDebugPanel() {
        // Show debug panel with keyboard shortcut (Ctrl+Shift+D)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                const panel = document.querySelector('.debug-panel');
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
        });

        // Initialize checkboxes from localStorage
        const savedDebug = localStorage.getItem('debug');
        if (savedDebug) {
            const settings = JSON.parse(savedDebug);
            document.querySelectorAll('[data-debug]').forEach(checkbox => {
                checkbox.checked = settings[checkbox.dataset.debug] ?? false;
            });
        }

        // Handle apply button
        document.getElementById('applyDebug')?.addEventListener('click', () => {
            const settings = {};
            document.querySelectorAll('[data-debug]').forEach(checkbox => {
                settings[checkbox.dataset.debug] = checkbox.checked;
            });
            localStorage.setItem('debug', JSON.stringify(settings));
            location.reload(); // Reload to apply new debug settings
        });
    }

    async initialize() {
        try {
            this.debug('Starting initialization...');
            // Initialize wallet manager with autoConnect parameter
            window.walletManager = walletManager;
            await walletManager.init(true);
            
            // Initialize WebSocket service
            window.webSocket = new WebSocketService();
            const wsInitialized = await window.webSocket.initialize();
            if (!wsInitialized) {
                this.debug('WebSocket initialization failed, falling back to HTTP');
            }
            
            // Initialize components in read-only mode initially
            await this.initializeComponents(true);
            
            this.debug('Initialization complete');
        } catch (error) {
            this.debug('Initialization error:', error);
        }
    }

    async initializeComponents(readOnlyMode) {
        try {
            this.debug('Initializing components in ' + 
                (readOnlyMode ? 'read-only' : 'connected') + ' mode');
            
            // Initialize each component
            for (const [id, component] of Object.entries(this.components)) {
                if (component && typeof component.initialize === 'function') {
                    this.debug(`Initializing component: ${id}`);
                    try {
                        await component.initialize(readOnlyMode);
                    } catch (error) {
                        // Log error but continue with other components
                        console.error(`[App] Error initializing ${id}:`, error);
                    }
                }
            }
            
            // Show the current tab
            this.showTab(this.currentTab);
            
            this.debug('Components initialized');
        } catch (error) {
            console.error('[App] Error initializing components:', error);
            // Continue execution instead of throwing
            this.showError("Some components failed to initialize. Limited functionality available.");
        }
    }

    async connectWallet() {
        const loader = document.createElement('div');
        loader.className = 'loader-overlay';
        loader.innerHTML = '<div class="loader"></div>';
        document.body.appendChild(loader);
        
        try {
            await walletManager.connect();
        } catch (error) {
            this.showError("Failed to connect wallet: " + error.message);
        } finally {
            if (loader && loader.parentElement) {
                loader.parentElement.removeChild(loader);
            }
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

    async showTab(tabId) {
        try {
            this.debug('Switching to tab:', tabId);
            
            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Update tab buttons
            document.querySelectorAll('.tab-button').forEach(button => {
                button.classList.remove('active');
                if (button.dataset.tab === tabId) {
                    button.classList.add('active');
                }
            });
            
            // Show selected tab
            const tabContent = document.getElementById(tabId);
            if (tabContent) {
                tabContent.classList.add('active');
                
                // Initialize component if it exists
                const component = this.components[tabId];
                if (component?.initialize) {
                    const readOnlyMode = !window.walletManager?.provider;
                    await component.initialize(readOnlyMode);
                }
            }
            
            this.currentTab = tabId;
            this.debug('Tab switch complete:', tabId);
        } catch (error) {
            console.error('[App] Error showing tab:', error);
        }
    }

    // Add new method to reinitialize components
    async reinitializeComponents() {
        if (this.isReinitializing) {
            this.debug('Already reinitializing, skipping...');
            return;
        }
        this.isReinitializing = true;
        
        try {
            this.debug('Reinitializing components with wallet...');
            
            // Clean up existing CreateOrder component if it exists
            if (this.components['create-order']?.cleanup) {
                this.components['create-order'].cleanup();
            }
            
            // Create and initialize CreateOrder component when wallet is connected
            const createOrderComponent = new CreateOrder();
            this.components['create-order'] = createOrderComponent;
            await createOrderComponent.initialize(false);
            
            // Reinitialize only the current tab's component
            const currentComponent = this.components[this.currentTab];
            if (currentComponent && typeof currentComponent.initialize === 'function') {
                this.debug(`Reinitializing current component: ${this.currentTab}`);
                try {
                    await currentComponent.initialize(false);
                } catch (error) {
                    console.error(`[App] Error reinitializing ${this.currentTab}:`, error);
                }
            }

            // Re-show the current tab
            await this.showTab(this.currentTab);
            
            this.debug('Components reinitialized');
        } finally {
            this.isReinitializing = false;
        }
    }

    // Add method to refresh active component
    async refreshActiveComponent() {
        const activeComponent = this.components[this.currentTab];
        if (activeComponent?.initialize) {
            this.debug('Refreshing active component:', this.currentTab);
            await activeComponent.initialize(false);
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
        
        window.app.debug('Initialization complete');
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

// Function to show application parameters in a popup
function showAppParametersPopup() {
    const networkConfigs = getNetworkConfig(); // Fetch network configurations
    const contractAddress = networkConfigs.contractAddress || 'N/A'; // Get contract address
    const currentChainId = networkConfigs.chainId || 'N/A'; // Get current chain ID

    const popup = document.createElement('div');
    popup.className = 'network-config-popup';
    popup.innerHTML = `
        <div class="popup-content">
            <h2>App Parameters</h2>
            <div class="config-item">
                <label for="contractAddress"><strong>Contract Address:</strong></label>
                <input type="text" id="contractAddress" class="config-input" value="${contractAddress}" readonly />
            </div>
            <div class="config-item">
                <label for="chainId"><strong>Current Chain ID:</strong></label>
                <input type="text" id="chainId" class="config-input" value="${currentChainId}" readonly />
            </div>
            <button class="close-popup">Close</button>
        </div>
    `;
    document.body.appendChild(popup);

    // Add event listener to close the popup
    popup.querySelector('.close-popup').addEventListener('click', () => {
        document.body.removeChild(popup);
    });
}

// Add event listener for the network config button
document.querySelector('.network-config-button').addEventListener('click', showAppParametersPopup);
