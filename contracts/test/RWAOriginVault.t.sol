// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RWAOriginVault} from "../src/RWAOriginVault.sol";

contract RWAOriginVaultTest is Test {
    RWAOriginVault vault;

    address constant ADMIN = address(0xA11CE);
    address constant ORIGINATOR = address(0x0121);
    address constant VALUER = address(0x7A15);
    address constant OUTSIDER = address(0xBAD);

    uint256 constant PORTFOLIO = 1042;
    uint256 constant VALUE = 250_000e6;

    function setUp() public {
        vault = new RWAOriginVault(ADMIN);
        vm.startPrank(ADMIN);
        vault.setOriginator(ORIGINATOR, true);
        vault.setValuer(VALUER, true);
        vm.stopPrank();
    }

    function _registerAndValue() internal {
        vm.prank(ORIGINATOR);
        vault.registerPortfolio(PORTFOLIO);
        vm.prank(VALUER);
        vault.setValuation(PORTFOLIO, VALUE);
    }

    function test_LockEmitsAttestableEvent() public {
        _registerAndValue();

        vm.expectEmit(true, true, false, true);
        emit RWAOriginVault.PortfolioLocked(ORIGINATOR, PORTFOLIO, VALUE, 1);

        vm.prank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);

        assertTrue(vault.getPortfolio(PORTFOLIO).isLocked);
    }

    function test_RevertWhen_UnapprovedOriginatorRegisters() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(RWAOriginVault.NotOriginator.selector);
        vault.registerPortfolio(PORTFOLIO);
    }

    /// @dev The core credibility property: a borrower cannot price their own collateral.
    function test_RevertWhen_OriginatorSelfValues() public {
        vm.prank(ORIGINATOR);
        vault.registerPortfolio(PORTFOLIO);

        vm.prank(ORIGINATOR);
        vm.expectRevert(RWAOriginVault.NotValuer.selector);
        vault.setValuation(PORTFOLIO, 10_000_000e6);
    }

    function test_RevertWhen_LockingUnvaluedPortfolio() public {
        vm.prank(ORIGINATOR);
        vault.registerPortfolio(PORTFOLIO);

        vm.prank(ORIGINATOR);
        vm.expectRevert(RWAOriginVault.NotValued.selector);
        vault.lockPortfolio(PORTFOLIO);
    }

    function test_RevertWhen_NonOwnerLocks() public {
        _registerAndValue();

        vm.prank(OUTSIDER);
        vm.expectRevert(RWAOriginVault.NotPortfolioOwner.selector);
        vault.lockPortfolio(PORTFOLIO);
    }

    function test_RevertWhen_DoubleLock() public {
        _registerAndValue();
        vm.startPrank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);
        vm.expectRevert(RWAOriginVault.AlreadyLocked.selector);
        vault.lockPortfolio(PORTFOLIO);
        vm.stopPrank();
    }

    /// @dev Value must not drift after it has been attested.
    function test_RevertWhen_RevaluingLockedPortfolio() public {
        _registerAndValue();
        vm.prank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);

        vm.prank(VALUER);
        vm.expectRevert(RWAOriginVault.AlreadyLocked.selector);
        vault.setValuation(PORTFOLIO, 10_000_000e6);
    }

    function test_ValuationRoundIncrements() public {
        vm.prank(ORIGINATOR);
        vault.registerPortfolio(PORTFOLIO);

        vm.startPrank(VALUER);
        vault.setValuation(PORTFOLIO, VALUE);
        vault.setValuation(PORTFOLIO, VALUE + 1);
        vm.stopPrank();

        assertEq(vault.getPortfolio(PORTFOLIO).valuationRound, 2);
    }

    function test_RevertWhen_ZeroValuation() public {
        vm.prank(ORIGINATOR);
        vault.registerPortfolio(PORTFOLIO);

        vm.prank(VALUER);
        vm.expectRevert(RWAOriginVault.ZeroValue.selector);
        vault.setValuation(PORTFOLIO, 0);
    }

    function test_RevertWhen_DuplicateRegistration() public {
        vm.startPrank(ORIGINATOR);
        vault.registerPortfolio(PORTFOLIO);
        vm.expectRevert(RWAOriginVault.PortfolioExists.selector);
        vault.registerPortfolio(PORTFOLIO);
        vm.stopPrank();
    }

    function test_AdminUnlockReleasesEscrow() public {
        _registerAndValue();
        vm.prank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);

        vm.prank(ADMIN);
        vault.unlockPortfolio(PORTFOLIO);
        assertFalse(vault.getPortfolio(PORTFOLIO).isLocked);
    }

    function test_RevertWhen_NonAdminUnlocks() public {
        _registerAndValue();
        vm.prank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);

        vm.prank(OUTSIDER);
        vm.expectRevert(RWAOriginVault.NotAdmin.selector);
        vault.unlockPortfolio(PORTFOLIO);
    }

    function test_RevertWhen_NonAdminSetsOriginator() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(RWAOriginVault.NotAdmin.selector);
        vault.setOriginator(OUTSIDER, true);
    }

    // -- valuation freshness ---------------------------------------------------

    function test_ValuationStampsPublicationTime() public {
        vm.warp(1_000_000);
        _registerAndValue();
        assertEq(vault.getPortfolio(PORTFOLIO).valuedAt, 1_000_000);
    }

    function test_RevertWhen_LockingOnAStaleValuation() public {
        _registerAndValue();
        // One second past the window. The valuation is still on-chain and still signed
        // by an approved valuer — it is simply too old to escrow against.
        skip(vault.maxValuationAge() + 1);
        vm.prank(ORIGINATOR);
        vm.expectRevert(RWAOriginVault.StaleValuation.selector);
        vault.lockPortfolio(PORTFOLIO);
    }

    function test_LockSucceedsAtTheEdgeOfTheWindow() public {
        _registerAndValue();
        skip(vault.maxValuationAge());
        vm.prank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);
        assertTrue(vault.getPortfolio(PORTFOLIO).isLocked);
    }

    function test_RevaluingRefreshesTheWindow() public {
        _registerAndValue();
        skip(vault.maxValuationAge() + 1);

        // A fresh valuation is the remedy for a stale one.
        vm.prank(VALUER);
        vault.setValuation(PORTFOLIO, VALUE);
        vm.prank(ORIGINATOR);
        vault.lockPortfolio(PORTFOLIO);
        assertTrue(vault.getPortfolio(PORTFOLIO).isLocked);
    }

    function test_AdminCanTightenValuationWindow() public {
        vm.prank(ADMIN);
        vault.setMaxValuationAge(1 days);
        assertEq(vault.maxValuationAge(), 1 days);

        _registerAndValue();
        skip(2 days);
        vm.prank(ORIGINATOR);
        vm.expectRevert(RWAOriginVault.StaleValuation.selector);
        vault.lockPortfolio(PORTFOLIO);
    }

    /// @dev The freshness bound is tunable but not removable — the point of the control.
    function test_RevertWhen_ValuationWindowDisabledOrUnbounded() public {
        // Read the ceiling first: expectRevert binds to the very next call, and a
        // getter invoked after arming it would swallow the expectation.
        uint64 ceiling = vault.MAX_VALUATION_AGE_LIMIT();

        vm.startPrank(ADMIN);
        vm.expectRevert(RWAOriginVault.BadValuationAge.selector);
        vault.setMaxValuationAge(0);
        vm.expectRevert(RWAOriginVault.BadValuationAge.selector);
        vault.setMaxValuationAge(ceiling + 1);
        vm.stopPrank();
    }

    function test_RevertWhen_NonAdminSetsValuationWindow() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(RWAOriginVault.NotAdmin.selector);
        vault.setMaxValuationAge(1 days);
    }
}
