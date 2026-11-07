// pnpm demo:run [--out out] [--port 8546]
// Controlled experiment on a local anvil chain. Not a discovered live exploit.
// Produces two dependency snapshots (baseline, after beacon upgrade) with scenario results, as manifests.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, toFunctionSelector,
  type Abi, type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { parseArgs } from "./args.ts";
import { IMPORTER_VERSION } from "./config.ts";
import { observeContract } from "./adapters.ts";
import { canonical, digestOf, logicalId, makeSnapshotId, sha256 } from "./manifest.ts";
import { makeReader } from "./reader.ts";
import type {
  CoverageRecord, DependencyRecord, DeploymentRecord, ScenarioResultRecord, SnapshotManifest,
} from "./types.ts";

const DATASET_ID = "controlled-demo";
const CHAIN_ID = 31337;
const SCENARIO_ID = "shared-beacon-upgrade-v1";
const AMOUNT = 10n ** 18n;
const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(here, "../../../contracts");
const args = parseArgs(process.argv.slice(2));
const outDir = args.out ?? "out";
const port = args.port ?? "8546";
const rpc = `http://127.0.0.1:${port}`;

const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(`${contractsDir}/out/${file}/${name}.json`, "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};
const V1 = artifact("VaultV1.sol", "VaultV1");
const V2 = artifact("VaultV2Paused.sol", "VaultV2Paused");
const BEACON = artifact("UpgradeableBeacon.sol", "UpgradeableBeacon");
const PROXY = artifact("BeaconProxy.sol", "BeaconProxy");
const lc = (a: string) => a.toLowerCase() as Hex;

async function startAnvil(): Promise<ChildProcess> {
  const p = spawn("anvil", ["--port", port, "--silent"], { stdio: "ignore" });
  const pc = createPublicClient({ chain: foundry, transport: http(rpc) });
  for (let i = 0; i < 50; i++) {
    try { await pc.getBlockNumber(); return p; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  p.kill(); throw new Error("anvil did not start; is Foundry installed?");
}

function revertData(e: unknown): Hex | undefined {
  let cur: any = e;
  for (let i = 0; i < 8 && cur; i++) {
    if (typeof cur.data === "string" && cur.data.startsWith("0x")) return cur.data as Hex;
    if (typeof cur.data?.data === "string") return cur.data.data as Hex;
    cur = cur.cause;
  }
  return undefined;
}

const anvil = await startAnvil();
let failed = false;
try {
  const pc = createPublicClient({ chain: foundry, transport: http(rpc) });
  const wc = createWalletClient({ chain: foundry, transport: http(rpc) });
  const rawReq = (pc as any).request.bind(pc) as (a: { method: string; params?: unknown[] }) => Promise<any>;
  const accounts = (await rawReq({ method: "eth_accounts" })).map(lc) as Hex[];
  const [deployer, ownerShared, ownerC, user] = accounts;

  const deploy = async (a: { abi: Abi; bytecode: Hex }, argv: unknown[] = []) => {
    const hash = await wc.deployContract({ abi: a.abi, bytecode: a.bytecode, args: argv, account: deployer });
    return lc((await pc.waitForTransactionReceipt({ hash })).contractAddress!);
  };

  // 1-2. implementations, beacons, three proxies (initialised in the proxy constructor)
  const implV1 = await deploy(V1);
  const implC = await deploy(V1);
  const implV2 = await deploy(V2);
  const beaconShared = await deploy(BEACON, [implV1, ownerShared]);
  const beaconC = await deploy(BEACON, [implC, ownerC]);
  const init = encodeFunctionData({ abi: V1.abi, functionName: "initialize" });
  const vaultA = await deploy(PROXY, [beaconShared, init]);
  const vaultB = await deploy(PROXY, [beaconShared, init]);
  const vaultC = await deploy(PROXY, [beaconC, init]);

  // 3. equal deposits from one funded test user
  const vaults = [
    { label: "Vault A", address: vaultA, expected: "reverted" as const },
    { label: "Vault B", address: vaultB, expected: "reverted" as const },
    { label: "Vault C", address: vaultC, expected: "succeeded" as const },
  ];
  for (const v of vaults) {
    const h = await wc.writeContract({ address: v.address, abi: V1.abi, functionName: "deposit", value: AMOUNT, account: user });
    await pc.waitForTransactionReceipt({ hash: h });
  }
  const position = async (v: Hex) => ((await pc.readContract({ address: v, abi: V1.abi, functionName: "balances", args: [user] })) as bigint).toString();

  const roles: Record<string, string> = {
    [implV1]: "impl-v1", [implC]: "impl-c", [implV2]: "impl-v2-paused",
    [beaconShared]: "beacon-shared", [beaconC]: "beacon-c",
    [vaultA]: "vault-a", [vaultB]: "vault-b", [vaultC]: "vault-c",
    [ownerShared]: "owner-shared-beacon", [ownerC]: "owner-beacon-c",
  };
  const contractAddrs = [vaultA, vaultB, vaultC, beaconShared, beaconC, implV1, implC, implV2];

  // dependency snapshot at the current block
  async function captureSnapshot(phase: "baseline" | "after") {
    const b = await pc.getBlock({ blockTag: "latest" });
    const reader = makeReader(rpc, { number: b.number!, hash: b.hash!, timestamp: b.timestamp });
    const snapshotId = makeSnapshotId(b.number!, b.hash!);
    const known = new Set<Hex>([beaconShared, beaconC]);
    const dependencies = new Map<string, DependencyRecord>();
    const coverage: CoverageRecord[] = [];
    const endpoints = new Set<Hex>(contractAddrs);
    for (const address of contractAddrs) {
      const obs = await observeContract(reader, address, { knownOwnableBeacons: known });
      for (const e of obs.edges) {
        endpoints.add(e.source); endpoints.add(e.target);
        const id = logicalId("dependency", DATASET_ID, CHAIN_ID, e.source, e.target, e.relation, snapshotId);
        dependencies.set(id, {
          type: "dependency", logicalId: id, datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId,
          source: e.source, target: e.target, relation: e.relation, adapterId: e.adapterId,
          adapterVersion: e.adapterVersion, basis: "observed state",
          block: { number: b.number!.toString(), hash: b.hash! }, evidence: e.evidence,
          evidenceHash: sha256(canonical(e.evidence)),
        });
      }
      coverage.push({
        type: "coverage", logicalId: logicalId("coverage", DATASET_ID, CHAIN_ID, address, snapshotId),
        datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId, address, status: obs.status,
        attempted: obs.attempted, notes: obs.notes,
      });
    }
    const deployments: DeploymentRecord[] = [...endpoints].sort().map((address) => ({
      type: "deployment", logicalId: logicalId("deployment", DATASET_ID, CHAIN_ID, address),
      datasetId: DATASET_ID, chainId: CHAIN_ID, address, origin: "scenario", protocol: "controlled-demo",
      role: roles[address] ?? "discovered", aliases: [], group: "controlled-demo",
    }));
    for (const d of deployments) if (!contractAddrs.includes(d.address)) {
      coverage.push({
        type: "coverage", logicalId: logicalId("coverage", DATASET_ID, CHAIN_ID, d.address, snapshotId),
        datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId, address: d.address, status: "not-inspected",
        attempted: [], notes: ["externally owned account; found as an edge endpoint"],
      });
    }
    return { phase, block: b, snapshotId, deployments, dependencies: [...dependencies.values()], coverage };
  }

  // attempt a withdrawal exactly as the test user would, from the state the caller has prepared
  const WithdrawalsPaused = toFunctionSelector("WithdrawalsPaused()");
  async function attempt(phase: "baseline" | "after", snapshotId: string, v: (typeof vaults)[number]): Promise<ScenarioResultRecord> {
    const data = encodeFunctionData({ abi: V1.abi, functionName: "withdraw", args: [AMOUNT] });
    const call = { from: user, to: v.address, data, value: "0" };
    const before = await position(v.address);
    const beaconAddr = lc(("0x" + (await pc.getStorageAt({ address: v.address, slot: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" }))!.slice(-40)));
    const beaconImpl = (await pc.readContract({ address: beaconAddr, abi: [{ type: "function", name: "implementation", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }] as const, functionName: "implementation" })) as Hex;
    let ethCall: ScenarioResultRecord["ethCall"];
    try {
      const r = await pc.call({ account: user, to: v.address, data });
      ethCall = { ok: true, returnData: (r.data ?? "0x") as Hex };
    } catch (e) {
      const rd = revertData(e);
      ethCall = { ok: false, revertData: rd, decodedError: rd?.startsWith(WithdrawalsPaused) ? "WithdrawalsPaused()" : rd ? "unrecognised revert" : "revert without data" };
    }
    const hash = await wc.sendTransaction({ account: user, to: v.address, data, gas: 200_000n });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    const after = await position(v.address);
    const outcome = receipt.status === "success" ? "succeeded" : "reverted";
    return {
      type: "scenario_result", logicalId: logicalId("scenario_result", DATASET_ID, SCENARIO_ID, phase, v.address, snapshotId),
      datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId, scenarioId: SCENARIO_ID, phase, address: v.address,
      label: v.label, user, outcome, expected: phase === "baseline" ? "succeeded" : v.expected, call, ethCall,
      tx: { hash, status: receipt.status, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber.toString() },
      implementationInEffect: beaconImpl, positionBefore: before, positionAfter: after,
    };
  }

  const evmSnapshot = async () => (await rawReq({ method: "evm_snapshot" })) as string;
  const evmRevert = async (id: string) => { if (!(await rawReq({ method: "evm_revert", params: [id] }))) throw new Error("evm_revert failed"); };

  async function runPhase(phase: "baseline" | "after", snapshotId: string) {
    const out: ScenarioResultRecord[] = [];
    let id = await evmSnapshot();
    for (const v of vaults) {
      out.push(await attempt(phase, snapshotId, v));
      await evmRevert(id); // every vault starts from the same logical state
      id = await evmSnapshot();
    }
    await evmRevert(id);
    return out;
  }

  // 4-6. baseline snapshot, then baseline withdrawals each from the same starting state
  const baseline = await captureSnapshot("baseline");
  const baselineResults = await runPhase("baseline", baseline.snapshotId);

  // 7-8. authorised upgrade of the shared beacon (the unauthorised path is covered by the Foundry tests)
  const upgradeHash = await wc.writeContract({ address: beaconShared, abi: BEACON.abi, functionName: "upgradeTo", args: [implV2], account: ownerShared });
  const upgradeReceipt = await pc.waitForTransactionReceipt({ hash: upgradeHash });
  const after = await captureSnapshot("after");

  // 9. after-upgrade withdrawals from comparable state
  const afterResults = await runPhase("after", after.snapshotId);

  // 10. assertions: A/B revert for the expected reason, C succeeds, baseline all succeeded
  const problems: string[] = [];
  for (const r of baselineResults) {
    if (r.outcome !== "succeeded") problems.push(`baseline ${r.label} should succeed, got ${r.outcome}`);
    if (r.positionBefore !== AMOUNT.toString() || r.positionAfter !== "0") problems.push(`baseline ${r.label}: position ${r.positionBefore} -> ${r.positionAfter}, expected ${AMOUNT} -> 0`);
  }
  for (const r of afterResults) {
    if (r.outcome !== r.expected) problems.push(`after ${r.label}: expected ${r.expected}, got ${r.outcome}`);
    if (r.expected === "reverted" && r.ethCall.decodedError !== "WithdrawalsPaused()") problems.push(`after ${r.label}: wrong revert reason (${r.ethCall.decodedError})`);
    if (r.outcome === "reverted" && r.positionAfter !== AMOUNT.toString()) problems.push(`after ${r.label}: a reverted withdrawal changed the position`);
    if (r.outcome === "succeeded" && r.positionAfter !== "0") problems.push(`after ${r.label}: a successful withdrawal left a non-zero position`);
  }
  if (problems.length) { failed = true; console.error("SCENARIO ASSERTIONS FAILED:\n - " + problems.join("\n - ")); }

  // 11. evidence about the setup
  const layout = (name: string) => JSON.parse(execFileSync("forge", ["inspect", name, "storage-layout", "--json"], { cwd: contractsDir, encoding: "utf8" }));
  const l1 = layout("VaultV1"), l2 = layout("VaultV2Paused");
  const strip = (l: any) => l.storage.map((s: any) => ({ label: s.label, slot: s.slot, offset: s.offset, type: s.type }));
  const codeHash = async (a: Hex) => keccak256((await pc.getCode({ address: a }))!);
  const srcHash = (f: string) => createHash("sha256").update(readFileSync(`${contractsDir}/src/${f}`)).digest("hex");
  const scenario = {
    id: SCENARIO_ID, kind: "controlled experiment on a local chain; not a discovered live exploit",
    chain: { id: CHAIN_ID, node: execFileSync("anvil", ["--version"], { encoding: "utf8" }).split("\n")[0] },
    roles: { deployer, ownerSharedBeacon: ownerShared, ownerBeaconC: ownerC, testUser: user },
    amountWei: AMOUNT.toString(),
    upgrade: { by: ownerShared, beacon: beaconShared, from: implV1, to: implV2, txHash: upgradeHash, blockNumber: upgradeReceipt.blockNumber.toString() },
    codeHashes: { vaultV1: await codeHash(implV1), vaultV2Paused: await codeHash(implV2) },
    sourceSha256: { "VaultV1.sol": srcHash("VaultV1.sol"), "VaultV2Paused.sol": srcHash("VaultV2Paused.sol") },
    storageLayout: { vaultV1: strip(l1), vaultV2Paused: strip(l2), identical: canonical(strip(l1)) === canonical(strip(l2)) },
    assumptions: [
      "Local anvil chain with unlocked test accounts; every transaction auto-mined.",
      "Each withdrawal ran from the same logical state: the chain was reverted to an EVM snapshot between attempts.",
      "Transaction hashes of withdrawals refer to blocks discarded by those reverts; the receipt fields are copied into each record.",
      "Only the shared beacon was upgraded. Vault C uses a different beacon, implementation and owner.",
    ],
  };

  const finish = (s: Awaited<ReturnType<typeof captureSnapshot>>, results: ScenarioResultRecord[], pair: string): SnapshotManifest => {
    const m: SnapshotManifest = {
      manifestVersion: 1, datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId: s.snapshotId,
      block: { number: s.block.number!.toString(), hash: s.block.hash!, timestamp: s.block.timestamp.toString() },
      importer: { version: IMPORTER_VERSION },
      counts: {
        deployments: s.deployments.length, dependencies: s.dependencies.length, coverage: s.coverage.length,
        results: results.length, registryRecords: 0,
        inspected: s.coverage.filter((c) => c.status !== "not-inspected").length,
        unsupported: s.coverage.filter((c) => c.status === "no-supported-pattern" || c.status === "no-code").length,
      },
      digest: "", createdAt: new Date().toISOString(),
      deployments: s.deployments.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
      dependencies: s.dependencies.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
      coverage: s.coverage.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
      results, scenario: { ...scenario, phase: s.phase, pairedSnapshot: pair },
    };
    m.digest = digestOf(m);
    return m;
  };
  const mBase = finish(baseline, baselineResults, after.snapshotId);
  const mAfter = finish(after, afterResults, baseline.snapshotId);

  mkdirSync(outDir, { recursive: true });
  for (const m of [mBase, mAfter]) writeFileSync(`${outDir}/${m.snapshotId}.manifest.json`, JSON.stringify(m, null, 2));

  const row = (r: ScenarioResultRecord) => `  ${r.label.padEnd(8)} ${r.outcome.padEnd(10)} (expected ${r.expected}) ${r.ethCall.decodedError ?? ""}`;
  console.log(`baseline snapshot ${baseline.snapshotId}  edges ${mBase.counts.dependencies}\n${baselineResults.map(row).join("\n")}`);
  console.log(`after snapshot    ${after.snapshotId}  edges ${mAfter.counts.dependencies}\n${afterResults.map(row).join("\n")}`);
  console.log(`storage layout identical: ${scenario.storageLayout.identical}`);
  const changed = mAfter.dependencies.filter((e) => !mBase.dependencies.some((b) => b.logicalId.length && b.source === e.source && b.target === e.target && b.relation === e.relation));
  console.log(`edges new after upgrade: ${changed.map((e) => `${roles[e.source]} -> ${roles[e.target]} (${e.relation})`).join(", ")}`);
  console.log(`wrote ${outDir}/${mBase.snapshotId}.manifest.json and ${outDir}/${mAfter.snapshotId}.manifest.json`);
} finally {
  anvil.kill();
}
if (failed) process.exit(1);
