import { useState } from "react";
import { CAP, COLX, CY, doubleBubbleLayout, VIEW, wrapLabel, type Bubble, type Shape } from "./compare.ts";
import { FAIL, KIND_COLOR, KIND_NAME } from "./theme.ts";
import { shortAddr } from "./model.ts";
import type { UINode } from "./types.ts";

export type Side = "left" | "shared" | "right";
interface Item { id: string; side: Side; bubble?: Bubble; more?: number }

interface Props {
  left: UINode;
  right: UINode;
  unit: "dependencies" | "positions";
  positionWord: string; // singular, e.g. "position" or "reserve token"
  bubbles: { left: Bubble[]; shared: Bubble[]; right: Bubble[] };
  selectedId?: string | null;
  failed: (id: string) => boolean;
  onPick: (id: string) => void;
  onMore: (side: Side) => void;
}

const BG = "#0B1220";
const clip = (t: string, n = 34) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const tint = (c: string, pct = 22) => `color-mix(in srgb, ${c} ${pct}%, ${BG})`;

function items(list: Bubble[], side: Side, cap: number): Item[] {
  // one more than the cap still fits, so a "1 more" bubble is never used where the real one would fit
  if (list.length <= cap + 1) return list.map((b) => ({ id: b.id, side, bubble: b }));
  const shown: Item[] = list.slice(0, cap).map((b) => ({ id: b.id, side, bubble: b }));
  shown.push({ id: `more:${side}`, side, more: list.length - cap });
  return shown;
}

function Label(p: { text: string; shape: Shape; size: number; weight?: number; fill?: string }) {
  const maxChars = Math.max(5, Math.floor((p.shape.rx * 2 * 0.8) / (p.size * 0.56)));
  const lines = wrapLabel(p.text, maxChars, p.shape.ry >= 40 ? 3 : 2);
  const lh = p.size * 1.18;
  return (
    <text textAnchor="middle" fontSize={p.size} fontWeight={p.weight ?? 500} fill={p.fill ?? "#E8EEFA"}>
      {lines.map((l, i) => <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * lh + p.size * 0.35}>{l}</tspan>)}
    </text>
  );
}

