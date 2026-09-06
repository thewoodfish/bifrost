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
        bool exists;
        bool isLocked;
    }

    mapping(uint256 => Portfolio) public portfolios;

    event OriginatorSet(address indexed originator, bool allowed);
    event ValuerSet(address indexed valuer, bool allowed);
    event PortfolioRegistered(uint256 indexed portfolioId, address indexed owner);
    event PortfolioValued(uint256 indexed portfolioId, uint256 dollarValue, uint64 valuationRound);
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

    // -- Portfolio lifecycle ---------------------------------------------------

    /// @notice Register a portfolio. Value is published separately by a valuer,
    ///         so an originator cannot self-assert collateral worth.
    function registerPortfolio(uint256 portfolioId) external {
        if (!isOriginator[msg.sender]) revert NotOriginator();
        if (portfolios[portfolioId].exists) revert PortfolioExists();

        portfolios[portfolioId] =
            Portfolio({owner: msg.sender, dollarValue: 0, valuationRound: 0, exists: true, isLocked: false});

        emit PortfolioRegistered(portfolioId, msg.sender);
    }

    /// @notice Publish an independent valuation. Cannot change while locked, so the
    ///         attested value can never drift from what was proven.
    function setValuation(uint256 portfolioId, uint256 dollarValue) external {
        if (!isValuer[msg.sender]) revert NotValuer();
        Portfolio storage p = portfolios[portfolioId];
        if (!p.exists) revert UnknownPortfolio();
        if (p.isLocked) revert AlreadyLocked();
        if (dollarValue == 0) revert ZeroValue();

        p.dollarValue = dollarValue;
        p.valuationRound += 1;

        emit PortfolioValued(portfolioId, dollarValue, p.valuationRound);
    }

    /// @notice Lock the portfolio into escrow and emit the fact Attestcoin will prove.
    function lockPortfolio(uint256 portfolioId) external {
        Portfolio storage p = portfolios[portfolioId];
        if (!p.exists) revert UnknownPortfolio();
        if (p.owner != msg.sender) revert NotPortfolioOwner();
        if (p.isLocked) revert AlreadyLocked();
        if (p.dollarValue == 0) revert NotValued();

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
