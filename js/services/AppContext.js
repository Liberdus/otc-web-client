/**
 * AppContext - Centralized dependency container for the application
 * 
 * Provides a single point of access for all shared services, replacing
 * scattered window.* globals with a structured, testable interface.
 * 
 * Usage:
 *   // In app.js, create and populate the context:
 *   const ctx = createAppContext();
 *   ctx.wallet = walletManager;
 *   ctx.ws = webSocketService;
 *   // ...
 * 
 *   // Pass to components:
 *   component.setContext(ctx);
 * 
 *   // In components, access via this.ctx:
 *   const account = this.ctx.wallet.getAccount();
 *   const orders = this.ctx.ws.getOrders();
 */

/**
 * @typedef {Object} AppContext
 * @property {Object} wallet - WalletManager instance
 * @property {Object} ws - WebSocketService instance  
 * @property {Object} pricing - PricingService instance
 * @property {Object} toast - Toast functions (showError, showSuccess, etc.)
 * @property {Object} contractService - ContractService instance
 */

/**
 * Creates a new AppContext with null/undefined values
 * Values are populated by App during initialization
 * @returns {AppContext}
 */
export function createAppContext() {
    return {
        // Core services (set by App during load)
        wallet: null,
        ws: null,
        pricing: null,
        contractService: null,
        
        // Toast functions
        toast: {
            showError: null,
            showSuccess: null,
            showWarning: null,
            showInfo: null,
        },
        
        /**
         * Check if context is fully initialized
         * @returns {boolean}
         */
        isReady() {
            return !!(this.wallet && this.ws);
        },
        
        /**
         * Get wallet manager (with global fallback for backward compatibility)
         * @returns {Object|null}
         */
        getWallet() {
            return this.wallet || window.walletManager || null;
        },
        
        /**
         * Get WebSocket service (with global fallback for backward compatibility)
         * @returns {Object|null}
         */
        getWebSocket() {
            return this.ws || window.webSocket || null;
        },
        
        /**
         * Get pricing service (with global fallback for backward compatibility)
         * @returns {Object|null}
         */
        getPricing() {
            return this.pricing || window.pricingService || null;
        },
        
        /**
         * Show error toast (with global fallback)
         * @param {string} message
         * @param {number} duration
         */
        showError(message, duration = 0) {
            const fn = this.toast.showError || window.showError;
            if (fn) return fn(message, duration);
            console.error('[AppContext] showError:', message);
        },
        
        /**
         * Show success toast (with global fallback)
         * @param {string} message
         * @param {number} duration
         */
        showSuccess(message, duration = 5000) {
            const fn = this.toast.showSuccess || window.showSuccess;
            if (fn) return fn(message, duration);
            console.log('[AppContext] showSuccess:', message);
        },
        
        /**
         * Show warning toast (with global fallback)
         * @param {string} message
         * @param {number} duration
         */
        showWarning(message, duration = 5000) {
            const fn = this.toast.showWarning || window.showWarning;
            if (fn) return fn(message, duration);
            console.warn('[AppContext] showWarning:', message);
        },
        
        /**
         * Show info toast (with global fallback)
         * @param {string} message
         * @param {number} duration
         */
        showInfo(message, duration = 5000) {
            const fn = this.toast.showInfo || window.showInfo;
            if (fn) return fn(message, duration);
            console.log('[AppContext] showInfo:', message);
        }
    };
}

/**
 * Global context instance (for backward compatibility during migration)
 * Components can import this directly, but prefer receiving context via setContext()
 */
let globalContext = null;

/**
 * Get or create the global context instance
 * @returns {AppContext}
 */
export function getAppContext() {
    if (!globalContext) {
        globalContext = createAppContext();
    }
    return globalContext;
}

/**
 * Set the global context instance (called by App during initialization)
 * @param {AppContext} ctx
 */
export function setGlobalContext(ctx) {
    globalContext = ctx;
    // Also expose on window for debugging
    window.appContext = ctx;
}
