// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CreditcoinPoolEngine} from "../src/CreditcoinPoolEngine.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {Attestcoin} from "../src/interfaces/IAttestcoinBlockProver.sol";
import {ChainInfoAddr} from "../src/interfaces/IChainInfo.sol";

/**
 * @notice Deploys the credit pool to Creditcoin CC3 testnet and funds it.
 *
 *   forge script script/DeployCreditcoin.s.sol \
 *     --rpc-url $CREDITCOIN_RPC_URL --account bifrost --broadcast
 *
 * Env:
 *   ORIGIN_VAULT   (required) RWAOriginVault address on Sepolia
 *   STABLECOIN     (optional) existing token; a TestUSDC is deployed if unset
 *   CHAIN_KEY      (optional) source chainKey; defaults to 1 (Sepolia on CC3)
 *   ADMIN          (optional) defaults to the broadcasting account
 *   POOL_LIQUIDITY (optional) tUSDC minted into the pool; defaults to 10,000,000
 */
contract DeployCreditcoin is Script {
    function run() external returns (CreditcoinPoolEngine engine, address stablecoin) {
        address deployer = msg.sender;
        address originVault = vm.envAddress("ORIGIN_VAULT");
        address admin = vm.envOr("ADMIN", deployer);
        uint64 chainKey = uint64(vm.envOr("CHAIN_KEY", uint256(Attestcoin.CHAIN_KEY_SEPOLIA)));
        uint256 liquidity = vm.envOr("POOL_LIQUIDITY", uint256(10_000_000e6));
        address existingToken = vm.envOr("STABLECOIN", address(0));

        require(originVault != address(0), "ORIGIN_VAULT required");

        vm.startBroadcast();

        if (existingToken == address(0)) {
            TestUSDC t = new TestUSDC();
            stablecoin = address(t);
        } else {
            stablecoin = existingToken;
        }

        engine = new CreditcoinPoolEngine(
            Attestcoin.BLOCK_PROVER, // pass address(0) to fall back to the same constant
            ChainInfoAddr.CHAIN_INFO, // ditto — used to age locks against attestation
            stablecoin,
            originVault,
            chainKey,
            admin
        );

        if (existingToken == address(0) && liquidity > 0) {
            TestUSDC(stablecoin).mint(address(engine), liquidity);
        }

        vm.stopBroadcast();

        console.log("CreditcoinPoolEngine:", address(engine));
        console.log("  stablecoin:        ", stablecoin);
        console.log("  originVault:       ", originVault);
        console.log("  chainKey:          ", chainKey);
        console.log("  blockProver:       ", Attestcoin.BLOCK_PROVER);
        console.log("  admin:             ", admin);
        console.log("  pool liquidity:    ", liquidity);
    }
}
