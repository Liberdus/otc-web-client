import { getNetworkConfig } from '../config.js';
import { NETWORK_TOKENS } from '../utils/tokens.js';
import { createLogger } from './LogService.js';

export class PricingService {
    constructor() {
        this.prices = new Map();
        this.lastUpdate = null;
        this.updating = false;
        this.subscribers = new Set();
        this.rateLimitDelay = 250; // Ensure we stay under 300 requests/minute
        this.networkConfig = getNetworkConfig();
        
        const logger = createLogger('PRICING');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);

        this.refreshPromise = null; // Track current refresh promise
    }

    async initialize() {
        await this.refreshPrices();
    }

    subscribe(callback) {
        this.subscribers.add(callback);
    }

    unsubscribe(callback) {
        this.subscribers.delete(callback);
    }

    notifySubscribers(event, data) {
        this.subscribers.forEach(callback => callback(event, data));
    }

    async fetchTokenPrices(tokenAddresses) {
        this.debug('Fetching prices for tokens:', tokenAddresses);
        const prices = new Map();
        
        // First try batch request
        const chunks = [];
        for (let i = 0; i < tokenAddresses.length; i += 30) {
            chunks.push(tokenAddresses.slice(i, i + 30));
        }

        for (const chunk of chunks) {
            try {
                const addresses = chunk.join(',');
                const url = `https://api.dexscreener.com/latest/dex/tokens/${addresses}`;
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.pairs) {
                    this.processTokenPairs(data.pairs, prices);
                }
                
                await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
            } catch (error) {
                this.error('Error fetching chunk prices:', error);
            }
        }

        // For any tokens that didn't get prices, try individual requests
        const missingTokens = tokenAddresses.filter(addr => !prices.has(addr.toLowerCase()));
        if (missingTokens.length > 0) {
            this.debug('Fetching missing token prices individually:', missingTokens);
            
            for (const addr of missingTokens) {
                try {
                    const url = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
                    const response = await fetch(url);
                    const data = await response.json();
                    
                    if (data.pairs && data.pairs.length > 0) {
                        this.processTokenPairs(data.pairs, prices);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
                } catch (error) {
                    this.error('Error fetching individual token price:', { token: addr, error });
                }
            }
        }

        return prices;
    }

    processTokenPairs(pairs, prices) {
        // Sort pairs by liquidity
        const sortedPairs = pairs.sort((a, b) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        );

        for (const pair of sortedPairs) {
            const baseAddr = pair.baseToken.address.toLowerCase();
            const quoteAddr = pair.quoteToken.address.toLowerCase();
            const priceUsd = parseFloat(pair.priceUsd);
            
            if (!isNaN(priceUsd)) {
                if (!prices.has(baseAddr)) {
                    prices.set(baseAddr, {
                        price: priceUsd,
                        liquidity: pair.liquidity?.usd || 0
                    });
                }
                
                // Calculate and set quote token price if we don't have it yet
                if (!prices.has(quoteAddr)) {
                    const basePrice = prices.get(baseAddr).price;
                    const priceNative = parseFloat(pair.priceNative);
                    if (!isNaN(priceNative)) {
                        prices.set(quoteAddr, {
                            price: basePrice / priceNative,
                            liquidity: pair.liquidity?.usd || 0
                        });
                    }
                }
            }
        }
    }

    async refreshPrices() {
        if (this.updating) {
            return this.refreshPromise;
        }
        
        this.updating = true;
        this.notifySubscribers('refreshStart');

        this.refreshPromise = (async () => {
            try {
                // Get unique token addresses from orders and NETWORK_TOKENS
                const tokenAddresses = new Set();
                
                // Add tokens from orders
                if (window.webSocket?.orderCache) {
                    for (const order of window.webSocket.orderCache.values()) {
                        tokenAddresses.add(order.sellToken.toLowerCase());
                        tokenAddresses.add(order.buyToken.toLowerCase());
                    }
                }

                // Add tokens from NETWORK_TOKENS to ensure we always have prices for common tokens
                const networkConfig = getNetworkConfig();
                const networkTokens = NETWORK_TOKENS[networkConfig.name] || [];
                for (const token of networkTokens) {
                    tokenAddresses.add(token.address.toLowerCase());
                }

                if (tokenAddresses.size === 0) {
                    this.warn('No tokens to fetch prices for');
                    return { success: true, message: 'No tokens to update' };
                }

                this.debug('Fetching prices for tokens:', [...tokenAddresses]);
                const prices = await this.fetchTokenPrices([...tokenAddresses]);
                this.debug('Fetched prices:', prices);
                
                // Update internal price map
                this.prices.clear();
                for (const [address, data] of prices.entries()) {
                    this.debug(`Setting price for ${address}:`, data.price);
                    this.prices.set(address, data.price);
                }
                
                if (window.webSocket) {
                    await window.webSocket.updateAllDeals();
                }
                
                this.lastUpdate = Date.now();
                this.notifySubscribers('refreshComplete');
                
                this.debug('Prices updated:', Object.fromEntries(this.prices));
                return { success: true, message: 'Prices updated successfully' };
            } catch (error) {
                this.error('Error refreshing prices:', error);
                this.notifySubscribers('refreshError', error);
                return { success: false, message: 'Failed to update prices' };
            } finally {
                this.updating = false;
                this.refreshPromise = null;
            }
        })();

        return this.refreshPromise;
    }

    getPrice(tokenAddress) {
        const price = this.prices.get(tokenAddress.toLowerCase());
        this.debug('Getting price for token:', {
            address: tokenAddress,
            price: price || 1,
            allPrices: Object.fromEntries(this.prices)
        });
        return price || 1;
    }

    isPriceEstimated(tokenAddress) {
        return !this.prices.has(tokenAddress.toLowerCase());
    }

    calculateRate(sellToken, buyToken) {
        const sellPrice = this.getPrice(sellToken);
        const buyPrice = this.getPrice(buyToken);
        return buyPrice / sellPrice;
    }

    calculateDeal(price, rate) {
        return price * rate;
    }

    getLastUpdateTime() {
        return this.lastUpdate ? new Date(this.lastUpdate).toLocaleTimeString() : 'Never';
    }
}