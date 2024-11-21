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
- An `.env` file in the root directory

## Environment Setup
1. Create a `.env` file in the root directory with the following variables:
```env
PRIVATE_KEY=your_private_key
CONTRACT_ADDRESS=0xF9D874860d5801233dd84569fad8513e0037A5d9
RECIPIENT_ADDRESS=your_recipient_address
TOKEN1_ADDRESS=0xd85e481D10f8d77762e6215E87C5900D8b098e94
TOKEN2_ADDRESS=0xcDC1F663207f1ec636C5AF85C1D669A4a3d02fB3
YOUR_ALCHEMY_KEY=your_alchemy_key
```

## Network Configuration
The application currently runs on Polygon Amoy Testnet. Network configuration is managed in `config.js`:

```javascript
{
    "80002": {
        name: "Amoy",
        contractAddress: "0xF9D874860d5801233dd84569fad8513e0037A5d9",
        explorer: "https://www.oklink.com/amoy",
        rpcUrl: "https://rpc.ankr.com/polygon_amoy",
        fallbackRpcUrls: [
            "https://polygon-amoy.blockpi.network/v1/rpc/public",
            "https://polygon-amoy.public.blastapi.io"
        ]
    }
}
```

## Getting Started (locally)

1. Install dependencies:
```bash
npm install
```

2. Ensure your `.env` file is properly configured

3. Start the node server:
```bash
http-server
```

4. Connect your wallet - the application will automatically:
   - Request connection to MetaMask
   - Switch to Amoy testnet if needed
   - Initialize the contract interface

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

### Amoy Testnet (Current Network)
- Chain ID: 80002 (0x13882)
- Primary RPC URL: https://rpc.ankr.com/polygon_amoy
- Fallback RPC URLs:
  - https://polygon-amoy.blockpi.network/v1/rpc/public
  - https://polygon-amoy.public.blastapi.io
- Explorer: https://www.oklink.com/amoy
- Faucet: https://faucet.polygon.technology/
- Native Currency: POL (18 decimals)

## Support
For issues and feature requests, please open an issue on the repository.
