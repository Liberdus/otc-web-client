import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';
import { NETWORK_TOKENS } from '../utils/tokens.js';
import { erc20Abi } from '../abi/erc20.js';
import { createLogger } from './LogService.js';

export class WebSocketService {
    constructor() {
        this.provider = null;
        this.subscribers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.orderCache = new Map();
        this.isInitialized = false;
        this.contractAddress = null;
        this.contractABI = null;
        this.contract = null;
        
        // Add rate limiting properties
        this.requestQueue = [];
        this.processingQueue = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 100; // Increase from 100ms to 500ms between requests
        this.maxConcurrentRequests = 2; // Reduce from 3 to 1 concurrent request
        this.activeRequests = 0;
        
        // Add contract constants
        this.orderExpiry = null;
        this.gracePeriod = null;
        

        const logger = createLogger('WEBSOCKET');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
        
        this.tokenCache = new Map();  // Add token cache
    }

    async queueRequest(callback) {
        while (this.activeRequests >= this.maxConcurrentRequests) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Increase wait time
        }
        
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minRequestInterval) {
            await new Promise(resolve => 
                setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
            );
        }
        
        try {
            this.activeRequests++;
            this.debug(`Making request (active: ${this.activeRequests})`);
            const result = await callback();
            this.lastRequestTime = Date.now();
            return result;
        } catch (error) {
            if (error?.error?.code === -32005) {
                this.warn('Rate limit hit, waiting before retry...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.queueRequest(callback);
            }
            this.error('Request failed:', error);
            throw error;
        } finally {
            this.activeRequests--;
        }
    }

    async initialize() {
        if (this.isInitialized) {
            this.debug('Already initialized, skipping...');
            return;
        }

        try {
            this.debug('Starting initialization...');
            this.initializationPromise = (async () => {
                // Wait for provider connection
                const config = getNetworkConfig();
                
                const wsUrls = [config.wsUrl, ...config.fallbackWsUrls];
                let connected = false;
                
                for (const url of wsUrls) {
                    try {
                        this.debug('Attempting to connect to WebSocket URL:', url);
                        this.provider = new ethers.providers.WebSocketProvider(url);
                        
                        // Wait for provider to be ready
                        await this.provider.ready;
                        this.debug('Connected to WebSocket:', url);
                        connected = true;
                        break;
                    } catch (error) {
                        this.debug('Failed to connect to WebSocket URL:', url, error);
                    }
                }
                
                if (!connected) {
                    throw new Error('Failed to connect to any WebSocket URL');
                }

                this.debug('Fetching contract constants...');
                this.orderExpiry = await this.contract.ORDER_EXPIRY();
                this.gracePeriod = await this.contract.GRACE_PERIOD();
                this.debug('Contract constants loaded:', {
                    orderExpiry: this.orderExpiry.toString(),
                    gracePeriod: this.gracePeriod.toString()
                });
                
                // Subscribe to pricing service after everything else is ready
                if (window.pricingService) {
                    this.debug('Subscribing to pricing service...');
                    window.pricingService.subscribe(() => {
                        this.debug('Price update received, updating all deals...');
                        this.updateAllDeals();
                    });
                } else {
                    this.debug('Warning: PricingService not available');
                }
                
                this.isInitialized = true;
                this.debug('Initialization complete');
                this.reconnectAttempts = 0;
                
                return true;
            })();

            return await this.initializationPromise;
        } catch (error) {
            this.error('Initialization failed:', {
                message: error.message,
                stack: error.stack
            });
            this.initializationPromise = null;
            return this.reconnect();
        }
    }

    async waitForInitialization() {
        if (this.isInitialized) return true;
        if (this.initializationPromise) {
            return await this.initializationPromise;
        }
        return this.initialize();
    }

    async setupEventListeners(contract) {
        try {
            this.debug('Setting up event listeners for contract:', contract.address);
            
            // Add connection state tracking
            this.provider.on("connect", () => {
                this.debug('Provider connected');
            });
            
            this.provider.on("disconnect", (error) => {
                this.debug('Provider disconnected:', error);
                this.reconnect();
            });

            // Test event subscription
            const filter = contract.filters.OrderCreated();
            this.debug('Created filter:', filter);
            
            // Listen for new blocks to ensure connection is alive
            this.provider.on("block", async (blockNumber) => {
                await this.queueRequest(async () => {
                    this.debug('New block received:', blockNumber);
                });
            });

            contract.on("OrderCreated", async (...args) => {
                try {
                    const [orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, fee, event] = args;
                    
                    let orderData = {
                        id: orderId.toNumber(),
                        maker,
                        taker,
                        sellToken,
                        sellAmount,
                        buyToken,
                        buyAmount,
                        timings: {
                            createdAt: timestamp.toNumber(),
                            expiresAt: timestamp.toNumber() + this.orderExpiry.toNumber(),
                            graceEndsAt: timestamp.toNumber() + this.orderExpiry.toNumber() + this.gracePeriod.toNumber()
                        },
                        status: 'Active',
                        orderCreationFee: fee,
                        tries: 0
                    };

                    // Calculate and add deal metrics
                    orderData = await this.calculateDealMetrics(orderData);
                    
                    // Add to cache
                    this.orderCache.set(orderId.toNumber(), orderData);
                    
                    // Debug logging
                    this.debug('New order added to cache:', {
                        id: orderData.id,
                        maker: orderData.maker,
                        status: orderData.status,
                        timestamp: orderData.timings.createdAt
                    });
                    
                    // Notify subscribers
                    this.notifySubscribers("OrderCreated", orderData);
                    
                    // Force UI update
                    this.notifySubscribers("ordersUpdated", Array.from(this.orderCache.values()));
                } catch (error) {
                    this.debug('Error in OrderCreated handler:', error);
                    console.error('Failed to process OrderCreated event:', error);
                }
            });

            contract.on("OrderFilled", (...args) => {
                const [orderId] = args;
                const orderIdNum = orderId.toNumber();
                const order = this.orderCache.get(orderIdNum);
                if (order) {
                    order.status = 'Filled';
                    this.orderCache.set(orderIdNum, order);
                    this.debug('Cache updated for filled order:', order);
                    this.notifySubscribers("OrderFilled", order);
                }
            });

            contract.on("OrderCanceled", (orderId, maker, timestamp, event) => {
                const orderIdNum = orderId.toNumber();
                const order = this.orderCache.get(orderIdNum);
                if (order) {
                    order.status = 'Canceled';
                    this.orderCache.set(orderIdNum, order);
                    this.debug('Updated order to Canceled:', orderIdNum);
                    this.notifySubscribers("OrderCanceled", order);
                }
            });

            contract.on("OrderCleanedUp", (orderId) => {
                const orderIdNum = orderId.toNumber();
                if (this.orderCache.has(orderIdNum)) {
                    this.orderCache.delete(orderIdNum);
                    this.debug('Removed cleaned up order:', orderIdNum);
                    this.notifySubscribers("OrderCleanedUp", { id: orderIdNum });
                }
            });
            
            contract.on("RetryOrder", (oldOrderId, newOrderId, maker, tries, timestamp) => {
                const oldOrderIdNum = oldOrderId.toNumber();
                const newOrderIdNum = newOrderId.toNumber();
                
                const order = this.orderCache.get(oldOrderIdNum);
                if (order) {
                    order.id = newOrderIdNum;
                    order.tries = tries.toNumber();
                    order.timestamp = timestamp.toNumber();
                    
                    this.orderCache.delete(oldOrderIdNum);
                    this.orderCache.set(newOrderIdNum, order);
                    this.debug('Updated retried order:', {oldId: oldOrderIdNum, newId: newOrderIdNum, tries: tries.toString()});
                    this.notifySubscribers("RetryOrder", order);
                }
            });
            
            this.debug('Event listeners setup complete');
        } catch (error) {
            this.debug('Error setting up event listeners:', error);
        }
    }

        async syncAllOrders() {
        const config = getNetworkConfig();
        this.debug('Network config loaded, attempting WebSocket connection...');
        
        this.contractAddress = config.contractAddress;
        this.contractABI = config.contractABI;

        if (!this.contractABI) {
            throw new Error('Contract ABI not found in network config');
        }

        this.contract = new ethers.Contract(
            this.contractAddress,
            this.contractABI,
            this.provider
        );

        this.debug('Contract initialized:', {
            address: this.contract.address,
            abi: this.contract.interface.format()
        }); 

        this.debug('Contract initialized, starting order sync...');
        try {
            this.debug('Starting order sync with contract:', this.contract.address);
            
            let nextOrderId = 0;
            try {
                nextOrderId = await this.contract.nextOrderId();
                this.debug('nextOrderId result:', nextOrderId.toString());
            } catch (error) {
                this.debug('nextOrderId call failed, using default value:', error);
            }

            // Clear existing cache before sync
            this.orderCache.clear();
            
            // Process orders in smaller batches to avoid rate limiting
            const batchSize = 3; // Process only 3 orders at a time
            const totalBatches = Math.ceil(nextOrderId / batchSize);
            
            this.debug(`Processing ${nextOrderId} orders in ${totalBatches} batches of ${batchSize}`);
            
            for (let batch = 0; batch < totalBatches; batch++) {
                const startIndex = batch * batchSize;
                const endIndex = Math.min(startIndex + batchSize, nextOrderId);
                
                this.debug(`Processing batch ${batch + 1}/${totalBatches} (orders ${startIndex}-${endIndex - 1})`);
                
                                // Process current batch
                for (let i = startIndex; i < endIndex; i++) {
                    try {
                        // Add longer delay to avoid rate limiting
                        if (i > startIndex) {
                            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
                        }
                        
                        const order = await this.contract.orders(i);
                        // Only filter out zero-address makers (non-existent orders)
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
                                status: ['Active', 'Filled', 'Canceled'][order.status], // Map enum to string
                                orderCreationFee: order.orderCreationFee,
                                tries: order.tries
                            };
                            this.orderCache.set(i, orderData);
                            this.debug('Added order to cache:', orderData);
                        }
                    } catch (error) {
                        this.debug(`Failed to read order ${i}:`, error);
                        
                        // If it's a rate limit error, add extra delay
                        if (error.code === 'CALL_EXCEPTION' && error.error?.code === -32005) {
                            this.debug(`Rate limit hit for order ${i}, waiting 2 seconds...`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                        }
                        
                        continue;
                    }
                }
                
                // Add delay between batches
                if (batch < totalBatches - 1) {
                    this.debug(`Batch ${batch + 1} complete, waiting 1 second before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between batches
                }
            }
            
            this.debug('Order sync complete. Cache size:', this.orderCache.size);
            this.notifySubscribers('orderSyncComplete', Object.fromEntries(this.orderCache));
            this.debug('Setting up event listeners...');
            // TODO move this where needed (after sync)
            await this.setupEventListeners(this.contract);
            
        } catch (error) {
            this.debug('Order sync failed:', error);
            this.orderCache.clear();
            this.notifySubscribers('orderSyncComplete', {});
        }
    }

    getOrders(filterStatus = null) {
        try {
            this.debug('Getting orders with filter:', filterStatus);
            const orders = Array.from(this.orderCache.values());
            
            // Add detailed logging of order cache
            this.debug('Current order cache:', {
                size: this.orderCache.size,
                orderStatuses: orders.map(o => ({
                    id: o.id,
                    status: o.status,
                    timestamp: o.timestamp
                }))
            });
            
            if (filterStatus) {
                return orders.filter(order => order.status === filterStatus);
            }
            
            return orders;
        } catch (error) {
            this.debug('Error getting orders:', error);
            return [];
        }
    }

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.debug('Max reconnection attempts reached');
            return false;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        this.debug(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
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

    removeOrders(orderIds) {
        if (!Array.isArray(orderIds)) {
            console.warn('[WebSocket] removeOrders called with non-array:', orderIds);
            return;
        }
        
        this.debug('Removing orders:', orderIds);
        orderIds.forEach(orderId => {
            this.orderCache.delete(orderId);
        });
        
        // Notify subscribers of the update
        this.notifySubscribers('ordersUpdated', this.getOrders());
    }

    notifySubscribers(eventName, data) {
        this.debug('Notifying subscribers for event:', eventName);
        const subscribers = this.subscribers.get(eventName);
        if (subscribers) {
            this.debug('Found', subscribers.size, 'subscribers');
            subscribers.forEach(callback => {
                try {
                    this.debug('Calling subscriber callback');
                    callback(data);
                    this.debug('Subscriber callback completed');
                } catch (error) {
                    this.debug('Error in subscriber callback:', error);
                }
            });
        } else {
            this.debug('No subscribers found for event:', eventName);
        }
    }

    isOrderExpired(order) {
        try {
            if (!this.orderExpiry) {
                this.debug('Order expiry not initialized');
                return false;
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const expiryTime = order.timestamp + this.orderExpiry.toNumber();
            
            return currentTime > expiryTime;
        } catch (error) {
            this.debug('Error checking order expiry:', error);
            return false;
        }
    }

    getOrderExpiryTime(order) {
        if (!this.orderExpiry) {
            return null;
        }
        return order.timestamp + this.orderExpiry.toNumber();
    }

    // Add this helper method to WebSocketService class
    async calculateDealMetrics(orderData) {
        try {
            const buyTokenInfo = await this.getTokenInfo(orderData.buyToken);
            const sellTokenInfo = await this.getTokenInfo(orderData.sellToken);

            const buyTokenUsdPrice = window.pricingService.getPrice(orderData.buyToken);
            const sellTokenUsdPrice = window.pricingService.getPrice(orderData.sellToken);

            // Format amounts using correct decimals
            const sellAmount = ethers.utils.formatUnits(orderData.sellAmount, sellTokenInfo.decimals);
            const buyAmount = ethers.utils.formatUnits(orderData.buyAmount, buyTokenInfo.decimals);

            // Calculate Price (what you get / what you give from taker perspective)
            const price = Number(buyAmount) / Number(sellAmount);
            
            // Calculate Rate (market rate comparison)
            const rate = sellTokenUsdPrice / buyTokenUsdPrice;
            
            // Calculate Deal (Price * Rate)
            const deal = price * rate;

            return {
                ...orderData,
                dealMetrics: {
                    price,
                    rate,
                    deal,
                    formattedSellAmount: sellAmount,
                    formattedBuyAmount: buyAmount,
                    sellTokenUsdPrice,
                    buyTokenUsdPrice,
                    lastUpdated: Date.now()
                }
            };
        } catch (error) {
            this.debug('Error calculating deal metrics:', error);
            return orderData;
        }
    }

    async getTokenInfo(tokenAddress) {
        try {
            // Normalize address to lowercase for consistent comparison
            const normalizedAddress = tokenAddress.toLowerCase();

            // 1. First check our tokenCache
            if (this.tokenCache.has(normalizedAddress)) {
                this.debug('Token info found in cache:', normalizedAddress);
                return this.tokenCache.get(normalizedAddress);
            }

            // 2. Then check NETWORK_TOKENS (predefined list)
            const networkConfig = getNetworkConfig();
            const predefinedToken = NETWORK_TOKENS[networkConfig.name]?.[normalizedAddress];
            if (predefinedToken) {
                this.debug('Token info found in predefined list:', normalizedAddress);
                this.tokenCache.set(normalizedAddress, predefinedToken);
                return predefinedToken;
            }

            // 3. If not found, fetch from contract using queueRequest
            this.debug('Fetching token info from contract:', normalizedAddress);
            return await this.queueRequest(async () => {
                const contract = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
                const [symbol, decimals, name] = await Promise.all([
                    contract.symbol(),
                    contract.decimals(),
                    contract.name()
                ]);

                const tokenInfo = {
                    address: normalizedAddress,
                    symbol,
                    decimals: Number(decimals),
                    name
                };

                // Cache the result
                this.tokenCache.set(normalizedAddress, tokenInfo);
                this.debug('Added token to cache:', tokenInfo);

                return tokenInfo;
            });

        } catch (error) {
            this.debug('Error getting token info:', error);
            // Return a basic fallback object
            const fallback = {
                address: tokenAddress.toLowerCase(),
                symbol: `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-4)}`,
                decimals: 18,
                name: 'Unknown Token'
            };
            this.tokenCache.set(tokenAddress.toLowerCase(), fallback);
            return fallback;
        }
    }

    // Update all deals when prices change
    // Will be used with refresh button in the UI 
    async updateAllDeals() {
        if (!window.pricingService) {
            this.debug('Cannot update deals: PricingService not available');
            return;
        }

        this.debug('Updating deal metrics for all orders...');
        for (const [orderId, order] of this.orderCache.entries()) {
            try {
                const updatedOrder = await this.calculateDealMetrics(order);
                this.orderCache.set(orderId, updatedOrder);
            } catch (error) {
                this.debug('Error updating deal metrics for order:', orderId, error);
            }
        }

        // Notify subscribers about the updates
        this.notifySubscribers("ordersUpdated", Array.from(this.orderCache.values()));
    }

    // Check if an order can be filled by the current account
    // Use this to determine to provide a fill button in the UI
    canFillOrder(order, currentAccount) {
        if (order.status !== 'Active') return false;
        if (Date.now()/1000 > order.timings.expiresAt) return false;
        if (order.maker?.toLowerCase() === currentAccount?.toLowerCase()) return false;
        return order.taker === ethers.constants.AddressZero || 
               order.taker?.toLowerCase() === currentAccount?.toLowerCase();
    }

    // Check if an order can be canceled by the current account
    // Use this to determine to provide a cancel button in the UI
    canCancelOrder(order, currentAccount) {
        if (order.status !== 'Active') return false;
        if (Date.now()/1000 > order.timings.graceEndsAt) return false;
        return order.maker?.toLowerCase() === currentAccount?.toLowerCase();
    }

    // Get the status of an order
    // Use this to determine to provide a fill button in the UI
    getOrderStatus(order) {
        // Check explicit status first
        if (order.status === 'Canceled') return 'Canceled';
        if (order.status === 'Filled') return 'Filled';

        // Then check timing using cached timings
        const currentTime = Math.floor(Date.now() / 1000);

        if (currentTime > order.timings.graceEndsAt) {
            this.debug('Order not active: Past grace period');
            return '';
        }
        if (currentTime > order.timings.expiresAt) {
            this.debug('Order status: Awaiting Clean');
            return 'Expired';
        }

        this.debug('Order status: Active');
        return 'Active';
    }
}
