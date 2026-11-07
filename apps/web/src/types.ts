import type { CoverageRecord, Relation, ScenarioResultRecord } from "@importer/types.ts";

export type Kind = "position" | "vault" | "beacon" | "implementation" | "authority" | "unknown";
export type UIRelation = Relation | "holds";
export type DatasetKey = "demo" | "mirror";
export type SnapshotPhase = "baseline" | "after" | "current";

export interface UINode {
  id: string; // lowercase address, or "pos:<vault>" for a derived position
  label: string;
  kind: Kind;
  address: string;
  role: string;
  detail: string;
  origin: string;
  coverage?: Pick<CoverageRecord, "status" | "notes" | "attempted">;
  upstream?: { repo: string; commit: string; path: string; line: number; license: string; licenseUrl: string };
  visible: boolean;
  x: number;
  y: number;
}

export interface UIEdge {
  id: string;
  from: string; // dependent
  to: string; // dependency
  relation: UIRelation;
  adapter: string;
  adapterVersion: string;
  basis: string;
  call: string;
  raw: string;
  block?: { number: string; hash: string };
  evidenceHash?: string;
}

export interface SnapshotView {
  id: string;
  phase: SnapshotPhase;
  title: string;
  block: { number: string; hash: string; timestamp: string };
  completedAt?: string;
  expiryDays?: number;
  digest: string;
  publisher: string;
  edges: UIEdge[];
  coverage: CoverageRecord[];
  results: ScenarioResultRecord[];
  registry?: { repo: string; commit: string; path: string; license: string; licenseHolder: string; licenseUrl: string };
  scenario?: Record<string, any>;
  counts: { deployments: number; dependencies: number; coverage: number; results?: number };
  integrity: { ok: boolean; message: string };
}

export interface DatasetView {
  key: DatasetKey;
  datasetId: string;
  title: string;
  mode: "scenario" | "registry";
  nodes: UINode[];
  snapshots: SnapshotView[];
}
