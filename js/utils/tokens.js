import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';

export async function getTokenList() {
    try {
        // Add native token (POL) as a default token
        const defaultTokens = [{
            address: '0x0000000000000000000000000000000000001010', // Native token contract
            symbol: 'POL',
            name: 'POLYGON Ecosystem Token',
            decimals: 18,
            isNative: true // Flag to identify native token
        }];

        // Get user's wallet tokens
        const walletTokens = await getUserWalletTokens();
        
        // Add native token balance
        if (window.ethereum) {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const address = await provider.getSigner().getAddress();
            const balance = await provider.getBalance(address);
            defaultTokens[0].balance = ethers.utils.formatEther(balance);
        }

        // Add icons to all tokens
        const tokensWithIcons = await Promise.all([...defaultTokens, ...walletTokens]
            .filter((token, index, self) => 
                index === self.findIndex(t => 
                    t.address.toLowerCase() === token.address.toLowerCase()
                )
            )
            .map(async token => ({
                ...token,
                iconUrl: await getTokenIcon(token.address)
            }))
        );

        return tokensWithIcons;
    } catch (error) {
        console.error('Error getting token list:', error);
        return [];
    }
}

async function getUserWalletTokens() {
    if (!window.ethereum) return [];

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const address = await provider.getSigner().getAddress();

        // Get token transfer events to/from the user's address
        const filter = {
            fromBlock: 0,
            toBlock: 'latest',
            topics: [
                ethers.utils.id('Transfer(address,address,uint256)'),
                null,
                ethers.utils.hexZeroPad(address, 32)
            ]
        };

        const logs = await provider.getLogs(filter);
        const tokenAddresses = [...new Set(logs.map(log => log.address))];
        const tokens = [];

        // Get token details
        for (const tokenAddress of tokenAddresses) {
            try {
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

                const [symbol, name, decimals, balance] = await Promise.all([
                    tokenContract.symbol(),
                    tokenContract.name(),
                    tokenContract.decimals(),
                    tokenContract.balanceOf(address)
                ]);

                // Only add tokens with non-zero balance
                if (balance.gt(0)) {
                    tokens.push({
                        address: tokenAddress,
                        symbol,
                        name,
                        decimals,
                        balance: ethers.utils.formatUnits(balance, decimals)
                    });
                }
            } catch (error) {
                console.warn(`Error loading token at ${tokenAddress}:`, error);
            }
        }

        return tokens;
    } catch (error) {
        console.error('Error getting wallet tokens:', error);
        return [];
    }
}

// Add a cache to avoid repeated failed requests
const iconCache = new Map();

async function getTokenIcon(address) {
    // Check cache first
    if (iconCache.has(address)) {
        return iconCache.get(address);
    }

    // Try multiple sources in order of reliability
    const sources = [
        // 1. Chain-specific token list (most reliable)
        () => getChainTokenList(address),
        // 2. CoinGecko API (rate limited but good coverage)
        () => getCoinGeckoIcon(address),
        // 3. Trust Wallet assets (needs checksum address)
        () => getTrustWalletIcon(address)
    ];

    for (const getIcon of sources) {
        try {
            const icon = await getIcon();
            if (icon && await checkImageExists(icon)) {
                iconCache.set(address, icon);
                return icon;
            }
        } catch (error) {
            console.warn('Failed to fetch icon from source:', error);
        }
    }
    
    // If no icon found, cache null to avoid future requests
    iconCache.set(address, null);
    return null;
}

// Helper to verify image exists
async function checkImageExists(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch {
        return false;
    }
}

// Chain-specific token lists (most reliable)
async function getChainTokenList(address) {
    // Example for Polygon
    const tokenListUrl = 'https://raw.githubusercontent.com/maticnetwork/polygon-token-list/master/src/tokens.json';
    try {
        const response = await fetch(tokenListUrl);
        const data = await response.json();
        const token = data.tokens.find(t => 
            t.address.toLowerCase() === address.toLowerCase()
        );
        return token?.logoURI;
    } catch (error) {
        console.warn('Failed to fetch from token list:', error);
        return null;
    }
}

// CoinGecko API
async function getCoinGeckoIcon(address) {
    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/polygon/contract/${address}`
        );
        const data = await response.json();
        return data.image?.small;
    } catch (error) {
        console.warn('Failed to fetch from CoinGecko:', error);
        return null;
    }
}

// Trust Wallet assets
function getTrustWalletIcon(address) {
    // Convert to checksum address
    const checksumAddress = ethers.utils.getAddress(address);
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/${checksumAddress}/logo.png`;
}

// Block explorer API (requires API key)
async function getExplorerIcon(address) {
    // Example for Polygonscan
    const apiKey = 'YOUR_EXPLORER_API_KEY';
    try {
        const response = await fetch(
            `https://api.polygonscan.com/api?module=token&action=tokeninfo&contractaddress=${address}&apikey=${apiKey}`
        );
        const data = await response.json();
        return data.result[0]?.image;
    } catch (error) {
        console.warn('Failed to fetch from explorer:', error);
        return null;
    }
} 