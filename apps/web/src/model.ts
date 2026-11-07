import type {
  CoverageRecord, DependencyRecord, DeploymentRecord, ScenarioResultRecord,
} from "@importer/types.ts";
import type { DatasetKey, DatasetView, Kind, SnapshotPhase, SnapshotView, UIEdge, UINode } from "./types.ts";

/** Everything Arkiv returned for one completed snapshot. */
export interface RawSnapshot {
  summary: any; // the snapshot entity's JSON payload
  publisher: string;
  deployments: DeploymentRecord[];
  dependencies: DependencyRecord[];
  coverage: CoverageRecord[];
  results: ScenarioResultRecord[];
}

const DEMO_LABELS: Record<string, string> = {
  "vault-a": "Vault A", "vault-b": "Vault B", "vault-c": "Vault C",
  "beacon-shared": "Shared beacon", "beacon-c": "Beacon C",
  "impl-v1": "VaultV1", "impl-c": "VaultV1 (C)", "impl-v2-paused": "VaultV2Paused",
  "owner-shared-beacon": "Owner of shared beacon", "owner-beacon-c": "Owner of beacon C",
};

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const edgeId = (from: string, to: string, relation: string) => `${from}>${to}:${relation}`;
const isToken = (role: string) => /_(A|V)_TOKEN$/.test(role);

export function toEdges(snap: RawSnapshot, mode: "scenario" | "registry"): UIEdge[] {
  const edges: UIEdge[] = snap.dependencies.map((d) => ({
    id: edgeId(d.source, d.target, d.relation), from: d.source, to: d.target, relation: d.relation,
    adapter: d.adapterId, adapterVersion: d.adapterVersion, basis: d.basis,
    call: d.evidence.kind === "storage-slot" ? `getStorageAt(source, ${d.evidence.slot})` : (d.evidence.call ?? ""),
    raw: d.evidence.raw, block: d.block, evidenceHash: d.evidenceHash,
  }));
  if (mode === "scenario") {
    for (const r of snap.results) {
      edges.push({
        id: edgeId(`pos:${r.address}`, r.address, "holds"), from: `pos:${r.address}`, to: r.address, relation: "holds",
        adapter: "scenario-deposit", adapterVersion: "1", basis: "scenario execution",
        call: `balances(${r.user})`, raw: `${r.positionBefore} wei before the withdrawal attempt`,
      });
    }
  }
  return edges;
}

