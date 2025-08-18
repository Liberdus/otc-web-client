import { BaseComponent } from './components/BaseComponent.js';
import { CreateOrder } from './components/CreateOrder.js';
import { walletManager, WalletManager, getNetworkConfig, getAllNetworks, isDebugEnabled, getNetworkById, APP_BRAND, APP_LOGO } from './config.js';
import { WalletUI } from './components/WalletUI.js';
import { WebSocketService } from './services/WebSocket.js';
import { ViewOrders } from './components/ViewOrders.js';
import { MyOrders } from './components/MyOrders.js';
import { TakerOrders } from './components/TakerOrders.js';
import { Cleanup } from './components/Cleanup.js';
import { ContractParams } from './components/ContractParams.js';
import { PricingService } from './services/PricingService.js';
import { contractService } from './services/ContractService.js';
import { createLogger } from './services/LogService.js';
import { DebugPanel } from './components/DebugPanel.js';
import { getToast, showError, showSuccess, showWarning, showInfo } from './components/Toast.js';
import { Footer } from './components/Footer.js';
import { Intro } from './components/Intro.js';
import { versionService } from './services/VersionService.js';

class App {
	constructor() {
		this.isInitializing = false;
		
		// Replace debug initialization with LogService
		const logger = createLogger('APP');
		this.debug = logger.debug.bind(logger);
		this.error = logger.error.bind(logger);
		this.warn = logger.warn.bind(logger);

		this.debug('App constructor called');
	}

