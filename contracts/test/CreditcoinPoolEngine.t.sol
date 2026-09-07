// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditcoinPoolEngine} from "../src/CreditcoinPoolEngine.sol";
import {IAttestcoinBlockProver} from "../src/interfaces/IAttestcoinBlockProver.sol";
import {MockBlockProver, MockERC20} from "./mocks/Mocks.sol";
import {AttestedTxBuilder} from "./helpers/AttestedTxBuilder.sol";
import {AttestedTx} from "../src/lib/AttestedTx.sol";

contract CreditcoinPoolEngineTest is Test {
    CreditcoinPoolEngine engine;
    MockBlockProver prover;
    MockERC20 usdc;

    address constant ORIGIN_VAULT = address(0xBEEF);
    address constant BORROWER = address(0xB0B);
    address constant ATTACKER = address(0xBAD);
    address constant ADMIN = address(0xA11CE);
    uint64 constant CHAIN_KEY = 1; // Sepolia on CC3

    uint256 constant PORTFOLIO = 1042;
    uint256 constant VALUE = 250_000e6;

    bytes32 constant LOCK_TOPIC = keccak256("PortfolioLocked(address,uint256,uint256,uint64)");

    IAttestcoinBlockProver.MerkleProof mp;
    IAttestcoinBlockProver.ContinuityProof cp;

    function setUp() public {
        prover = new MockBlockProver();
        usdc = new MockERC20();
        engine = new CreditcoinPoolEngine(address(prover), address(usdc), ORIGIN_VAULT, CHAIN_KEY, ADMIN);
        usdc.mint(address(engine), 10_000_000e6);
    }

    // -- helpers ---------------------------------------------------------------

    function _lockReceipt(address emitter, address owner, uint256 portfolioId, uint256 value, uint64 round)
        internal
        pure
        returns (bytes memory)
    {
        return _lockReceiptTyped(emitter, owner, portfolioId, value, round, 2, 1, 3);
    }

    function _lockReceiptTyped(
        address emitter,
        address owner,
        uint256 portfolioId,
        uint256 value,
        uint64 round,
        uint8 txType,
        uint8 status,
        uint256 chunkCount
    ) internal pure returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = LOCK_TOPIC;
        topics[1] = bytes32(uint256(uint160(owner)));
        topics[2] = bytes32(portfolioId);
        AttestedTx.Log[] memory logs = AttestedTxBuilder.singleLog(emitter, topics, abi.encode(value, round));
        return AttestedTxBuilder.encode(txType, status, 120000, logs, chunkCount);
    }

    function _claim(uint256 value, address borrower) internal pure returns (CreditcoinPoolEngine.LockClaim memory) {
        return CreditcoinPoolEngine.LockClaim({
            chainKey: CHAIN_KEY,
            height: 100,
            portfolioId: PORTFOLIO,
            borrower: borrower,
            dollarValue: value,
            valuationRound: 1
        });
    }

    // -- happy path ------------------------------------------------------------

    function test_OpenCredit_IssuesEightyPercentLTV() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);

        vm.prank(BORROWER);
        uint256 limit = engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);

        assertEq(limit, 200_000e6, "80% of 250k");
        CreditcoinPoolEngine.CreditLine memory line = engine.getCreditLine(PORTFOLIO);
        assertEq(line.attestedValue, VALUE);
        assertEq(line.creditLimit, 200_000e6);
        assertTrue(line.open);
    }

    /// @dev Blob/authorization transactions carry four chunks; the receipt is still last.
    function test_FourChunkPayloadDecodes() public {
        bytes memory receipt = _lockReceiptTyped(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1, 3, 1, 4);

        vm.prank(BORROWER);
        assertEq(engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp), 200_000e6);
    }

    function test_LegacyTxTypeDecodes() public {
        bytes memory receipt = _lockReceiptTyped(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1, 0, 1, 3);

        vm.prank(BORROWER);
        assertEq(engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp), 200_000e6);
    }

    /// @dev A reverted source tx still yields an attestable receipt; it must not fund credit.
    function test_RevertWhen_SourceTxReverted() public {
        bytes memory receipt = _lockReceiptTyped(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1, 2, 0, 3);

        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.SourceTxFailed.selector);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);
    }

    function test_RevertWhen_PayloadIsGarbage() public {
        vm.prank(BORROWER);
        vm.expectRevert();
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), hex"deadbeef", mp, cp);
    }

    // -- the attack this protocol exists to stop -------------------------------

    function test_RevertWhen_ClaimInflatesValueBeyondProof() public {
        // Receipt proves $250k. Borrower claims $10m.
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);

        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.ClaimDoesNotMatchProof.selector);
        engine.attestAndOpenCredit(_claim(10_000_000e6, BORROWER), receipt, mp, cp);
    }

    function test_RevertWhen_LogComesFromAttackerContract() public {
        // Attacker emits an identical event from their own contract.
        bytes memory receipt = _lockReceipt(address(0xDEAD), ATTACKER, PORTFOLIO, 10_000_000e6, 1);

        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.LockLogNotFound.selector);
        engine.attestAndOpenCredit(_claim(10_000_000e6, ATTACKER), receipt, mp, cp);
    }

    function test_RevertWhen_BorrowerIsNotProvenOwner() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);

        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.ClaimDoesNotMatchProof.selector);
        engine.attestAndOpenCredit(_claim(VALUE, ATTACKER), receipt, mp, cp);
    }

    function test_RevertWhen_CallerIsNotClaimedBorrower() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);

        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.BorrowerMismatch.selector);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);
    }

    function test_RevertWhen_ReceiptReplayed() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);

        vm.startPrank(BORROWER);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);
        vm.expectRevert(CreditcoinPoolEngine.LineAlreadyOpen.selector);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);
        vm.stopPrank();
    }

    function test_RevertWhen_ProverRejectsProof() public {
        prover.setResult(false);
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);

        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.ProofRejected.selector);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);
    }

    function test_RevertWhen_WrongChainKey() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        CreditcoinPoolEngine.LockClaim memory c = _claim(VALUE, BORROWER);
        c.chainKey = 99;

        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.BadChainKey.selector);
        engine.attestAndOpenCredit(c, receipt, mp, cp);
    }

    function test_RevertWhen_ValuationRoundMismatch() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 7);

        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.ClaimDoesNotMatchProof.selector);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);
    }

    // -- drawdown / repay ------------------------------------------------------

    function test_DrawAndRepayClosesLine() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        vm.prank(BORROWER);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);

        vm.prank(BORROWER);
        engine.draw(PORTFOLIO, 200_000e6);
        assertEq(usdc.balanceOf(BORROWER), 200_000e6);
        assertEq(engine.available(PORTFOLIO), 0);

        vm.prank(BORROWER);
        usdc.approve(address(engine), 200_000e6);
        vm.prank(BORROWER);
        engine.repay(PORTFOLIO, 200_000e6);

        assertFalse(engine.getCreditLine(PORTFOLIO).open);
        assertFalse(engine.portfolioHasOpenLine(PORTFOLIO));
    }

    function test_RevertWhen_DrawExceedsLimit() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        vm.prank(BORROWER);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);

        vm.prank(BORROWER);
        vm.expectRevert(CreditcoinPoolEngine.ExceedsCreditLimit.selector);
        engine.draw(PORTFOLIO, 200_001e6);
    }

    function test_RevertWhen_NonBorrowerDraws() public {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        vm.prank(BORROWER);
        engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp);

        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.BorrowerMismatch.selector);
        engine.draw(PORTFOLIO, 1);
    }

    // -- admin -----------------------------------------------------------------

    function test_RevertWhen_LtvRaisedAboveCap() public {
        vm.prank(ADMIN);
        vm.expectRevert(CreditcoinPoolEngine.LtvTooHigh.selector);
        engine.setLtvBps(8_001);
    }

    function test_RevertWhen_NonAdminSetsLtv() public {
        vm.prank(ATTACKER);
        vm.expectRevert(CreditcoinPoolEngine.NotAdmin.selector);
        engine.setLtvBps(5_000);
    }

    function test_LowerLtvAppliesToNewLines() public {
        vm.prank(ADMIN);
        engine.setLtvBps(5_000);

        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        vm.prank(BORROWER);
        assertEq(engine.attestAndOpenCredit(_claim(VALUE, BORROWER), receipt, mp, cp), 125_000e6);
    }

    // -- preview ---------------------------------------------------------------

    function test_PreviewIngest_AcceptsValidProof() public view {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        (bool ok,) = engine.previewIngest(_claim(VALUE, BORROWER), receipt, mp, cp);
        assertTrue(ok);
    }

    function test_PreviewIngest_RejectsInflatedValue() public view {
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, VALUE, 1);
        (bool ok, string memory reason) = engine.previewIngest(_claim(999e6, BORROWER), receipt, mp, cp);
        assertFalse(ok);
        assertEq(reason, "value mismatch");
    }

    // -- fuzz ------------------------------------------------------------------

    function testFuzz_CreditNeverExceedsEightyPercentOfProvenValue(uint128 value) public {
        vm.assume(value > 0);
        bytes memory receipt = _lockReceipt(ORIGIN_VAULT, BORROWER, PORTFOLIO, value, 1);

        vm.prank(BORROWER);
        uint256 limit = engine.attestAndOpenCredit(_claim(value, BORROWER), receipt, mp, cp);

        assertLe(limit, (uint256(value) * 8_000) / 10_000);
    }
}
