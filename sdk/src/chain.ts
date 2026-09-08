import { JsonRpcProvider, Wallet, Contract, type Signer } from "ethers";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { config, CHAIN_INFO_PRECOMPILE } from "./config.js";
import { CHAIN_INFO_ABI } from "./abis.js";

export const sepolia = () => new JsonRpcProvider(config.sepoliaRpc);
export const creditcoin = () => new JsonRpcProvider(config.creditcoinRpc);

/** Which on-chain role a signer is acting as. */
export type Role = "borrower" | "valuer";

/**
 * Resolve a signer for a role. Prefers an encrypted Foundry keystore so a raw key
 * never has to sit in the environment; falls back to a private key for CI.
 *
 *   borrower:  KEYSTORE_ACCOUNT        + KEYSTORE_PASSWORD        | PRIVATE_KEY
 *   valuer:    VALUER_KEYSTORE_ACCOUNT + VALUER_KEYSTORE_PASSWORD | VALUER_PRIVATE_KEY
 *
 * The valuer falls back to the borrower's signer when unconfigured. That fallback
 * is deliberate for local testing, but on a deployment with real role separation it
 * surfaces as a NotValuer revert rather than silently pricing the borrower's own
 * collateral.
 */
export async function signerFor(provider: JsonRpcProvider, role: Role = "borrower"): Promise<Signer> {
  const prefix = role === "valuer" ? "VALUER_" : "";

  const account = process.env[`${prefix}KEYSTORE_ACCOUNT`];
  if (account) {
    const password = process.env[`${prefix}KEYSTORE_PASSWORD`];
    if (!password) {
      throw new Error(`${prefix}KEYSTORE_ACCOUNT is set but ${prefix}KEYSTORE_PASSWORD is missing`);
    }
    const json = await readFile(join(homedir(), ".foundry", "keystores", account), "utf8");
    return (await Wallet.fromEncryptedJson(json, password)).connect(provider);
  }

  const pk = process.env[`${prefix}PRIVATE_KEY`];
  if (pk) return new Wallet(pk, provider);

  if (role === "valuer") return signerFor(provider, "borrower");

  throw new Error(
    "No signer configured. Set KEYSTORE_ACCOUNT + KEYSTORE_PASSWORD (preferred) or PRIVATE_KEY.",
  );
}

/** True when a distinct valuer key is configured. */
export function hasValuerSigner(): boolean {
  return Boolean(process.env.VALUER_KEYSTORE_ACCOUNT || process.env.VALUER_PRIVATE_KEY);
}

export function chainInfo(provider: JsonRpcProvider): Contract {
  return new Contract(CHAIN_INFO_PRECOMPILE, CHAIN_INFO_ABI, provider);
}

/** Latest attested source height, and how far behind the source chain head it is. */
export async function attestationLag(): Promise<{
  head: number;
  attested: number;
  behind: number;
  exists: boolean;
}> {
  const [head, latest] = await Promise.all([
    sepolia().getBlockNumber(),
    chainInfo(creditcoin()).get_latest_attestation_height_and_hash(config.chainKey),
  ]);
  const attested = Number(latest[0]);
  return { head, attested, behind: head - attested, exists: Boolean(latest[3]) };
}
