import { ethers } from 'ethers';

export class WebSocketService {
    constructor() {
        this.subscribers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        this.isInitialized = false;
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

            await this.setupEventListeners();
            
            this.isInitialized = true;
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

            // Store contract instance
            this.contract = contract;

            // Listen for contract events and handle potential errors
            contract.on('OrderCreated', (...args) => {
                try {
                    const [orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, fee] = args;
                    
                    // Validate order data
                    if (!orderId || !maker || !sellToken || !buyToken) {
                        throw new ContractError(
                            CONTRACT_ERRORS.INVALID_ORDER.message,
                            CONTRACT_ERRORS.INVALID_ORDER.code,
                            { orderId, maker }
                        );
                    }

                    this.notifySubscribers('orderCreated', {
                        orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, fee
                    });
                } catch (error) {
                    if (error instanceof ContractError) {
                        console.error('[WebSocket] Contract error:', {
                            code: error.code,
                            message: error.message,
                            details: error.details
                        });
                    }
                    this.notifySubscribers('error', error);
                }
            });

            // Example of handling order fill attempts
            contract.on('OrderFilled', async (...args) => {
                try {
                    const [orderId, maker, taker] = args;
                    
                    // Check order status before processing
                    const orderStatus = await contract.getOrderStatus(orderId);
                    if (orderStatus === 0) { // Assuming 0 means inactive
                        throw new ContractError(
                            CONTRACT_ERRORS.INACTIVE_ORDER.message,
                            CONTRACT_ERRORS.INACTIVE_ORDER.code,
                            { orderId }
                        );
                    }

                    // Check authorization
                    if (taker !== window.walletManager.currentAddress) {
                        throw new ContractError(
                            CONTRACT_ERRORS.UNAUTHORIZED.message,
                            CONTRACT_ERRORS.UNAUTHORIZED.code,
                            { orderId, taker }
                        );
                    }

                    // Process the fill event
                    this.notifySubscribers('orderFilled', {
                        orderId, maker, taker, ...args
                    });
                } catch (error) {
                    if (error instanceof ContractError) {
                        console.error('[WebSocket] Order fill error:', {
                            code: error.code,
                            message: error.message,
                            details: error.details
                        });
                        // Notify UI of specific error
                        this.notifySubscribers('error', {
                            type: 'orderFill',
                            code: error.code,
                            message: error.message
                        });
                    }
                }
            });

            // Example of handling token allowance checks
            contract.on('PreOrderCheck', async (orderId, maker, sellToken, sellAmount) => {
                try {
                    const tokenContract = new ethers.Contract(
                        sellToken,
                        ['function allowance(address,address) view returns (uint256)'],
                        this.provider
                    );

                    const allowance = await tokenContract.allowance(maker, contract.address);
                    if (allowance.lt(sellAmount)) {
                        throw new ContractError(
                            CONTRACT_ERRORS.INSUFFICIENT_ALLOWANCE.message,
                            CONTRACT_ERRORS.INSUFFICIENT_ALLOWANCE.code,
                            { 
                                orderId,
                                maker,
                                required: sellAmount.toString(),
                                current: allowance.toString()
                            }
                        );
                    }
                } catch (error) {
                    if (error instanceof ContractError) {
                        console.error('[WebSocket] Allowance check failed:', {
                            code: error.code,
                            message: error.message,
                            details: error.details
                        });
                        this.notifySubscribers('error', error);
                    }
                }
            });

            // Listen for OrderCanceled events
            contract.on('OrderCanceled', (...args) => {
                console.log('[WebSocket] OrderCanceled event received:', args);
                const [orderId, maker, timestamp] = args;
                this.notifySubscribers('orderCanceled', { orderId, maker, timestamp });
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
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Max reconnection attempts reached');
            this.notifySubscribers('error', { 
                code: 'WS_CONNECTION_FAILED',
                message: 'WebSocket connection failed after multiple attempts',
                attempts: this.reconnectAttempts
            });
            return;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        console.log(`[WebSocket] Reconnecting in ${delay}ms...`);
        
        // Clear existing listeners before reconnecting
        if (this.contract) {
            this.contract.removeAllListeners();
        }
        
        setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                await this.initialize();
                this.notifySubscribers('reconnected', {
                    attempts: this.reconnectAttempts
                });
            } catch (error) {
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
    INSUFFICIENT_BALANCE: {
        code: 'TOKEN_001',
        message: 'Insufficient balance for sell token'
    },
    INSUFFICIENT_ALLOWANCE: {
        code: 'TOKEN_002',
        message: 'Insufficient allowance for sell token'
    },
    UNAUTHORIZED: {
        code: 'AUTH_001',
        message: 'Not authorized to perform this action'
    }
};
