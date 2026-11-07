// pnpm import:registry [--commit <sha>] [--block <n>] [--assets all|A,B,C] [--out out]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "./args.ts";
import { DEFAULT_ASSETS, DEFAULT_COMMIT, DEFAULT_RPC } from "./config.ts";
import { buildManifest } from "./manifest.ts";
import { isStillCanonical, makeReader, pinFinalizedBlock } from "./reader.ts";
import { fetchRegistry, parseRegistry, selectScope } from "./registry.ts";

const args = parseArgs(process.argv.slice(2));
const commit = args.commit ?? DEFAULT_COMMIT;
const rpc = process.env.ETHEREUM_RPC_URL || DEFAULT_RPC;
const assets: string[] | "all" = args.assets === "all" ? "all" : args.assets ? args.assets.split(",") : DEFAULT_ASSETS;
const outDir = args.out ?? "out";

console.log(`registry ${commit}`);
const source = await fetchRegistry(commit);
const all = parseRegistry(source.text);
const entries = selectScope(all, assets);
console.log(`registry constants parsed: ${all.length}; in scope: ${entries.length}; file sha256 ${source.sha256.slice(0, 16)}`);

const pinned = await pinFinalizedBlock(rpc, args.block ? BigInt(args.block) : undefined);
console.log(`pinned block ${pinned.number} ${pinned.hash}`);
const reader = makeReader(rpc, pinned);

const manifest = await buildManifest({
  entries, source, commit, reader, blockTimestamp: pinned.timestamp, assets, log: (s) => console.log(s),
});

if (!(await isStillCanonical(rpc, pinned))) {
  console.error("pinned block is no longer canonical; discard this run and re-import.");
  process.exit(3);
}

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/${manifest.snapshotId}.manifest.json`;
writeFileSync(file, JSON.stringify(manifest, null, 2));

const c = manifest.counts;
const byStatus: Record<string, number> = {};
for (const x of manifest.coverage) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
console.log(`\nsnapshot ${manifest.snapshotId}`);
console.log(`registry records imported: ${c.registryRecords}`);
console.log(`contracts inspected:       ${c.inspected}`);
console.log(`supported edges:           ${c.dependencies}`);
console.log(`no supported pattern/code: ${c.unsupported}`);
console.log(`coverage by status:        ${JSON.stringify(byStatus)}`);
console.log(`digest ${manifest.digest}\nwrote ${file}`);
