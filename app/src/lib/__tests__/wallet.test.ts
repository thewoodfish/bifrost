import { describe, expect, it } from "vitest";
import { isUnknownChainError } from "../wallet";

describe("isUnknownChainError", () => {
  it("recognises MetaMask's 4902", () => {
    expect(isUnknownChainError({ code: 4902, message: "Unrecognized chain ID" })).toBe(true);
  });

  it("recognises Rabby's wording, whatever the code", () => {
    const rabby = { code: -32603, message: 'Unrecognized chain ID "0x18e8f". Try adding the chain using wallet_addEthereumChain first.' };
    expect(isUnknownChainError(rabby)).toBe(true);
  });

  it("recognises a nested or stringified code", () => {
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ code: "4902" })).toBe(true);
  });

  it("does not treat a user rejection as an unknown chain", () => {
    expect(isUnknownChainError({ code: 4001, message: "User rejected the request." })).toBe(false);
  });
});
