import { addr, bytes, defineSchema, i32, str, u64 } from "@arkiv-network/sdk/schema";

// Indexed columns are the ones clients filter on. `payload` holds the full JSON record (<=128 KiB, not indexable).
// logicalId is a sha256 hex (64 chars) because a readable composite key can exceed the 128-byte string limit.
export const Deployment = defineSchema("blast-radius.deployment", {
  datasetId: str().indexed(),
  chainId: i32().indexed(),
  address: addr().indexed(),
  protocol: str().indexed(),
  role: str().indexed(),
  origin: str().indexed(),
  snapshotId: str().indexed(),
  logicalId: str().indexed(),
  payload: bytes(),
});

export const Dependency = defineSchema("blast-radius.dependency", {
  datasetId: str().indexed(),
  chainId: i32().indexed(),
  source: addr().indexed(),
  target: addr().indexed(),
  relation: str().indexed(),
  snapshotId: str().indexed(),
  adapterId: str().indexed(),
  logicalId: str().indexed(),
  payload: bytes(),
});

export const Coverage = defineSchema("blast-radius.coverage", {
  datasetId: str().indexed(),
  chainId: i32().indexed(),
  address: addr().indexed(),
  snapshotId: str().indexed(),
  status: str().indexed(),
  logicalId: str().indexed(),
  payload: bytes(),
});

export const Snapshot = defineSchema("blast-radius.snapshot", {
  datasetId: str().indexed(),
  chainId: i32().indexed(),
  snapshotId: str().indexed(),
  status: str().indexed(),
  blockNumber: u64().indexed(),
  blockHash: str().indexed(),
  digest: str().indexed(),
  payload: bytes(),
});

export const ScenarioResult = defineSchema("blast-radius.scenario-result", {
  datasetId: str().indexed(),
  chainId: i32().indexed(),
  scenarioId: str().indexed(),
  phase: str().indexed(),
  address: addr().indexed(),
  outcome: str().indexed(),
  snapshotId: str().indexed(),
  logicalId: str().indexed(),
  payload: bytes(),
});
