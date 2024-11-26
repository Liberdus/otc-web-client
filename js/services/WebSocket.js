import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';

export class WebSocketService {
    constructor() {
        this.provider = null;
        this.subscribers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.orderCache = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        try {
            if (this.isInitialized) return true;
            console.log('[WebSocket] Starting initialization...');

            const config = getNetworkConfig();
            console.log('[WebSocket] Network config loaded, connecting to:', config.wsUrl);
            
            this.provider = new ethers.providers.WebSocketProvider(config.wsUrl);
            
            // Wait for provider to be ready
            await this.provider.ready;
            console.log('[WebSocket] Provider ready');

            const contract = new ethers.Contract(
                config.contractAddress,
                config.contractABI,
                this.provider
            );

            console.log('[WebSocket] Contract initialized, starting order sync...');
            await this.syncAllOrders(contract);
            console.log('[WebSocket] Setting up event listeners...');
            await this.setupEventListeners(contract);
            
            this.isInitialized = true;
            console.log('[WebSocket] Initialization complete');
            this.reconnectAttempts = 0;
            
            return true;
        } catch (error) {
            console.error('[WebSocket] Initialization failed:', error);
            return this.reconnect();
        }
    }

    async setupEventListeners(contract) {
        try {
            console.log('[WebSocket] Setting up event listeners for contract:', contract.address);
            
            // Add connection state tracking
            this.provider.on("connect", () => {
                console.log('[WebSocket] Provider connected');
            });
            
            this.provider.on("disconnect", (error) => {
                console.error('[WebSocket] Provider disconnected:', error);
                this.reconnect();
            });

            // Test event subscription
            const filter = contract.filters.OrderCreated();
            console.log('[WebSocket] Created filter:', filter);
            
            // Listen for new blocks to ensure connection is alive
            this.provider.on("block", (blockNumber) => {
                console.log('[WebSocket] New block received:', blockNumber);
            });

            contract.on("OrderCreated", (...args) => {
                try {
                    console.log('[WebSocket] OrderCreated event received (raw):', args);
                    const [orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, fee, event] = args;
                    
                    const orderData = {
                        id: orderId.toNumber(),
                        maker,
                        taker,
                        sellToken,
                        sellAmount,
                        buyToken,
                        buyAmount,
                        timestamp: timestamp.toNumber(),
                        orderCreationFee: fee,
                        status: 'Active'
                    };
                    
                    console.log('[WebSocket] Processed OrderCreated data:', orderData);
                    
                    // Update cache
                    this.orderCache.set(orderId.toNumber(), orderData);
                    console.log('[WebSocket] Cache updated:', Array.from(this.orderCache.entries()));
                    
                    // Log subscribers before notification
                    console.log('[WebSocket] Current subscribers for OrderCreated:', 
                        this.subscribers.get("OrderCreated")?.size || 0);
                    
                    this.notifySubscribers("OrderCreated", orderData);
                } catch (error) {
                    console.error('[WebSocket] Error in OrderCreated handler:', error);
                }
            });

            contract.on("OrderFilled", (...args) => {
                const [orderId] = args;
                const orderIdNum = orderId.toNumber();
                const order = this.orderCache.get(orderIdNum);
                if (order) {
                    order.status = 'Filled';
                    this.orderCache.set(orderIdNum, order);
                    console.log('[WebSocket] Cache updated for filled order:', order);
                    this.notifySubscribers("OrderFilled", order);
                }
            });

            contract.on("OrderCanceled", (orderId, maker, timestamp, event) => {
                const order = this.orderCache.get(orderId.toNumber());
                if (order) {
                    order.status = 'Canceled';
                    this.updateOrderCache(orderId.toNumber(), order);
                    this.notifySubscribers("OrderCanceled", order);
                }
            });
            
            console.log('[WebSocket] Event listeners setup complete');
        } catch (error) {
            console.error('[WebSocket] Error setting up event listeners:', error);
        }
    }

