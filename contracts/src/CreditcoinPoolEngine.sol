// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAttestcoinBlockProver, Attestcoin} from "./interfaces/IAttestcoinBlockProver.sol";
import {IChainInfo, ChainInfoAddr} from "./interfaces/IChainInfo.sol";
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
 *
 *      The pool is funded by liquidity providers, who hold shares in it (4626-style:
 *      deposit assets, redeem shares). Borrowers pay simple interest on drawn principal;
 *      a reserve factor of each interest payment goes to the protocol and the rest raises
 *      the value of every share.
 */
contract CreditcoinPoolEngine {
    using AttestedTx for bytes;

    /// @dev keccak256("PortfolioLocked(address,uint256,uint256,uint64)")
    bytes32 public constant PORTFOLIO_LOCKED_TOPIC = keccak256("PortfolioLocked(address,uint256,uint256,uint64)");

    uint256 public constant BPS = 10_000;
    /// @dev Hard ceiling on LTV; the over-collateralization buffer is not admin-removable.
    uint256 public constant MAX_LTV_BPS = 8_000;

    /// @dev Ceiling on the lock-age window, ~7 days of Sepolia blocks. Like the LTV
    ///      buffer, the freshness requirement is tunable but cannot be switched off.
    uint64 public constant MAX_LOCK_AGE_LIMIT = 50_400;

    IAttestcoinBlockProver public immutable blockProver;
    /// @notice ChainInfo precompile, used to age the lock against attestation progress.
    IChainInfo public immutable chainInfo;
    IERC20 public immutable stablecoin;

    /// @notice Attested source chain (Sepolia = 1 on CC3 testnet).
    uint64 public immutable expectedChainKey;
    /// @notice RWAOriginVault address on the origin chain; only its logs are trusted.
    address public immutable originVault;

    address public admin;
    uint256 public ltvBps = 8_000;

    /**
     * @notice How far behind the attestation frontier a lock may be and still open a line.
     *
     * @dev The vault bounds how stale a valuation is when it is locked; this bounds how
     *      long that lock may then sit before it is drawn on. Without it a borrower could
     *      hold a valid attested receipt indefinitely and open a line long after the
     *      portfolio it describes stopped resembling reality — the proof would still be
     *      perfectly valid, which is exactly what makes it dangerous.
     *
     *      Measured in source-chain blocks against `get_latest_attestation_height_and_hash`
     *      rather than in wall-clock time, because the origin block timestamp is not
     *      available here — only the height the proof pins.
     */
    uint64 public maxLockAge = 7_200;

    // -- Lending pool state ------------------------------------------------------

    uint256 public constant YEAR = 365 days;
    /// @dev Ceilings, so neither the borrow rate nor the protocol's cut can be set abusive.
    uint256 public constant MAX_BORROW_RATE_BPS = 5_000;
    uint256 public constant MAX_RESERVE_FACTOR_BPS = 5_000;
    /// @dev Virtual shares and assets in every conversion. The share-price offset makes a
    ///      first-depositor inflation attack cost the attacker far more than it takes.
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    /// @notice Borrower APR on drawn principal, simple interest accruing per second.
    uint256 public borrowRateBps = 800;
    /// @notice Share of every interest payment kept by the protocol. At 8% and 25% this is
    ///         the business model on-chain: borrowers pay ~8%, LPs earn ~6%, 2% is spread.
    uint256 public reserveFactorBps = 2_500;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    /// @notice Principal currently lent out. Part of pool assets: it is owed back.
    uint256 public totalBorrowed;
    /// @notice Interest collected for the protocol and not yet withdrawn. Not LP money.
    uint256 public protocolReserves;

    /// @dev Interest is tracked beside the line rather than inside it, so `CreditLine` and
    ///      every consumer decoding it keep their layout.
    struct Accrual {
        uint256 interest;
        uint64 lastAccrued;
    }

    mapping(uint256 => Accrual) internal accruals;

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
    /// @dev `Repaid` carries principal only, so a drawn balance is still drawn − repaid.
    event InterestPaid(address indexed payer, uint256 indexed portfolioId, uint256 interest, uint256 toReserves);
    event Deposited(address indexed lp, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lp, uint256 assets, uint256 shares);
    event BorrowRateUpdated(uint256 borrowRateBps);
    event ReserveFactorUpdated(uint256 reserveFactorBps);
    event ReservesWithdrawn(address indexed to, uint256 amount);
    event LtvUpdated(uint256 ltvBps);
    event MaxLockAgeUpdated(uint64 maxLockAge);
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
    error LockTooOld();
    error BadLockAge();
    error ZeroValue();
    error TransferFailed();
    error ZeroShares();
    error InsufficientShares();
    error InsufficientLiquidity();
    error RateTooHigh();
    error ReserveFactorTooHigh();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address _blockProver,
        address _chainInfo,
        address _stablecoin,
        address _originVault,
        uint64 _chainKey,
        address _admin
    ) {
        if (_stablecoin == address(0) || _originVault == address(0) || _admin == address(0)) {
            revert ZeroAddress();
        }
        blockProver = IAttestcoinBlockProver(_blockProver == address(0) ? Attestcoin.BLOCK_PROVER : _blockProver);
        chainInfo = IChainInfo(_chainInfo == address(0) ? ChainInfoAddr.CHAIN_INFO : _chainInfo);
        stablecoin = IERC20(_stablecoin);
        originVault = _originVault;
        expectedChainKey = _chainKey;
        admin = _admin;
    }

    // -- Attestation-gated credit ---------------------------------------------

    /**
     * @notice Prove an origin-chain lock via Attestcoin and open a credit line.
     * @param claim         Fields locating the lock; all are cross-checked against the proof.
     * @param encodedTx     Attestcoin's ABI-encoded transaction envelope; its last chunk is the receipt.
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
        // A valid proof says nothing about age. Reject a lock the attestation frontier
        // has long since left behind, before paying for verification.
        if (_lockAge(claim.height) > maxLockAge) revert LockTooOld();

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
        if (provenOwner != claim.borrower || provenValue != claim.dollarValue || provenRound != claim.valuationRound) {
            revert ClaimDoesNotMatchProof();
        }
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

        emit CreditLineOpened(claim.borrower, claim.portfolioId, provenValue, creditLimit, provenRound, receiptId);
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

        try this.lockAge(claim.height) returns (uint64 age) {
            if (age > maxLockAge) return (false, "lock too old");
        } catch {
            return (false, "chain info unavailable");
        }

        return (true, "");
    }

    /// @notice How many source blocks behind the attestation frontier `height` sits.
    /// @dev External so `previewIngest` can call it inside a `try`, keeping a precompile
    ///      failure a readable reason string rather than an opaque revert.
    function lockAge(uint64 height) external view returns (uint64) {
        return _lockAge(height);
    }

    function _lockAge(uint64 height) internal view returns (uint64) {
        (uint64 latest,,,) = chainInfo.get_latest_attestation_height_and_hash(expectedChainKey);
        // The frontier trailing the proven height means the lock is newer than anything
        // attested, which cannot be stale.
        return latest > height ? latest - height : 0;
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
        // Protocol reserves sit in the same balance but are not the pool's to lend.
        if (amount > idleLiquidity()) revert InsufficientLiquidity();

        _accrue(portfolioId);
        line.drawn += amount;
        totalBorrowed += amount;
        if (!stablecoin.transfer(msg.sender, amount)) revert TransferFailed();

        emit Drawn(msg.sender, portfolioId, amount);
    }

    /**
     * @notice Pay down a line: accrued interest first, then principal. Paying more than
     *         is owed charges only what is owed, so "repay in full" can pass any ceiling.
     *         The line closes once both principal and interest reach zero.
     */
    function repay(uint256 portfolioId, uint256 amount) external {
        CreditLine storage line = creditLines[portfolioId];
        if (!line.open) revert NoOpenLine();
        Accrual storage a = accruals[portfolioId];
        _accrue(portfolioId);
        uint256 debt = line.drawn + a.interest;
        if (debt == 0) revert NothingDrawn();

        uint256 payment = amount > debt ? debt : amount;
        uint256 toInterest = payment > a.interest ? a.interest : payment;
        uint256 toPrincipal = payment - toInterest;
        uint256 toReserves = (toInterest * reserveFactorBps) / BPS;

        a.interest -= toInterest;
        line.drawn -= toPrincipal;
        totalBorrowed -= toPrincipal;
        protocolReserves += toReserves;
        if (!stablecoin.transferFrom(msg.sender, address(this), payment)) revert TransferFailed();

        if (toInterest > 0) emit InterestPaid(msg.sender, portfolioId, toInterest, toReserves);
        if (toPrincipal > 0) emit Repaid(msg.sender, portfolioId, toPrincipal);

        if (line.drawn == 0 && a.interest == 0) {
            line.open = false;
            portfolioHasOpenLine[portfolioId] = false;
            emit CreditLineClosed(portfolioId);
        }
    }

    /// @dev Roll interest forward to now. A rate change applies from each line's next touch.
    function _accrue(uint256 portfolioId) internal {
        Accrual storage a = accruals[portfolioId];
        a.interest = _owedInterest(creditLines[portfolioId].drawn, a);
        a.lastAccrued = uint64(block.timestamp);
    }

    function _owedInterest(uint256 drawn, Accrual storage a) internal view returns (uint256) {
        if (drawn == 0 || a.lastAccrued == 0) return a.interest;
        return a.interest + (drawn * borrowRateBps * (block.timestamp - a.lastAccrued)) / (BPS * YEAR);
    }

    // -- Liquidity providers ---------------------------------------------------

    /// @notice Add liquidity; mints shares at the current share price.
    function deposit(uint256 assets) external returns (uint256 shares) {
        if (assets == 0) revert ZeroValue();
        shares = convertToShares(assets);
        if (shares == 0) revert ZeroShares();

        totalShares += shares;
        sharesOf[msg.sender] += shares;
        if (!stablecoin.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();

        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Take out exactly `assets`, burning the shares they are worth (rounded up).
    function withdraw(uint256 assets) external returns (uint256 shares) {
        if (assets == 0) revert ZeroValue();
        uint256 supply = totalShares + VIRTUAL_SHARES;
        uint256 pool = totalAssets() + VIRTUAL_ASSETS;
        shares = (assets * supply + pool - 1) / pool;
        _exit(assets, shares);
    }

    /// @notice Burn `shares` for what they are worth now (rounded down).
    function redeem(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert ZeroShares();
        assets = convertToAssets(shares);
        _exit(assets, shares);
    }

    function _exit(uint256 assets, uint256 shares) internal {
        if (shares > sharesOf[msg.sender]) revert InsufficientShares();
        // Lent-out principal is owed to LPs but is not here to hand back yet.
        if (assets > idleLiquidity()) revert InsufficientLiquidity();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        if (!stablecoin.transfer(msg.sender, assets)) revert TransferFailed();

        emit Withdrawn(msg.sender, assets, shares);
    }

    /// @notice LP money: idle stablecoin plus principal owed back. Unpaid interest counts
    ///         only once paid, so share price never rests on a debt that might not be.
    function totalAssets() public view returns (uint256) {
        return stablecoin.balanceOf(address(this)) - protocolReserves + totalBorrowed;
    }

    /// @notice Stablecoin available to draw or withdraw right now.
    function idleLiquidity() public view returns (uint256) {
        return stablecoin.balanceOf(address(this)) - protocolReserves;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets() + VIRTUAL_ASSETS);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * (totalAssets() + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
    }

    /// @notice What an LP's shares are worth now.
    function assetsOf(address lp) external view returns (uint256) {
        return convertToAssets(sharesOf[lp]);
    }

    /// @notice Principal lent out as a share of LP money, in basis points.
    function utilizationBps() public view returns (uint256) {
        uint256 assets = totalAssets();
        return assets == 0 ? 0 : (totalBorrowed * BPS) / assets;
    }

    /// @notice What LP money earns at current utilization, after the protocol's cut.
    function supplyRateBps() external view returns (uint256) {
        return (borrowRateBps * utilizationBps() * (BPS - reserveFactorBps)) / (BPS * BPS);
    }

    /// @notice Principal and interest owed on a line right now.
    function owed(uint256 portfolioId) external view returns (uint256 principal, uint256 interest) {
        principal = creditLines[portfolioId].drawn;
        interest = _owedInterest(principal, accruals[portfolioId]);
    }

    // -- Admin -----------------------------------------------------------------

    function setLtvBps(uint256 newLtvBps) external onlyAdmin {
        if (newLtvBps > MAX_LTV_BPS || newLtvBps == 0) revert LtvTooHigh();
        ltvBps = newLtvBps;
        emit LtvUpdated(newLtvBps);
    }

    /// @notice Tune the lock-age window. Bounded on both sides so it cannot be disabled.
    function setMaxLockAge(uint64 newMaxLockAge) external onlyAdmin {
        if (newMaxLockAge == 0 || newMaxLockAge > MAX_LOCK_AGE_LIMIT) revert BadLockAge();
        maxLockAge = newMaxLockAge;
        emit MaxLockAgeUpdated(newMaxLockAge);
    }

    function setBorrowRateBps(uint256 newRateBps) external onlyAdmin {
        if (newRateBps > MAX_BORROW_RATE_BPS) revert RateTooHigh();
        borrowRateBps = newRateBps;
        emit BorrowRateUpdated(newRateBps);
    }

    function setReserveFactorBps(uint256 newFactorBps) external onlyAdmin {
        if (newFactorBps > MAX_RESERVE_FACTOR_BPS) revert ReserveFactorTooHigh();
        reserveFactorBps = newFactorBps;
        emit ReserveFactorUpdated(newFactorBps);
    }

    /// @notice Collect the protocol's share of interest. Never touches LP money.
    function withdrawReserves(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        if (amount > protocolReserves) revert InsufficientLiquidity();
        protocolReserves -= amount;
        if (!stablecoin.transfer(to, amount)) revert TransferFailed();
        emit ReservesWithdrawn(to, amount);
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
