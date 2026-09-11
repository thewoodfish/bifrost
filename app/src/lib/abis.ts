import { parseAbi } from "viem";

/**
 * ABIs for the contracts the portal drives. Mirrors sdk/src/abis.ts — the two must agree,
 * since the CLI and the portal open lines on the same engine.
 */

export const VAULT_ABI = [
  { type: "function", name: "registerPortfolio", stateMutability: "nonpayable", inputs: [{ name: "portfolioId", type: "uint256" }], outputs: [] },
  { type: "function", name: "setValuation", stateMutability: "nonpayable", inputs: [{ name: "portfolioId", type: "uint256" }, { name: "dollarValue", type: "uint256" }], outputs: [] },
  { type: "function", name: "lockPortfolio", stateMutability: "nonpayable", inputs: [{ name: "portfolioId", type: "uint256" }], outputs: [] },
  { type: "function", name: "isOriginator", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isValuer", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxValuationAge", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function", name: "getPortfolio", stateMutability: "view",
    inputs: [{ name: "portfolioId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "owner", type: "address" },
        { name: "dollarValue", type: "uint256" },
        { name: "valuationRound", type: "uint64" },
        { name: "valuedAt", type: "uint64" },
        { name: "exists", type: "bool" },
        { name: "isLocked", type: "bool" },
      ],
    }],
  },
  {
    type: "event", name: "PortfolioLocked",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "portfolioId", type: "uint256", indexed: true },
      { name: "dollarValue", type: "uint256", indexed: false },
      { name: "valuationRound", type: "uint64", indexed: false },
    ],
  },
] as const;

const CLAIM = {
  name: "claim", type: "tuple",
  components: [
    { name: "chainKey", type: "uint64" },
    { name: "height", type: "uint64" },
    { name: "portfolioId", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "dollarValue", type: "uint256" },
    { name: "valuationRound", type: "uint64" },
  ],
} as const;

const MERKLE = {
  name: "merkleProof", type: "tuple",
  components: [
    { name: "root", type: "bytes32" },
    {
      name: "siblings", type: "tuple[]",
      components: [
        { name: "hash", type: "bytes32" },
        { name: "isLeft", type: "bool" },
      ],
    },
  ],
} as const;

const CONTINUITY = {
  name: "continuityProof", type: "tuple",
  components: [
    { name: "lowerEndpointDigest", type: "bytes32" },
    { name: "roots", type: "bytes32[]" },
  ],
} as const;

const PROOF_INPUTS = [CLAIM, { name: "encodedTx", type: "bytes" }, MERKLE, CONTINUITY] as const;

export const ENGINE_ABI = [
  { type: "function", name: "attestAndOpenCredit", stateMutability: "nonpayable", inputs: PROOF_INPUTS, outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewIngest", stateMutability: "view", inputs: PROOF_INPUTS, outputs: [{ name: "ok", type: "bool" }, { name: "reason", type: "string" }] },
  { type: "function", name: "draw", stateMutability: "nonpayable", inputs: [{ name: "portfolioId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "portfolioId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "available", stateMutability: "view", inputs: [{ name: "portfolioId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ltvBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "originVault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "expectedChainKey", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "maxLockAge", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "lockAge", stateMutability: "view", inputs: [{ name: "height", type: "uint64" }], outputs: [{ type: "uint64" }] },
  // Lender side
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "idleLiquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalBorrowed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolReserves", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sharesOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "assetsOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "utilizationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "borrowRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "supplyRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reserveFactorBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owed", stateMutability: "view", inputs: [{ name: "portfolioId", type: "uint256" }], outputs: [{ name: "principal", type: "uint256" }, { name: "interest", type: "uint256" }] },
  { type: "function", name: "usedReceipt", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ type: "bool" }] },
  {
    type: "function", name: "getCreditLine", stateMutability: "view",
    inputs: [{ name: "portfolioId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "borrower", type: "address" },
        { name: "portfolioId", type: "uint256" },
        { name: "attestedValue", type: "uint256" },
        { name: "creditLimit", type: "uint256" },
        { name: "drawn", type: "uint256" },
        { name: "valuationRound", type: "uint64" },
        { name: "open", type: "bool" },
      ],
    }],
  },
] as const;

/**
 * Every event the indexer reads. Together they are the whole protocol history: the
 * portal derives portfolios, credit lines and protocol totals from these alone.
 */
export const VAULT_EVENTS = parseAbi([
  "event PortfolioRegistered(uint256 indexed portfolioId, address indexed owner)",
  "event PortfolioValued(uint256 indexed portfolioId, uint256 dollarValue, uint64 valuationRound)",
  "event PortfolioLocked(address indexed owner, uint256 indexed portfolioId, uint256 dollarValue, uint64 valuationRound)",
  "event PortfolioUnlocked(address indexed owner, uint256 indexed portfolioId)",
  "event ValuerSet(address indexed valuer, bool allowed)",
  "event OriginatorSet(address indexed originator, bool allowed)",
]);

export const ENGINE_EVENTS = parseAbi([
  "event CreditLineOpened(address indexed borrower, uint256 indexed portfolioId, uint256 attestedValue, uint256 creditLimit, uint64 valuationRound, bytes32 receiptId)",
  "event Drawn(address indexed borrower, uint256 indexed portfolioId, uint256 amount)",
  "event Repaid(address indexed borrower, uint256 indexed portfolioId, uint256 amount)",
  "event CreditLineClosed(uint256 indexed portfolioId)",
  "event InterestPaid(address indexed payer, uint256 indexed portfolioId, uint256 interest, uint256 toReserves)",
  "event Deposited(address indexed lp, uint256 assets, uint256 shares)",
  "event Withdrawn(address indexed lp, uint256 assets, uint256 shares)",
]);

/** BlockProver precompile, read-only form. Struct order is load-bearing: root before siblings. */
export const BLOCK_PROVER_ABI = [
  {
    type: "function", name: "verify", stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "height", type: "uint64" },
      { name: "encodedTransaction", type: "bytes" },
      MERKLE,
      CONTINUITY,
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** ChainInfo precompile. snake_case — camelCase returns "Unknown selector". */
export const CHAIN_INFO_ABI = [
  {
    type: "function", name: "get_supported_chains", stateMutability: "view", inputs: [],
    outputs: [{
      type: "tuple[]",
      components: [
        { name: "chainKey", type: "uint64" },
        { name: "chainId", type: "uint64" },
        { name: "chainName", type: "string" },
        { name: "chainEncoding", type: "uint64" },
      ],
    }],
  },
  {
    type: "function", name: "get_latest_attestation_height_and_hash", stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      { name: "height", type: "uint64" },
      { name: "hash", type: "bytes32" },
      { name: "isAttestation", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function", name: "is_height_attested", stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }, { name: "height", type: "uint64" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  /** TestUSDC only: unrestricted mint, so anyone trying the lender flow can get test funds. */
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;
