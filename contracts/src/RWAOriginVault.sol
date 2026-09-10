// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RWAOriginVault
 * @notice Origin-chain escrow for tokenized real-world-asset loan portfolios.
 * @dev    Deployed on the compliance chain (Sepolia for the testnet build).
 *
 *  Locking a portfolio emits `PortfolioLocked`, whose receipt log is the fact that
 *  Attestcoin proves on Creditcoin. The event layout is load-bearing:
 *
 *    topics[0] = PortfolioLocked signature
 *    topics[1] = owner        (indexed — bound to the borrower on Creditcoin)
 *    topics[2] = portfolioId  (indexed)
 *    data      = abi.encode(dollarValue, valuationRound)
 *
 *  CreditcoinPoolEngine decodes `dollarValue` out of the proven receipt rather than
 *  trusting caller-supplied calldata, so a credit line cannot exceed what was
 *  actually attested on this chain.
 */
contract RWAOriginVault {
    /// @notice Issuers permitted to register portfolios (KYC'd originators).
    mapping(address => bool) public isOriginator;

    /// @notice Addresses permitted to publish valuations (independent auditors).
    mapping(address => bool) public isValuer;

    address public admin;

    struct Portfolio {
        address owner;
        uint256 dollarValue;
        uint64 valuationRound;
        /// @notice When the current valuation was published. Zero until first valued.
        uint64 valuedAt;
        bool exists;
        bool isLocked;
    }

    mapping(uint256 => Portfolio) public portfolios;

    /// @dev Ceiling on how stale a valuation may be at lock time. The freshness
    ///      requirement is tunable but not admin-removable — same reasoning as the
    ///      engine's MAX_LTV_BPS: a buffer an admin can switch off is not a buffer.
    uint64 public constant MAX_VALUATION_AGE_LIMIT = 90 days;

    /// @notice How old a valuation may be when the portfolio is locked.
    uint64 public maxValuationAge = 7 days;

    event OriginatorSet(address indexed originator, bool allowed);
    event ValuerSet(address indexed valuer, bool allowed);
    event PortfolioRegistered(uint256 indexed portfolioId, address indexed owner);
    event PortfolioValued(uint256 indexed portfolioId, uint256 dollarValue, uint64 valuationRound);
    event MaxValuationAgeUpdated(uint64 maxValuationAge);
    event PortfolioLocked(
        address indexed owner, uint256 indexed portfolioId, uint256 dollarValue, uint64 valuationRound
    );
    event PortfolioUnlocked(address indexed owner, uint256 indexed portfolioId);

    error NotAdmin();
    error NotOriginator();
    error NotValuer();
    error NotPortfolioOwner();
    error PortfolioExists();
    error UnknownPortfolio();
    error AlreadyLocked();
    error NotLocked();
    error NotValued();
    error ZeroValue();
    error ZeroAddress();
    error StaleValuation();
    error BadValuationAge();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    // -- Access control --------------------------------------------------------

    function setOriginator(address originator, bool allowed) external onlyAdmin {
        if (originator == address(0)) revert ZeroAddress();
        isOriginator[originator] = allowed;
        emit OriginatorSet(originator, allowed);
    }

    function setValuer(address valuer, bool allowed) external onlyAdmin {
        if (valuer == address(0)) revert ZeroAddress();
        isValuer[valuer] = allowed;
        emit ValuerSet(valuer, allowed);
    }

    /// @notice Tune how fresh a valuation must be at lock time.
    /// @dev Bounded on both sides: zero would disable the check, and an unbounded
    ///      ceiling would disable it in all but name.
    function setMaxValuationAge(uint64 newAge) external onlyAdmin {
        if (newAge == 0 || newAge > MAX_VALUATION_AGE_LIMIT) revert BadValuationAge();
        maxValuationAge = newAge;
        emit MaxValuationAgeUpdated(newAge);
    }

    // -- Portfolio lifecycle ---------------------------------------------------

    /// @notice Register a portfolio. Value is published separately by a valuer,
    ///         so an originator cannot self-assert collateral worth.
    function registerPortfolio(uint256 portfolioId) external {
        if (!isOriginator[msg.sender]) revert NotOriginator();
        if (portfolios[portfolioId].exists) revert PortfolioExists();

        portfolios[portfolioId] = Portfolio({
            owner: msg.sender, dollarValue: 0, valuationRound: 0, valuedAt: 0, exists: true, isLocked: false
        });

        emit PortfolioRegistered(portfolioId, msg.sender);
    }

    /// @notice Publish an independent valuation. Cannot change while locked, so the
    ///         attested value can never drift from what was proven. Stamps the
    ///         publication time, which `lockPortfolio` enforces a bound on.
    function setValuation(uint256 portfolioId, uint256 dollarValue) external {
        if (!isValuer[msg.sender]) revert NotValuer();
        Portfolio storage p = portfolios[portfolioId];
        if (!p.exists) revert UnknownPortfolio();
        if (p.isLocked) revert AlreadyLocked();
        if (dollarValue == 0) revert ZeroValue();

        p.dollarValue = dollarValue;
        p.valuationRound += 1;
        p.valuedAt = uint64(block.timestamp);

        emit PortfolioValued(portfolioId, dollarValue, p.valuationRound);
    }

    /// @notice Lock the portfolio into escrow and emit the fact Attestcoin will prove.
    function lockPortfolio(uint256 portfolioId) external {
        Portfolio storage p = portfolios[portfolioId];
        if (!p.exists) revert UnknownPortfolio();
        if (p.owner != msg.sender) revert NotPortfolioOwner();
        if (p.isLocked) revert AlreadyLocked();
        if (p.dollarValue == 0) revert NotValued();
        // A valuation the market has moved past is worse than no valuation: the
        // attestation would faithfully prove a number nobody stands behind any more.
        if (block.timestamp - p.valuedAt > maxValuationAge) revert StaleValuation();

        p.isLocked = true;

        emit PortfolioLocked(msg.sender, portfolioId, p.dollarValue, p.valuationRound);
    }

    /// @notice Release escrow once the Creditcoin line is closed.
    /// @dev    Admin-gated: Creditcoin settlement is not observable from this chain,
    ///         so release is authorised rather than proven. Making this symmetric
    ///         (Creditcoin -> origin attestation) is tracked in Claude.md section 9.
    function unlockPortfolio(uint256 portfolioId) external onlyAdmin {
        Portfolio storage p = portfolios[portfolioId];
        if (!p.exists) revert UnknownPortfolio();
        if (!p.isLocked) revert NotLocked();

        p.isLocked = false;

        emit PortfolioUnlocked(p.owner, portfolioId);
    }

    function getPortfolio(uint256 portfolioId) external view returns (Portfolio memory) {
        return portfolios[portfolioId];
    }
}
