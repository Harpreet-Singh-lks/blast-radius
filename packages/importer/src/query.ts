// pnpm query:dependents --snapshot <id> --address <0x..> [--publisher <0x..>] [--depth 8]
// Reads only from Arkiv with the public RPC. No manifest file, no writer key.
import { eq } from "@arkiv-network/sdk/query";
import { hexToString, getAddress, type Hex } from "viem";
import { parseArgs } from "./args.ts";
import { DEFAULT_PUBLISHERS } from "./config.ts";
import { fetchSnapshotRows, publicClient } from "./arkiv.ts";
import { Dependency, Deployment, Snapshot } from "./schema.ts";
import type { DependencyRecord, DeploymentRecord } from "./types.ts";

const args = parseArgs(process.argv.slice(2));
if (!args.snapshot || !args.address) {
  console.error("usage: query:dependents --snapshot <id> --address <0x..> [--publisher <0x..>] [--depth 8]"); process.exit(1);
}
const owner = (args.publisher ?? DEFAULT_PUBLISHERS[0]) as Hex;
const target = args.address.toLowerCase() as Hex;
const maxDepth = Number(args.depth ?? 8);

// Readers use only completed snapshots.
const pc = publicClient() as any;
const { entities: snaps } = await pc.select({ payload: true }).from(Snapshot)
  .where(eq("snapshotId", args.snapshot)).ownedBy(owner).limit(1).fetch();
if (!snaps.length) { console.error(`no completed snapshot ${args.snapshot} from publisher ${owner}`); process.exit(2); }
const snap = JSON.parse(hexToString(snaps[0].payload.value));

const deployments = (await fetchSnapshotRows(Deployment, args.snapshot, owner, false)).map((r) => r.record as DeploymentRecord);
const deps = (await fetchSnapshotRows(Dependency, args.snapshot, owner, false)).map((r) => r.record as DependencyRecord);
const label = new Map(deployments.map((d) => [d.address, d.role === "discovered" ? "(unlabelled)" : d.role]));

// reverse traversal with a visited set; each dependent counted once, one evidence path retained
const incoming = new Map<Hex, DependencyRecord[]>();
for (const e of deps) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
const seen = new Set<Hex>([target]);
const via = new Map<Hex, DependencyRecord>();
let frontier: Hex[] = [target];
let truncated = false;
for (let d = 0; frontier.length; d++) {
  if (d >= maxDepth) { truncated = true; break; }
  const next: Hex[] = [];
  for (const id of frontier) for (const e of incoming.get(id) ?? []) {
    if (seen.has(e.source)) continue;
    seen.add(e.source); via.set(e.source, e); next.push(e.source);
  }
  frontier = next;
}

console.log(`snapshot ${snap.snapshotId}  block ${snap.block.number} (${snap.block.hash.slice(0, 10)}…)  publisher ${owner}`);
if (snap.registry) console.log(`registry ${snap.registry.repo}@${snap.registry.commit.slice(0, 10)} (${snap.registry.license}, ${snap.registry.licenseHolder})`);
else if (snap.scenario) console.log(`scenario ${snap.scenario.id} (${snap.scenario.phase}); ${snap.scenario.kind}`);
console.log(`target ${getAddress(target)}  ${label.get(target) ?? "(not in this snapshot)"}`);
const dependents = [...seen].filter((a) => a !== target).sort();
console.log(`\n${dependents.length} dependent contract(s) reach it (potential exposure, not exploitability):`);
for (const a of dependents) {
  const e = via.get(a)!;
  const ev = e.evidence.slot ? `slot ${e.evidence.slot.slice(0, 10)}…` : e.evidence.call;
  console.log(`  ${(label.get(a) ?? a).padEnd(30)} ${e.relation.padEnd(22)} ${ev} = 0x${e.evidence.raw.slice(-40)}`);
}
if (truncated) console.log(`\ntraversal truncated at depth ${maxDepth}`);
