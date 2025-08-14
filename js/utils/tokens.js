import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';
import { createLogger } from '../services/LogService.js';

const LIB_LOGO = new URL('../../assets/32.png', import.meta.url).href;

// Initialize logger
const logger = createLogger('TOKENS');
const debug = logger.debug.bind(logger);
const error = logger.error.bind(logger);
const warn = logger.warn.bind(logger);

// Export the network tokens constant so it can be imported elsewhere
export const NETWORK_TOKENS = {
    Polygon: [
        {
            address: `0x693ed886545970F0a3ADf8C59af5cCdb6dDF0a76`,
            symbol: `LIB`,
            name: `Liberdus`,
            decimals: 18,
            logoURI: LIB_LOGO
        },
        {
            address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619/logo.png'
        },
        {
            address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174/logo.png'
        },
        {
            name: `Wrapped MATIC`,
            symbol: `WMATIC`,
            address: `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`,
            decimals: 18,
            logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270/logo.png'
        },
        {
            name: `USDT`,
            symbol: `USDT`,
            address: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`,
            decimals: 6,
            logoURI: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0xc2132D05D31c914a87C6611C10748AEb04B58e8F/logo.png`
        },
        {
            name: 'Wrapped Bitcoin',
            symbol: `WBTC`,
            address: `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6`,
            decimals: 18,
            logoURI: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6/logo.png`
        },
        {
            name: `The Spork Dao Token (PoS)`,
            symbol: `SPORK`,
            address: `0x9CA6a77C8B38159fd2dA9Bd25bc3E259C33F5E39`,
            decimals: 18,
            logoURI: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x2953399124f0cbb46d333b213f0a01d3b7f2d08d/logo.png`
        }

    ]
};

// Add a debug logging utility that only logs in development
const DEBUG = false;
const debugLog = (...args) => {
    if (DEBUG) {
        console.log(...args);
    }
};

// Add token icon sources configuration
const TOKEN_ICON_SOURCES = {
    // Update with working token list URL
    POLYGON_TOKEN_LIST: 'https://tokens.1inch.io/v1.1/137',
    COINGECKO_API: 'https://api.coingecko.com/api/v3',
    // Add fallback icon URL if needed
    FALLBACK_ICON: 'path/to/fallback/icon.png'
};

// Create an in-memory cache for token data
const tokenCache = new Map();
const iconCache = new Map();