	async load () {
		this.debug('Loading app components...');

		// Initialize toast component
		this.toast = getToast();
		this.debug('Toast component initialized');

		// Set brand in document title, header, and favicon from constants
		try {
			if (typeof APP_BRAND === 'string' && APP_BRAND.length > 0) {
				document.title = APP_BRAND;
				const headerTitle = document.querySelector('.header-left h1');
				if (headerTitle) {
					headerTitle.textContent = APP_BRAND;
				}
			}
			
			// Set favicon dynamically
			if (typeof APP_LOGO === 'string' && APP_LOGO.length > 0) {
				const favicon = document.querySelector('link[rel="icon"]');
				const shortcutIcon = document.querySelector('link[rel="shortcut icon"]');
				
				if (favicon) {
					favicon.href = APP_LOGO;
				}
				if (shortcutIcon) {
					shortcutIcon.href = APP_LOGO;
				}
			}
		} catch (e) {
			this.warn('Failed to set brand name in DOM', e);
		}

		await this.initializeWalletManager();
		await this.initializePricingService();
		await this.initializeWebSocket();
		
		// Initialize CreateOrder first
		this.components = {
			'create-order': new CreateOrder()
		};
		
		// Then initialize other components that might depend on CreateOrder's DOM elements
		this.components = {
			...this.components,  // Keep CreateOrder
			'view-orders': new ViewOrders(),
			'my-orders': new MyOrders(),
			'taker-orders': new TakerOrders(),
			'cleanup-orders': new Cleanup(),
			'contract-params': new ContractParams(),
			'intro': new Intro()
		};

		// Initialize wallet UI and store reference
		this.walletUI = new WalletUI();
		this.components['wallet-info'] = this.walletUI;

		// Initialize footer (persists across tabs)
		try {
			this.footer = new Footer('app-footer');
			this.footer.initialize();
		} catch (e) {
			this.warn('Footer failed to initialize', e);
		}
		
		this.handleConnectWallet = async (e) => {
			e && e.preventDefault();
			await this.connectWallet();
		};

		// Fallback for rendering components that are not CreateOrder, ViewOrders, TakerOrders, WalletUI, or Cleanup
		Object.entries(this.components).forEach(([id, component]) => {
			if (component instanceof BaseComponent && 
				!(component instanceof CreateOrder) && 
				!(component instanceof ViewOrders) &&
				!(component instanceof TakerOrders) &&
				!(component instanceof WalletUI) &&
				!(component instanceof Cleanup) &&
				!(component instanceof Intro)) {
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

        // Treat presence of signer as connected for initial render to avoid flicker
        const isInitiallyConnected = !!window.walletManager?.getSigner?.();
        this.currentTab = isInitiallyConnected ? 'create-order' : 'view-orders';

		// Add wallet connect button handler
		const walletConnectBtn = document.getElementById('walletConnect');
		if (walletConnectBtn) {
			walletConnectBtn.addEventListener('click', this.handleConnectWallet);
		}

		// Add wallet connection state handler
		walletManager.addListener(async (event, data) => {
			switch (event) {
				case 'connect': {
					this.debug('Wallet connected, reinitializing components...');
					this.updateTabVisibility(true);
					// When connected, default to create-order to avoid flicker between tabs
					this.currentTab = 'create-order';
					// Preserve WebSocket order cache to avoid clearing orders on connect
					await this.reinitializeComponents(true);
					break;
				}
				case 'disconnect': {
					this.debug('Wallet disconnected, updating tab visibility...');
					this.updateTabVisibility(false);
					break;
				}
				case 'accountsChanged': {
					try {
						this.debug('Account changed, reinitializing components...');
						await this.reinitializeComponents(true);
						if (data?.account) {
							const short = `${data.account.slice(0,6)}...${data.account.slice(-4)}`;
							this.showInfo(`Switched account to ${short}`);
						} else {
							this.showInfo('Account changed');
						}
					} catch (error) {
						console.error('[App] Error handling accountsChanged:', error);
					}
					break;
				}
				case 'chainChanged': {
					try {
						this.debug('Chain changed event received:', data?.chainId);
						const network = data?.chainId ? getNetworkById(data.chainId) : null;
						if (network?.isDefault) {
							await this.reinitializeComponents(true);
							this.showInfo(`Switched to ${network.displayName || network.name}`);
						} else {
							this.showWarning('Wrong Network. Please switch to the default network.');
						}
					} catch (error) {
						console.error('[App] Error handling chainChanged:', error);
					}
					break;
				}
			}
		});

		// Add tab switching event listeners
		this.initializeEventListeners();

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
				// always show intro, view-orders, cleanup-orders, contract-params
				if (
					button.dataset.tab === 'intro' ||
					button.dataset.tab === 'view-orders' ||
					button.dataset.tab === 'cleanup-orders' ||
					button.dataset.tab === 'contract-params'
				) {
					button.style.display = 'block';
				} else {
					button.style.display = isConnected ? 'block' : 'none';
				}
			});
			
			// If disconnected and not on view-orders tab, switch to it
			if (!isConnected && this.currentTab !== 'view-orders') {
				this.showTab('view-orders');
			}
		};

		// Update initial tab visibility based on initial connection state
		this.updateTabVisibility(!!isInitiallyConnected);

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

		// Show main content after initialization
		if (mainContent) {
			mainContent.style.display = 'block';
		}

		// Initialize theme handling
		this.initializeTheme();

		await window.webSocket.syncAllOrders();

		// Initialize components based on connection (read-only if not connected)
		const readOnlyMode = !window.walletManager?.isWalletConnected();
		// Prefer signer presence for initial render
		const initialReadOnlyMode = !isInitiallyConnected;
		await this.initializeComponents(initialReadOnlyMode);
		
		// Show the initial tab based on connection state (force read-only if needed for first paint)
		await this.showTab(this.currentTab, initialReadOnlyMode);
		
		// Remove loading overlay after initialization
		if (this.loadingOverlay && this.loadingOverlay.parentElement) {
			this.loadingOverlay.remove();
		}

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
				if (panel) {
					panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
				}
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

	async initializeWalletManager() {
		try {
			this.debug('Initializing wallet manager...');
			window.walletManager = walletManager;
			await walletManager.init(true);
			this.debug('Wallet manager initialized');
		} catch (error) {
			this.debug('Wallet manager initialization error:', error);
		}
	}

	async initializePricingService() {
		try {
			this.debug('Initializing pricing service...');
			// Ensure contract service is initialized before use
			try {
				contractService.initialize();
			} catch (e) {
				this.debug('ContractService initialize skipped/failed:', e);
			}
			// Initialize PricingService first and make it globally available
			window.pricingService = new PricingService();
			
			// Defer allowed token fetch until WebSocket/contract is ready
			// The pricing service will refresh later when WebSocket finishes init
			
			await window.pricingService.initialize();
			this.debug('Pricing service initialized');
		} catch (error) {
			this.debug('Pricing service initialization error:', error);
		}
	}

	async initializeWebSocket() {
		try {
			this.debug('Initializing WebSocket...');
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
			this.debug('WebSocket initialized');
		} catch (error) {
			this.debug('WebSocket initialization error:', error);
		}
	}

	async initializeComponents(readOnlyMode) {
		try {
			this.debug('Initializing components in ' + 
				(readOnlyMode ? 'read-only' : 'connected') + ' mode');
			
			// In read-only mode, initialize the tabs that should always be visible
			if (readOnlyMode) {
				const readOnlyTabs = ['intro', 'view-orders', 'cleanup-orders', 'contract-params'];
				for (const tabId of readOnlyTabs) {
					const component = this.components[tabId];
					if (component && typeof component.initialize === 'function') {
						this.debug(`Initializing read-only component: ${tabId}`);
						try {
							await component.initialize(readOnlyMode);
						} catch (error) {
							console.error(`[App] Error initializing ${tabId}:`, error);
						}
					}
				}
			} else {
				// In connected mode, initialize the current tab's component
				const currentComponent = this.components[this.currentTab];
				if (currentComponent && typeof currentComponent.initialize === 'function') {
					this.debug(`Initializing current component: ${this.currentTab}`);
					try {
						await currentComponent.initialize(readOnlyMode);
					} catch (error) {
						console.error(`[App] Error initializing ${this.currentTab}:`, error);
					}
				}
			}
			
			this.debug('Components initialized');
		} catch (error) {
			console.error('[App] Error initializing components:', error);
			this.showError("Component failed to initialize. Limited functionality available.");
		}
	}

	async connectWallet() {
		const loader = this.showLoader();
		try {
			await walletManager.connect();
		} catch (error) {
			// Don't show toast here - WalletUI component handles the error display
			this.error('Wallet connection failed:', error);
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
			// Force render create-order after connect
			await this.showTab('create-order');
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
			"Wallet disconnected from site."
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

	showError(message, duration = 0) {
		this.debug('Showing error toast:', message);
		return showError(message, duration);
	}

	showSuccess(message, duration = 5000) {
		this.debug('Showing success toast:', message);
		return showSuccess(message, duration);
	}

	showWarning(message, duration = 5000) {
		this.debug('Showing warning toast:', message);
		return showWarning(message, duration);
	}

	showInfo(message, duration = 5000) {
		this.debug('Showing info toast:', message);
		return showInfo(message, duration);
	}

	showToast(message, type = 'info', duration = 5000) {
		this.debug(`Showing ${type} toast:`, message);
		return this.toast.showToast(message, type, duration);
	}

	async showTab(tabId, readOnlyOverride = null) {
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
				
				// Initialize component for this tab
				const component = this.components[tabId];
				if (component?.initialize) {
					const computedReadOnly = readOnlyOverride !== null
						? !!readOnlyOverride
						: !window.walletManager?.isWalletConnected();
					await component.initialize(computedReadOnly);
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
	async reinitializeComponents(preserveOrders = false) {
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
			
			// Optionally clean up WebSocket service (clears order cache). Preserve on account/chain change.
			if (!preserveOrders && window.webSocket?.cleanup) {
				try {
					window.webSocket.cleanup();
				} catch (error) {
					console.warn(`Error cleaning up WebSocket service:`, error);
				}
			}
			
			// Create and initialize CreateOrder component when wallet is connected
			const createOrderComponent = new CreateOrder();
			this.components['create-order'] = createOrderComponent;
			await createOrderComponent.initialize(false);
			
			// Reinitialize all components in connected mode
			await this.initializeComponents(false);
			
			// Ensure WebSocket is initialized and synced when preserving orders
			if (preserveOrders && window.webSocket) {
				try {
					await window.webSocket.waitForInitialization();
					if (window.webSocket.orderCache.size === 0) {
						await window.webSocket.syncAllOrders();
					}
				} catch (e) {
					this.debug('WebSocket not ready during reinit (preserveOrders)', e);
				}
			}
			
			// Re-show the current tab
			await this.showTab(this.currentTab, !window.walletManager?.isWalletConnected());
			
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

window.app = new App();

// Make toast functions globally available for all components
window.showError = showError;
window.showSuccess = showSuccess;
window.showWarning = showWarning;
window.showInfo = showInfo;
window.getToast = getToast;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
	try {
		// Check version first, before anything else happens
		await versionService.initialize();
		
		window.app.load();
		
		// Add network config button event listener here (element doesn't exist in HTML, so commented out)
		// const networkConfigButton = document.querySelector('.network-config-button');
		// if (networkConfigButton) {
		// 	networkConfigButton.addEventListener('click', showAppParametersPopup);
		// }
		
		window.app.debug('Initialization complete');
	} catch (error) {
		console.error('[App] App initialization error:', error);
	}
});

// Network selector functionality
let networkButton, networkDropdown, networkBadge;

// Dynamically populate network options
const populateNetworkOptions = () => {
	const networks = getAllNetworks();
	
	// Check if network elements exist
	if (!networkButton || !networkDropdown || !networkBadge) {
		console.warn('Network selector elements not found');
		return;
	}
	
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
				if (networkBadge) {
					networkBadge.textContent = option.textContent;
				}
				if (networkDropdown) {
					networkDropdown.classList.add('hidden');
				}
				
				if (window.walletManager && window.walletManager.isConnected()) {
					const chainId = option.dataset.chainId;
					await window.ethereum.request({
						method: 'wallet_switchEthereumChain',
						params: [{ chainId }],
					});
				}
			} catch (error) {
				console.error('Failed to switch network:', error);
				if (networkBadge && networkButton) {
					const buttonBadge = networkButton.querySelector('.network-badge');
					if (buttonBadge) {
						networkBadge.textContent = buttonBadge.textContent;
					}
				}
				if (window.app) {
					window.app.showError('Failed to switch network: ' + error.message);
				} else {
					showError('Failed to switch network: ' + error.message);
				}
			}
		});
	});
};

// Initialize network dropdown when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	networkButton = document.querySelector('.network-button');
	networkDropdown = document.querySelector('.network-dropdown');
	networkBadge = document.querySelector('.network-badge');
	populateNetworkOptions();
});

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

