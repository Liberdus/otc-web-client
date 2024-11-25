import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';

export class WebSocketService {
    constructor() {
        this.subscribers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        this.isInitialized = false;
        this.activeOrders = new Map();
        this.expiredOrders = new Map();
        this.canceledOrders = new Map();
        this.BLOCKS_TO_SYNC = 115200; // ~20 days worth of blocks (assuming 15s block time)
        this.isInitialSyncComplete = false;
    }

    async initialize() {
        try {
            // Wait for wallet initialization
            await window.walletInitialized;
            
            // Wait for contract configuration
            if (!window.walletManager?.isInitialized) {
                console.log('[WebSocket] Waiting for wallet manager initialization...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.initialize();
            }

            // Verify contract configuration exists
            if (!window.walletManager?.contractAddress || !window.walletManager?.contractABI) {
                throw new Error('Contract configuration not found. Ensure wallet is properly initialized.');
            }

            // Use network config RPC URLs with fallback support
            const networkConfig = getNetworkConfig();
            this.provider = await this.initializeProvider(networkConfig);

            // Initialize contract first
            await this.setupEventListeners();
            
            // Then do initial sync after contract is set up
            await this.performInitialSync();
            
            this.isInitialized = true;
            this.isInitialSyncComplete = true;
            console.log('[WebSocket] Connected successfully');
        } catch (error) {
            console.error('[WebSocket] Initialization error:', error);
            this.handleConnectionError();
        }
    }

    async initializeProvider(config) {
        let provider;
        let lastError;

        // Try main RPC URL first
        try {
            console.log('[WebSocket] Trying main RPC URL:', config.rpcUrl);
            provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
            await provider.getNetwork();
            return provider;
        } catch (error) {
            console.warn('[WebSocket] Main RPC failed, trying fallbacks:', error);
            lastError = error;
        }

        // Try fallback URLs
        for (const rpcUrl of config.fallbackRpcUrls) {
            try {
                console.log('[WebSocket] Trying fallback RPC:', rpcUrl);
                provider = new ethers.providers.JsonRpcProvider(rpcUrl);
                await provider.getNetwork();
                return provider;
            } catch (error) {
                console.warn(`[WebSocket] Fallback RPC ${rpcUrl} failed:`, error);
                lastError = error;
            }
        }

        throw new Error(`Failed to connect to any RPC endpoint: ${lastError?.message}`);
    }

    async setupEventListeners() {
        try {
            console.log('[WebSocket] Setting up event listeners with config:', {
                address: window.walletManager.contractAddress,
                hasABI: !!window.walletManager.contractABI
            });

            const contract = new ethers.Contract(
                window.walletManager.contractAddress,
                window.walletManager.contractABI,
                this.provider
            );

            // Add error handler for contract calls
            const wrappedContract = new Proxy(contract, {
                get: (target, prop) => {
                    const original = target[prop];
                    if (typeof original === 'function') {
                        return async (...args) => {
                            try {
                                return await original.apply(target, args);
                            } catch (error) {
                                if (error.code === 'CALL_EXCEPTION' || 
                                    (error.rpcError && error.rpcError.code === -32000)) {
                                    throw new ContractError(
                                        CONTRACT_ERRORS.MISSING_ORDER.message,
                                        CONTRACT_ERRORS.MISSING_ORDER.code,
                                        { originalError: error }
                                    );
                                }
                                throw error;
                            }
                        };
                    }
                    return original;
                }
            });

            this.contract = wrappedContract;

            // Listen for new orders
            this.contract.on('OrderCreated', (...args) => {
                const orderId = args[0].toString();  // First arg is orderId
                this.activeOrders.set(orderId, args);
                this.notifySubscribers('orderCreated', args);
            });

            // Listen for orders becoming inactive
            this.contract.on('OrderFilled', (orderId) => {
                this.activeOrders.delete(orderId.toString());
                this.notifySubscribers('orderFilled', orderId);
            });

            this.contract.on('OrderCanceled', (orderId) => {
                this.activeOrders.delete(orderId.toString());
                this.notifySubscribers('orderCanceled', orderId);
            });

            console.log('[WebSocket] Event listeners setup complete');
        } catch (error) {
            console.error('[WebSocket] Error setting up event listeners:', error);
            throw error;
        }
    }

    setupConnectionMonitoring() {
        this.provider._websocket.on('close', () => {
            console.log('[WebSocket] Connection closed');
            this.handleConnectionError();
        });
    }

    async handleConnectionError() {
        const errorDetails = {
            attempts: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            provider: {
                network: this.provider?._network,
                ready: this.provider?._ready,
                websocket: {
                    readyState: this.provider?._websocket?.readyState,
                    url: this.provider?._websocket?.url
                }
            }
        };

        console.log('[WebSocket] Connection error details:', JSON.stringify(errorDetails, null, 2));

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Max reconnection attempts reached', errorDetails);
            this.notifySubscribers('error', { 
                code: 'WS_CONNECTION_FAILED',
                message: 'WebSocket connection failed after multiple attempts',
                details: errorDetails
            });
            return;
        }

        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
            30000 // Max 30 second delay
        );
        
