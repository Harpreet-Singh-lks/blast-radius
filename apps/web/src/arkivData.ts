import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { asc, eq } from "@arkiv-network/sdk/query";
import { http, hexToString } from "viem";
import { DEFAULT_PUBLISHERS } from "@importer/config.ts";
import { Coverage, Dependency, Deployment, ScenarioResult, Snapshot } from "@importer/schema.ts";
import { buildDataset, chooseSnapshots, type RawSnapshot } from "./model.ts";
import type { DatasetKey, DatasetView } from "./types.ts";

// Public configuration only. There is no writer key in the browser. The access key is optional and public-tier.
export const PUBLISHER = (import.meta.env.VITE_ARKIV_PUBLISHER as string | undefined) ?? DEFAULT_PUBLISHERS[0];
const client = createPublicClient({
  chain: rabdi({ accessKey: (import.meta.env.VITE_ARKIV_ACCESS_KEY as string | undefined) ?? "" }),
  transport: http(),
}) as any;

const DATASET_IDS: Record<DatasetKey, string> = { demo: "controlled-demo", mirror: "aave-v3-ethereum-mirror" };

/** Page through all rows (100 per page, fixed key order) and decode each JSON payload. */
async function fetchAll(schema: any, where: any): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const { entities } = await client
      .select({ payload: true }).from(schema).where(where).ownedBy(PUBLISHER)
      .orderBy(asc("$key")).limit(100).offset(offset).fetch();
    for (const e of entities) out.push(JSON.parse(hexToString(e.payload.value)));
    if (entities.length < 100) break;
  }
  return out;
}

let summariesCache: Promise<{ payload: any; publisher: string }[]> | undefined;
function listSnapshots() {
  summariesCache ??= fetchAll(Snapshot, eq("status", "complete")).then((rows) => rows.map((payload) => ({ payload, publisher: PUBLISHER })));
  return summariesCache;
}

export function resetCache() { summariesCache = undefined; }

export async function loadDataset(key: DatasetKey): Promise<DatasetView> {
  const all = (await listSnapshots()).filter((s) => s.payload.datasetId === DATASET_IDS[key]);
  const chosen = chooseSnapshots(key, all);
  if (!chosen.length) {
    throw new Error(`No completed ${key === "demo" ? "controlled-demo before/after pair" : "mainnet mirror snapshot"} from publisher ${PUBLISHER} was found on Arkiv. It may have expired or not been published yet.`);
  }
  const snaps: { raw: RawSnapshot; phase: any }[] = [];
  for (const c of chosen) {
    const sid = eq("snapshotId", c.payload.snapshotId);
    const [deployments, dependencies, coverage, results] = await Promise.all([
      fetchAll(Deployment, sid), fetchAll(Dependency, sid), fetchAll(Coverage, sid),
      c.payload.counts?.results ? fetchAll(ScenarioResult, sid) : Promise.resolve([]),
    ]);
    snaps.push({ phase: c.phase, raw: { summary: c.payload, publisher: c.publisher, deployments, dependencies, coverage, results } });
  }
  return buildDataset(key, snaps);
}
