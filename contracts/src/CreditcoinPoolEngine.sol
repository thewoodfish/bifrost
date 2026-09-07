// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAttestcoinBlockProver, Attestcoin} from "./interfaces/IAttestcoinBlockProver.sol";
import {AttestedTx} from "./lib/AttestedTx.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title CreditcoinPoolEngine
 * @notice Issues stablecoin credit lines on Creditcoin against RWA portfolios that
 *         Attestcoin has proven to be locked on an origin chain.
 *
 * @dev The security property that makes this protocol meaningful:
 *
 *      Collateral value is NEVER taken from calldata. It is decoded out of the
 *      `PortfolioLocked` receipt log that the BlockProver precompile has just
 *      verified. `LockClaim` fields only locate and cross-check that log — every
 *      one of them must equal what the proven receipt says, or the call reverts.
 *      A borrower therefore cannot mint credit beyond what an independent valuer
 *      published and the origin chain actually escrowed.
 */
contract CreditcoinPoolEngine {
    using AttestedTx for bytes;

    /// @dev keccak256("PortfolioLocked(address,uint256,uint256,uint64)")
    bytes32 public constant PORTFOLIO_LOCKED_TOPIC =
        keccak256("PortfolioLocked(address,uint256,uint256,uint64)");

    uint256 public constant BPS = 10_000;
    /// @dev Hard ceiling on LTV; the over-collateralization buffer is not admin-removable.
    uint256 public constant MAX_LTV_BPS = 8_000;

    IAttestcoinBlockProver public immutable blockProver;
    IERC20 public immutable stablecoin;

    /// @notice Attested source chain (Sepolia = 1 on CC3 testnet).
    uint64 public immutable expectedChainKey;
    /// @notice RWAOriginVault address on the origin chain; only its logs are trusted.
    address public immutable originVault;

    address public admin;
    uint256 public ltvBps = 8_000;

    struct LockClaim {
        uint64 chainKey;
        uint64 height;
        uint256 portfolioId;
        address borrower;
        uint256 dollarValue;
        uint64 valuationRound;
    }

    struct CreditLine {
        address borrower;
        uint256 portfolioId;
        uint256 attestedValue;
        uint256 creditLimit;
        uint256 drawn;
        uint64 valuationRound;
        bool open;
    }

    /// @notice Receipts already consumed, keyed by keccak256(encodedTransaction).
    mapping(bytes32 => bool) public usedReceipt;
    /// @notice One open line per portfolio.
    mapping(uint256 => bool) public portfolioHasOpenLine;
    mapping(uint256 => CreditLine) public creditLines;

    event CreditLineOpened(
        address indexed borrower,
        uint256 indexed portfolioId,
        uint256 attestedValue,
        uint256 creditLimit,
        uint64 valuationRound,
        bytes32 receiptId
    );
    event Drawn(address indexed borrower, uint256 indexed portfolioId, uint256 amount);
    event Repaid(address indexed borrower, uint256 indexed portfolioId, uint256 amount);
    event CreditLineClosed(uint256 indexed portfolioId);
    event LtvUpdated(uint256 ltvBps);
    event AdminTransferred(address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();
    error BadChainKey();
    error BorrowerMismatch();
    error ReceiptAlreadyUsed();
    error ProofRejected();
    error LockLogNotFound();
    error MalformedLockLog();
    error SourceTxFailed();
    error ClaimDoesNotMatchProof();
    error LineAlreadyOpen();
    error NoOpenLine();
    error ExceedsCreditLimit();
    error NothingDrawn();
    error LtvTooHigh();
    error ZeroValue();
    error TransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address _blockProver, address _stablecoin, address _originVault, uint64 _chainKey, address _admin) {
        if (_stablecoin == address(0) || _originVault == address(0) || _admin == address(0)) revert ZeroAddress();
        blockProver = IAttestcoinBlockProver(
            _blockProver == address(0) ? Attestcoin.BLOCK_PROVER : _blockProver
        );
        stablecoin = IERC20(_stablecoin);
        originVault = _originVault;
        expectedChainKey = _chainKey;
        admin = _admin;
    }

    // -- Attestation-gated credit ---------------------------------------------

    /**
     * @notice Prove an origin-chain lock via Attestcoin and open a credit line.
     * @param claim         Fields locating the lock; all are cross-checked against the proof.
     * @param encodedTx     The origin-chain receipt RLP that Attestcoin proves.
     * @param merkleProof   Block-inclusion proof for the receipt.
     * @param continuityProof Chain-continuity proof for the source block.
     */
    function attestAndOpenCredit(
        LockClaim calldata claim,
        bytes calldata encodedTx,
        IAttestcoinBlockProver.MerkleProof calldata merkleProof,
        IAttestcoinBlockProver.ContinuityProof calldata continuityProof
    ) external returns (uint256 creditLimit) {
        if (claim.chainKey != expectedChainKey) revert BadChainKey();
        if (claim.borrower != msg.sender) revert BorrowerMismatch();
        if (portfolioHasOpenLine[claim.portfolioId]) revert LineAlreadyOpen();

        bytes32 receiptId = keccak256(encodedTx);
        if (usedReceipt[receiptId]) revert ReceiptAlreadyUsed();
        usedReceipt[receiptId] = true;

        // 1. Attestcoin verifies the receipt was really included on the source chain.
        if (!blockProver.verifyAndEmit(claim.chainKey, claim.height, encodedTx, merkleProof, continuityProof)) {
            revert ProofRejected();
        }

        // 2. Derive the collateral facts from the proven receipt itself.
        (uint256 provenValue, address provenOwner, uint64 provenRound) = _decodeLock(encodedTx, claim.portfolioId);

        // 3. Bind the claim to the proof.
        if (
            provenOwner != claim.borrower || provenValue != claim.dollarValue
                || provenRound != claim.valuationRound
        ) revert ClaimDoesNotMatchProof();
        if (provenValue == 0) revert ZeroValue();

        creditLimit = (provenValue * ltvBps) / BPS;

        creditLines[claim.portfolioId] = CreditLine({
            borrower: claim.borrower,
            portfolioId: claim.portfolioId,
            attestedValue: provenValue,
            creditLimit: creditLimit,
            drawn: 0,
            valuationRound: provenRound,
            open: true
        });
        portfolioHasOpenLine[claim.portfolioId] = true;

        emit CreditLineOpened(
            claim.borrower, claim.portfolioId, provenValue, creditLimit, provenRound, receiptId
        );
    }

    /**
     * @notice Dry-run a proof without spending gas on state changes.
     * @dev Uses the precompile's read-only `verify`, so a caller can check a proof
     *      is valid before submitting. Does not consume the receipt.
     */
    function previewIngest(
        LockClaim calldata claim,
        bytes calldata encodedTx,
        IAttestcoinBlockProver.MerkleProof calldata merkleProof,
        IAttestcoinBlockProver.ContinuityProof calldata continuityProof
    ) external view returns (bool ok, string memory reason) {
        if (claim.chainKey != expectedChainKey) return (false, "wrong chain key");
        if (portfolioHasOpenLine[claim.portfolioId]) return (false, "line already open");
        if (usedReceipt[keccak256(encodedTx)]) return (false, "receipt already used");

        try blockProver.verify(claim.chainKey, claim.height, encodedTx, merkleProof, continuityProof) returns (
            bool result
        ) {
            if (!result) return (false, "precompile rejected proof");
        } catch {
            return (false, "precompile reverted");
        }

        (bool found, bytes32[] memory topics, bytes memory data, uint8 status) =
            AttestedTx.findLog(encodedTx, originVault, PORTFOLIO_LOCKED_TOPIC);
        if (status != 1) return (false, "source tx reverted");
        if (!found) return (false, "lock log not found");
        if (topics.length < 3 || data.length < 64) return (false, "malformed lock log");
        if (uint256(topics[2]) != claim.portfolioId) return (false, "portfolio mismatch");
        if (address(uint160(uint256(topics[1]))) != claim.borrower) return (false, "borrower mismatch");

        (uint256 value,) = abi.decode(data, (uint256, uint64));
        if (value != claim.dollarValue) return (false, "value mismatch");

        return (true, "");
    }

    /// @dev Pull owner, value and valuation round out of the proven receipt.
    function _decodeLock(bytes calldata encodedTx, uint256 portfolioId)
        internal
        view
        returns (uint256 value, address owner, uint64 round)
    {
        (bool found, bytes32[] memory topics, bytes memory data, uint8 status) =
            AttestedTx.findLog(encodedTx, originVault, PORTFOLIO_LOCKED_TOPIC);

        // A reverted source transaction still produces an attestable receipt.
        if (status != 1) revert SourceTxFailed();
        if (!found) revert LockLogNotFound();
        // topics = [sig, owner, portfolioId]; data = abi.encode(dollarValue, valuationRound)
        if (topics.length < 3 || data.length < 64) revert MalformedLockLog();
        if (uint256(topics[2]) != portfolioId) revert ClaimDoesNotMatchProof();

        owner = address(uint160(uint256(topics[1])));
        (value, round) = abi.decode(data, (uint256, uint64));
    }

    // -- Drawdown and repayment ------------------------------------------------

    function draw(uint256 portfolioId, uint256 amount) external {
        CreditLine storage line = creditLines[portfolioId];
        if (!line.open) revert NoOpenLine();
        if (line.borrower != msg.sender) revert BorrowerMismatch();
        if (line.drawn + amount > line.creditLimit) revert ExceedsCreditLimit();

        line.drawn += amount;
        if (!stablecoin.transfer(msg.sender, amount)) revert TransferFailed();

        emit Drawn(msg.sender, portfolioId, amount);
    }

    function repay(uint256 portfolioId, uint256 amount) external {
        CreditLine storage line = creditLines[portfolioId];
        if (!line.open) revert NoOpenLine();
        if (line.drawn == 0) revert NothingDrawn();

        uint256 payment = amount > line.drawn ? line.drawn : amount;
        line.drawn -= payment;
        if (!stablecoin.transferFrom(msg.sender, address(this), payment)) revert TransferFailed();

        emit Repaid(msg.sender, portfolioId, payment);

        if (line.drawn == 0) {
            line.open = false;
            portfolioHasOpenLine[portfolioId] = false;
            emit CreditLineClosed(portfolioId);
        }
    }

    // -- Admin -----------------------------------------------------------------

    function setLtvBps(uint256 newLtvBps) external onlyAdmin {
        if (newLtvBps > MAX_LTV_BPS || newLtvBps == 0) revert LtvTooHigh();
        ltvBps = newLtvBps;
        emit LtvUpdated(newLtvBps);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
        emit AdminTransferred(newAdmin);
    }

    function getCreditLine(uint256 portfolioId) external view returns (CreditLine memory) {
        return creditLines[portfolioId];
    }

    function available(uint256 portfolioId) external view returns (uint256) {
        CreditLine storage line = creditLines[portfolioId];
        if (!line.open) return 0;
        return line.creditLimit - line.drawn;
    }
}
