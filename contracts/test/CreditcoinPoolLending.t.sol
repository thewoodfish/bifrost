// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditcoinPoolEngine} from "../src/CreditcoinPoolEngine.sol";
import {IAttestcoinBlockProver} from "../src/interfaces/IAttestcoinBlockProver.sol";
import {MockBlockProver, MockChainInfo, MockERC20} from "./mocks/Mocks.sol";
import {AttestedTxBuilder} from "./helpers/AttestedTxBuilder.sol";
import {AttestedTx} from "../src/lib/AttestedTx.sol";

/**
 * @notice The lender side of the pool: LP shares, borrower interest, and the protocol's
 *         reserve factor. Unlike the engine suite, the pool here starts empty and is
 *         funded only through `deposit`, the way the deployment is.
 */
contract CreditcoinPoolLendingTest is Test {
    CreditcoinPoolEngine engine;
    MockERC20 usdc;
    MockChainInfo chainInfo;

    address constant ORIGIN_VAULT = address(0xBEEF);
    address constant BORROWER = address(0xB0B);
    address constant LP = address(0x1111);
    address constant LP2 = address(0x2222);
    address constant ATTACKER = address(0xBAD);
    address constant ADMIN = address(0xA11CE);
    address constant TREASURY = address(0x7EA5);

    uint256 constant PORTFOLIO = 1042;
    uint256 constant VALUE = 1_000_000e6; // → $800,000 line
    bytes32 constant LOCK_TOPIC = keccak256("PortfolioLocked(address,uint256,uint256,uint64)");

    IAttestcoinBlockProver.MerkleProof mp;
    IAttestcoinBlockProver.ContinuityProof cp;

    /// @dev Clock kept here, not read back: under via_ir `block.timestamp` can come back
    ///      stale after a state-changing call, which silently turns a second warp into none.
    uint256 clock = 1_800_000_000;

    function setUp() public {
        chainInfo = new MockChainInfo();
        chainInfo.setLatestHeight(100);
        usdc = new MockERC20();
        engine = new CreditcoinPoolEngine(
            address(new MockBlockProver()), address(chainInfo), address(usdc), ORIGIN_VAULT, 1, ADMIN
        );
        vm.warp(clock);
    }

    function _elapse(uint256 dt) internal {
        clock += dt;
        vm.warp(clock);
    }

    // -- helpers ---------------------------------------------------------------

    function _deposit(address lp, uint256 assets) internal returns (uint256 shares) {
        usdc.mint(lp, assets);
        vm.startPrank(lp);
        usdc.approve(address(engine), assets);
        shares = engine.deposit(assets);
        vm.stopPrank();
    }

    function _openLine() internal {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = LOCK_TOPIC;
        topics[1] = bytes32(uint256(uint160(BORROWER)));
        topics[2] = bytes32(PORTFOLIO);
        AttestedTx.Log[] memory logs = AttestedTxBuilder.singleLog(ORIGIN_VAULT, topics, abi.encode(VALUE, uint64(1)));
        bytes memory receipt = AttestedTxBuilder.encode(2, 1, 120000, logs, 3);
        CreditcoinPoolEngine.LockClaim memory claim = CreditcoinPoolEngine.LockClaim({
            chainKey: 1, height: 100, portfolioId: PORTFOLIO, borrower: BORROWER, dollarValue: VALUE, valuationRound: 1
        });
        vm.prank(BORROWER);
        engine.attestAndOpenCredit(claim, receipt, mp, cp);
    }

    function _draw(uint256 amount) internal {
        vm.prank(BORROWER);
        engine.draw(PORTFOLIO, amount);
    }

    function _repay(uint256 amount) internal {
        usdc.mint(BORROWER, amount);
        vm.startPrank(BORROWER);
        usdc.approve(address(engine), amount);
        engine.repay(PORTFOLIO, amount);
        vm.stopPrank();
    }

    function _interest() internal view returns (uint256 i) {
        (, i) = engine.owed(PORTFOLIO);
    }

    // -- deposits and withdrawals ---------------------------------------------

    function test_DepositMintsSharesAndFundsThePool() public {
        uint256 shares = _deposit(LP, 1_000_000e6);

        assertGt(shares, 0);
        assertEq(engine.sharesOf(LP), shares);
        assertEq(engine.totalAssets(), 1_000_000e6);
        assertEq(engine.idleLiquidity(), 1_000_000e6);
        assertEq(engine.assetsOf(LP), 1_000_000e6, "no interest yet: shares worth the deposit");
    }

    function test_WithdrawReturnsTheDeposit() public {
        _deposit(LP, 500_000e6);
        vm.prank(LP);
        engine.withdraw(500_000e6);

        assertEq(usdc.balanceOf(LP), 500_000e6);
        assertEq(engine.sharesOf(LP), 0);
        assertEq(engine.totalShares(), 0);
    }

    function test_RedeemAllSharesReturnsTheDeposit() public {
        uint256 shares = _deposit(LP, 500_000e6);
        vm.prank(LP);
        uint256 assets = engine.redeem(shares);
        assertEq(assets, 500_000e6);
    }

    function test_RevertWhen_WithdrawingMoreSharesThanHeld() public {
        _deposit(LP, 100e6);
        vm.prank(LP2);
        vm.expectRevert(CreditcoinPoolEngine.InsufficientShares.selector);
        engine.withdraw(1e6);
    }

    function test_RevertWhen_DepositIsZero() public {
        vm.prank(LP);
        vm.expectRevert(CreditcoinPoolEngine.ZeroValue.selector);
        engine.deposit(0);
    }

    /// @dev Lent-out principal belongs to LPs but is not here to hand back.
    function test_RevertWhen_WithdrawalExceedsIdleLiquidity() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(800_000e6);

        vm.prank(LP);
        vm.expectRevert(CreditcoinPoolEngine.InsufficientLiquidity.selector);
        engine.withdraw(200_001e6);

        vm.prank(LP);
        engine.withdraw(200_000e6);
    }

    function test_RevertWhen_DrawExceedsPoolLiquidity() public {
        _deposit(LP, 100_000e6);
        _openLine();
        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.InsufficientLiquidity.selector);
        engine.draw(PORTFOLIO, 100_001e6);
    }

    // -- interest --------------------------------------------------------------

    function test_InterestAccruesOnDrawnPrincipal() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);

        _elapse(365 days);
        assertEq(_interest(), 8_000e6, "8% APR on $100k for a year");

        _elapse(365 days / 2);
        assertEq(_interest(), 12_000e6);
    }

    function test_NoInterestOnAnUndrawnLine() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _elapse(365 days);
        assertEq(_interest(), 0);
    }

    function test_InterestFollowsTheBalanceAcrossDraws() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days / 2); // 4,000 on 100k
        _draw(100_000e6);
        _elapse(365 days / 2); // 8,000 on 200k
        assertEq(_interest(), 12_000e6);
    }

    function test_RepayPaysInterestFirst() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days);

        _repay(5_000e6);

        (uint256 principal, uint256 interest) = engine.owed(PORTFOLIO);
        assertEq(principal, 100_000e6, "principal untouched");
        assertEq(interest, 3_000e6);
        assertTrue(engine.getCreditLine(PORTFOLIO).open);
    }

    /// @dev Repaying only the principal leaves interest owed; the line must stay open.
    function test_LineStaysOpenUntilInterestIsPaid() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days);

        _repay(100_000e6);
        assertTrue(engine.getCreditLine(PORTFOLIO).open);
        (uint256 principal, uint256 interest) = engine.owed(PORTFOLIO);
        assertEq(principal + interest, 8_000e6);

        _repay(8_000e6);
        assertFalse(engine.getCreditLine(PORTFOLIO).open);
        assertFalse(engine.portfolioHasOpenLine(PORTFOLIO));
    }

    function test_OverpaymentChargesOnlyWhatIsOwed() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days);

        usdc.mint(BORROWER, 1_000_000e6);
        vm.startPrank(BORROWER);
        usdc.approve(address(engine), type(uint256).max);
        engine.repay(PORTFOLIO, type(uint256).max);
        vm.stopPrank();

        assertEq(usdc.balanceOf(BORROWER), 1_000_000e6 + 100_000e6 - 108_000e6);
        assertFalse(engine.getCreditLine(PORTFOLIO).open);
    }

    function test_RepaidEventCarriesPrincipalOnly() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days);

        usdc.mint(BORROWER, 108_000e6);
        vm.startPrank(BORROWER);
        usdc.approve(address(engine), 108_000e6);
        vm.expectEmit(true, true, false, true);
        emit CreditcoinPoolEngine.InterestPaid(BORROWER, PORTFOLIO, 8_000e6, 2_000e6);
        vm.expectEmit(true, true, false, true);
        emit CreditcoinPoolEngine.Repaid(BORROWER, PORTFOLIO, 100_000e6);
        engine.repay(PORTFOLIO, 108_000e6);
        vm.stopPrank();
    }

    // -- the spread ------------------------------------------------------------

    /// @dev The business model end to end: borrower pays 8%, LPs earn 6%, protocol keeps 2%.
    function test_LpsEarnInterestNetOfTheReserveFactor() public {
        uint256 shares = _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(500_000e6);
        _elapse(365 days);
        _repay(500_000e6 + 40_000e6);

        assertEq(engine.protocolReserves(), 10_000e6, "25% of $40k interest");
        assertEq(engine.totalAssets(), 1_030_000e6);

        vm.prank(LP);
        uint256 out = engine.redeem(shares);
        assertApproxEqAbs(out, 1_030_000e6, 1, "principal plus 6% on the $500k lent");
    }

    function test_SupplyRateReflectsUtilizationAndReserveFactor() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(500_000e6);
        assertEq(engine.utilizationBps(), 5_000);
        assertEq(engine.supplyRateBps(), 300, "8% x 50% utilized x 75% to LPs");
    }

    function test_LaterDepositorIsNotDilutedAndDoesNotDilute() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(500_000e6);
        _elapse(365 days);
        _repay(540_000e6);

        uint256 lpBefore = engine.assetsOf(LP);
        _deposit(LP2, 1_000_000e6);

        assertApproxEqAbs(engine.assetsOf(LP2), 1_000_000e6, 1);
        assertApproxEqAbs(engine.assetsOf(LP), lpBefore, 1);
    }

    function test_DrawCannotSpendProtocolReserves() public {
        _deposit(LP, 700_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days);
        _repay(8_000e6); // interest only: line stays open, reserves 2,000

        assertEq(engine.protocolReserves(), 2_000e6);
        assertEq(engine.idleLiquidity(), 606_000e6);
        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.InsufficientLiquidity.selector);
        engine.draw(PORTFOLIO, 606_001e6);

        _draw(606_000e6);
        assertEq(usdc.balanceOf(address(engine)), 2_000e6, "only the reserves remain");
    }

    // -- admin -----------------------------------------------------------------

    function test_AdminWithdrawsReservesButNotLpMoney() public {
        _deposit(LP, 1_000_000e6);
        _openLine();
        _draw(100_000e6);
        _elapse(365 days);
        _repay(108_000e6);

        vm.prank(ADMIN);
        vm.expectRevert(CreditcoinPoolEngine.InsufficientLiquidity.selector);
        engine.withdrawReserves(TREASURY, 2_000e6 + 1);

        uint256 lpValue = engine.totalAssets();
        vm.prank(ADMIN);
        engine.withdrawReserves(TREASURY, 2_000e6);
        assertEq(usdc.balanceOf(TREASURY), 2_000e6);
        assertEq(engine.totalAssets(), lpValue, "LP money unchanged");
    }

    function test_RevertWhen_NonAdminWithdrawsReserves() public {
        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.NotAdmin.selector);
        engine.withdrawReserves(ATTACKER, 1);
    }

    function test_RatesAreBounded() public {
        vm.startPrank(ADMIN);
        vm.expectRevert(CreditcoinPoolEngine.RateTooHigh.selector);
        engine.setBorrowRateBps(5_001);
        vm.expectRevert(CreditcoinPoolEngine.ReserveFactorTooHigh.selector);
        engine.setReserveFactorBps(5_001);
        engine.setBorrowRateBps(1_200);
        engine.setReserveFactorBps(1_000);
        vm.stopPrank();
        assertEq(engine.borrowRateBps(), 1_200);
        assertEq(engine.reserveFactorBps(), 1_000);

        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.NotAdmin.selector);
        engine.setBorrowRateBps(0);
    }

    // -- adversarial -----------------------------------------------------------

    /// @dev Classic 4626 attack: tiny first deposit, then a donation to inflate the share
    ///      price so the next depositor's shares round to little. The virtual offset has
    ///      to make it cost the attacker, and cost the victim almost nothing.
    function test_InflationAttackIsUnprofitable() public {
        _deposit(ATTACKER, 1);
        usdc.mint(ATTACKER, 1_000_000e6);
        vm.prank(ATTACKER);
        usdc.transfer(address(engine), 1_000_000e6);

        _deposit(LP, 1_000_000e6);

        assertApproxEqAbs(engine.assetsOf(LP), 1_000_000e6, 1e6, "victim loses under $1");
        assertLt(engine.assetsOf(ATTACKER), 1_000_000e6, "attacker cannot recover the donation");
    }

    function testFuzz_DepositThenRedeemNeverReturnsMore(uint96 seed, uint96 amount) public {
        vm.assume(amount > 0);
        if (seed > 0) _deposit(LP2, seed);
        uint256 shares = _deposit(LP, amount);
        vm.assume(shares > 0);
        vm.prank(LP);
        uint256 out = engine.redeem(shares);
        assertLe(out, amount);
    }
}
