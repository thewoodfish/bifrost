// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ReceiptDecoder
 * @notice Minimal RLP reader for Ethereum transaction receipts, used to pull a
 *         specific event log out of a receipt that Attestcoin has already proven.
 *
 * @dev Receipt body is `[status, cumulativeGasUsed, logsBloom, logs]`, where each
 *      log is `[address, [topic...], data]`. EIP-2718 typed receipts prepend a
 *      single type byte (<= 0x7f) before the RLP list; that envelope is skipped.
 *
 *      Length prefixes follow the RLP spec exactly:
 *        b <= 0x7f              single byte, payload is the byte itself
 *        0x80..0xb7             short string, len = b - 0x80
 *        0xb8..0xbf             long string, lenOfLen = b - 0xb7
 *        0xc0..0xf7             short list,  len = b - 0xc0
 *        0xf8..0xff             long list,   lenOfLen = b - 0xf7
 *
 *      Every read is bounds-checked against both the buffer and the enclosing
 *      list payload, so a malformed or truncated receipt reverts rather than
 *      silently decoding attacker-chosen memory.
 */
library ReceiptDecoder {
    error MalformedReceipt();

    // -- RLP primitives --------------------------------------------------------

    /// @dev Decode the RLP header at `pos`.
    function _header(bytes memory d, uint256 pos)
        private
        pure
        returns (uint256 payloadStart, uint256 payloadLen, bool isList)
    {
        if (pos >= d.length) revert MalformedReceipt();
        uint8 b = uint8(d[pos]);

        if (b <= 0x7f) return (pos, 1, false);
        if (b <= 0xb7) return (pos + 1, uint256(b) - 0x80, false);
        if (b <= 0xbf) {
            uint256 lenOfLen = uint256(b) - 0xb7;
            return (pos + 1 + lenOfLen, _readLen(d, pos + 1, lenOfLen), false);
        }
        if (b <= 0xf7) return (pos + 1, uint256(b) - 0xc0, true);

        uint256 lol = uint256(b) - 0xf7;
        return (pos + 1 + lol, _readLen(d, pos + 1, lol), true);
    }

    function _readLen(bytes memory d, uint256 pos, uint256 n) private pure returns (uint256 len) {
        if (n == 0 || n > 8) revert MalformedReceipt();
        if (pos + n > d.length) revert MalformedReceipt();
        for (uint256 i = 0; i < n; i++) {
            len = (len << 8) | uint256(uint8(d[pos + i]));
        }
    }

    /// @dev First byte past the item starting at `pos`.
    function _end(bytes memory d, uint256 pos) private pure returns (uint256) {
        (uint256 s, uint256 l,) = _header(d, pos);
        uint256 e = s + l;
        if (e > d.length) revert MalformedReceipt();
        return e;
    }

    function _toAddress(bytes memory d, uint256 pos) private pure returns (address) {
        if (pos + 20 > d.length) revert MalformedReceipt();
        uint160 a;
        for (uint256 i = 0; i < 20; i++) {
            a = (a << 8) | uint160(uint8(d[pos + i]));
        }
        return address(a);
    }

    function _toBytes32(bytes memory d, uint256 pos) private pure returns (bytes32) {
        if (pos + 32 > d.length) revert MalformedReceipt();
        uint256 w;
        for (uint256 i = 0; i < 32; i++) {
            w = (w << 8) | uint256(uint8(d[pos + i]));
        }
        return bytes32(w);
    }

    function _slice(bytes memory d, uint256 pos, uint256 len) private pure returns (bytes memory out) {
        if (pos + len > d.length) revert MalformedReceipt();
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = d[pos + i];
        }
    }

    // -- Receipt traversal -----------------------------------------------------

    /// @dev Byte range of the `logs` list payload.
    function _logsRange(bytes memory receipt) private pure returns (uint256 start, uint256 end) {
        if (receipt.length == 0) revert MalformedReceipt();

        // Skip an EIP-2718 type byte if present.
        uint256 pos = uint8(receipt[0]) <= 0x7f ? 1 : 0;

        (uint256 bodyStart, uint256 bodyLen, bool isList) = _header(receipt, pos);
        if (!isList) revert MalformedReceipt();
        uint256 bodyEnd = bodyStart + bodyLen;
        if (bodyEnd > receipt.length) revert MalformedReceipt();

        uint256 p = bodyStart;
        p = _end(receipt, p); // status
        p = _end(receipt, p); // cumulativeGasUsed
        p = _end(receipt, p); // logsBloom
        if (p >= bodyEnd) revert MalformedReceipt();

        (uint256 ls, uint256 ll, bool logsAreList) = _header(receipt, p);
        if (!logsAreList) revert MalformedReceipt();
        end = ls + ll;
        if (end > bodyEnd) revert MalformedReceipt();
        return (ls, end);
    }

    /**
     * @notice Find the first log emitted by `emitter` whose `topics[0] == topic0`.
     * @return found  Whether such a log exists in the receipt.
     * @return topics The log's topics, in order.
     * @return data   The log's non-indexed data payload.
     */
    function findLog(bytes memory receipt, address emitter, bytes32 topic0)
        internal
        pure
        returns (bool found, bytes32[] memory topics, bytes memory data)
    {
        (uint256 p, uint256 end) = _logsRange(receipt);

        while (p < end) {
            (uint256 logStart, uint256 logLen, bool isList) = _header(receipt, p);
            if (!isList) revert MalformedReceipt();
            uint256 next = logStart + logLen;
            if (next > end) revert MalformedReceipt();

            // Field 0: emitter address
            (uint256 aStart, uint256 aLen,) = _header(receipt, logStart);
            if (aLen != 20) {
                p = next;
                continue;
            }

            if (_toAddress(receipt, aStart) == emitter) {
                // Field 1: topics list
                (uint256 tStart, uint256 tLen, bool tIsList) = _header(receipt, aStart + aLen);
                if (!tIsList) revert MalformedReceipt();
                uint256 tEnd = tStart + tLen;
                if (tEnd > next) revert MalformedReceipt();

                uint256 count;
                for (uint256 q = tStart; q < tEnd;) {
                    q = _end(receipt, q);
                    count++;
                }

                if (count > 0) {
                    (uint256 t0Start, uint256 t0Len,) = _header(receipt, tStart);
                    if (t0Len == 32 && _toBytes32(receipt, t0Start) == topic0) {
                        topics = new bytes32[](count);
                        uint256 q2 = tStart;
                        for (uint256 i = 0; i < count; i++) {
                            (uint256 s, uint256 l,) = _header(receipt, q2);
                            topics[i] = l == 32 ? _toBytes32(receipt, s) : bytes32(0);
                            q2 = s + l;
                        }

                        // Field 2: data
                        (uint256 dStart, uint256 dLen,) = _header(receipt, tEnd);
                        if (dStart + dLen > next) revert MalformedReceipt();
                        data = _slice(receipt, dStart, dLen);

                        return (true, topics, data);
                    }
                }
            }

            p = next;
        }

        return (false, new bytes32[](0), bytes(""));
    }
}
