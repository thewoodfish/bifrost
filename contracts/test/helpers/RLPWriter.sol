// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal RLP encoder used by tests to build realistic Ethereum receipts.
library RLPWriter {
    function encodeBytes(bytes memory b) internal pure returns (bytes memory) {
        if (b.length == 1 && uint8(b[0]) <= 0x7f) return b;
        return abi.encodePacked(_prefix(b.length, 0x80), b);
    }

    function encodeList(bytes memory concatenatedItems) internal pure returns (bytes memory) {
        return abi.encodePacked(_prefix(concatenatedItems.length, 0xc0), concatenatedItems);
    }

    function encodeUint(uint256 x) internal pure returns (bytes memory) {
        if (x == 0) return hex"80";
        return encodeBytes(_toBinary(x));
    }

    function _prefix(uint256 len, uint8 offset) private pure returns (bytes memory) {
        if (len <= 55) return abi.encodePacked(uint8(offset + uint8(len)));
        bytes memory lb = _toBinary(len);
        return abi.encodePacked(uint8(offset + 55 + uint8(lb.length)), lb);
    }

    function _toBinary(uint256 x) private pure returns (bytes memory) {
        uint256 n;
        uint256 t = x;
        while (t > 0) {
            n++;
            t >>= 8;
        }
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[n - 1 - i] = bytes1(uint8(x >> (8 * i)));
        }
        return out;
    }
}

/// @notice Builds receipt RLP: [status, cumulativeGasUsed, logsBloom, logs].
library ReceiptBuilder {
    using RLPWriter for bytes;

    function log(address emitter, bytes32[] memory topics, bytes memory data)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory t;
        for (uint256 i = 0; i < topics.length; i++) {
            t = abi.encodePacked(t, RLPWriter.encodeBytes(abi.encodePacked(topics[i])));
        }
        bytes memory body = abi.encodePacked(
            RLPWriter.encodeBytes(abi.encodePacked(emitter)), RLPWriter.encodeList(t), RLPWriter.encodeBytes(data)
        );
        return RLPWriter.encodeList(body);
    }

    /// @param typeByte 0 for a legacy receipt, otherwise an EIP-2718 envelope byte.
    function receiptRLP(uint8 typeByte, uint256 status, uint256 gasUsed, bytes memory concatenatedLogs)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory bloom = new bytes(256); // full 256-byte logsBloom: long-string prefix
        bytes memory body = abi.encodePacked(
            RLPWriter.encodeUint(status),
            RLPWriter.encodeUint(gasUsed),
            RLPWriter.encodeBytes(bloom),
            RLPWriter.encodeList(concatenatedLogs)
        );
        bytes memory rlp = RLPWriter.encodeList(body);
        if (typeByte == 0) return rlp;
        return abi.encodePacked(typeByte, rlp);
    }
}
