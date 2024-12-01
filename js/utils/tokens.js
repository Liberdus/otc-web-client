import { ethers } from 'ethers';

export async function getTokenList() {
    try {
        // Default tokens that are always shown
        const defaultTokens = [
          // Add tokens as needed
        ];

        // Get user's wallet tokens
        const walletTokens = await getUserWalletTokens();
        
        // Combine lists, avoiding duplicates
        return [...defaultTokens, ...walletTokens.filter(wToken => 
            !defaultTokens.some(dToken => 
                dToken.address.toLowerCase() === wToken.address.toLowerCase()
            )
        )];
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