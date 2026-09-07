import { JsonRpcProvider, Wallet, Contract, type Signer } from "ethers";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { config, CHAIN_INFO_PRECOMPILE } from "./config.js";
import { CHAIN_INFO_ABI } from "./abis.js";

export const sepolia = () => new JsonRpcProvider(config.sepoliaRpc);
export const creditcoin = () => new JsonRpcProvider(config.creditcoinRpc);

/**
 * Resolve a signer. Prefers an encrypted Foundry keystore so a raw key never has
 * to sit in the environment; falls back to PRIVATE_KEY for CI.
 *
 *   KEYSTORE_ACCOUNT=bifrost KEYSTORE_PASSWORD=... npm run bifrost -- ...
 */
export async function signerFor(provider: JsonRpcProvider): Promise<Signer> {
  const account = process.env.KEYSTORE_ACCOUNT;
  if (account) {
    const path = join(homedir(), ".foundry", "keystores", account);
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) throw new Error("KEYSTORE_ACCOUNT set but KEYSTORE_PASSWORD is missing");
    const json = await readFile(path, "utf8");
    const wallet = await Wallet.fromEncryptedJson(json, password);
    return wallet.connect(provider);
  }

  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "No signer configured. Set KEYSTORE_ACCOUNT + KEYSTORE_PASSWORD (preferred) or PRIVATE_KEY.",
    );
  }
  return new Wallet(pk, provider);
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
