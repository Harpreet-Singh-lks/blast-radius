export type Hex = `0x${string}`;
export type Relation = "implementation-slot" | "beacon-slot" | "beacon-implementation" | "beacon-owner";
export type CoverageStatus =
  | "edges-found"
  | "no-supported-pattern"
  | "no-code"
  | "not-inspected"
  | "error";

export interface Evidence {
  kind: "storage-slot" | "call";
  slot?: Hex;
  call?: string;
  raw: Hex;
}

export interface EdgeDraft {
  source: Hex; // dependent
  target: Hex; // dependency
  relation: Relation;
  adapterId: string;
  adapterVersion: string;
  evidence: Evidence;
}

export interface Observation {
  edges: EdgeDraft[];
  attempted: string[];
  notes: string[];
  status: CoverageStatus;
}

export interface Reader {
  blockNumber: bigint;
  blockHash: Hex;
  getStorageAt(address: Hex, slot: Hex): Promise<Hex>;
  getCode(address: Hex): Promise<Hex | undefined>;
  call(to: Hex, data: Hex): Promise<Hex>;
}

// ---- manifest records (the JSON payload of each Arkiv entity) ----
export interface DeploymentRecord {
  type: "deployment";
  logicalId: string;
  datasetId: string;
  chainId: number;
  address: Hex;
  origin: "registry" | "observed" | "scenario";
  protocol: string;
  role: string; // registry constant name, or "discovered"
  aliases: string[];
  group: string;
  upstream?: { repo: string; commit: string; path: string; line: number; license: string; licenseUrl: string };
}

export interface DependencyRecord {
  type: "dependency";
  logicalId: string;
  datasetId: string;
  chainId: number;
  snapshotId: string;
  source: Hex;
  target: Hex;
  relation: Relation;
  adapterId: string;
  adapterVersion: string;
  basis: "observed state";
  block: { number: string; hash: Hex };
  evidence: Evidence;
  evidenceHash: string;
}

export interface CoverageRecord {
  type: "coverage";
  logicalId: string;
  datasetId: string;
  chainId: number;
  snapshotId: string;
  address: Hex;
  status: CoverageStatus;
  attempted: string[];
  notes: string[];
}

export interface ScenarioResultRecord {
  type: "scenario_result";
  logicalId: string;
  datasetId: string;
  chainId: number;
  snapshotId: string;
  scenarioId: string;
  phase: "baseline" | "after";
  address: Hex; // the vault whose withdrawal was attempted
  label: string;
  user: Hex;
  outcome: "succeeded" | "reverted";
  expected: "succeeded" | "reverted";
  call: { from: Hex; to: Hex; data: Hex; value: string };
  ethCall: { ok: boolean; returnData?: Hex; revertData?: Hex; decodedError?: string };
  tx: { hash: Hex; status: "success" | "reverted"; gasUsed: string; blockNumber: string };
  implementationInEffect: Hex;
  positionBefore: string;
  positionAfter: string;
}

export interface SnapshotManifest {
  manifestVersion: 1;
  datasetId: string;
  chainId: number;
  snapshotId: string;
  block: { number: string; hash: Hex; timestamp: string };
  registry?: {
    repo: string; commit: string; path: string; fileSha256: string;
    license: string; licenseHolder: string; licenseUrl: string;
    scope: { core: true; assets: string[] | "all" };
  };
  importer: { version: string };
  counts: { deployments: number; dependencies: number; coverage: number; results?: number; registryRecords: number; inspected: number; unsupported: number };
  digest: string;
  createdAt: string;
  deployments: DeploymentRecord[];
  dependencies: DependencyRecord[];
  coverage: CoverageRecord[];
  results?: ScenarioResultRecord[];
  scenario?: Record<string, unknown>;
}