    async syncAllOrders(contract) {
        try {
            console.log('[WebSocket] Starting order sync with contract:', contract.address);
            
            // Try reading a simple view function first to verify contract access
            try {
                const maxCleanupBatch = await contract.MAX_CLEANUP_BATCH();
                console.log('[WebSocket] MAX_CLEANUP_BATCH:', maxCleanupBatch.toString());
            } catch (error) {
                console.error('[WebSocket] Failed to read MAX_CLEANUP_BATCH:', error);
            }

            // Try getting firstOrderId with explicit error handling
            let firstOrderId = 0;  // Default to 0 if call fails
            try {
                console.log('[WebSocket] Calling firstOrderId...');
                firstOrderId = await contract.firstOrderId();
                console.log('[WebSocket] firstOrderId result:', firstOrderId.toString());
            } catch (error) {
                console.warn('[WebSocket] firstOrderId call failed, using default value:', error);
            }

            // Try getting nextOrderId with explicit error handling
            let nextOrderId = 0;  // Default to 0 if call fails
            try {
                console.log('[WebSocket] Calling nextOrderId...');
                nextOrderId = await contract.nextOrderId();
                console.log('[WebSocket] nextOrderId result:', nextOrderId.toString());
            } catch (error) {
                console.warn('[WebSocket] nextOrderId call failed, using default value:', error);
            }

            // If both calls failed, try reading a single order
            if (firstOrderId === 0 && nextOrderId === 0) {
                try {
                    console.log('[WebSocket] Attempting to read order 0...');
                    const order = await contract.orders(0);
                    console.log('[WebSocket] Order 0 result:', order);
                } catch (error) {
                    console.error('[WebSocket] Failed to read order 0:', error);
                    // If we can't read any orders, return empty cache
                    this.orderCache.clear();
                    this.notifySubscribers('orderSyncComplete', {});
                    return;
                }
            }
            
            console.log('[WebSocket] Syncing orders from', firstOrderId.toString(), 'to', nextOrderId.toString());
            
            for (let i = firstOrderId; i < nextOrderId; i++) {
                try {
                    const order = await contract.orders(i);
                    if (order.maker !== ethers.constants.AddressZero) {
                        const orderData = {
                            id: i,
                            maker: order.maker,
                            taker: order.taker,
                            sellToken: order.sellToken,
                            sellAmount: order.sellAmount,
                            buyToken: order.buyToken,
                            buyAmount: order.buyAmount,
                            timestamp: order.timestamp.toNumber(),
                            status: ['Active', 'Filled', 'Canceled'][order.status],
                            orderCreationFee: order.orderCreationFee,
                            tries: order.tries
                        };
                        this.orderCache.set(i, orderData);
                    }
                } catch (error) {
                    console.warn(`[WebSocket] Failed to read order ${i}:`, error);
                    continue;
                }
            }
            
            console.log('[WebSocket] Order sync complete:', Object.fromEntries(this.orderCache));
            this.notifySubscribers('orderSyncComplete', Object.fromEntries(this.orderCache));
            
        } catch (error) {
            console.error('[WebSocket] Order sync failed:', error);
            // Don't throw - instead handle gracefully
            this.orderCache.clear();
            this.notifySubscribers('orderSyncComplete', {});
        }
    }

    getOrders(filterStatus = null) {
        const orders = Array.from(this.orderCache.values());
        if (filterStatus) {
            return orders.filter(order => order.status === filterStatus);
        }
        return orders;
    }

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Max reconnection attempts reached');
            return false;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`[WebSocket] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.initialize();
    }

    subscribe(eventName, callback) {
        if (!this.subscribers.has(eventName)) {
            this.subscribers.set(eventName, new Set());
        }
        this.subscribers.get(eventName).add(callback);
    }

    unsubscribe(eventName, callback) {
        if (this.subscribers.has(eventName)) {
            this.subscribers.get(eventName).delete(callback);
        }
    }

    // Example method to listen to contract events
    listenToContractEvents(contract, eventName) {
        if (!this.provider) {
            throw new Error('WebSocket not initialized');
        }

        contract.on(eventName, (...args) => {
            const event = args[args.length - 1]; // Last argument is the event object
            const subscribers = this.subscribers.get(eventName);
            if (subscribers) {
                subscribers.forEach(callback => callback(event));
            }
        });
    }

    updateOrderCache(orderId, orderData) {
        this.orderCache.set(orderId, orderData);
    }

    removeOrder(orderId) {
        this.orderCache.delete(orderId);
    }

    notifySubscribers(eventName, data) {
        console.log('[WebSocket] Notifying subscribers for event:', eventName);
        const subscribers = this.subscribers.get(eventName);
        if (subscribers) {
            console.log('[WebSocket] Found', subscribers.size, 'subscribers');
            subscribers.forEach(callback => {
                try {
                    console.log('[WebSocket] Calling subscriber callback');
                    callback(data);
                    console.log('[WebSocket] Subscriber callback completed');
                } catch (error) {
                    console.error('[WebSocket] Error in subscriber callback:', error);
                }
            });
        } else {
            console.log('[WebSocket] No subscribers found for event:', eventName);
        }
    }

    async checkContractState(contract) {
        try {
            // Get deployer/owner address
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            const currentAccount = accounts[0];
            
            console.log('[WebSocket] Contract state check:', {
                address: contract.address,
                currentAccount,
                bytecodeExists: await contract.provider.getCode(contract.address) !== '0x'
            });
            
            return true;
        } catch (error) {
            console.error('[WebSocket] Contract state check failed:', error);
            return false;
        }
    }
}