export function CompareMap(p: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const L = items(p.bubbles.left, "left", CAP.unique);
  const S = items(p.bubbles.shared, "shared", CAP.shared);
  const R = items(p.bubbles.right, "right", CAP.unique);
  const lay = doubleBubbleLayout(L.length, S.length, R.length);
  const shape = (side: Side, i: number) => (side === "left" ? lay.left : side === "right" ? lay.right : lay.shared)[i];
  const focus = hover ?? p.selectedId ?? null;
  const centerIds = [p.left.id, p.right.id];

  const lineState = (id: string, toCenter: string) => {
    if (!focus) return "base";
    if (focus === id || focus === toCenter) return "hot";
    return "dim";
  };

  const all: (Item & { s: Shape; i: number })[] = [
    ...L.map((it, i) => ({ ...it, s: shape("left", i), i })),
    ...S.map((it, i) => ({ ...it, s: shape("shared", i), i })),
    ...R.map((it, i) => ({ ...it, s: shape("right", i), i })),
  ];

  const word = p.unit === "dependencies" ? ["dependency", "dependencies"] : [p.positionWord, `${p.positionWord}s`];
  const sub = (list: Bubble[]) => {
    const live = list.filter((b) => b.state !== "removed").length;
    const gone = list.length - live;
    return `${live} ${live === 1 ? word[0] : word[1]}${gone ? `, ${gone} removed` : ""}`;
  };
  const leftFailed = p.failed(p.left.id), rightFailed = p.failed(p.right.id);

  // crop the drawing to its content: captions sit just above the topmost bubble, and nothing below the lowest label is kept
  const shapes = [lay.centerL, lay.centerR, ...all.map((a) => a.s)];
  const top = Math.min(...shapes.map((s) => s.y - s.ry));
  const bottom = Math.max(...shapes.map((s) => s.y + s.ry)) + 40;
  const vbY = Math.max(0, Math.min(top - 78, 300));
  const vbH = Math.min(VIEW.h - vbY, Math.max(300, bottom - vbY));
  const capY = vbY + 30;

  return (
    <svg
      className="compare" viewBox={`0 ${vbY} ${VIEW.w} ${vbH}`} preserveAspectRatio="xMidYMid meet" role="group"
      aria-label={`Comparison of ${p.left.label} and ${p.right.label}: ${p.bubbles.shared.length} shared, ${p.bubbles.left.length} only ${p.left.label}, ${p.bubbles.right.length} only ${p.right.label}`}
    >
      {/* column captions state counts, so a reader can see "how many are independent" without counting bubbles */}
      <g className="captions">
        <text x={20} y={capY} className="cap-title" textAnchor="start"><title>{p.left.label}</title>Only {clip(p.left.label)}</text>
        <text x={20} y={capY + 20} className="cap-sub" textAnchor="start">{sub(p.bubbles.left)}</text>
        <text x={COLX.shared} y={capY} className="cap-title" textAnchor="middle">Shared by both</text>
        <text x={COLX.shared} y={capY + 20} className="cap-sub" textAnchor="middle">{sub(p.bubbles.shared)}</text>
        <text x={VIEW.w - 20} y={capY} className="cap-title" textAnchor="end"><title>{p.right.label}</title>Only {clip(p.right.label)}</text>
        <text x={VIEW.w - 20} y={capY + 20} className="cap-sub" textAnchor="end">{sub(p.bubbles.right)}</text>
      </g>

      {p.bubbles.shared.every((b) => b.state === "removed") && (
        <g textAnchor="middle" className="empty-mid">
          <text x={COLX.shared} y={CY - 6} className="empty-title">Nothing shared</text>
          <text x={COLX.shared} y={CY + 16} className="empty-sub">
            {p.unit === "dependencies" ? "No common dependency in this snapshot" : `No ${p.positionWord} depends on both`}
          </text>
        </g>
      )}

      {/* lines first, so bubbles cover their ends */}
      <g className="lines">
        {all.map((it) => {
          const targets = it.side === "shared" ? [lay.centerL, lay.centerR] : it.side === "left" ? [lay.centerL] : [lay.centerR];
          const ids = it.side === "shared" ? centerIds : it.side === "left" ? [p.left.id] : [p.right.id];
          const removed = it.bubble?.state === "removed";
          return targets.map((c, k) => (
            <line
              key={`${it.id}-${k}`} x1={c.x} y1={c.y} x2={it.s.x} y2={it.s.y}
              className={`ln ${lineState(it.id, ids[k])} ${removed || it.more ? "ghost" : ""}`}
            />
          ));
        })}
      </g>

      {all.map((it) => {
        const b = it.bubble;
        const color = b ? KIND_COLOR[b.node.kind] : "#8FA0C0";
        const fs = it.s.ry >= 40 ? 13.5 : it.s.ry >= 34 ? 12.5 : 11.5;
        const failed = b ? p.failed(b.id) : false;
        const sel = p.selectedId === it.id;
        const dim = focus && focus !== it.id && !centerIds.includes(focus) ? 0.55 : 1;
        const name = b ? b.node.label : `${it.more} more`;
        return (
          <g
            key={it.id} className="bubble" role="button" tabIndex={0} style={{ transform: `translate(${it.s.x}px, ${it.s.y}px)`, opacity: b?.state === "removed" ? 0.5 : dim }}
            aria-label={b ? `${name}, ${KIND_NAME[b.node.kind]}${b.state !== "present" ? `, ${b.state} in this snapshot` : ""}${failed ? ", withdrawal reverts" : ""}` : `Show ${it.more} more on the ${it.side} side`}
            aria-pressed={sel}
            onClick={() => (b ? p.onPick(b.id) : p.onMore(it.side))}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b ? p.onPick(b.id) : p.onMore(it.side); } }}
            onMouseEnter={() => setHover(it.id)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(it.id)} onBlur={() => setHover(null)}
          >
            <title>{b ? `${name} · ${KIND_NAME[b.node.kind]} · ${shortAddr(b.node.address)}` : `${it.more} more`}</title>
            {failed && <ellipse rx={it.s.rx + 7} ry={it.s.ry + 7} fill="none" stroke={FAIL} strokeWidth={2.5} />}
            {sel && <ellipse rx={it.s.rx + 6} ry={it.s.ry + 6} fill="none" stroke="#E8EEFA" strokeWidth={1.5} />}
            <ellipse
              rx={it.s.rx} ry={it.s.ry} fill={b ? tint(color) : BG} stroke={b?.state === "new" ? "#FFFFFF" : color}
              strokeWidth={b?.state === "new" ? 3 : 2} strokeDasharray={!b || b.state === "removed" ? "5 4" : undefined}
            />
            <Label text={name} shape={it.s} size={fs} />
            {b && b.state !== "present" && (
              <text
                x={(it.side === "left" ? -1 : 1) * (it.s.rx + 8)} y={4} textAnchor={it.side === "left" ? "end" : "start"}
                fontSize={12} fontWeight={700} fill={b.state === "new" ? "#FFFFFF" : "#8FA0C0"}
              >
                {b.state === "new" ? "new" : "removed"}
              </text>
            )}
            {failed && (
              <text y={it.s.ry + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill={FAIL}>withdraw reverts</text>
            )}
          </g>
        );
      })}

      {[
        { n: p.left, s: lay.centerL, failed: leftFailed },
        { n: p.right, s: lay.centerR, failed: rightFailed },
      ].map(({ n, s, failed }) => (
        <g
          key={n.id} className="bubble center" role="button" tabIndex={0} style={{ transform: `translate(${s.x}px, ${s.y}px)` }}
          aria-label={`${n.label}, ${KIND_NAME[n.kind]}`} aria-pressed={p.selectedId === n.id}
          onClick={() => p.onPick(n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onPick(n.id); } }}
          onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
        >
          <title>{`${n.label} · ${KIND_NAME[n.kind]} · ${shortAddr(n.address)}`}</title>
          {failed && <ellipse rx={s.rx + 9} ry={s.ry + 9} fill="none" stroke={FAIL} strokeWidth={3} />}
          {p.selectedId === n.id && <ellipse rx={s.rx + 6} ry={s.ry + 6} fill="none" stroke="#9ADBFF" strokeWidth={2} />}
          <ellipse rx={s.rx} ry={s.ry} fill="#18264A" stroke={KIND_COLOR[n.kind]} strokeWidth={3.5} />
          <Label text={n.label} shape={s} size={16} weight={700} fill="#FFFFFF" />
          {failed && <text y={s.ry + 26} textAnchor="middle" fontSize={12} fontWeight={600} fill={FAIL}>withdraw reverts</text>}
        </g>
      ))}
    </svg>
  );
}
