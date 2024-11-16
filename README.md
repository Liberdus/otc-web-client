# OTC Token Swap DApp

A decentralized application for over-the-counter token swaps on Polygon networks.

## Networks Supported
- Polygon Mainnet
- Polygon Amoy Testnet
- additional can be added depending on where smart contract is deployed and added to configs

## Prerequisites
- Node.js
- MetaMask
- Test tokens for testing (on respective networks)

## Network Configuration
The application supports multiple networks through `config.js`. Current supported networks:

```javascript
{
    "137": {
        name: "Polygon Mainnet",
        contractAddress: "YOUR_CONTRACT_ADDRESS",
        explorer: "https://polygonscan.com",
        rpcUrl: "https://polygon-rpc.com"
    },
    "80002": {
        name: "Amoy",
        contractAddress: "0xE9B83Ef40251017D9E8E0685d3Dd96F7C64d40cA",
        explorer: "https://www.oklink.com/amoy",
        rpcUrl: "https://rpc-amoy.polygon.technology"
    }
}
```

## Getting Started (locally)

1. Install dependencies:
```bash
npm install
```

2. Configure your network settings in `config.js`

3. Start the node server:
```bash
http-server
```

4. Connect your wallet and ensure you're on the correct network

## Features
- Create OTC swap orders
- Fill existing orders
- Cancel your orders
- View active orders
- Network switching support
- Real-time order updates

## Testing
1. Test on Amoy testnet first
2. Get test tokens from the Polygon faucet
3. Ensure your wallet has sufficient native tokens for gas

## Security Notes
- Always verify token addresses
- Check order details carefully before swapping
- Never share your private keys
- Use trusted token contracts only

## Network Details

### Polygon Mainnet
- Chain ID: 137
- RPC URL: https://polygon-rpc.com
- Explorer: https://polygonscan.com

### Amoy Testnet
- Chain ID: 80002
- RPC URL: https://rpc-amoy.polygon.technology
- Explorer: https://www.oklink.com/amoy
- Faucet: https://faucet.polygon.technology/

## Support
For issues and feature requests, please open an issue on the repository.
