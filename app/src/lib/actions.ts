import type { Address, Hex, WalletClient } from "viem";
import { decodeEventLog, parseUnits } from "viem";
import { ENGINE_ABI, ERC20_ABI, VAULT_ABI } from "./abis";
import { config } from "./config";
import { creditcoin, origin } from "./chains";
import { creditcoinClient, originClient } from "./clients";
import { fetchProof, ProverError, type AttestcoinProof } from "./prover";

export interface LockResult {
  txHash: Hex;
  blockNumber: number;
  dollarValue: bigint;
  valuationRound: bigint;
  owner: Address;
}

const usdc = (v: string) => parseUnits(v, config.decimals);

export async function registerPortfolio(w: WalletClient, account: Address, portfolioId: bigint) {
  const hash = await w.writeContract({
    chain: origin, account, address: config.originVault,
    abi: VAULT_ABI, functionName: "registerPortfolio", args: [portfolioId],
  });
  await originClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function setValuation(
  w: WalletClient, account: Address, portfolioId: bigint, dollars: string,
) {
  const hash = await w.writeContract({
    chain: origin, account, address: config.originVault,
    abi: VAULT_ABI, functionName: "setValuation", args: [portfolioId, usdc(dollars)],
  });
  await originClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Lock the portfolio and pull the details straight out of the emitted event.
 *
 * The PortfolioLocked layout is the contract between the two chains — the engine decodes
 * it out of the attested receipt — so the values that open the credit line are read from
 * the log rather than from anything the UI believes.
 */
export async function lockPortfolio(
  w: WalletClient, account: Address, portfolioId: bigint,
): Promise<LockResult> {
  const hash = await w.writeContract({
    chain: origin, account, address: config.originVault,
    abi: VAULT_ABI, functionName: "lockPortfolio", args: [portfolioId],
  });
  const receipt = await originClient.waitForTransactionReceipt({ hash });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.originVault.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
      if (parsed.eventName === "PortfolioLocked") {
        const a = parsed.args as unknown as {
          owner: Address; portfolioId: bigint; dollarValue: bigint; valuationRound: bigint;
        };
        return {
          txHash: hash,
          blockNumber: Number(receipt.blockNumber),
          dollarValue: a.dollarValue,
          valuationRound: a.valuationRound,
          owner: a.owner,
        };
      }
    } catch {
      // Not the event we want; keep looking.
    }
  }
  throw new Error("Lock succeeded but no PortfolioLocked event was found in the receipt.");
}

export interface PreviewResult {
  ok: boolean;
  reason: string;
  proof: AttestcoinProof;
  claim: {
    chainKey: bigint; height: bigint; portfolioId: bigint;
    borrower: Address; dollarValue: bigint; valuationRound: bigint;
  };
}

/**
 * Build the proof and dry-run it against the engine.
 *
 * `previewIngest` is a staticcall, so this costs nothing and answers the only question
 * that matters before spending gas. It is worth doing every time: `attestAndOpenCredit`
 * consumes the receipt on its first success, and a revert after the precompile has run
 * still bills the caller in full.
 */
export async function previewOpen(
  portfolioId: bigint, lockTx: string, borrower: Address,
  dollarValue: bigint, valuationRound: bigint,
  prefetched?: AttestcoinProof,
): Promise<PreviewResult> {
  const proof = prefetched ?? (await fetchProof(lockTx));
  const claim = {
    chainKey: BigInt(proof.chainKey),
    height: BigInt(proof.height),
    portfolioId,
    borrower,
    dollarValue,
    valuationRound,
  };
  const [ok, reason] = (await creditcoinClient.readContract({
    address: config.poolEngine, abi: ENGINE_ABI, functionName: "previewIngest",
    args: [claim, proof.encodedTx, proof.merkleProof, proof.continuityProof],
  })) as readonly [boolean, string];

  return { ok, reason, proof, claim };
}

