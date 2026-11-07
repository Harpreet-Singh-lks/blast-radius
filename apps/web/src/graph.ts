import type { UIEdge as Edge, UINode as GNode } from "./types.ts";

export interface Reach {
  nodes: Set<string>;
  edges: Set<string>;
  /** one evidence-backed path (edge ids, dependent to dependency) per reached position */
  paths: Map<string, Edge[]>;
}

const MAX_DEPTH = 8;

/** Reverse traversal: what depends on `start`? Visited set prevents double counting. */
export function reverseReach(edges: Edge[], nodes: Map<string, GNode>, start: string): Reach {
  const incoming = new Map<string, Edge[]>();
  for (const e of edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
  const out: Reach = { nodes: new Set([start]), edges: new Set(), paths: new Map() };
  const parent = new Map<string, Edge>();
  let frontier = [start];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of incoming.get(id) ?? []) {
        out.edges.add(e.id);
        if (out.nodes.has(e.from)) continue;
        out.nodes.add(e.from);
        parent.set(e.from, e);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  for (const id of out.nodes) {
    if (nodes.get(id)?.kind !== "position" || id === start) continue;
    const path: Edge[] = [];
    let cur = id;
    while (cur !== start && parent.has(cur)) {
      const e = parent.get(cur)!;
      path.push(e);
      cur = e.to;
    }
    out.paths.set(id, path);
  }
  return out;
}

/** Forward traversal: what does `start` depend on? */
export function forwardReach(edges: Edge[], start: string): Reach {
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
  const out: Reach = { nodes: new Set([start]), edges: new Set(), paths: new Map() };
  let frontier = [start];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of outgoing.get(id) ?? []) {
        out.edges.add(e.id);
        if (out.nodes.has(e.to)) continue;
        out.nodes.add(e.to);
        next.push(e.to);
      }
    }
    frontier = next;
  }
  return out;
}

/** Unique supported positions that depend on each node. A position counts as one. */
export function dependentCounts(edges: Edge[], nodes: GNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind === "position") { counts.set(n.id, 1); continue; }
    const r = reverseReach(edges, byId, n.id);
    counts.set(n.id, [...r.nodes].filter((id) => byId.get(id)?.kind === "position").length);
  }
  return counts;
}

export function diffEdges(before: Edge[], after: Edge[]) {
  const b = new Set(before.map((e) => e.id));
  const a = new Set(after.map((e) => e.id));
  return {
    added: after.filter((e) => !b.has(e.id)),
    removed: before.filter((e) => !a.has(e.id)),
  };
}

export const shortAddr = (x: string) => `${x.slice(0, 6)}…${x.slice(-4)}`;
