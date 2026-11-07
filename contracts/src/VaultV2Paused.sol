// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultV1} from "./VaultV1.sol";

/// Storage-compatible with VaultV1 (inherits, adds no state). Withdrawals revert on purpose.
contract VaultV2Paused is VaultV1 {
    error WithdrawalsPaused();

    function withdraw(uint256) external pure override {
        revert WithdrawalsPaused();
    }
}
