/** Human-readable ABIs for the contracts this pipeline drives. */

export const RWA_ORIGIN_VAULT_ABI = [
  "function registerPortfolio(uint256 portfolioId)",
  "function setValuation(uint256 portfolioId, uint256 dollarValue)",
  "function lockPortfolio(uint256 portfolioId)",
  "function unlockPortfolio(uint256 portfolioId)",
  "function setOriginator(address originator, bool allowed)",
  "function setValuer(address valuer, bool allowed)",
  "function isOriginator(address) view returns (bool)",
  "function isValuer(address) view returns (bool)",
  "function getPortfolio(uint256 portfolioId) view returns (tuple(address owner, uint256 dollarValue, uint64 valuationRound, bool exists, bool isLocked))",
  "event PortfolioLocked(address indexed owner, uint256 indexed portfolioId, uint256 dollarValue, uint64 valuationRound)",
] as const;

const CLAIM = "tuple(uint64 chainKey, uint64 height, uint256 portfolioId, address borrower, uint256 dollarValue, uint64 valuationRound)";
const MERKLE = "tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings)";
const CONTINUITY = "tuple(bytes32 lowerEndpointDigest, bytes32[] roots)";

export const POOL_ENGINE_ABI = [
  `function attestAndOpenCredit(${CLAIM} claim, bytes encodedTx, ${MERKLE} merkleProof, ${CONTINUITY} continuityProof) returns (uint256)`,
  `function previewIngest(${CLAIM} claim, bytes encodedTx, ${MERKLE} merkleProof, ${CONTINUITY} continuityProof) view returns (bool ok, string reason)`,
  "function draw(uint256 portfolioId, uint256 amount)",
  "function repay(uint256 portfolioId, uint256 amount)",
  "function available(uint256 portfolioId) view returns (uint256)",
  "function getCreditLine(uint256 portfolioId) view returns (tuple(address borrower, uint256 portfolioId, uint256 attestedValue, uint256 creditLimit, uint256 drawn, uint64 valuationRound, bool open))",
  "function ltvBps() view returns (uint256)",
  "function originVault() view returns (address)",
  "function expectedChainKey() view returns (uint64)",
  "event CreditLineOpened(address indexed borrower, uint256 indexed portfolioId, uint256 attestedValue, uint256 creditLimit, uint64 valuationRound, bytes32 receiptId)",
] as const;

/** ChainInfo precompile. Names are snake_case — camelCase returns "Unknown selector". */
export const CHAIN_INFO_ABI = [
  "function get_supported_chains() view returns (tuple(uint64 chainKey, uint64 chainId, string chainName, uint64 chainEncoding)[])",
  "function get_latest_attestation_height_and_hash(uint64 chainKey) view returns (uint64 height, bytes32 hash, bool isAttestation, bool exists)",
  "function is_height_attested(uint64 chainKey, uint64 height) view returns (bool)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
] as const;
