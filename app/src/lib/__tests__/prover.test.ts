import { afterEach, describe, expect, it, vi } from "vitest";
import { explainReason, fetchProof, isTransientProverError, ProverError } from "../prover";
import lock2001 from "../__fixtures__/lock-2001-proof.json";

afterEach(() => vi.unstubAllGlobals());

describe("fetchProof", () => {
  it("maps the prover's response into the shape the precompile takes", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(lock2001)));
    vi.stubGlobal("fetch", fetch);

    const p = await fetchProof(lock2001.txHash);

    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/proof-by-tx\/1\/0xa551daeb/));
    expect(p.chainKey).toBe(1);
    expect(p.height).toBe(11675614);
    expect(p.txIndex).toBe(97);
    expect(p.encodedTx).toBe(lock2001.txBytes);
    expect(p.merkleProof.root).toBe(lock2001.merkleProof.root);
    expect(p.merkleProof.siblings).toHaveLength(lock2001.merkleProof.siblings.length);
    expect(Object.keys(p.merkleProof.siblings[0])).toEqual(["hash", "isLeft"]);
    expect(p.continuityProof.roots).toHaveLength(lock2001.continuityProof.roots.length);
  });

  it("treats 422 as 'not materialised yet', so the portal retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("pending", { status: 422 })));
    const err = await fetchProof("0x01").catch((e) => e);
    expect(err).toBeInstanceOf(ProverError);
    expect(err.transient).toBe(true);
  });

  it("treats a 400 as final", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad tx", { status: 400 })));
    const err = await fetchProof("0x01").catch((e) => e);
    expect(err.transient).toBe(false);
  });

  it("treats a network failure as transient", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await fetchProof("0x01").catch((e) => e);
    expect(err.transient).toBe(true);
  });
});

describe("isTransientProverError", () => {
  it.each([["422", true], ["404", true], ["429", true], ["503", true], ["400", false], ["timeout", true]])(
    "%s → %s", (m, want) => expect(isTransientProverError(m)).toBe(want),
  );
});

describe("explainReason", () => {
  it("turns previewIngest reasons into actionable titles", () => {
    expect(explainReason("receipt already used").title).toMatch(/already been used/);
    expect(explainReason("value mismatch").title).toMatch(/disagrees/);
    expect(explainReason("precompile rejected proof").title).toMatch(/rejected the proof/);
    expect(explainReason("something new").detail).toBe("something new");
  });
});
