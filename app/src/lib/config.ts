import type { Address } from "viem";

function addr(v: string | undefined, fallback: string): Address {
  return ((v && v.trim()) || fallback) as Address;
}

/**
 * Deployed addresses. Defaults are the live testnet deployment recorded in
 * docs/addresses.md; override per-environment with VITE_* vars.
 */
export const config = {
  originVault: addr(
    import.meta.env.VITE_ORIGIN_VAULT,
    "0x13F8630216EeF192ea74fc2AfA47Bd9edA372b7b",
  ),
  poolEngine: addr(
    import.meta.env.VITE_POOL_ENGINE,
    "0x33280d3558B174563a1CDd6590640Dd1C7e41a32",
  ),
  stablecoin: addr(
    import.meta.env.VITE_STABLECOIN,
    "0x6C1e351d926E45Bf88CbdA0412C8831E40AF865B",
  ),

  /**
   * Deploy blocks, where the indexer starts reading events. Nothing can predate a
   * contract, so starting earlier only costs RPC calls. Override alongside the addresses.
   */
  originVaultFromBlock: BigInt(import.meta.env.VITE_ORIGIN_VAULT_FROM_BLOCK || 11675595),
  poolEngineFromBlock: BigInt(import.meta.env.VITE_POOL_ENGINE_FROM_BLOCK || 5464049),

  /** Sepolia's chainKey on Attestcoin. Ethereum mainnet is 3; nothing else is attested. */
  chainKey: Number(import.meta.env.VITE_CHAIN_KEY ?? 1),

  /**
   * RPC overrides. The chain defaults are public endpoints that rate-limit and cap
   * `eth_getLogs` ranges; point these at a dedicated provider for a demo that must not
   * stall. Undefined falls back to the chain's default transport.
   */
  originRpc: (import.meta.env.VITE_SEPOLIA_RPC_URL || undefined) as string | undefined,
  creditcoinRpc: (import.meta.env.VITE_CREDITCOIN_RPC_URL || undefined) as string | undefined,

  proverUrl: (import.meta.env.VITE_PROVER_URL ??
    "https://prover.cc3-testnet.creditcoin.network") as string,

  /** Stablecoin decimals. TestUSDC mirrors USDC at 6. */
  decimals: 6,
} as const;

export const CHAIN_INFO_PRECOMPILE =
  "0x0000000000000000000000000000000000000fD3" as Address;

export const BLOCK_PROVER_PRECOMPILE =
  "0x0000000000000000000000000000000000000FD2" as Address;

/** Rough block times, for turning block counts into wall-clock estimates. */
export const SEPOLIA_BLOCK_SECONDS = 12;
