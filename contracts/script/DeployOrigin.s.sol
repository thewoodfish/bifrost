// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RWAOriginVault} from "../src/RWAOriginVault.sol";

/**
 * @notice Deploys the origin-chain vault to Sepolia and wires demo roles.
 *
 *   forge script script/DeployOrigin.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL --account bifrost --broadcast --verify
 *
 * Env:
 *   ADMIN       (optional) admin address; defaults to the broadcasting account
 *   ORIGINATOR  (optional) address allowed to register portfolios
 *   VALUER      (optional) address allowed to publish valuations
 */
contract DeployOrigin is Script {
    function run() external returns (RWAOriginVault vault) {
        address deployer = msg.sender;
        address admin = vm.envOr("ADMIN", deployer);
        address originator = vm.envOr("ORIGINATOR", deployer);
        address valuer = vm.envOr("VALUER", deployer);

        vm.startBroadcast();

        vault = new RWAOriginVault(admin);

        // Only possible while the broadcaster is still admin.
        if (admin == deployer) {
            vault.setOriginator(originator, true);
            vault.setValuer(valuer, true);
        }

        vm.stopBroadcast();

        console.log("RWAOriginVault:", address(vault));
        console.log("  admin:       ", admin);
        console.log("  originator:  ", originator);
        console.log("  valuer:      ", valuer);
        console.log("");
        console.log("Set ORIGIN_VAULT to this address before deploying the Creditcoin side.");
    }
}
