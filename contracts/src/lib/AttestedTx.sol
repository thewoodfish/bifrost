// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AttestedTx
 * @notice Decoder for the `encodedTransaction` payload that the Attestcoin BlockProver
 *         verifies — i.e. the bytes produced by the usc-sdk abiEncode helper.
 *
 * @dev The payload is NOT receipt RLP. It is:
 *
 *        abi.encode(uint8 txType, bytes[] chunks)
 *
 *      where the chunk count varies by transaction type (3 for legacy/1559, 4 for
 *      blob and authorization types) and the **last chunk is always the receipt**:
 *
 *        abi.encode(
 *            uint8  status,
 *            uint64 gasUsed,
 *            tuple(address, bytes32[], bytes)[] logs,
 *            bytes  logsBloom
 *        )
 *
 *      Taking the last chunk rather than a fixed index is what makes this work across
 *      every transaction type. Verified against usc-sdk v0.18.0 `encoding/abi/v1`.
 *
 *      Decoding is delegated to the Solidity ABI decoder, which bounds-checks and
 *      reverts on malformed input, so a hand-rolled parser is not needed here.
 */
library AttestedTx {
    struct Log {
        address emitter;
        bytes32[] topics;
        bytes data;
    }

    error MalformedPayload();

    /// @notice Decode the receipt carried by an attested transaction payload.
    function decodeReceipt(bytes memory encodedTransaction)
        internal
        pure
        returns (uint8 status, uint64 gasUsed, Log[] memory logs)
    {
        (, bytes[] memory chunks) = abi.decode(encodedTransaction, (uint8, bytes[]));
        if (chunks.length < 3) revert MalformedPayload();

        bytes memory receiptChunk = chunks[chunks.length - 1];
        (status, gasUsed, logs,) = abi.decode(receiptChunk, (uint8, uint64, Log[], bytes));
    }

    /**
     * @notice Find the first log emitted by `emitter` whose `topics[0] == topic0`.
     * @dev Matching on the emitter is what stops an attacker emitting a lookalike
     *      event from a contract they control.
     */
    function findLog(bytes memory encodedTransaction, address emitter, bytes32 topic0)
        internal
        pure
        returns (bool found, bytes32[] memory topics, bytes memory data, uint8 status)
    {
        Log[] memory logs;
        (status,, logs) = decodeReceipt(encodedTransaction);

        for (uint256 i = 0; i < logs.length; i++) {
            Log memory l = logs[i];
            if (l.emitter == emitter && l.topics.length > 0 && l.topics[0] == topic0) {
                return (true, l.topics, l.data, status);
            }
        }
        return (false, new bytes32[](0), bytes(""), status);
    }
}