export async function submitOpen(w: WalletClient, account: Address, p: PreviewResult) {
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.poolEngine,
    abi: ENGINE_ABI, functionName: "attestAndOpenCredit",
    args: [p.claim, p.proof.encodedTx, p.proof.merkleProof, p.proof.continuityProof],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function draw(w: WalletClient, account: Address, portfolioId: bigint, dollars: string) {
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.poolEngine,
    abi: ENGINE_ABI, functionName: "draw", args: [portfolioId, usdc(dollars)],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Repay, approving first only when the existing allowance is short.
 *
 * Skipping a redundant approval is not just gas: an unnecessary second wallet prompt is
 * where users abandon the flow.
 */
export async function repay(
  w: WalletClient, account: Address, portfolioId: bigint, dollars: string,
): Promise<{ repayTx: Hex }> {
  const amount = usdc(dollars);
  await ensureAllowance(w, account, amount);
  const repayTx = await w.writeContract({
    chain: creditcoin, account, address: config.poolEngine,
    abi: ENGINE_ABI, functionName: "repay", args: [portfolioId, amount],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash: repayTx });
  return { repayTx };
}

// ── Lender side ──────────────────────────────────────────────────────────────

/** Approve only when the allowance is short — a second wallet prompt is where people quit. */
async function ensureAllowance(w: WalletClient, account: Address, amount: bigint) {
  const allowance = (await creditcoinClient.readContract({
    address: config.stablecoin, abi: ERC20_ABI, functionName: "allowance",
    args: [account, config.poolEngine],
  })) as bigint;
  if (allowance >= amount) return;
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.stablecoin,
    abi: ERC20_ABI, functionName: "approve", args: [config.poolEngine, amount],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
}

export async function deposit(w: WalletClient, account: Address, dollars: string) {
  const amount = usdc(dollars);
  await ensureAllowance(w, account, amount);
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.poolEngine,
    abi: ENGINE_ABI, functionName: "deposit", args: [amount],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function withdraw(w: WalletClient, account: Address, dollars: string) {
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.poolEngine,
    abi: ENGINE_ABI, functionName: "withdraw", args: [usdc(dollars)],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Exit a whole position by shares, so rounding never leaves dust behind. */
export async function redeemAll(w: WalletClient, account: Address) {
  const shares = (await creditcoinClient.readContract({
    address: config.poolEngine, abi: ENGINE_ABI, functionName: "sharesOf", args: [account],
  })) as bigint;
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.poolEngine,
    abi: ENGINE_ABI, functionName: "redeem", args: [shares],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** TestUSDC's open mint, so anyone can try lending. Testnet only, by construction. */
export async function mintTestUsdc(w: WalletClient, account: Address, dollars: string) {
  const hash = await w.writeContract({
    chain: creditcoin, account, address: config.stablecoin,
    abi: ERC20_ABI, functionName: "mint", args: [account, usdc(dollars)],
  });
  await creditcoinClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function lpPosition(account: Address): Promise<{ shares: bigint; assets: bigint }> {
  const [shares, assets] = await Promise.all([
    creditcoinClient.readContract({ address: config.poolEngine, abi: ENGINE_ABI, functionName: "sharesOf", args: [account] }),
    creditcoinClient.readContract({ address: config.poolEngine, abi: ENGINE_ABI, functionName: "assetsOf", args: [account] }),
  ]);
  return { shares: shares as bigint, assets: assets as bigint };
}

export async function owed(portfolioId: bigint): Promise<{ principal: bigint; interest: bigint }> {
  const [principal, interest] = (await creditcoinClient.readContract({
    address: config.poolEngine, abi: ENGINE_ABI, functionName: "owed", args: [portfolioId],
  })) as readonly [bigint, bigint];
  return { principal, interest };
}

export interface PoolState {
  /** LP money: idle stablecoin plus principal lent out. */
  totalAssets: bigint;
  /** Available to draw or withdraw now. */
  idle: bigint;
  borrowed: bigint;
  reserves: bigint;
  utilizationBps: number;
  borrowRateBps: number;
  supplyRateBps: number;
  reserveFactorBps: number;
}

export async function poolState(): Promise<PoolState> {
  const read = (functionName: string) =>
    creditcoinClient.readContract({ address: config.poolEngine, abi: ENGINE_ABI, functionName } as never) as Promise<bigint>;
  const [totalAssets, idle, borrowed, reserves, util, borrowRate, supplyRate, reserveFactor] = await Promise.all([
    read("totalAssets"), read("idleLiquidity"), read("totalBorrowed"), read("protocolReserves"),
    read("utilizationBps"), read("borrowRateBps"), read("supplyRateBps"), read("reserveFactorBps"),
  ]);
  return {
    totalAssets, idle, borrowed, reserves,
    utilizationBps: Number(util), borrowRateBps: Number(borrowRate),
    supplyRateBps: Number(supplyRate), reserveFactorBps: Number(reserveFactor),
  };
}

export async function stablecoinBalance(account: Address): Promise<bigint> {
  return (await creditcoinClient.readContract({
    address: config.stablecoin, abi: ERC20_ABI, functionName: "balanceOf", args: [account],
  })) as bigint;
}

export { ProverError };
