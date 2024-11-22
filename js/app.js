import { BaseComponent } from './components/BaseComponent.js';
import { CreateOrder } from './components/CreateOrder.js';
import { walletManager, WalletManager, getNetworkConfig } from './config.js';
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
        
        this.showSuccess("Wallet connected successfully!");
    }

    handleWalletDisconnect() {
        
        this.showError("Wallet disconnected");
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
