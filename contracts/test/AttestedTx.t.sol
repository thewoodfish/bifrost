// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AttestedTx} from "../src/lib/AttestedTx.sol";

/**
 * @notice Decodes a payload captured from the live Attestcoin prover for a real
 *         Sepolia transaction, rather than one this test suite constructed.
 *
 *  Fixture: Sepolia tx 0xc3fece6a...23d3a6 in block 11656630, fetched from
 *  https://prover.cc3-testnet.creditcoin.network on 2026-09-07. This is the only
 *  test that can catch a wrong assumption about the payload format itself — every
 *  other test would happily agree with a mistake made in its own builder.
 */
contract AttestedTxRealPayloadTest is Test {
    bytes internal payload;

    address constant LOG0_EMITTER = 0x8ba11Bf80c94eB9052e3C9d52326Fc1c899c7DC5;
    bytes32 constant LOG0_TOPIC0 = 0xdd84a3fa9ef9409f550d54d6affec7e9c480c878c6ab27b78912a03e1b371c6e;
    address constant LOG1_EMITTER = 0x333C2bc95b913190275fC0F26a7C171a0175c5C9;
    bytes32 constant LOG1_TOPIC0 = 0xb04e63db38c49950639fa09d29872f21f5d49d614f3a969d8adf3d4b52e41a62;

    function setUp() public {
        payload = vm.parseBytes(vm.readFile("test/fixtures/sepolia-attested-tx.hex"));
    }

    function test_DecodesRealAttestedReceipt() public view {
        (uint8 status, uint64 gasUsed, AttestedTx.Log[] memory logs) = AttestedTx.decodeReceipt(payload);

        assertEq(status, 1, "source tx succeeded");
        assertEq(gasUsed, 123491);
        assertEq(logs.length, 2);
    }

    function test_FindsLogByEmitterAndTopicInRealPayload() public view {
        (bool found, bytes32[] memory topics, bytes memory data, uint8 status) =
            AttestedTx.findLog(payload, LOG0_EMITTER, LOG0_TOPIC0);

        assertTrue(found);
        assertEq(status, 1);
        assertEq(topics.length, 2);
        assertEq(topics[0], LOG0_TOPIC0);
        assertEq(data.length, 64);
    }

    function test_FindsSecondLogInRealPayload() public view {
        (bool found, bytes32[] memory topics,,) = AttestedTx.findLog(payload, LOG1_EMITTER, LOG1_TOPIC0);

        assertTrue(found);
        assertEq(topics.length, 1);
    }

    /// @dev The emitter check is what stops a lookalike event from another contract.
    function test_RealPayload_WrongEmitterIsNotFound() public view {
        (bool found,,,) = AttestedTx.findLog(payload, address(0xDEAD), LOG0_TOPIC0);
        assertFalse(found);
    }

    function test_RealPayload_WrongTopicIsNotFound() public view {
        (bool found,,,) = AttestedTx.findLog(payload, LOG0_EMITTER, keccak256("NotTheEvent()"));
        assertFalse(found);
    }
}
