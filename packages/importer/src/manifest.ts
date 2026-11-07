import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { CHAIN_ID, DATASET_ID, IMPORTER_VERSION, LICENSE, REGISTRY_PATH, REPO } from "./config.ts";
import { observeContract } from "./adapters.ts";
import type { RegistryEntry, RegistrySource } from "./registry.ts";
import type {
  CoverageRecord, DependencyRecord, DeploymentRecord, Hex, Reader, SnapshotManifest,
} from "./types.ts";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Deterministic JSON: object keys sorted recursively. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export const logicalId = (...parts: (string | number)[]) => sha256(parts.join("|"));
export const makeSnapshotId = (number: bigint, hash: Hex) => `${number}-${hash.slice(2, 12)}`;

export function digestOf(m: Pick<SnapshotManifest, "deployments" | "dependencies" | "coverage" | "results">): string {
  const byId = <T extends { logicalId: string }>(xs: T[]) => [...xs].sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  const core = { d: byId(m.deployments), e: byId(m.dependencies), c: byId(m.coverage) };
  return sha256(canonical(m.results?.length ? { ...core, r: byId(m.results) } : core));
}

export async function buildManifest(args: {
  entries: RegistryEntry[]; source: RegistrySource; commit: string; reader: Reader;
  blockTimestamp: bigint; assets: string[] | "all"; log?: (s: string) => void;
}): Promise<SnapshotManifest> {
  const { entries, source, commit, reader, assets } = args;
  const log = args.log ?? (() => {});
  const snapshotId = makeSnapshotId(reader.blockNumber, reader.blockHash);
  const license = LICENSE.url(commit);

  // one deployment per address; extra registry names become aliases
  const byAddr = new Map<Hex, RegistryEntry[]>();
  for (const e of entries) byAddr.set(e.address, [...(byAddr.get(e.address) ?? []), e]);
  const registryAddrs = [...byAddr.keys()].sort();

  const deployments: DeploymentRecord[] = registryAddrs.map((address) => {
    const es = byAddr.get(address)!;
    return {
      type: "deployment", logicalId: logicalId("deployment", DATASET_ID, CHAIN_ID, address),
      datasetId: DATASET_ID, chainId: CHAIN_ID, address, origin: "registry", protocol: "aave-v3",
      role: es[0].role, aliases: es.slice(1).map((x) => x.role), group: es[0].group,
      upstream: { repo: REPO, commit, path: REGISTRY_PATH, line: es[0].line, license: LICENSE.spdx, licenseUrl: license },
    };
  });

  const dependencies = new Map<string, DependencyRecord>();
  const coverage: CoverageRecord[] = [];
  const discovered = new Set<Hex>();
  let done = 0;

  await Promise.all(registryAddrs.map(async (address) => {
    const obs = await observeContract(reader, address);
    for (const e of obs.edges) {
      const id = logicalId("dependency", DATASET_ID, CHAIN_ID, e.source, e.target, e.relation, snapshotId);
      if (!dependencies.has(id)) {
        dependencies.set(id, {
          type: "dependency", logicalId: id, datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId,
          source: e.source, target: e.target, relation: e.relation,
          adapterId: e.adapterId, adapterVersion: e.adapterVersion, basis: "observed state",
          block: { number: reader.blockNumber.toString(), hash: reader.blockHash },
          evidence: e.evidence, evidenceHash: sha256(canonical(e.evidence)),
        });
      }
      for (const end of [e.source, e.target]) if (!byAddr.has(end)) discovered.add(end);
    }
    coverage.push({
      type: "coverage", logicalId: logicalId("coverage", DATASET_ID, CHAIN_ID, address, snapshotId),
      datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId, address,
      status: obs.status, attempted: obs.attempted, notes: obs.notes,
    });
    if (++done % 20 === 0) log(`  inspected ${done}/${registryAddrs.length}`);
  }));

  // edge endpoints that the registry does not list stay visible as observed-only nodes
  for (const address of [...discovered].sort()) {
    deployments.push({
      type: "deployment", logicalId: logicalId("deployment", DATASET_ID, CHAIN_ID, address),
      datasetId: DATASET_ID, chainId: CHAIN_ID, address, origin: "observed", protocol: "aave-v3",
      role: "discovered", aliases: [], group: "observed",
    });
    coverage.push({
      type: "coverage", logicalId: logicalId("coverage", DATASET_ID, CHAIN_ID, address, snapshotId),
      datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId, address, status: "not-inspected",
      attempted: [], notes: ["found as an edge endpoint; not itself inspected"],
    });
  }

  deployments.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  coverage.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  const deps = [...dependencies.values()].sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  const inspected = coverage.filter((c) => c.status !== "not-inspected").length;
  const unsupported = coverage.filter((c) => c.status === "no-supported-pattern" || c.status === "no-code").length;

  const manifest: SnapshotManifest = {
    manifestVersion: 1, datasetId: DATASET_ID, chainId: CHAIN_ID, snapshotId,
    block: { number: reader.blockNumber.toString(), hash: reader.blockHash, timestamp: args.blockTimestamp.toString() },
    registry: {
      repo: REPO, commit, path: REGISTRY_PATH, fileSha256: source.sha256, license: LICENSE.spdx,
      licenseHolder: LICENSE.holder, licenseUrl: license, scope: { core: true, assets },
    },
    importer: { version: IMPORTER_VERSION },
    counts: {
      deployments: deployments.length, dependencies: deps.length, coverage: coverage.length,
      registryRecords: registryAddrs.length, inspected, unsupported,
    },
    digest: "", createdAt: new Date().toISOString(), deployments, dependencies: deps, coverage,
  };
  manifest.digest = digestOf(manifest);
  return manifest;
}

export const checksum = (a: Hex) => getAddress(a);
