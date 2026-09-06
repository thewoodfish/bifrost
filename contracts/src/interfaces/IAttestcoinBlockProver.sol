// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAttestcoinBlockProver
 * @notice Creditcoin Attestcoin / USC BlockProver precompile.
 * @dev    Live at 0x0000000000000000000000000000000000000FD2 on Creditcoin.
 *
 *  Verified against CC3 testnet (chain id 102031) on 2026-09-04: calling `verify`
 *  with this exact signature and empty calldata returns the precompile's own
 *  "Transaction data cannot be empty" revert, proving the selector is dispatched.
 *  A mismatched struct ordering returns "Unknown selector" instead.
 */
interface IAttestcoinBlockProver {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    /// @dev Field order is load-bearing: `root` precedes `siblings`.
    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    /// @notice Verify a source-chain transaction and emit an on-chain attestation event.
    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);

    /// @notice Read-only form of `verifyAndEmit`, for dry-run validation via staticcall.
    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool);

    /// @notice Recover the transaction index implied by a proof pair.
    function calculateTxIndex(
        bytes32 txHash,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (uint256);
}

library Attestcoin {
    /// @dev BlockProver precompile address on Creditcoin.
    address internal constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;

    /// @dev Sepolia's chainKey on CC3 testnet.
    uint64 internal constant CHAIN_KEY_SEPOLIA = 1;
}
