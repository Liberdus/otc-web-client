const networkConfig = {
    "80002": {
        name: "Amoy",
        contractAddress: "0xE9B83Ef40251017D9E8E0685d3Dd96F7C64d40cA",
        explorer: "https://www.oklink.com/amoy",
        rpcUrl: "https://rpc-amoy.polygon.technology"
    },
    // "80001": {
    //     name: "Mumbai",
    //     contractAddress: "0x...", // Mumbai deployment
    //     explorer: "https://mumbai.polygonscan.com",
    //     rpcUrl: "https://rpc-mumbai.maticvigil.com"
    // }
};

async function getNetworkConfig() {
    // Check if MetaMask is installed
    if (typeof window.ethereum === 'undefined') {
        throw new Error("MetaMask is not installed!");
    }

    try {
        // Get current chain ID from MetaMask
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const decimalChainId = parseInt(chainId, 16).toString();
        
        // Check if network is supported
        const config = networkConfig[decimalChainId];
        if (!config) {
            throw new Error(`Unsupported network (Chain ID: ${decimalChainId}). Please switch to Amoy or Mumbai testnet.`);
        }

        return config;
    } catch (error) {
        console.error("Network detection error:", error);
        throw error;
    }
}

// Helper function to switch networks
async function switchNetwork(targetChainId) {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${Number(targetChainId).toString(16)}` }],
        });
    } catch (error) {
        if (error.code === 4902) {
            // Network needs to be added to MetaMask
            const config = networkConfig[targetChainId];
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: `0x${Number(targetChainId).toString(16)}`,
                    chainName: config.name,
                    rpcUrls: [config.rpcUrl],
                    blockExplorerUrls: [config.explorer]
                }],
            });
        } else {
            throw error;
        }
    }
}
