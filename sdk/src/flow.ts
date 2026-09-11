import { Contract, formatUnits, type Signer } from "ethers";
import { config } from "./config.js";
import { creditcoin, hasValuerSigner, sepolia, signerFor } from "./chain.js";
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

/**
 * Register, value and lock a portfolio on Sepolia.
 *
 * Three transactions across two keys: the borrower registers and locks, while an
 * independent valuer publishes the valuation. Splitting the signers here is what makes
 * the resulting attestation worth anything — otherwise it proves a number the borrower
 * chose for itself.
 */
export async function lockPortfolio(
  portfolioId: bigint,
  dollarValue: bigint,
  log: (s: string) => void,
): Promise<LockDetails> {
  const provider = sepolia();
  const borrower = await signerFor(provider, "borrower");
  const v = await vault(borrower);
  const me = await borrower.getAddress();

  const existing = await v.getPortfolio(portfolioId);
  if (!existing.exists) {
    if (!(await v.isOriginator(me))) {
      throw new Error(`${me} is not an approved originator. Grant it with setOriginator from the admin key.`);
    }
    log(`registering portfolio ${portfolioId} as ${me}...`);
    await (await v.registerPortfolio(portfolioId)).wait();
  } else {
    log(`portfolio ${portfolioId} already registered to ${existing.owner}`);
  }

  if (existing.dollarValue !== dollarValue) {
    const valuerSigner = await signerFor(provider, "valuer");
    const valuerAddr = await valuerSigner.getAddress();

    if (!(await v.isValuer(valuerAddr))) {
      const hint = hasValuerSigner()
        ? `Approve it with setValuer from the admin key.`
        : `No separate valuer key is configured, so the borrower's key was used. ` +
          `Set VALUER_KEYSTORE_ACCOUNT + VALUER_KEYSTORE_PASSWORD (or VALUER_PRIVATE_KEY).`;
      throw new Error(`${valuerAddr} is not an approved valuer. ${hint}`);
    }

    log(`publishing valuation ${dollarValue} as valuer ${valuerAddr}...`);
    await (await vault(valuerSigner)).setValuation(portfolioId, dollarValue).then((t: any) => t.wait());
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
  const e = await engine();
  const [line, [, interest], rate] = await Promise.all([
    e.getCreditLine(portfolioId), e.owed(portfolioId), e.borrowRateBps(),
  ]);
  return { line, interest: interest as bigint, rateBps: rate as bigint };
}

/** The lender side: what LPs have in the pool, what is lent out, and what it earns. */
export async function poolStats() {
  const e = await engine();
  const [assets, idle, borrowed, reserves, util, borrowRate, supplyRate, reserveFactor] = await Promise.all([
    e.totalAssets(), e.idleLiquidity(), e.totalBorrowed(), e.protocolReserves(),
    e.utilizationBps(), e.borrowRateBps(), e.supplyRateBps(), e.reserveFactorBps(),
  ]);
  return { assets, idle, borrowed, reserves, util, borrowRate, supplyRate, reserveFactor } as Record<string, bigint>;
}
