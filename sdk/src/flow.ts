import { Contract, formatUnits, type Signer } from "ethers";
import { config } from "./config.js";
import { creditcoin, sepolia, signerFor } from "./chain.js";
import { POOL_ENGINE_ABI, RWA_ORIGIN_VAULT_ABI } from "./abis.js";
import { attestAndBuild, type AttestcoinProof, type Stage } from "./attest.js";

export interface LockDetails {
  txHash: string;
  blockNumber: number;
  portfolioId: bigint;
  owner: string;
  dollarValue: bigint;
  valuationRound: bigint;
}

async function vault(signer?: Signer): Promise<Contract> {
  const provider = sepolia();
  return new Contract(config.originVault(), RWA_ORIGIN_VAULT_ABI, signer ?? provider);
}

async function engine(signer?: Signer): Promise<Contract> {
  const provider = creditcoin();
  return new Contract(config.poolEngine(), POOL_ENGINE_ABI, signer ?? provider);
}

/** Register, value and lock a portfolio on Sepolia. Returns the lock's details. */
export async function lockPortfolio(
  portfolioId: bigint,
  dollarValue: bigint,
  log: (s: string) => void,
): Promise<LockDetails> {
  const signer = await signerFor(sepolia());
  const v = await vault(signer);
  const me = await signer.getAddress();

  const existing = await v.getPortfolio(portfolioId);
  if (!existing.exists) {
    log(`registering portfolio ${portfolioId}...`);
    await (await v.registerPortfolio(portfolioId)).wait();
  } else {
    log(`portfolio ${portfolioId} already registered to ${existing.owner}`);
  }

  if (existing.dollarValue !== dollarValue) {
    if (!(await v.isValuer(me))) {
      throw new Error(
        `${me} is not an approved valuer. Valuation must come from an independent ` +
          `valuer — that separation is the point. Grant it with setValuer, or run this ` +
          `step from the valuer's key.`,
      );
    }
    log(`publishing valuation ${dollarValue}...`);
    await (await v.setValuation(portfolioId, dollarValue)).wait();
  }

  log(`locking portfolio ${portfolioId}...`);
  const tx = await v.lockPortfolio(portfolioId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("lock transaction produced no receipt");

  const parsed = receipt.logs
    .map((l: any) => {
      try {
        return v.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === "PortfolioLocked");

  if (!parsed) throw new Error("PortfolioLocked not found in lock receipt");

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    portfolioId: parsed.args.portfolioId,
    owner: parsed.args.owner,
    dollarValue: parsed.args.dollarValue,
    valuationRound: parsed.args.valuationRound,
  };
}

/** Read a lock's details back out of an existing Sepolia transaction. */
export async function readLock(txHash: string): Promise<LockDetails> {
  const provider = sepolia();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`No receipt for ${txHash} on Sepolia`);

  const v = await vault();
  const parsed = receipt.logs
    .map((l) => {
      try {
        return v.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "PortfolioLocked");

  if (!parsed) {
    throw new Error(
      `No PortfolioLocked event from ${config.originVault()} in ${txHash}. ` +
        `Wrong tx, or ORIGIN_VAULT points at a different deployment.`,
    );
  }

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    portfolioId: parsed.args.portfolioId,
    owner: parsed.args.owner,
    dollarValue: parsed.args.dollarValue,
    valuationRound: parsed.args.valuationRound,
  };
}

function claimFor(lock: LockDetails, proof: AttestcoinProof) {
  return {
    chainKey: proof.chainKey,
    height: proof.height,
    portfolioId: lock.portfolioId,
    borrower: lock.owner,
    dollarValue: lock.dollarValue,
    valuationRound: lock.valuationRound,
  };
}

/**
 * Full cross-chain path: wait for attestation, build the proof, dry-run it, then open
 * the credit line.
 *
 * The dry run matters. `attestAndOpenCredit` consumes the receipt on its first
 * successful call, and a revert after the precompile has run still costs real gas —
 * previewIngest is a staticcall that tells you why it would fail, for free.
 */
export async function openCreditLine(
  lock: LockDetails,
  log: (s: string) => void,
  onStage?: (s: Stage) => void,
): Promise<{ creditLimit: bigint; txHash: string }> {
  const proof = await attestAndBuild(lock.blockNumber, lock.txHash, onStage);

  const readOnly = await engine();
  const claim = claimFor(lock, proof);

  const [ok, reason] = await readOnly.previewIngest(
    claim,
    proof.encodedTx,
    proof.merkleProof,
    proof.continuityProof,
  );
  if (!ok) throw new Error(`Proof rejected before submission: ${reason}`);
  log("previewIngest passed — submitting");

  const signer = await signerFor(creditcoin());
  const e = await engine(signer);
  const tx = await e.attestAndOpenCredit(claim, proof.encodedTx, proof.merkleProof, proof.continuityProof);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("attestAndOpenCredit produced no receipt");

  const line = await readOnly.getCreditLine(lock.portfolioId);
  return { creditLimit: line.creditLimit, txHash: receipt.hash };
}

export async function drawDown(portfolioId: bigint, amount: bigint, log: (s: string) => void): Promise<string> {
  const signer = await signerFor(creditcoin());
  const e = await engine(signer);
  log(`drawing ${formatUnits(amount, 6)} tUSDC on portfolio ${portfolioId}...`);
  const receipt = await (await e.draw(portfolioId, amount)).wait();
  return receipt.hash;
}

export async function creditLineOf(portfolioId: bigint) {
  return (await engine()).getCreditLine(portfolioId);
}
