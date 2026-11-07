import type { Kind, UIEdge, UINode } from "./types.ts";

/** node id -> path of edges. For a position centre: centre to node. For a dependency centre: dependent to centre. */
export type Members = Map<string, UIEdge[]>;
const MAX_DEPTH = 8;

/**
 * What belongs in a centre's bubbles. A position's bubbles are everything it depends on; a dependency's bubbles are the
 * positions that depend on it. Each member keeps one evidence-backed path so no bubble is unexplained.
 */
export function memberPaths(edges: UIEdge[], nodes: Map<string, UINode>, centerId: string): Members {
  const out: Members = new Map();
  const center = nodes.get(centerId);
  if (!center) return out;
  const forward = center.kind === "position";
  const adj = new Map<string, UIEdge[]>();
  for (const e of edges) {
    const k = forward ? e.from : e.to;
    adj.set(k, [...(adj.get(k) ?? []), e]);
  }
  const parent = new Map<string, UIEdge>();
  const seen = new Set([centerId]);
  let frontier = [centerId];
  for (let d = 0; d < MAX_DEPTH && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const e of adj.get(id) ?? []) {
      const n = forward ? e.to : e.from;
      if (seen.has(n)) continue;
      seen.add(n); parent.set(n, e); next.push(n);
    }
    frontier = next;
  }
  for (const id of seen) {
    if (id === centerId) continue;
    if (!forward && nodes.get(id)?.kind !== "position") continue;
    const path: UIEdge[] = [];
    let cur = id;
    while (cur !== centerId) {
      const e = parent.get(cur)!;
      if (forward) { path.unshift(e); cur = e.from; } else { path.push(e); cur = e.to; }
    }
    out.set(id, path);
  }
  return out;
}

export type Side = "left" | "shared" | "right";
export interface Bubble {
  id: string;
  node: UINode;
  side: Side;
  state: "present" | "new" | "removed";
  pathL: UIEdge[] | null;
  pathR: UIEdge[] | null;
}

const KIND_ORDER: Kind[] = ["position", "vault", "beacon", "implementation", "authority", "unknown"];
const byKindThenLabel = (a: Bubble, b: Bubble) =>
  KIND_ORDER.indexOf(a.node.kind) - KIND_ORDER.indexOf(b.node.kind) ||
  a.node.label.localeCompare(b.node.label, undefined, { numeric: true });

/** Split two centres' members into only-left, shared and only-right. `prev` adds ghosts for removed members and flags new ones. */
export function compareSets(
  L: Members, R: Members, nodes: Map<string, UINode>, centers: [string, string],
  prev?: { L: Members; R: Members },
): { left: Bubble[]; shared: Bubble[]; right: Bubble[] } {
  const skip = new Set(centers);
  const out = { left: [] as Bubble[], shared: [] as Bubble[], right: [] as Bubble[] };
  const ids = new Set([...L.keys(), ...R.keys()].filter((i) => !skip.has(i)));
  const prevIds = prev ? new Set([...prev.L.keys(), ...prev.R.keys()].filter((i) => !skip.has(i))) : undefined;
  const push = (id: string, l: Members, r: Members, state: Bubble["state"]) => {
    const node = nodes.get(id);
    if (!node) return;
    const inL = l.has(id), inR = r.has(id);
    out[inL && inR ? "shared" : inL ? "left" : "right"].push({
      id, node, side: inL && inR ? "shared" : inL ? "left" : "right", state,
      pathL: l.get(id) ?? null, pathR: r.get(id) ?? null,
    });
  };
  for (const id of ids) push(id, L, R, prevIds && !prevIds.has(id) ? "new" : "present");
  if (prev && prevIds) for (const id of prevIds) if (!ids.has(id)) push(id, prev.L, prev.R, "removed");
  for (const k of ["left", "shared", "right"] as const) out[k].sort(byKindThenLabel);
  return out;
}

// ---- geometry for the double bubble map (viewBox 1200 x 760) ----
export const VIEW = { w: 1000, h: 600 };
export const CAP = { unique: 10, shared: 7 };
export interface Shape { x: number; y: number; rx: number; ry: number }
export interface DoubleLayout { left: Shape[]; shared: Shape[]; right: Shape[]; centerL: Shape; centerR: Shape }

export const CY = 326;
export const COLX = { left: 285, shared: 500, right: 715 };
const CXL = COLX.left, CXR = COLX.right, CXS = COLX.shared;

function arc(n: number, side: "left" | "right"): Shape[] {
  if (n === 0) return [];
  const ry = n <= 4 ? 42 : n <= 8 ? 36 : 30;
  const rx = ry * 1.3;
  const step = n === 1 ? 0 : Math.min(32, 220 / (n - 1));
  const cx = side === "left" ? CXL : CXR;
  const R = n <= 8 ? 200 : 230; // crowded sides use a wider arc so neighbours at the top and bottom do not touch
  return Array.from({ length: n }, (_, i) => {
    const o = ((i - (n - 1) / 2) * step * Math.PI) / 180;
    return { x: cx + (side === "left" ? -1 : 1) * R * Math.cos(o), y: CY + R * Math.sin(o), rx, ry };
  });
}

export function doubleBubbleLayout(nl: number, ns: number, nr: number): DoubleLayout {
  // callers show at most CAP entries plus one "more" bubble, so size everything for that
  const sharedN = Math.min(ns, CAP.shared + 1);
  const ry = sharedN <= 6 ? 34 : 28;
  const gap = sharedN <= 1 ? 0 : Math.min(88, 480 / sharedN);
  const shared = Array.from({ length: sharedN }, (_, i) => ({ x: CXS, y: CY + (i - (sharedN - 1) / 2) * gap, rx: 84, ry }));
  return {
    left: arc(Math.min(nl, CAP.unique + 1), "left"), shared, right: arc(Math.min(nr, CAP.unique + 1), "right"),
    centerL: { x: CXL, y: CY, rx: 78, ry: 56 }, centerR: { x: CXR, y: CY, rx: 78, ry: 56 },
  };
}

/** Greedy wrap at underscores and spaces; at most `maxLines`, last line ellipsised. */
export function wrapLabel(label: string, maxChars: number, maxLines = 3): string[] {
  const parts = label.match(/[^_\s]+[_\s]?/g) ?? [label];
  const lines: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && (cur + p).trim().length > maxChars) { lines.push(cur.trim()); cur = ""; }
    cur += p;
  }
  if (cur) lines.push(cur.trim());
  const hard = lines.flatMap((l) => (l.length > maxChars ? l.match(new RegExp(`.{1,${maxChars}}`, "g"))! : [l]));
  if (hard.length <= maxLines) return hard;
  const cut = hard.slice(0, maxLines);
  cut[maxLines - 1] = cut[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + "…";
  return cut;
}
