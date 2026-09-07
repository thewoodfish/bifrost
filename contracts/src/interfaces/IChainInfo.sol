// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IChainInfo
 * @notice Creditcoin ChainInfo precompile at 0x…0FD3.
 *
 * @dev Function names are **snake_case**, not camelCase. Querying this precompile with
 *      camelCase names returns "Unknown selector" — which reads like the precompile is
 *      missing when it is actually live. Names verified against usc-sdk v0.18.0
 *      `chain-info/chain_info.json` and confirmed by live call on CC3 testnet.
 *
 *      Live result of `get_supported_chains()` on CC3 (2026-09-07):
 *        (chainKey 3, chainId 1,        "Ethereum")
 *        (chainKey 1, chainId 11155111, "Sepolia ethereum")
 *
 *      Those two are the only attested source chains. Base and Plume are not supported.
 */
interface IChainInfo {
    struct ChainInfo {
        uint64 chainKey;
        uint64 chainId;
        string chainName;
        uint64 chainEncoding;
    }

    function get_supported_chains() external view returns (ChainInfo[] memory);
    function get_chain_by_key(uint64 chainKey) external view returns (ChainInfo memory);

    /// @return height, hash, isAttestation, exists
    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (uint64, bytes32, bool, bool);

    function is_height_attested(uint64 chainKey, uint64 height) external view returns (bool);
    function get_attestation_genesis_height(uint64 chainKey) external view returns (uint64);
}

library ChainInfoAddr {
    address internal constant CHAIN_INFO = 0x0000000000000000000000000000000000000fD3;
}
