import { defineChain } from "viem";
import { sepolia } from "viem/chains";

/**
 * Creditcoin CC3 testnet.
 *
 * Pre-merge EVM, which is why the contracts are compiled for `london`. Nothing here
 * depends on that, but it explains why CC3 blocks lack `mixHash` and some tooling
 * complains while working fine.
 */
export const creditcoin = defineChain({
  id: 102031,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://creditcoin-testnet.blockscout.com" },
  },
  testnet: true,
});

export const origin = sepolia;

export const CHAINS = { origin, creditcoin } as const;

export function explorerTx(chainId: number, hash: string): string {
  const base =
    chainId === creditcoin.id
      ? creditcoin.blockExplorers.default.url
      : "https://sepolia.etherscan.io";
  return `${base}/tx/${hash}`;
}

export function explorerAddress(chainId: number, address: string): string {
  const base =
    chainId === creditcoin.id
      ? creditcoin.blockExplorers.default.url
      : "https://sepolia.etherscan.io";
  return `${base}/address/${address}`;
}
