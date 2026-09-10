import { createPublicClient, http } from "viem";
import { creditcoin, origin } from "./chains";
import { config } from "./config";

/** Read-only clients. Reads never need a wallet — the portal is useful before connecting. */
export const originClient = createPublicClient({
  chain: origin,
  transport: http(config.originRpc),
});
export const creditcoinClient = createPublicClient({
  chain: creditcoin,
  transport: http(config.creditcoinRpc),
});

export function publicClientFor(chainId: number) {
  return chainId === creditcoin.id ? creditcoinClient : originClient;
}
