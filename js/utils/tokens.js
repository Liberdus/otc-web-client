import { ethers } from 'ethers';
import { getNetworkConfig } from '../config.js';

export async function getTokenList() {
    try {

        const POL_NativeToken_Address = '0x0000000000000000000000000000000000001010';
        // Get user's wallet tokens
        const walletTokens = await getUserWalletTokens();

        // Remove duplicates
        let uniqueTokens = walletTokens.filter((token, index, self) =>
            index === self.findIndex(t => t.address.toLowerCase() === token.address.toLowerCase())
        );

        // Remove native token if it's already in the list
        uniqueTokens = uniqueTokens.filter(token => token.address.toLowerCase() !== POL_NativeToken_Address.toLowerCase());

        return uniqueTokens;
    } catch (error) {
        console.error('Error getting token list:', error);
        // Return at least the native token if everything else fails
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
        console.error('Error getting user wallet tokens:', error);
        return [];
    }
}

async function getTokenIcon(address) {
    // Skip icon fetch for test tokens (you can adjust this check based on your needs)
    if (address.toLowerCase().includes('test')) {
        return null;
    }

    const iconCache = new Map();
    if (iconCache.has(address)) {
        return iconCache.get(address);
    }

    const sources = [
        // Chain-specific token lists (most reliable)
        async () => {
            try {
                return await getChainTokenList(address);
            } catch {
                return null;
            }
        },
        // CoinGecko
        async () => {
            try {
                return await getCoinGeckoIcon(address);
            } catch {
                return null;
            }
        },
        // Trust Wallet
        async () => {
            try {
                const icon = getTrustWalletIcon(address);
                const exists = await checkImageExists(icon);
                return exists ? icon : null;
            } catch {
                return null;
            }
        }
    ];

    for (const getIcon of sources) {
        const icon = await getIcon();
        if (icon) {
            iconCache.set(address, icon);
            return icon;
        }
    }

    // Cache null result to avoid future requests
    iconCache.set(address, null);
    return null;
}

// Helper function to get token icon from chain-specific token list
async function getChainTokenList(address) {
    try {
        const response = await fetch('https://raw.githubusercontent.com/maticnetwork/polygon-token-list/master/src/tokens.json');
        if (!response.ok) return null;
        const data = await response.json();
        const token = data.tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
        return token?.logoURI || null;
    } catch {
        return null;
    }
}

// Helper function to get token icon from CoinGecko
async function getCoinGeckoIcon(address) {
    try {
        const response = await fetch(`https://api.coingecko.com/api/v3/coins/polygon/contract/${address}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.image?.small || null;
    } catch {
        return null;
    }
}

// Helper function to get token icon from Trust Wallet
function getTrustWalletIcon(address) {
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/${address}/logo.png`;
}

// Helper function to check if an image exists
async function checkImageExists(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch {
        return false;
    }
} 