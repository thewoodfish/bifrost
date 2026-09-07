import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../.env"), quiet: true });
loadEnv({ quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} — see .env.example`);
  return v;
}

export const config = {
  sepoliaRpc: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
  creditcoinRpc: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",

  /** Sepolia's chainKey on CC3. Ethereum mainnet is 3; nothing else is attested. */
  chainKey: Number(process.env.CHAIN_KEY ?? 1),

  /** Both known prover hosts are live and identical; this is the SDK-documented one. */
  proverUrl: process.env.PROVER_URL ?? "https://prover.cc3-testnet.creditcoin.network",

  originVault: () => required("ORIGIN_VAULT"),
  poolEngine: () => required("POOL_ENGINE"),
  stablecoin: () => process.env.STABLECOIN ?? "",

  /** Attestation lands in roughly 8-20 min; allow 30 before giving up. */
  attestTimeoutMs: Number(process.env.ATTEST_TIMEOUT_MS ?? 30 * 60_000),
  attestPollMs: Number(process.env.ATTEST_POLL_MS ?? 15_000),
} as const;

export const CHAIN_INFO_PRECOMPILE = "0x0000000000000000000000000000000000000fD3";
export const BLOCK_PROVER_PRECOMPILE = "0x0000000000000000000000000000000000000FD2";
