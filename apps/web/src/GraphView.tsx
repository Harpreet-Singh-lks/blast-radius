import { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { AFFECTED, FAIL, KIND_COLOR, REL_NAME } from "./theme.ts";
import type { Kind, UIEdge, UINode } from "./types.ts";

export interface RenderNode extends UINode { fx: number; fy: number }
export interface RenderLink { source: string; target: string; edge: UIEdge; removed: boolean; changed: boolean }

interface Props {
  nodes: RenderNode[];
  links: RenderLink[];
  reach: { nodes: Set<string>; edges: Set<string> } | null;
  affected: Set<string>;
  failed: (id: string) => boolean;
  radius: (n: UINode) => number;
  selId?: string;
  frozen: boolean;
  fitSignal: unknown;
  onPick: (id: string) => void;
  onPickEdge: (id: string) => void;
  onClear: () => void;
  registerFit: (fit: (ms: number) => void) => void;
}

/** The original dependency graph: every observed edge, drawn on a deterministic layered layout. */
export function GraphView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback((ms: number) => {
    const ns = p.nodes;
    if (!ns.length || !fg.current) return;
    const w = (n: UINode) => n.label.length * 6.6 + 30;
    const left = (n: UINode) => (n.kind === "position" ? w(n) : n.kind === "vault" || n.kind === "beacon" ? w(n) / 2 : 20);
    const right = (n: UINode) => (n.kind === "position" ? 20 : n.kind === "vault" || n.kind === "beacon" ? w(n) / 2 : w(n));
    const minX = Math.min(...ns.map((n) => n.x - left(n))), maxX = Math.max(...ns.map((n) => n.x + right(n)));
    const minY = Math.min(...ns.map((n) => n.y)) - 34, maxY = Math.max(...ns.map((n) => n.y)) + 34;
    const k = Math.min(size.w / (maxX - minX), size.h / (maxY - minY)) * 0.94;
    fg.current.centerAt((minX + maxX) / 2, (minY + maxY) / 2, ms);
    fg.current.zoom(Math.min(k, 3), ms);
  }, [p.nodes, size.w, size.h]);
  useEffect(() => { p.registerFit(fit); }, [fit]);
  useEffect(() => {
    const t = [60, 350].map((ms) => setTimeout(() => fit(0), ms));
    return () => t.forEach(clearTimeout);
  }, [fit, p.fitSignal]);

  return (
    <div className="graph-wrap" ref={wrap}>
      <ForceGraph2D
        ref={fg} width={size.w} height={size.h} graphData={{ nodes: p.nodes, links: p.links } as any}
        backgroundColor="rgba(0,0,0,0)" enableNodeDrag={!p.frozen} cooldownTicks={0} nodeRelSize={1}
        nodeLabel={() => ""}
        linkLabel={(l: any) => REL_NAME[(l as RenderLink).edge.relation] + (l.removed ? " (removed in this snapshot)" : "")}
        linkDirectionalArrowLength={6} linkDirectionalArrowRelPos={0.97}
        linkCurvature={(l: any) => ((l as RenderLink).removed ? 0.35 : 0)}
        linkColor={(l: any) => {
          const k = l as RenderLink;
          if (k.removed) return "rgba(143,160,192,.45)";
          if (k.changed) return "#FFFFFF";
          if (p.reach) return p.reach.edges.has(k.edge.id) ? "#9ADBFF" : "rgba(60,84,130,.28)";
          return "rgba(88,116,170,.62)";
        }}
        linkWidth={(l: any) => { const k = l as RenderLink; return k.changed ? 3 : p.reach?.edges.has(k.edge.id) ? 2.4 : 1.2; }}
        linkLineDash={(l: any) => ((l as RenderLink).removed ? [4, 4] : null)}
        onLinkClick={(l: any) => p.onPickEdge((l as RenderLink).edge.id)}
        onNodeClick={(n: any) => p.onPick(n.id)}
        onBackgroundClick={p.onClear}
        nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, p.radius(n) + 4, 0, 7); ctx.fill();
        }}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, scale: number) => {
          const r = p.radius(n);
          const dim = p.reach && !p.reach.nodes.has(n.id);
          ctx.save();
          ctx.globalAlpha = dim ? 0.22 : 1;
          ctx.shadowColor = KIND_COLOR[n.kind as Kind]; ctx.shadowBlur = dim ? 0 : 10;
          ctx.fillStyle = KIND_COLOR[n.kind as Kind];
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
          ctx.shadowBlur = 0; ctx.fillStyle = "rgba(10,18,38,.55)";
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.62, 0, 7); ctx.fill();
          const f = p.failed(n.id), a = p.affected.has(n.id);
          if (f || a) { ctx.lineWidth = 2.5; ctx.strokeStyle = f ? FAIL : AFFECTED; ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, 7); ctx.stroke(); }
          if (p.selId === n.id) { ctx.lineWidth = 1.5; ctx.strokeStyle = "#E6ECF8"; ctx.beginPath(); ctx.arc(n.x, n.y, r + 9, 0, 7); ctx.stroke(); }
          const fs = Math.max(10, 12 / Math.sqrt(scale));
          ctx.font = `500 ${fs}px "Familjen Grotesk", sans-serif`;
          const above = n.kind === "vault" || n.kind === "beacon";
          ctx.textBaseline = above ? "bottom" : "middle";
          ctx.textAlign = n.kind === "position" ? "right" : above ? "center" : "left";
          ctx.fillStyle = "#E6ECF8";
          const lx = n.kind === "position" ? n.x - r - 8 : above ? n.x : n.x + r + 8;
          const ly = above ? n.y - r - 6 : n.y;
          ctx.fillText(n.label, lx, ly);
          if (f || a) { ctx.textBaseline = "top"; ctx.fillStyle = f ? FAIL : AFFECTED; ctx.fillText(f ? "withdraw reverts" : "potentially affected", lx, above ? n.y + r + 6 : n.y + fs / 2 + 2); }
          ctx.restore();
        }}
      />
    </div>
  );
}
