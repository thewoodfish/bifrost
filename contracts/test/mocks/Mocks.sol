// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAttestcoinBlockProver} from "../../src/interfaces/IAttestcoinBlockProver.sol";

/// @notice Stand-in for the Attestcoin BlockProver precompile in local tests.
contract MockBlockProver is IAttestcoinBlockProver {
    bool public result = true;
    bool public shouldRevert;

    function setResult(bool r) external {
        result = r;
    }

    function setShouldRevert(bool r) external {
        shouldRevert = r;
    }

    function verifyAndEmit(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        if (shouldRevert) revert("precompile failure");
        return result;
    }

    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        if (shouldRevert) revert("precompile failure");
        return result;
    }

    function calculateTxIndex(bytes32, MerkleProof calldata, ContinuityProof calldata) external pure returns (uint256) {
        return 0;
    }
}

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "not approved");
        allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
