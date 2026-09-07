// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AttestedTx} from "../../src/lib/AttestedTx.sol";

/**
 * @notice Builds `encodedTransaction` payloads in the exact shape produced by
 *         usc-sdk v0.18.0 `encoding/abi/v1.abiEncode`:
 *
 *           abi.encode(uint8 txType, bytes[] chunks)
 *
 *         with the receipt as the final chunk. Chunk count varies by tx type, so
 *         `chunkCount` is parameterised to exercise the "last chunk" rule.
 */
library AttestedTxBuilder {
    /// @dev Mirrors encodeCommonFields: nonce, gasLimit, from, toIsNull, to, value, data
    function _commonChunk() private pure returns (bytes memory) {
        return abi.encode(uint64(7), uint64(120000), address(0xA), false, address(0xB), uint256(0), bytes(""));
    }

    /// @dev Mirrors encodeReceiptFields: status, gasUsed, logs, logsBloom
    function receiptChunk(uint8 status, uint64 gasUsed, AttestedTx.Log[] memory logs)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(status, gasUsed, logs, new bytes(256));
    }

    function encode(uint8 txType, uint8 status, uint64 gasUsed, AttestedTx.Log[] memory logs, uint256 chunkCount)
        internal
        pure
        returns (bytes memory)
    {
        require(chunkCount >= 3, "need >= 3 chunks");
        bytes[] memory chunks = new bytes[](chunkCount);
        chunks[0] = _commonChunk();
        for (uint256 i = 1; i < chunkCount - 1; i++) {
            chunks[i] = abi.encode(uint64(11155111), uint128(1), uint128(2));
        }
        chunks[chunkCount - 1] = receiptChunk(status, gasUsed, logs);
        return abi.encode(txType, chunks);
    }

    /// @dev Standard EIP-1559 shape: type 2, three chunks, successful receipt.
    function encodeType2(AttestedTx.Log[] memory logs) internal pure returns (bytes memory) {
        return encode(2, 1, 120000, logs, 3);
    }

    function singleLog(address emitter, bytes32[] memory topics, bytes memory data)
        internal
        pure
        returns (AttestedTx.Log[] memory logs)
    {
        logs = new AttestedTx.Log[](1);
        logs[0] = AttestedTx.Log({emitter: emitter, topics: topics, data: data});
    }
}
