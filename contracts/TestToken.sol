// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        // Mint 1000 tokens to msg.sender
        // 1000 * 10^18 because ERC20 tokens default to 18 decimals
        _mint(msg.sender, 1000 * 10**18);
    }

    // Optional: Add a mint function for testing
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}