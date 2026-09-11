import { describe, expect, it } from "vitest";
import { keccak256, parseUnits, type Hex } from "viem";
import { decodeAttestedTx, forgeValue, LOCK_TOPIC } from "../proof";
import lock2001 from "../__fixtures__/lock-2001-proof.json";
import foreignTx from "../../../../contracts/test/fixtures/sepolia-attested-tx.hex?raw";

/**
 * The browser decoder must see exactly what the engine sees, so it is tested against
 * payloads captured from the live Attestcoin prover — never ones built here, which would
 * agree with any mistake made in their own builder.
 *
 * lock-2001-proof.json: the prover's response for portfolio 2001's lock on Sepolia
 * (tx 0xa551daeb…0e155b, block 11,675,614), captured 2026-09-11.
 */
const encoded = lock2001.txBytes as Hex;
const usd = (n: string) => parseUnits(n, 6);

describe("decodeAttestedTx — real attested Bifrost lock", () => {
  const d = decodeAttestedTx(encoded);

  it("reads the envelope and takes the receipt from the last chunk", () => {
    expect(d.txType).toBe(2);
    expect(d.chunks).toBe(3);
    expect(d.status).toBe(1);
  });

  it("finds PortfolioLocked from the vault and decodes the collateral facts", () => {
    expect(d.lock).not.toBeNull();
    expect(d.lock!.owner.toLowerCase()).toBe("0x3656abd007aed9b9a572a63c58447044d69f8daf");
    expect(d.lock!.portfolioId).toBe(2001n);
    expect(d.lock!.dollarValue).toBe(usd("750000"));
    expect(d.lock!.valuationRound).toBe(1n);
  });

  it("derives receiptId as keccak256 of the whole payload, as the engine does", () => {
    expect(d.receiptId).toBe(keccak256(encoded));
  });
});

describe("decodeAttestedTx — real attested receipt from another contract", () => {
  const d = decodeAttestedTx(`0x${foreignTx.trim().replace(/^0x/, "")}` as Hex);

  // Same numbers the Foundry test asserts on the same fixture.
  it("decodes status, gas and logs", () => {
    expect(d.status).toBe(1);
    expect(d.gasUsed).toBe(123491n);
    expect(d.logs).toHaveLength(2);
  });

  it("does not mistake another emitter's log for a lock", () => {
    expect(d.lock).toBeNull();
  });
});

describe("forgeValue — the 'try to lie' demo", () => {
  it("changes only the lock's dollar value", () => {
    const forged = forgeValue(encoded, usd("7500000"));
    const f = decodeAttestedTx(forged);
    const g = decodeAttestedTx(encoded);

    expect(forged).not.toBe(encoded);
    expect(forged.length).toBe(encoded.length);
    expect(f.lock!.dollarValue).toBe(usd("7500000"));
    expect(f.lock!.owner).toBe(g.lock!.owner);
    expect(f.lock!.portfolioId).toBe(g.lock!.portfolioId);
    expect(f.lock!.valuationRound).toBe(g.lock!.valuationRound);
    expect(f.status).toBe(g.status);
    expect(f.logs.length).toBe(g.logs.length);
    expect(f.receiptId).not.toBe(g.receiptId);
  });

  it("round-trips byte-for-byte when the value is left as attested", () => {
    // Why submitting the genuine value in the demo is accepted by the precompile.
    expect(forgeValue(encoded, usd("750000"))).toBe(encoded);
  });

  it("targets the PortfolioLocked topic", () => {
    const d = decodeAttestedTx(encoded);
    expect(d.logs.some((l) => l.topics[0] === LOCK_TOPIC)).toBe(true);
  });
});
