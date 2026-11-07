// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {VaultV1} from "../src/VaultV1.sol";
import {VaultV2Paused} from "../src/VaultV2Paused.sol";

contract SharedBeaconTest is Test {
    address owner = makeAddr("beaconOwner");
    address ownerC = makeAddr("beaconCOwner");
    address user = makeAddr("testUser");
    uint256 constant AMOUNT = 1 ether;

    UpgradeableBeacon shared;
    UpgradeableBeacon beaconC;
    VaultV1 implV1;
    VaultV1 implC;
    VaultV2Paused implV2;
    VaultV1 a;
    VaultV1 b;
    VaultV1 c;

    function _proxy(UpgradeableBeacon beacon) internal returns (VaultV1 v) {
        v = VaultV1(address(new BeaconProxy(address(beacon), abi.encodeCall(VaultV1.initialize, ()))));
        vm.prank(user);
        v.deposit{value: AMOUNT}();
    }

    function setUp() public {
        vm.deal(user, 10 ether);
        implV1 = new VaultV1();
        implC = new VaultV1();
        implV2 = new VaultV2Paused();
        shared = new UpgradeableBeacon(address(implV1), owner);
        beaconC = new UpgradeableBeacon(address(implC), ownerC);
        a = _proxy(shared);
        b = _proxy(shared);
        c = _proxy(beaconC);
    }

    function _withdraw(VaultV1 v) internal returns (bool ok, bytes memory ret) {
        vm.prank(user);
        (ok, ret) = address(v).call(abi.encodeCall(VaultV1.withdraw, (AMOUNT)));
    }

    function test_baselineAllWithdrawalsSucceed() public {
        uint256 snap = vm.snapshotState();
        VaultV1[3] memory vs = [a, b, c];
        for (uint256 i; i < 3; i++) {
            (bool ok, ) = _withdraw(vs[i]);
            assertTrue(ok);
            vm.revertToState(snap);
            snap = vm.snapshotState();
        }
    }

    function test_unauthorizedUpgradeRejected() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        shared.upgradeTo(address(implV2));
    }

    function test_sharedBeaconUpgradeBreaksABNotC() public {
        // deposits are untouched by the upgrade (storage compatible)
        vm.prank(owner);
        shared.upgradeTo(address(implV2));

        (bool okA, bytes memory retA) = _withdraw(a);
        (bool okB, bytes memory retB) = _withdraw(b);
        (bool okC, ) = _withdraw(c);

        assertFalse(okA);
        assertFalse(okB);
        assertEq(bytes4(retA), VaultV2Paused.WithdrawalsPaused.selector);
        assertEq(bytes4(retB), VaultV2Paused.WithdrawalsPaused.selector);
        assertTrue(okC);

        // funds not lost: balances still recorded in A and B
        assertEq(a.balances(user), AMOUNT);
        assertEq(b.balances(user), AMOUNT);
        assertEq(c.balances(user), 0);
    }

    function test_beaconOwnersAreSeparate() public view {
        assertEq(shared.owner(), owner);
        assertEq(beaconC.owner(), ownerC);
        assertEq(shared.implementation(), address(implV1));
        assertEq(beaconC.implementation(), address(implC));
    }
}
