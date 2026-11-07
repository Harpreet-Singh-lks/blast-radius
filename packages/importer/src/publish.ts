// pnpm publish:snapshot --input out/<id>.manifest.json [--days 60] [--batch 20]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { formatEther, stringToBytes } from "viem";
import { parseArgs } from "./args.ts";
import { DEFAULT_RPC } from "./config.ts";
import { fetchSnapshotRows, publicClient, writer } from "./arkiv.ts";
import { digestOf } from "./manifest.ts";
import { isStillCanonical } from "./reader.ts";
import { Coverage, Dependency, Deployment, ScenarioResult, Snapshot } from "./schema.ts";
import type { SnapshotManifest } from "./types.ts";

const args = parseArgs(process.argv.slice(2));
if (!args.input) { console.error("usage: publish:snapshot --input <manifest.json> [--days 60] [--batch 20]"); process.exit(1); }
const m: SnapshotManifest = JSON.parse(readFileSync(args.input, "utf8"));
const days = Number(args.days ?? 60);
let batchSize = Number(args.batch ?? 20);
const { account, client } = writer();
const pc = publicClient();
const expiration = ExpirationTime.fromDays(days);
const ledgerFile = args.input.replace(/\.manifest\.json$/, ".ledger.json");
const ledger: { publisher: string; keys: Record<string, string> } =
  existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : { publisher: account.address, keys: {} };
if (ledger.publisher.toLowerCase() !== account.address.toLowerCase()) {
  console.error("ledger belongs to a different writer wallet; use a fresh manifest copy"); process.exit(1);
}
const save = () => writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));

console.log(`snapshot ${m.snapshotId}  writer ${account.address}  expiry ${days}d`);

// 0. the manifest must describe itself truthfully and its block must still be canonical
if (digestOf(m) !== m.digest) { console.error("manifest digest does not match its records; refusing to publish"); process.exit(1); }
const rpc = process.env.ETHEREUM_RPC_URL || DEFAULT_RPC;
if (m.chainId === 31337) {
  console.log("local chain manifest: block canonicality cannot be re-checked once the node has stopped; the recorded evidence is self-contained");
} else if (!(await isStillCanonical(rpc, { number: BigInt(m.block.number), hash: m.block.hash as `0x${string}`, timestamp: 0n }))) {
  console.error("manifest block is no longer canonical; re-import"); process.exit(3);
}
console.log(`balance ${formatEther(await pc.getBalance({ address: account.address }))} tGLM`);

// 1. what is already on Arkiv for this snapshot and writer (guards against a lost ledger)
const sets = [
  { name: "deployments", schema: Deployment, records: m.deployments },
  { name: "dependencies", schema: Dependency, records: m.dependencies },
  { name: "coverage", schema: Coverage, records: m.coverage },
  ...(m.results?.length ? [{ name: "results", schema: ScenarioResult, records: m.results }] : []),
] as const;
const already = new Set<string>(Object.keys(ledger.keys));
for (const s of sets) for (const r of await fetchSnapshotRows(s.schema, m.snapshotId, account.address)) if (r.logicalId) already.add(r.logicalId);

const payload = (r: unknown) => stringToBytes(JSON.stringify(r));
const base = (r: { datasetId: string; chainId: number }) => ({ datasetId: r.datasetId, chainId: r.chainId });
function toCreate(kind: string, r: any) {
  if (kind === "deployments") return { schema: Deployment, expiration, values: {
    ...base(r), address: addr(r.address), protocol: r.protocol, role: r.role, origin: r.origin,
    snapshotId: m.snapshotId, logicalId: r.logicalId, payload: payload(r) } };
  if (kind === "dependencies") return { schema: Dependency, expiration, values: {
    ...base(r), source: addr(r.source), target: addr(r.target), relation: r.relation, snapshotId: r.snapshotId,
    adapterId: r.adapterId, logicalId: r.logicalId, payload: payload(r) } };
  if (kind === "results") return { schema: ScenarioResult, expiration, values: {
    ...base(r), scenarioId: r.scenarioId, phase: r.phase, address: addr(r.address), outcome: r.outcome,
    snapshotId: r.snapshotId, logicalId: r.logicalId, payload: payload(r) } };
  return { schema: Coverage, expiration, values: {
    ...base(r), address: addr(r.address), snapshotId: r.snapshotId, status: r.status,
    logicalId: r.logicalId, payload: payload(r) } };
}

// 2. bounded batches; each batch is one atomic transaction. Halve on failure, then give up loudly.
for (const s of sets) {
  const pending = (s.records as any[]).filter((r) => !already.has(r.logicalId));
  console.log(`${s.name}: ${s.records.length} total, ${pending.length} to publish`);
  for (let i = 0; i < pending.length; ) {
    const chunk = pending.slice(i, i + batchSize);
    try {
      const res = await (client as any).executeBatch({ creates: chunk.map((r) => toCreate(s.name, r)) });
      chunk.forEach((r, j) => { ledger.keys[r.logicalId] = res.createdEntities[j]; });
      save();
      i += chunk.length;
      console.log(`  +${chunk.length} (tx ${res.txHash.slice(0, 12)}…)`);
    } catch (e) {
      if (batchSize > 1) { batchSize = Math.max(1, Math.floor(batchSize / 2)); console.log(`  batch failed (${(e as Error).message.slice(0, 120)}); batch size now ${batchSize}`); }
      else { console.error("single-record write failed:", (e as Error).message); process.exit(4); }
    }
  }
}

// 3. read everything back and compare with the manifest before declaring the snapshot complete
console.log("verifying against Arkiv…");
const back: Record<string, any[]> = { deployments: [], dependencies: [], coverage: [], results: [] };
for (const s of sets) back[s.name] = (await fetchSnapshotRows(s.schema, m.snapshotId, account.address)).map((r) => r.record);
const counts: Record<string, number> = { deployments: back.deployments.length, dependencies: back.dependencies.length, coverage: back.coverage.length };
const expected: Record<string, number> = { deployments: m.counts.deployments, dependencies: m.counts.dependencies, coverage: m.counts.coverage };
if (m.results?.length) { counts.results = back.results.length; expected.results = m.results.length; }
console.log("  read back", JSON.stringify(counts), "expected", JSON.stringify(expected));
const readDigest = digestOf({ ...back, results: back.results } as any);
if (JSON.stringify(counts) !== JSON.stringify(expected) || readDigest !== m.digest) {
  console.error(`verification FAILED (digest read ${readDigest.slice(0, 12)} vs manifest ${m.digest.slice(0, 12)}); snapshot manifest NOT published`);
  process.exit(5);
}
console.log("  counts and digest match");

// 4. publish the completed-snapshot entity last; readers ignore snapshots without one
const existing = await fetchSnapshotRows(Snapshot, m.snapshotId, account.address, false);
if (existing.length) { console.log("snapshot entity already published; nothing more to do"); process.exit(0); }
const summary = { ...m, deployments: undefined, dependencies: undefined, coverage: undefined, results: undefined, completedAt: new Date().toISOString(), publishedBy: account.address, expiryDays: days };
const res = await (client as any).createEntity(Snapshot, {
  datasetId: m.datasetId, chainId: m.chainId, snapshotId: m.snapshotId, status: "complete",
  blockNumber: u64(BigInt(m.block.number)), blockHash: m.block.hash, digest: m.digest, payload: payload(summary),
}, { expiration });
console.log(`snapshot ${m.snapshotId} complete. entity ${res.entityKey}`);
