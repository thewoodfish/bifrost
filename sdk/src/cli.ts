#!/usr/bin/env tsx
import { formatUnits, parseUnits } from "ethers";
import { config } from "./config.js";
import { attestationLag, chainInfo, creditcoin } from "./chain.js";
import { buildProof } from "./attest.js";
import { creditLineOf, drawDown, lockPortfolio, openCreditLine, readLock } from "./flow.js";
import type { Stage } from "./attest.js";

const log = (s: string) => console.log(s);
const usd = (v: bigint) => `$${Number(formatUnits(v, 6)).toLocaleString()}`;

function onStage(s: Stage) {
  switch (s.phase) {
    case "waiting_attestation":
      console.log(
        `  attesting... height ${s.height}, latest attested ${s.attested} ` +
          `(${s.behind > 0 ? `${s.behind} blocks to go` : "catching up"})`,
      );
      break;
    case "attested":
      console.log(`  height ${s.height} attested`);
      break;
    case "building_proof":
      console.log("  building proof...");
      break;
    case "proof_retry":
      console.log(
        `  prover not ready yet (attempt ${s.attempt}, ${s.waited}s): ${s.reason.split("\n")[0]}`,
      );
      break;
    case "proof_ready":
      console.log("  proof ready");
      break;
  }
}

async function cmdStatus() {
  const chains = await chainInfo(creditcoin()).get_supported_chains();
  console.log("Attested source chains on Creditcoin:");
  for (const c of chains) {
    const mark = Number(c.chainKey) === config.chainKey ? " <- in use" : "";
    console.log(`  chainKey ${c.chainKey}  chainId ${c.chainId}  ${c.chainName}${mark}`);
  }

  const lag = await attestationLag();
  console.log("");
  console.log(`Sepolia head:    ${lag.head}`);
  console.log(`Latest attested: ${lag.attested}`);
  console.log(`Behind by:       ${lag.behind} blocks (~${Math.round((lag.behind * 12) / 60)} min)`);
}

async function cmdLock(portfolioId: string, value: string) {
  const lock = await lockPortfolio(BigInt(portfolioId), parseUnits(value, 6), log);
  console.log("");
  console.log(`locked in ${lock.txHash} (block ${lock.blockNumber})`);
  console.log(`  portfolio ${lock.portfolioId}  value ${usd(lock.dollarValue)}  round ${lock.valuationRound}`);
  console.log("");
  console.log(`next:  npm run bifrost -- open ${lock.txHash}`);
}

async function cmdProve(txHash: string) {
  const lock = await readLock(txHash);
  console.log(`lock at block ${lock.blockNumber}, portfolio ${lock.portfolioId}, ${usd(lock.dollarValue)}`);
  const proof = await buildProof(txHash, onStage);
  console.log(JSON.stringify(proof, null, 2));
}

async function cmdOpen(txHash: string) {
  const lock = await readLock(txHash);
  console.log(`opening credit against portfolio ${lock.portfolioId} (${usd(lock.dollarValue)})`);
  console.log("attestation takes 8-20 min; this will block until it lands.");
  const { creditLimit, txHash: hash } = await openCreditLine(lock, log, onStage);
  console.log("");
  console.log(`credit line opened: ${usd(creditLimit)} in ${hash}`);
}

async function cmdDraw(portfolioId: string, amount: string) {
  const hash = await drawDown(BigInt(portfolioId), parseUnits(amount, 6), log);
  console.log(`drawn in ${hash}`);
}

async function cmdLine(portfolioId: string) {
  const l = await creditLineOf(BigInt(portfolioId));
  if (!l.open && l.creditLimit === 0n) return console.log(`no credit line for portfolio ${portfolioId}`);
  console.log(`borrower:      ${l.borrower}`);
  console.log(`attested:      ${usd(l.attestedValue)}`);
  console.log(`credit limit:  ${usd(l.creditLimit)}`);
  console.log(`drawn:         ${usd(l.drawn)}`);
  console.log(`open:          ${l.open}`);
}

const USAGE = `bifrost — Attestcoin proof pipeline

  status                        supported chains and current attestation lag
  lock <portfolioId> <usd>      register, value and lock on Sepolia
  prove <txHash>                wait for attestation and print the proof
  open <txHash>                 prove, dry-run, and open the credit line
  draw <portfolioId> <usd>      draw against an open line
  line <portfolioId>            show a credit line

Env: ORIGIN_VAULT, POOL_ENGINE, and a signer
     (KEYSTORE_ACCOUNT + KEYSTORE_PASSWORD, or PRIVATE_KEY)`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "status":
      return cmdStatus();
    case "lock":
      if (args.length < 2) throw new Error("usage: lock <portfolioId> <usd>");
      return cmdLock(args[0]!, args[1]!);
    case "prove":
      if (!args[0]) throw new Error("usage: prove <txHash>");
      return cmdProve(args[0]);
    case "open":
      if (!args[0]) throw new Error("usage: open <txHash>");
      return cmdOpen(args[0]);
    case "draw":
      if (args.length < 2) throw new Error("usage: draw <portfolioId> <usd>");
      return cmdDraw(args[0]!, args[1]!);
    case "line":
      if (!args[0]) throw new Error("usage: line <portfolioId>");
      return cmdLine(args[0]);
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(`\nerror: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
