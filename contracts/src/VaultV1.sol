// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal deposit/withdraw vault used as a beacon implementation.
/// Storage layout: [0] balances, [1] initialized
contract VaultV1 {
    mapping(address => uint256) public balances;
    bool public initialized;

    function initialize() external {
        require(!initialized, "already initialized");
        initialized = true;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external virtual {
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }
}
