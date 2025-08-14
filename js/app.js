import { BaseComponent } from './components/BaseComponent.js';
import { CreateOrder } from './components/CreateOrder.js';
import { walletManager, WalletManager, getNetworkConfig, getAllNetworks, isDebugEnabled } from './config.js';
import { WalletUI } from './components/WalletUI.js';
import { WebSocketService } from './services/WebSocket.js';
import { ViewOrders } from './components/ViewOrders.js';
import { MyOrders } from './components/MyOrders.js';
import { TakerOrders } from './components/TakerOrders.js';
import { Cleanup } from './components/Cleanup.js';
import { ContractParams } from './components/ContractParams.js';
import { PricingService } from './services/PricingService.js';
import { createLogger } from './services/LogService.js';
import { DebugPanel } from './components/DebugPanel.js';

class App {
    constructor() {
        this.isInitializing = false;
        
        // Replace debug initialization with LogService
        const logger = createLogger('APP');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);

        this.debug('App constructor called');
        
        // Initialize CreateOrder first
        this.components = {
            'create-order': new CreateOrder()
        };
        
        // Render CreateOrder immediately
        this.components['create-order'].initialize();
        
        // Then initialize other components that might depend on CreateOrder's DOM elements
        this.components = {
            ...this.components,  // Keep CreateOrder
            'wallet-info': new WalletUI(),
            'view-orders': new ViewOrders(),
            'my-orders': new MyOrders(),
            'taker-orders': new TakerOrders(),
            'cleanup-orders': new Cleanup(),
            'contract-params': new ContractParams()
        };

        // Render wallet UI immediately
        this.walletUI = new WalletUI();
        
        this.handleConnectWallet = async (e) => {
            e && e.preventDefault();
            await this.connectWallet();
        };

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
        const debugPanel = new DebugPanel();

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

        // Add new property to track WebSocket readiness
        this.wsInitialized = false;

        // Add loading overlay to main content
        const mainContent = document.querySelector('.main-content');
        this.loadingOverlay = document.createElement('div');
        this.loadingOverlay.className = 'loading-overlay';
        this.loadingOverlay.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading orders...</div>
        `;
        document.body.appendChild(this.loadingOverlay);

        // Keep main content hidden initially
        mainContent.style.display = 'none';

        // Initialize theme handling
        this.initializeTheme();

        // Add a debounce mechanism for reinitialization
        let reinitializationTimeout = null;
        let isReinitializing = false;

        async function reinitializeComponents(walletAddress) {
            // Prevent multiple concurrent reinitializations
            if (isReinitializing) {
                console.log('[App] Already reinitializing, skipping...');
                return;
            }

            // Clear any pending reinitialization
            if (reinitializationTimeout) {
                clearTimeout(reinitializationTimeout);
            }

            // Set flag and schedule reinitialization
            isReinitializing = true;
            reinitializationTimeout = setTimeout(async () => {
                try {
                    console.log('[App] Reinitializing components with wallet...');
                    // ... existing reinitialization code ...
                } finally {
                    isReinitializing = false;
                    reinitializationTimeout = null;
                }
            }, 100); // Small delay to coalesce multiple events
        }

        // Update the wallet event handlers to use the debounced reinitialization
        window.addEventListener('walletConnected', (event) => {
            const { address } = event.detail;
            console.log('[App] Wallet connected:', address);
            reinitializeComponents(address);
        });

        window.addEventListener('chainChanged', (event) => {
            const { chainId } = event.detail;
            console.log('[App] Chain changed:', chainId);
            reinitializeComponents(window.ethereum.selectedAddress);
        });

        this.lastDisconnectNotification = 0;
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
        if (this.isInitializing) {
            console.log('[App] Already initializing, skipping...');
            return;
        }

        this.isInitializing = true;
        try {
            this.debug('Starting initialization...');
            
            // Add this line at the start
            const mainContent = document.querySelector('.main-content');
            
            window.walletManager = walletManager;
            await walletManager.init(true);
            
            // Initialize PricingService first and make it globally available
            window.pricingService = new PricingService();
            await window.pricingService.initialize();
            
            // Initialize WebSocket with the global pricingService
            window.webSocket = new WebSocketService({ 
                pricingService: window.pricingService 
            });
            
            // Subscribe to orderSyncComplete event before initialization
            window.webSocket.subscribe('orderSyncComplete', () => {
                this.wsInitialized = true;
                this.loadingOverlay.remove();
                this.debug('WebSocket order sync complete, showing content');
            });
            
            const wsInitialized = await window.webSocket.initialize();
            if (!wsInitialized) {
                this.debug('WebSocket initialization failed, falling back to HTTP');
                // Still remove overlay in case of failure
                this.loadingOverlay.remove();
            }
            
            await this.initializeComponents(true);
            
            // Add this line near the end, before removing loading overlay
            setTimeout(() => {
                this.loadingOverlay.remove();
                mainContent.style.display = 'block'; // Show content after initialization
                mainContent.classList.add('initialized');
                this.debug('Initialization complete');
            }, 500); // Small delay to ensure loading animation is visible
        } catch (error) {
            this.debug('Initialization error:', error);
            // Still show content in case of error
            mainContent?.classList.add('initialized');
            // Remove overlay in case of error
            this.loadingOverlay.remove();
        } finally {
            this.isInitializing = false;
        }
    }

    async initializeComponents(readOnlyMode) {
        try {
            this.debug('Initializing components in ' + 
                (readOnlyMode ? 'read-only' : 'connected') + ' mode');
            
            // Only initialize the current tab's component
            const currentComponent = this.components[this.currentTab];
            if (currentComponent && typeof currentComponent.initialize === 'function') {
                this.debug(`Initializing current component: ${this.currentTab}`);
                try {
                    await currentComponent.initialize(readOnlyMode);
                } catch (error) {
                    console.error(`[App] Error initializing ${this.currentTab}:`, error);
                }
            }
            
            // Show the current tab
            this.showTab(this.currentTab);
            
            this.debug('Component initialized');
        } catch (error) {
            console.error('[App] Error initializing component:', error);
            this.showError("Component failed to initialize. Limited functionality available.");
        }
    }

    async connectWallet() {
        const loader = this.showLoader();
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
        // Debounce notifications by checking last notification time
        const now = Date.now();
        if (now - this.lastDisconnectNotification < 1000) { // 1 second debounce
            return;
        }
        this.lastDisconnectNotification = now;
        
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
        
        this.showSuccess(
            "Wallet disconnected from site. For complete disconnection:\n" +
            "1. Click MetaMask extension\n" +
            "2. Click globe icon with a green dot\n" +
            "3. Select 'Disconnect'"
        );
    }

    handleAccountChange(account) {
        
    }

    handleChainChange(chainId) {
        
    }

    showLoader(container = document.body) {
        const loader = document.createElement('div');
        loader.className = 'loading-overlay';
        loader.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading...</div>
        `;
        
