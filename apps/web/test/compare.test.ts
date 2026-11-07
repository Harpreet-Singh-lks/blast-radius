import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP, compareSets, doubleBubbleLayout, memberPaths, wrapLabel, VIEW, type Shape } from "../src/compare.ts";
import type { UIEdge, UINode } from "../src/types.ts";

const node = (id: string, kind: UINode["kind"], label = id): UINode =>
  ({ id, label, kind, address: id, role: label, detail: "", origin: "t", visible: true, x: 0, y: 0 });
const edge = (from: string, to: string, relation: any = "beacon-slot"): UIEdge =>
  ({ id: `${from}>${to}:${relation}`, from, to, relation, adapter: "a", adapterVersion: "1", basis: "b", call: "c", raw: "r" });

// pA, pB share beacon -> impl; pC is independent
const nodes = new Map([
  node("pA", "position"), node("pB", "position"), node("pC", "position"),
  node("vA", "vault"), node("vB", "vault"), node("vC", "vault"),
  node("bS", "beacon"), node("bC", "beacon"), node("i1", "implementation"), node("iC", "implementation"),
].map((n) => [n.id, n]));
const edges = [
  edge("pA", "vA", "holds"), edge("pB", "vB", "holds"), edge("pC", "vC", "holds"),
  edge("vA", "bS"), edge("vB", "bS"), edge("vC", "bC"),
  edge("bS", "i1", "beacon-implementation"), edge("bC", "iC", "beacon-implementation"),
];

test("a position's members are everything it depends on, each with a path from the position", () => {
  const m = memberPaths(edges, nodes, "pA");
  assert.deepEqual([...m.keys()].sort(), ["bS", "i1", "vA"]);
  assert.deepEqual(m.get("i1")!.map((e) => e.id), ["pA>vA:holds", "vA>bS:beacon-slot", "bS>i1:beacon-implementation"]);
});

test("a dependency's members are only the positions that reach it, with a path to the dependency", () => {
  const m = memberPaths(edges, nodes, "bS");
  assert.deepEqual([...m.keys()].sort(), ["pA", "pB"]);
  assert.equal(m.get("pA")!.at(-1)!.to, "bS");
});

test("two positions that share a beacon: shared holds beacon and implementation, uniques hold their own vault", () => {
  const s = compareSets(memberPaths(edges, nodes, "pA"), memberPaths(edges, nodes, "pB"), nodes, ["pA", "pB"]);
  assert.deepEqual(s.shared.map((b) => b.id).sort(), ["bS", "i1"]);
  assert.deepEqual(s.left.map((b) => b.id), ["vA"]);
  assert.deepEqual(s.right.map((b) => b.id), ["vB"]);
});

test("two independent positions share nothing", () => {
  const s = compareSets(memberPaths(edges, nodes, "pA"), memberPaths(edges, nodes, "pC"), nodes, ["pA", "pC"]);
  assert.equal(s.shared.length, 0);
  assert.equal(s.left.length, 3);
  assert.equal(s.right.length, 3);
});

test("comparing against an earlier snapshot flags new members and keeps removed ones as ghosts", () => {
  const after = [...edges.filter((e) => e.id !== "bS>i1:beacon-implementation"), edge("bS", "iNew", "beacon-implementation")];
  const withNew = new Map(nodes).set("iNew", node("iNew", "implementation"));
  const cur = [memberPaths(after, withNew, "pA"), memberPaths(after, withNew, "pB")] as const;
  const prev = { L: memberPaths(edges, withNew, "pA"), R: memberPaths(edges, withNew, "pB") };
  const s = compareSets(cur[0], cur[1], withNew, ["pA", "pB"], prev);
  const state = (id: string) => s.shared.find((b) => b.id === id)?.state;
  assert.equal(state("iNew"), "new");
  assert.equal(state("i1"), "removed");
  assert.equal(state("bS"), "present");
});

// Ellipses of equal aspect ratio touch exactly when (dx/(rx1+rx2))^2 + (dy/(ry1+ry2))^2 = 1. Bounding boxes would flag
// diagonal neighbours that are visibly apart, so the test uses the ellipse metric with a small safety margin.
const overlaps = (a: Shape, b: Shape) =>
  (Math.abs(a.x - b.x) / (a.rx + b.rx)) ** 2 + (Math.abs(a.y - b.y) / (a.ry + b.ry)) ** 2 < 1.02;
for (const [nl, ns, nr] of [[0, 0, 0], [1, 1, 1], [3, 2, 5], [8, 4, 8], [12, 0, 12], [12, 8, 12], [13, 9, 13], [40, 40, 40]]) {
  test(`layout (${nl},${ns},${nr}) has no overlapping bubbles and stays inside the view`, () => {
    const l = doubleBubbleLayout(nl, ns, nr);
    const all = [l.centerL, l.centerR, ...l.left, ...l.shared, ...l.right];
    for (const s of all) {
      assert.ok(s.x - s.rx >= 0 && s.x + s.rx <= VIEW.w && s.y - s.ry >= 0 && s.y + s.ry <= VIEW.h, `inside view: ${JSON.stringify(s)}`);
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(!overlaps(all[i], all[j]), `overlap between ${JSON.stringify(all[i])} and ${JSON.stringify(all[j])}`);
    }
    assert.ok(l.left.length <= CAP.unique + 1 && l.shared.length <= CAP.shared + 1);
  });
}

test("wrapLabel breaks at underscores, caps the line count and ellipsises", () => {
  assert.deepEqual(wrapLabel("USDC_A_TOKEN", 8), ["USDC_A_", "TOKEN"]);
  assert.deepEqual(wrapLabel("Vault A", 20), ["Vault A"]);
  const long = wrapLabel("DEFAULT_VARIABLE_DEBT_TOKEN_IMPL", 10, 2);
  assert.equal(long.length, 2);
  assert.ok(long[1].endsWith("…"));
});