export async function getTokenList() {
    try {
        const networkConfig = getNetworkConfig();
        debug('Getting tokens for network:', networkConfig.name);
        
        // Get predefined tokens for current network
        const networkTokens = NETWORK_TOKENS[networkConfig.name] || [];
        debug('Predefined tokens:', networkTokens);
        
        // Get user's wallet tokens with balances
        const walletTokens = await getUserWalletTokens();
        debug('Wallet tokens:', walletTokens);
        
        // Combine and merge duplicates, preserving balance information
        let allTokens = [...networkTokens];
        
        // Update or add wallet tokens, preserving balance information
        walletTokens.forEach(walletToken => {
            const existingIndex = allTokens.findIndex(t => 
                t.address.toLowerCase() === walletToken.address.toLowerCase()
            );
            
            if (existingIndex >= 0) {
                // Update existing token with balance
                allTokens[existingIndex] = {
                    ...allTokens[existingIndex],
                    balance: walletToken.balance
                };
            } else {
                // Add new token
                allTokens.push(walletToken);
            }
        });

        // Remove native token
        const POL_NativeToken_Address = '0x0000000000000000000000000000000000001010';
        allTokens = allTokens.filter(token => 
            token.address.toLowerCase() !== POL_NativeToken_Address.toLowerCase()
        );

        debug('Final token list:', allTokens);
        return allTokens;
    } catch (error) {
        error('Error getting token list:', error);
        return NETWORK_TOKENS[getNetworkConfig().name] || [];
    }
}
async function getUserWalletTokens() {
    if (!window.ethereum) {
        warn('No ethereum provider found');
        return [];
    }

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const address = await provider.getSigner().getAddress();
        debug('Getting tokens for address:', address);

        // Get predefined tokens for current network
        const networkConfig = getNetworkConfig();
        const predefinedTokens = NETWORK_TOKENS[networkConfig.name] || [];
        const tokens = [];

        // Check balances for predefined tokens first
        for (const token of predefinedTokens) {
            try {
                // Check cache first
                const cacheKey = `${token.address}-${address}`;
                if (tokenCache.has(cacheKey)) {
                    const cachedToken = tokenCache.get(cacheKey);
                    if (Date.now() - cachedToken.timestamp < 60000) { // 1 minute cache
                        tokens.push(cachedToken.data);
                        continue;
                    }
                }

                const tokenContract = new ethers.Contract(
                    token.address,
                    [
                        'function balanceOf(address) view returns (uint256)',
                        'function decimals() view returns (uint8)'
                    ],
                    provider
                );

                // Use Promise.race with timeout
                const timeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 5000)
                );

                const [rawBalance, decimals] = await Promise.race([
                    Promise.all([
                        tokenContract.balanceOf(address).catch(() => ethers.BigNumber.from(0)),
                        tokenContract.decimals().catch(() => token.decimals || 18)
                    ]),
                    timeout
                ]);

                const balance = ethers.utils.formatUnits(rawBalance, decimals);

                if (rawBalance.gt(0)) {
                    const tokenData = {
                        ...token,
                        balance,
                        logoURI: await getTokenIcon(token.address)
                    };
                    tokens.push(tokenData);
                    
                    // Cache the result
                    tokenCache.set(cacheKey, {
                        timestamp: Date.now(),
                        data: tokenData
                    });
                    
                    debug(`Added ${token.symbol} with balance ${balance}`);
                }
            } catch (error) {
                debug(`Error loading predefined token at ${token.address}:`, error.message);
                continue;
            }
        }

        // Skip transfer event scanning if we already have tokens
        if (tokens.length > 0) {
            debug(`Found ${tokens.length} tokens with non-zero balance`);
            return tokens;
        }

        // Calculate block range for last 30 days (for discovering other tokens)
        const BLOCKS_PER_DAY = 34560;
        const DAYS = 30;
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = currentBlock - (BLOCKS_PER_DAY * DAYS);

        // Get transfer events with error handling
        const filters = [
            {
                fromBlock,
                toBlock: 'latest',
                topics: [
                    ethers.utils.id('Transfer(address,address,uint256)'),
                    null,
                    ethers.utils.hexZeroPad(address, 32)
                ]
            },
            {
                fromBlock,
                toBlock: 'latest',
                topics: [
                    ethers.utils.id('Transfer(address,address,uint256)'),
                    ethers.utils.hexZeroPad(address, 32),
                    null
                ]
            }
        ];

        // Get all transfer events with timeout and retry
        const getLogs = async (filter, retries = 3) => {
            try {
                return await Promise.race([
                    provider.getLogs(filter),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 10000)
                    )
                ]);
            } catch (error) {
                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return getLogs(filter, retries - 1);
                }
                warn('Failed to get logs after retries:', error);
                return [];
            }
        };

        const allLogs = await Promise.all(filters.map(filter => getLogs(filter)));
        const tokenAddresses = [...new Set(allLogs.flat().map(log => log.address))];
        
        debug(`Found ${tokenAddresses.length} unique token addresses from transfers`);

        // For each token address, get its details and current balance
        for (const tokenAddress of tokenAddresses) {
            try {
                // Verify contract exists
                const code = await provider.getCode(tokenAddress);
                if (code === '0x') continue;

                // Create contract interface
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    [
                        'function symbol() view returns (string)',
                        'function name() view returns (string)',
                        'function decimals() view returns (uint8)',
                        'function balanceOf(address) view returns (uint256)'
                    ],
                    provider
                );

                // Get token details and balance
                const [symbol, name, decimals, rawBalance] = await Promise.all([
                    tokenContract.symbol(),
                    tokenContract.name(),
                    tokenContract.decimals(),
                    tokenContract.balanceOf(address)
                ]);

                // Format balance using the correct decimals
                const balance = ethers.utils.formatUnits(rawBalance, decimals);

                // Only add tokens with non-zero balance
                if (rawBalance.gt(0)) {
                    tokens.push({
                        address: tokenAddress,
                        symbol,
                        name,
                        decimals,
                        balance,
                        logoURI: await getTokenIcon(tokenAddress)
                    });
                    debug(`Added ${symbol} with balance ${balance}`);
                }
            } catch (error) {
                warn(`Error loading token at ${tokenAddress}:`, error);
                continue;
            }
        }

        debug(`Found ${tokens.length} tokens with non-zero balance`);
        return tokens;
    } catch (error) {
        error('Error getting user wallet tokens:', error);
        return [];
    }
}

async function getTokenIcon(address) {
    // Check cache first
    if (iconCache.has(address)) {
        return iconCache.get(address);
    }

    // Skip icon fetch for test tokens
    if (address.toLowerCase().includes('test')) {
        debug('Skipping icon fetch for test token:', address);
        iconCache.set(address, null);
        return null;
    }

    try {
        // Try 1inch token list first (more reliable)
        const response = await fetch(TOKEN_ICON_SOURCES.POLYGON_TOKEN_LIST);
        if (response.ok) {
            const data = await response.json();
            const token = data[address.toLowerCase()];
            if (token?.logoURI) {
                iconCache.set(address, token.logoURI);
                return token.logoURI;
            }
        }
    } catch (error) {
        warn('Error fetching from 1inch token list:', error.message);
    }

    // Return null for now - we can add more sources if needed
    iconCache.set(address, null);
    return null;
} 