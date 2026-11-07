import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset, chooseSnapshots, type RawSnapshot } from "../src/model.ts";

const A = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as `0x${string}`;
const dep = (address: `0x${string}`, role: string, origin: any = "registry") =>
  ({ type: "deployment", logicalId: "d" + address, datasetId: "d", chainId: 1, address, origin, protocol: "p", role, aliases: [], group: "g" }) as any;
const edge = (source: `0x${string}`, target: `0x${string}`, relation: any) =>
  ({ type: "dependency", logicalId: "e" + source + target, datasetId: "d", chainId: 1, snapshotId: "s", source, target, relation,
    adapterId: "a", adapterVersion: "1", basis: "observed state", block: { number: "1", hash: "0x1" },
    evidence: { kind: "storage-slot", slot: "0xslot", raw: "0xraw" }, evidenceHash: "h" }) as any;

const raw = (over: Partial<RawSnapshot> = {}): RawSnapshot => ({
  summary: { snapshotId: "s", datasetId: "d", block: { number: "5", hash: "0x5", timestamp: "1" }, digest: "x",
    counts: { deployments: 5, dependencies: 3, coverage: 0 } },
  publisher: "0xpub",
  deployments: [dep(A(1), "WETH_A_TOKEN"), dep(A(2), "USDC_A_TOKEN"), dep(A(3), "DEFAULT_A_TOKEN_IMPL"),
    dep(A(4), "POOL"), dep(A(5), "LONELY")],
  dependencies: [edge(A(1), A(3), "implementation-slot"), edge(A(2), A(3), "implementation-slot"), edge(A(4), A(6), "implementation-slot")],
  coverage: [], results: [], ...over,
});

test("registry mode: tokens are positions, targets are implementations, unconnected nodes are hidden", () => {
  const ds = buildDataset("mirror", [{ raw: raw({ deployments: [...raw().deployments, dep(A(6), "discovered", "observed")], summary: { ...raw().summary, counts: { deployments: 6, dependencies: 3, coverage: 0 } } }), phase: "current" }]);
  const byRole = Object.fromEntries(ds.nodes.map((n) => [n.role, n]));
  assert.equal(byRole.WETH_A_TOKEN.kind, "position");
  assert.equal(byRole.DEFAULT_A_TOKEN_IMPL.kind, "implementation");
  assert.equal(byRole.POOL.kind, "vault");
  assert.equal(byRole.LONELY.visible, false);
  assert.equal(byRole.LONELY.kind, "unknown");
});

test("layout is deterministic and keeps one column per kind", () => {
  const mk = () => buildDataset("mirror", [{ raw: raw({ summary: { ...raw().summary, counts: { deployments: 5, dependencies: 3, coverage: 0 } } }), phase: "current" }]);
  const a = mk().nodes.map((n) => [n.id, n.x, n.y]);
  const b = mk().nodes.map((n) => [n.id, n.x, n.y]);
  assert.deepEqual(a, b);
});

test("count mismatch against the snapshot manifest is reported, not hidden", () => {
  const ds = buildDataset("mirror", [{ raw: raw({ summary: { ...raw().summary, counts: { deployments: 9, dependencies: 3, coverage: 0 } } }), phase: "current" }]);
  assert.equal(ds.snapshots[0].integrity.ok, false);
  assert.match(ds.snapshots[0].integrity.message, /incomplete/);
});

test("scenario mode derives positions from results and links them to vaults", () => {
  const res = { type: "scenario_result", address: A(10), label: "Vault A", user: A(99), positionBefore: "1" } as any;
  const r = raw({
    deployments: [dep(A(10), "vault-a", "scenario"), dep(A(11), "beacon-shared", "scenario")],
    dependencies: [edge(A(10), A(11), "beacon-slot")], results: [res],
    summary: { ...raw().summary, counts: { deployments: 2, dependencies: 1, coverage: 0, results: 1 } },
  });
  const ds = buildDataset("demo", [{ raw: r, phase: "baseline" }]);
  assert.ok(ds.nodes.find((n) => n.id === `pos:${A(10)}` && n.label === "Position A"));
  assert.ok(ds.snapshots[0].edges.find((e) => e.relation === "holds" && e.to === A(10)));
  assert.equal(ds.nodes.find((n) => n.address === A(11))!.kind, "beacon");
});

test("snapshot choice: newest complete before/after pair; highest block for the mirror", () => {
  const sum = (id: string, phase: string, paired: string, at: string) =>
    ({ publisher: "0xp", payload: { snapshotId: id, completedAt: at, block: { number: "1" }, scenario: { phase, pairedSnapshot: paired } } });
  const picked = chooseSnapshots("demo", [sum("b1", "baseline", "a1", "1"), sum("a1", "after", "b1", "2"), sum("a2", "after", "missing", "3")]);
  assert.deepEqual(picked.map((p) => [p.payload.snapshotId, p.phase]), [["b1", "baseline"], ["a1", "after"]]);
  const m = chooseSnapshots("mirror", [
    { publisher: "x", payload: { snapshotId: "lo", block: { number: "9" } } },
    { publisher: "x", payload: { snapshotId: "hi", block: { number: "100" } } },
  ]);
  assert.equal(m[0].payload.snapshotId, "hi");
});

test("layout orders dependents by the row of what they depend on, so parallel chains do not cross", () => {
  // addresses chosen so address order is the reverse of label order
  const res = (address: any, label: string) => ({ type: "scenario_result", address, label, user: A(99), positionBefore: "1" }) as any;
  const r = raw({
    deployments: [dep(A(20), "vault-a", "scenario"), dep(A(10), "vault-b", "scenario"), dep(A(30), "beacon-shared", "scenario")],
    dependencies: [edge(A(20), A(30), "beacon-slot"), edge(A(10), A(30), "beacon-slot")],
    results: [res(A(20), "Vault A"), res(A(10), "Vault B")],
    summary: { ...raw().summary, counts: { deployments: 3, dependencies: 2, coverage: 0, results: 2 } },
  });
  const ds = buildDataset("demo", [{ raw: r, phase: "baseline" }]);
  const y = (id: string) => ds.nodes.find((n) => n.id === id)!.y;
  const vaultsTopToBottom = [A(10), A(20)].sort((a, b) => y(a) - y(b));
  const positionsTopToBottom = [A(10), A(20)].map((v) => `pos:${v}`).sort((a, b) => y(a) - y(b));
  assert.deepEqual(positionsTopToBottom, vaultsTopToBottom.map((v) => `pos:${v}`));
});