        console.log(`[WebSocket] Attempting reconnection ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        // Clear existing listeners before reconnecting
        if (this.contract) {
            this.contract.removeAllListeners();
        }
        
        setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                await this.initialize();
                console.log('[WebSocket] Reconnection successful');
                this.notifySubscribers('reconnected', {
                    attempts: this.reconnectAttempts,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('[WebSocket] Reconnection failed:', error);
                this.handleConnectionError();
            }
        }, delay);
    }

    subscribe(eventType, callback) {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, new Set());
        }
        this.subscribers.get(eventType).add(callback);
    }

    unsubscribe(eventType, callback) {
        if (this.subscribers.has(eventType)) {
            this.subscribers.get(eventType).delete(callback);
        }
    }

    notifySubscribers(eventType, data) {
        if (this.subscribers.has(eventType)) {
            // Handle contract errors
            if (data instanceof ContractError) {
                this.subscribers.get(eventType).forEach(callback => 
                    callback({ error: data })
                );
                return;
            }
            this.subscribers.get(eventType).forEach(callback => callback(data));
        }
    }

    cleanup() {
        if (this.contract) {
            this.contract.removeAllListeners();
        }
        if (this.provider) {
            this.provider._websocket.close();
        }
    }

    async performInitialSync() {
        try {
            console.log('[WebSocket] Starting initial sync...');
            
            const currentBlock = await this.provider.getBlockNumber();
            const startBlock = Math.max(0, currentBlock - this.BLOCKS_TO_SYNC);
            
            // Get all relevant events
            const [createdEvents, filledEvents, canceledEvents, cleanedEvents] = await Promise.all([
                this.contract.queryFilter(this.contract.filters.OrderCreated(), startBlock, currentBlock),
                this.contract.queryFilter(this.contract.filters.OrderFilled(), startBlock, currentBlock),
                this.contract.queryFilter(this.contract.filters.OrderCanceled(), startBlock, currentBlock),
                this.contract.queryFilter(this.contract.filters.OrderCleanedUp(), startBlock, currentBlock)
            ]);

            // Create separate Sets for different inactive states
            const filledOrderIds = new Set(filledEvents.map(e => e.args.orderId.toString()));
            const canceledOrderIds = new Set(canceledEvents.map(e => e.args.orderId.toString()));
            const cleanedOrderIds = new Set(cleanedEvents.map(e => e.args.orderId.toString()));

            // Process created events
            const now = Math.floor(Date.now() / 1000);
            const EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

            for (const event of createdEvents) {
                const orderId = event.args.orderId.toString();
                const orderAge = now - event.args.timestamp;
                
                // Skip if order was filled or cleaned up
                if (filledOrderIds.has(orderId) || cleanedOrderIds.has(orderId)) {
                    continue;
                }

                // Track cancelled orders
                if (canceledOrderIds.has(orderId)) {
                    this.canceledOrders.set(orderId, event.args);
                    continue;
                }

                // Sort into active or expired
                if (orderAge > EXPIRY) {
                    this.expiredOrders.set(orderId, event.args);
                } else {
                    this.activeOrders.set(orderId, event.args);
                }
            }

            console.log('[WebSocket] Sync complete:', {
                active: this.activeOrders.size,
                expired: this.expiredOrders.size,
                canceled: this.canceledOrders.size
            });
        } catch (error) {
            console.error('[WebSocket] Sync error:', error);
            throw error;
        }
    }

    // Methods to access orders
    getActiveOrders() {
        return Array.from(this.activeOrders.values());
    }

    getExpiredOrders() {
        return Array.from(this.expiredOrders.values());
    }

    getCanceledOrders() {
        return Array.from(this.canceledOrders.values());
    }
}

class ContractError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'ContractError';
        this.code = code;
        this.details = details;
    }
}

const CONTRACT_ERRORS = {
    INVALID_ORDER: {
        code: 'ORDER_001',
        message: 'Order does not exist'
    },
    INACTIVE_ORDER: {
        code: 'ORDER_002',
        message: 'Order is not active'
    },
    EXPIRED_ORDER: {
        code: 'ORDER_003',
        message: 'Order has expired'
    },
    MISSING_ORDER: {
        code: 'ORDER_004',
        message: 'Order not found or missing'
    }
};