        if (container !== document.body) {
            container.style.position = 'relative';
        }
        container.appendChild(loader);
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
            
            // Add loading overlay before initialization
            const tabContent = document.getElementById(tabId);
            const loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'loading-overlay';
            loadingOverlay.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading...</div>
            `;
            if (tabContent) {
                tabContent.style.position = 'relative';
                tabContent.appendChild(loadingOverlay);
            }
            
            // Cleanup previous tab's component if it exists
            const previousComponent = this.components[this.currentTab];
            if (previousComponent?.cleanup) {
                previousComponent.cleanup();
            }
            
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
            
            // Show and initialize selected tab
            if (tabContent) {
                tabContent.classList.add('active');
                
                // Initialize component if it exists and hasn't been initialized
                const component = this.components[tabId];
                if (component?.initialize) {
                    const readOnlyMode = !window.walletManager?.provider;
                    await component.initialize(readOnlyMode);
                }
                
                // Remove loading overlay after initialization
                loadingOverlay.remove();
            }
            
            this.currentTab = tabId;
            this.debug('Tab switch complete:', tabId);
        } catch (error) {
            console.error('[App] Error showing tab:', error);
            // Ensure loading overlay is removed even if there's an error
            const loadingOverlay = document.querySelector('.loading-overlay');
            if (loadingOverlay) loadingOverlay.remove();
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
            
            // Clean up all components first
            Object.values(this.components).forEach(component => {
                if (component?.cleanup && component.initialized) {
                    try {
                        component.cleanup();
                    } catch (error) {
                        console.warn(`Error cleaning up component:`, error);
                    }
                }
            });
            
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
        } catch (error) {
            console.error('[App] Error reinitializing components:', error);
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

    // Add this new method
    initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-theme');
                const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
            });
        }

        // Optional: Check system preference on first visit
        if (!localStorage.getItem('theme')) {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
            localStorage.setItem('theme', prefersDark ? 'dark' : 'light');
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.app = new App();
        window.app.initializeEventListeners();
        window.app.showTab(window.app.currentTab);
        
        // Add network config button event listener here
        const networkConfigButton = document.querySelector('.network-config-button');
        if (networkConfigButton) {
            networkConfigButton.addEventListener('click', showAppParametersPopup);
        }
        
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
    const networkConfigs = getNetworkConfig();
    const contractAddress = networkConfigs.contractAddress || 'N/A';
    const currentChainId = networkConfigs.chainId || 'N/A';

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
    
    // Add event listener before adding to DOM
    const closeButton = popup.querySelector('.close-popup');
    closeButton.addEventListener('click', () => popup.remove());
    
    document.body.appendChild(popup);
}

