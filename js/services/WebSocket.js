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
        contract.on("OrderCreated", (orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, fee, event) => {
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
            this.updateOrderCache(orderId.toNumber(), orderData);
            this.notifySubscribers("OrderCreated", orderData);
        });

        contract.on("OrderFilled", (orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, event) => {
            const order = this.orderCache.get(orderId.toNumber());
            if (order) {
                order.status = 'Filled';
                this.updateOrderCache(orderId.toNumber(), order);
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
    }

    async syncAllOrders(contract) {
        try {
            const firstOrderId = await contract.firstOrderId();
            const nextOrderId = await contract.nextOrderId();
            
            console.log('[WebSocket] Syncing orders from', firstOrderId.toString(), 'to', nextOrderId.toString());
            
            for (let i = firstOrderId.toNumber(); i < nextOrderId.toNumber(); i++) {
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
            }
            
            console.log('[WebSocket] Order sync complete:', Object.fromEntries(this.orderCache));
            this.notifySubscribers('orderSyncComplete', Object.fromEntries(this.orderCache));
            
        } catch (error) {
            console.error('[WebSocket] Order sync failed:', error);
            throw error;
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
        const subscribers = this.subscribers.get(eventName);
        if (subscribers) {
            subscribers.forEach(callback => callback(data));
        }
    }
}