/** Decide what each node is from the relationships actually observed, never from its registry name alone. */
export function buildNodes(snaps: RawSnapshot[], edgesBySnap: UIEdge[][], mode: "scenario" | "registry"): UINode[] {
  const dep = new Map<string, DeploymentRecord>();
  const cov = new Map<string, CoverageRecord>();
  for (const s of snaps) {
    for (const d of s.deployments) dep.set(d.address, d);
    for (const c of s.coverage) cov.set(c.address, c);
  }
  const all = edgesBySnap.flat();
  const targetsOf = (rel: string) => new Set(all.filter((e) => e.relation === rel).map((e) => e.to));
  const owners = targetsOf("beacon-owner");
  const beacons = targetsOf("beacon-slot");
  const impls = new Set([...targetsOf("implementation-slot"), ...targetsOf("beacon-implementation")]);
  const hasOut = new Set(all.map((e) => e.from));
  const connected = new Set(all.flatMap((e) => [e.from, e.to]));

  const nodes: UINode[] = [];
  const kindOf = (d: DeploymentRecord): Kind => {
    if (owners.has(d.address)) return "authority";
    if (beacons.has(d.address)) return "beacon";
    if (impls.has(d.address)) return "implementation";
    if (mode === "registry" && isToken(d.role)) return "position";
    if (hasOut.has(d.address)) return "vault";
    return "unknown";
  };
  const labelOf = (d: DeploymentRole) =>
    mode === "scenario" ? DEMO_LABELS[d.role] ?? shortAddr(d.address) : d.role === "discovered" ? shortAddr(d.address) : d.role;
  type DeploymentRole = Pick<DeploymentRecord, "role" | "address">;

  for (const d of dep.values()) {
    const c = cov.get(d.address);
    nodes.push({
      id: d.address, label: labelOf(d), kind: kindOf(d), address: d.address, role: d.role, origin: d.origin,
      detail: d.origin === "observed" ? "Not in the registry; found as the target of an observed edge"
        : d.origin === "scenario" ? "Controlled-demo contract" : `Registry name ${d.role}`,
      coverage: c ? { status: c.status, notes: c.notes, attempted: c.attempted } : undefined,
      upstream: d.upstream, visible: mode === "scenario" ? true : connected.has(d.address), x: 0, y: 0,
    });
  }
  if (mode === "scenario") {
    const users = new Map<string, string>();
    for (const s of snaps) for (const r of s.results) users.set(r.address, r.label);
    for (const [vault, label] of users) {
      nodes.push({
        id: `pos:${vault}`, label: label.replace("Vault", "Position"), kind: "position", address: vault,
        role: "position", origin: "scenario", detail: `Test user's deposit in ${label}`, visible: true, x: 0, y: 0,
      });
    }
  }
  layout(nodes, all, mode);
  return nodes.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

const COLS: Record<Kind, number> = { position: -360, vault: -200, beacon: -20, implementation: 160, authority: 320, unknown: 480 };
const ROW_GAP = { scenario: 58, registry: 38 };

/**
 * Deterministic layered layout: one column per kind, no randomness. Columns are ordered from the dependency side
 * back to the dependent side, and each node sits at the row of the first thing it depends on, which keeps lines short.
 */
export function layout(nodes: UINode[], edges: UIEdge[], mode: "scenario" | "registry" = "registry") {
  const DY = ROW_GAP[mode];
  const firstTarget = new Map<string, string>();
  for (const e of edges) if (!firstTarget.has(e.from) || e.to < firstTarget.get(e.from)!) firstTarget.set(e.from, e.to);
  const byKind = new Map<Kind, UINode[]>();
  for (const n of nodes) {
    if (!n.visible) continue;
    byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);
  }
  const rank = new Map<string, number>(); // row of a node once its column is placed
  const order: Kind[] = ["unknown", "authority", "implementation", "beacon", "vault", "position"];
  for (const kind of order) {
    const list = byKind.get(kind);
    if (!list) continue;
    const key = (n: UINode) => rank.get(firstTarget.get(n.id) ?? "") ?? Number.MAX_SAFE_INTEGER;
    list.sort((a, b) => key(a) - key(b) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    list.forEach((n, i) => { n.x = COLS[kind]; n.y = (i - (list.length - 1) / 2) * DY; rank.set(n.id, n.y); });
  }
}

export function buildSnapshot(raw: RawSnapshot, phase: SnapshotPhase, mode: "scenario" | "registry"): SnapshotView {
  const s = raw.summary;
  const expected = s.counts ?? {};
  const got = {
    deployments: raw.deployments.length, dependencies: raw.dependencies.length,
    coverage: raw.coverage.length, ...(raw.results.length ? { results: raw.results.length } : {}),
  };
  const bad = (Object.keys(got) as (keyof typeof got)[]).filter((k) => expected[k] !== undefined && expected[k] !== got[k]);
  return {
    id: s.snapshotId, phase, title: phase === "baseline" ? "Baseline" : phase === "after" ? "After beacon upgrade" : "Current",
    block: s.block, completedAt: s.completedAt, expiryDays: s.expiryDays, digest: s.digest, publisher: raw.publisher,
    edges: toEdges(raw, mode), coverage: raw.coverage, results: raw.results, registry: s.registry, scenario: s.scenario,
    counts: got,
    integrity: bad.length
      ? { ok: false, message: `Arkiv returned ${bad.map((k) => `${got[k]} ${k}`).join(", ")}; the snapshot declares ${bad.map((k) => `${expected[k]}`).join(", ")}. Treat it as incomplete.` }
      : { ok: true, message: "Record counts match the snapshot manifest." },
  };
}

export function buildDataset(key: DatasetKey, snaps: { raw: RawSnapshot; phase: SnapshotPhase }[]): DatasetView {
  const mode = key === "demo" ? "scenario" : "registry";
  const views = snaps.map((s) => buildSnapshot(s.raw, s.phase, mode));
  const nodes = buildNodes(snaps.map((s) => s.raw), views.map((v) => v.edges), mode);
  return {
    key, datasetId: snaps[0].raw.summary.datasetId, mode,
    title: key === "demo" ? "Controlled demo" : "Ethereum mirror", nodes, snapshots: views,
  };
}

/** Pick which completed snapshots to show: the newest scenario pair, or the highest mainnet block. */
export function chooseSnapshots(key: DatasetKey, summaries: { payload: any; publisher: string }[]) {
  if (key === "mirror") {
    const best = [...summaries].sort((a, b) => (BigInt(b.payload.block.number) > BigInt(a.payload.block.number) ? 1 : -1))[0];
    return best ? [{ ...best, phase: "current" as SnapshotPhase }] : [];
  }
  const newestFirst = [...summaries].sort((a, b) => String(b.payload.completedAt).localeCompare(String(a.payload.completedAt)));
  for (const s of newestFirst) {
    const sc = s.payload.scenario;
    if (sc?.phase !== "after") continue;
    const base = summaries.find((x) => x.payload.snapshotId === sc.pairedSnapshot && x.payload.scenario?.phase === "baseline");
    if (base) return [{ ...base, phase: "baseline" as SnapshotPhase }, { ...s, phase: "after" as SnapshotPhase }];
  }
  return [];
}
