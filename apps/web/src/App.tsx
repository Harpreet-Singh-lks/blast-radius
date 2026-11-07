import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { loadDataset, PUBLISHER, resetCache } from "./arkivData.ts";
import { dependentCounts, diffEdges, forwardReach, reverseReach } from "./graph.ts";
import { shortAddr } from "./model.ts";
import type { DatasetKey, DatasetView, Kind, SnapshotView, UIEdge, UINode, UIRelation } from "./types.ts";

const KIND_COLOR: Record<Kind, string> = {
  position: "#2DD4BF", vault: "#4C8DFF", implementation: "#9B7BFF",
  beacon: "#F5B73B", authority: "#FF7A6B", unknown: "#8A94A8",
};
const REL_NAME: Record<UIRelation, string> = {
  holds: "Position in vault",
  "implementation-slot": "Proxy to implementation (ERC-1967 slot)",
  "beacon-slot": "Proxy to beacon",
  "beacon-implementation": "Beacon to implementation",
  "beacon-owner": "Beacon to owner",
};
const COVERAGE_TEXT: Record<string, string> = {
  "edges-found": "A supported proxy pattern was read",
  "no-supported-pattern": "No supported proxy pattern found (this is not a safety finding)",
  "no-code": "No contract code at this block",
  "not-inspected": "Found as an edge endpoint; not inspected itself",
  error: "A read failed; nothing was inferred",
};
const FAIL = "#FF4D5E";
const AFFECTED = "#F5B73B";
const NODE_CAP = 150;

type Selection = { type: "node" | "edge"; id: string } | null;
type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: DatasetView };
interface RenderNode extends UINode { fx: number; fy: number }
interface RenderLink { source: string; target: string; edge: UIEdge; removed: boolean; changed: boolean }

const ago = (ts: string) => {
  const s = Number(ts) - Date.now() / 1000;
  const f = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(s);
  if (abs < 3600) return f.format(Math.round(s / 60), "minute");
  if (abs < 86400) return f.format(Math.round(s / 3600), "hour");
  return f.format(Math.round(s / 86400), "day");
};

export function App() {
  const [dsKey, setDsKey] = useState<DatasetKey>("mirror");
  const [loads, setLoads] = useState<Partial<Record<DatasetKey, Load>>>({});
  const load = loads[dsKey] ?? { state: "loading" as const };

  const fetchDs = useCallback((key: DatasetKey) => {
    setLoads((l) => ({ ...l, [key]: { state: "loading" } }));
    loadDataset(key)
      .then((data) => setLoads((l) => ({ ...l, [key]: { state: "ready", data } })))
      .catch((e: Error) => setLoads((l) => ({ ...l, [key]: { state: "error", message: e.message } })));
  }, []);
  // load what is on screen first, then the other dataset in the background
  useEffect(() => { if (!loads[dsKey]) fetchDs(dsKey); }, [dsKey, loads, fetchDs]);
  useEffect(() => {
    const other: DatasetKey = dsKey === "mirror" ? "demo" : "mirror";
    if (loads[dsKey]?.state === "ready" && !loads[other]) fetchDs(other);
  }, [dsKey, loads, fetchDs]);

  return (
    <div className="app">
      <Header dsKey={dsKey} setDsKey={setDsKey} load={load} />
      {load.state === "ready" ? (
        <Workspace key={dsKey} data={load.data} />
      ) : (
        <main className="load-state">
          {load.state === "loading" ? (
            <><h2>Reading from Arkiv</h2><p>Fetching the completed snapshot published by {shortAddr(PUBLISHER)}.</p></>
          ) : (
            <>
              <h2>Arkiv data could not be loaded</h2>
              <p>{/HTTP request failed|Failed to fetch/i.test(load.message)
                ? "This browser could not reach the Arkiv public endpoint. It may be offline or rate limited. Nothing is shown until real data loads."
                : load.message}</p>
              <details><summary>Technical details</summary><p className="raw">{load.message}</p></details>
              <button onClick={() => { resetCache(); fetchDs(dsKey); }}>Try again</button>
            </>
          )}
        </main>
      )}
    </div>
  );
}

function Header(p: { dsKey: DatasetKey; setDsKey: (k: DatasetKey) => void; load: Load }) {
  const d = p.load.state === "ready" ? p.load.data : undefined;
  const s = d?.snapshots[d.snapshots.length - 1];
  return (
    <header className="top">
      <h1>Blast Radius</h1>
      <div className="seg" role="tablist" aria-label="Dataset">
        <button role="tab" aria-selected={p.dsKey === "mirror"} onClick={() => p.setDsKey("mirror")}>Ethereum mirror</button>
        <button role="tab" aria-selected={p.dsKey === "demo"} onClick={() => p.setDsKey("demo")}>Controlled demo</button>
      </div>
      <span className={"badge " + (p.dsKey === "demo" ? "demo" : "")}>{p.dsKey === "demo" ? "Controlled demo" : "Mainnet mirror"}</span>
      {s && (
        <dl className="meta">
          <div><dt>Source</dt><dd>{s.registry ? `Aave Address Book ${s.registry.commit.slice(0, 7)}` : "Local chain experiment"}</dd></div>
          <div><dt>Block</dt><dd>{s.block.number}</dd></div>
          <div><dt>Observed</dt><dd>{ago(s.block.timestamp)}</dd></div>
          <div><dt>Publisher</dt><dd title={s.publisher}>{shortAddr(s.publisher)}</dd></div>
        </dl>
      )}
    </header>
  );
}

function Workspace({ data }: { data: DatasetView }) {
  const [snapIdx, setSnapIdx] = useState(0);
  const [sel, setSel] = useState<Selection>(null);
  const [overlay, setOverlay] = useState(false);
  const [query, setQuery] = useState("");
  const [frozen, setFrozen] = useState(false);

  const snap: SnapshotView = data.snapshots[Math.min(snapIdx, data.snapshots.length - 1)];
  const paired = data.snapshots.length === 2;
  const relNames = useMemo(() => [...new Set(data.snapshots.flatMap((s) => s.edges.map((e) => e.relation)))], [data]);
  const [rels, setRels] = useState<Set<UIRelation>>(new Set(relNames));

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const edges = useMemo(() => snap.edges.filter((e) => rels.has(e.relation)), [snap, rels]);
  const counts = useMemo(() => dependentCounts(edges, data.nodes), [edges, data]);
  const diff = useMemo(() => (paired ? diffEdges(data.snapshots[0].edges, data.snapshots[1].edges) : { added: [], removed: [] }), [data, paired]);

  const visibleNodes = useMemo(() => data.nodes.filter((n) => n.visible), [data]);
  const shown = visibleNodes.slice(0, NODE_CAP);
  const hiddenNodes = data.nodes.filter((n) => !n.visible);
  const renderNodes = useRef<RenderNode[]>([]);
  renderNodes.current = useMemo(() => shown.map((n) => ({ ...n, fx: n.x, fy: n.y })), [data]);

  const graphData = useMemo(() => {
    const ids = new Set(shown.map((n) => n.id));
    const links: RenderLink[] = edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({
      source: e.from, target: e.to, edge: e, removed: false,
      changed: paired && snapIdx === 1 && diff.added.some((d) => d.id === e.id),
    }));
    if (paired && snapIdx === 1) {
      for (const e of diff.removed.filter((r) => rels.has(r.relation))) links.push({ source: e.from, target: e.to, edge: e, removed: true, changed: false });
    }
    return { nodes: renderNodes.current, links };
  }, [edges, snapIdx, diff, rels, paired, data]);

  const allEdges = useMemo(() => data.snapshots.flatMap((s) => s.edges), [data]);
  const selectedNode = sel?.type === "node" ? nodeById.get(sel.id) : undefined;
  const selectedEdge = sel?.type === "edge" ? allEdges.find((e) => e.id === sel.id) : undefined;

  const reach = useMemo(() => {
    if (!sel) return null;
    if (sel.type === "edge") {
      return selectedEdge ? { nodes: new Set([selectedEdge.from, selectedEdge.to]), edges: new Set([selectedEdge.id]), paths: new Map<string, UIEdge[]>() } : null;
    }
    const n = nodeById.get(sel.id);
    if (!n) return null;
    return n.kind === "position" ? forwardReach(edges, sel.id) : reverseReach(edges, nodeById, sel.id);
  }, [sel, selectedEdge, edges, nodeById]);

  const affected = useMemo(
    () => (selectedNode && selectedNode.kind !== "position" && reach
      ? new Set([...reach.nodes].filter((id) => nodeById.get(id)?.kind === "position")) : new Set<string>()),
    [selectedNode, reach, nodeById],
  );

  const afterResults = data.snapshots.find((s) => s.phase === "after")?.results ?? [];
  const failedIds = useMemo(() => new Set(afterResults.filter((r) => r.outcome === "reverted").map((r) => `pos:${r.address}`)), [afterResults]);
  const isFailed = (id: string) => overlay && snap.phase === "after" && failedIds.has(id);
  const radius = (n: UINode) => 6 + Math.min(14, Math.sqrt(counts.get(n.id) ?? 0) * (data.mode === "registry" ? 4.5 : 7));

  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const fg = useRef<any>(null);
  // Fit the bubbles and their labels: positions label to the left, everything else to the right.
  const fit = useCallback((ms: number) => {
    const ns = renderNodes.current;
    if (!ns.length || !fg.current) return;
    const w = (n: UINode) => n.label.length * 6.6 + 30;
    const left = (n: UINode) => (n.kind === "position" ? w(n) : n.kind === "vault" || n.kind === "beacon" ? w(n) / 2 : 20);
    const right = (n: UINode) => (n.kind === "position" ? 20 : n.kind === "vault" || n.kind === "beacon" ? w(n) / 2 : w(n));
    const minX = Math.min(...ns.map((n) => n.x - left(n)));
    const maxX = Math.max(...ns.map((n) => n.x + right(n)));
    const minY = Math.min(...ns.map((n) => n.y)) - 34, maxY = Math.max(...ns.map((n) => n.y)) + 34;
    const k = Math.min(size.w / (maxX - minX), size.h / (maxY - minY)) * 0.94;
    fg.current.centerAt((minX + maxX) / 2, (minY + maxY) / 2, ms);
    fg.current.zoom(Math.min(k, 3), ms);
  }, [size.w, size.h]);
  useEffect(() => {
    const t = [60, 350].map((ms) => setTimeout(() => fit(0), ms));
    return () => t.forEach(clearTimeout);
  }, [fit, data]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.nodes.filter((n) => n.address.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [query, data]);
  const pick = (id: string) => setSel({ type: "node", id });
  const toggleRel = (r: UIRelation) => { const n = new Set(rels); n.has(r) ? n.delete(r) : n.add(r); setRels(n); };
  const positions = data.nodes.filter((n) => n.kind === "position");
  const deps = data.nodes.filter((n) => n.visible && n.kind !== "position");
  const posWord = data.mode === "registry" ? "reserve token" : "position";

  return (
    <>
      <aside className="left" aria-label="Portfolio and filters">
        <div className="search">
          <label className="sr" htmlFor="addr">Search address or label</label>
          <input id="addr" placeholder="Search address or label" value={query} onChange={(e) => setQuery(e.target.value)} />
          {hits.length > 0 && (
            <ul className="hits">
              {hits.map((n) => <li key={n.id}><button onClick={() => { pick(n.id); setQuery(""); }}>{n.label}<span>{shortAddr(n.address)}</span></button></li>)}
            </ul>
          )}
        </div>
        <section>
          <h2>{data.mode === "registry" ? "Supported positions (reserve tokens)" : "Supported portfolio"}</h2>
          <ul className="list">
            {positions.map((n) => (
              <li key={n.id}>
                <button className={sel?.id === n.id ? "on" : ""} onClick={() => pick(n.id)}>
                  <i style={{ background: KIND_COLOR.position }} />{n.label}
                  {isFailed(n.id) && <b className="tag fail">reverts</b>}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Dependencies</h2>
          <ul className="list">
            {deps.map((n) => (
              <li key={n.id}>
                <button className={sel?.id === n.id ? "on" : ""} onClick={() => pick(n.id)}>
                  <i style={{ background: KIND_COLOR[n.kind] }} />
                  <span className="grow">{n.label}</span>
                  <span className="n" title={`Unique ${posWord}s that depend on this`}>{counts.get(n.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Relationships</h2>
          {relNames.map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={rels.has(r)} onChange={() => toggleRel(r)} />{REL_NAME[r]}</label>
          ))}
        </section>
        <Coverage snap={snap} data={data} hidden={hiddenNodes.length} shown={shown.length} total={data.nodes.length} />
        {hiddenNodes.length > 0 && (
          <details className="hidden-list">
            <summary>{hiddenNodes.length} contracts without a supported edge (not drawn)</summary>
            <ul className="list">
              {hiddenNodes.map((n) => <li key={n.id}><button className={sel?.id === n.id ? "on" : ""} onClick={() => pick(n.id)}>{n.label}</button></li>)}
            </ul>
          </details>
        )}
      </aside>

      <main className="stage">
        {!snap.integrity.ok && <p className="banner" role="alert">{snap.integrity.message}</p>}
        <div className="canvas" ref={wrap}>
          <ForceGraph2D
            ref={fg} width={size.w} height={size.h} graphData={graphData as any}
            backgroundColor="rgba(0,0,0,0)" enableNodeDrag={!frozen} cooldownTicks={0} nodeRelSize={1}
            nodeLabel={() => ""}
            linkLabel={(l: any) => REL_NAME[(l as RenderLink).edge.relation] + (l.removed ? " (removed in this snapshot)" : "")}
            linkDirectionalArrowLength={6} linkDirectionalArrowRelPos={0.97}
            linkCurvature={(l: any) => ((l as RenderLink).removed ? 0.35 : 0)}
            linkColor={(l: any) => {
              const k = l as RenderLink;
              if (k.removed) return "rgba(143,160,192,.45)";
              if (k.changed) return "#FFFFFF";
              if (reach) return reach.edges.has(k.edge.id) ? "#9ADBFF" : "rgba(60,84,130,.28)";
              return "rgba(88,116,170,.62)";
            }}
            linkWidth={(l: any) => { const k = l as RenderLink; return k.changed ? 3 : reach?.edges.has(k.edge.id) ? 2.4 : 1.2; }}
            linkLineDash={(l: any) => ((l as RenderLink).removed ? [4, 4] : null)}
            onLinkClick={(l: any) => setSel({ type: "edge", id: (l as RenderLink).edge.id })}
            onNodeClick={(n: any) => pick(n.id)}
            onBackgroundClick={() => setSel(null)}
            nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 4, 0, 7); ctx.fill();
            }}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, scale: number) => {
              const r = radius(n);
              const dim = reach && !reach.nodes.has(n.id);
              ctx.save();
              ctx.globalAlpha = dim ? 0.22 : 1;
              ctx.shadowColor = KIND_COLOR[n.kind as Kind]; ctx.shadowBlur = dim ? 0 : 10;
              ctx.fillStyle = KIND_COLOR[n.kind as Kind];
              ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
              ctx.shadowBlur = 0; ctx.fillStyle = "rgba(10,18,38,.55)";
              ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.62, 0, 7); ctx.fill();
              const f = isFailed(n.id), a = affected.has(n.id);
              if (f || a) { ctx.lineWidth = 2.5; ctx.strokeStyle = f ? FAIL : AFFECTED; ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, 7); ctx.stroke(); }
              if (sel?.id === n.id) { ctx.lineWidth = 1.5; ctx.strokeStyle = "#E6ECF8"; ctx.beginPath(); ctx.arc(n.x, n.y, r + 9, 0, 7); ctx.stroke(); }
              const fs = Math.max(10, 12 / Math.sqrt(scale));
              ctx.font = `500 ${fs}px "Familjen Grotesk", sans-serif`;
              // positions label to the left, vaults and beacons above (their lines leave to the right), the rest to the right
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
          <div className="tools">
            <button onClick={() => fit(300)}>Fit</button>
            <button onClick={() => { setSel(null); fit(300); }}>Reset</button>
            <button aria-pressed={frozen} onClick={() => setFrozen(!frozen)}>{frozen ? "Unfreeze layout" : "Freeze layout"}</button>
          </div>
        </div>
        <Legend mode={data.mode} />
      </main>

      <aside className="right" aria-label="Evidence">
        <Drawer node={selectedNode} edge={selectedEdge} reach={reach} nodeById={nodeById} snap={snap}
          count={selectedNode ? counts.get(selectedNode.id) ?? 0 : 0} posWord={posWord} onPick={pick} />
      </aside>

      <footer className="bottom">
        {data.mode === "scenario" ? (
          <>
            <section className="snap">
              <h2>Snapshot</h2>
              <div className="seg" role="tablist" aria-label="Snapshot">
                {data.snapshots.map((s, i) => (
                  <button key={s.id} role="tab" aria-selected={snapIdx === i} onClick={() => setSnapIdx(i)}>{s.title}</button>
                ))}
              </div>
              <p className="diff">
                {diff.removed.length + diff.added.length === 0 ? "No edges changed between the two snapshots." : (
                  <>{Math.max(diff.removed.length, diff.added.length)} {Math.max(diff.removed.length, diff.added.length) === 1 ? "edge" : "edges"} changed: {diff.removed.map((e) => `${nodeById.get(e.from)?.label} → ${nodeById.get(e.to)?.label}`).join(", ")} became{" "}
                    <b>{diff.added.map((e) => `${nodeById.get(e.from)?.label} → ${nodeById.get(e.to)?.label}`).join(", ")}</b>.</>
                )}
              </p>
              <p className="note">
                The changed edge makes {countAffected(diff.added, data.snapshots[1].edges, nodeById)} positions potentially affected. Only the experiment shows what actually happened.
              </p>
              <label className="check">
                <input type="checkbox" checked={overlay} disabled={snap.phase !== "after"} onChange={() => setOverlay(!overlay)} />
                Show experiment outcome on the map {snap.phase !== "after" && <span className="muted">(after-upgrade snapshot only)</span>}
              </label>
              <details className="repro">
                <summary>Reproduce</summary>
                <p>Run <code>pnpm demo:run</code> in <code>packages/importer</code> with Foundry installed, then publish the two manifests. The browser never calls a privileged RPC.</p>
              </details>
              <p className="note">{snap.integrity.message}</p>
            </section>
            <Results data={data} />
          </>
        ) : (
          <section className="snap wide">
            <h2>Snapshot {snap.id}</h2>
            <p className="note">
              Block {snap.block.number} ({snap.block.hash.slice(0, 12)}…), observed {ago(snap.block.timestamp)}. Stored for {snap.expiryDays ?? "an unknown number of"} days from publishing; expiry is storage lifecycle, not a freshness judgement. {snap.integrity.message}
            </p>
            {snap.registry && (
              <p className="note">
                Registry <a href={`https://github.com/${snap.registry.repo}/tree/${snap.registry.commit}`}>{snap.registry.repo}@{snap.registry.commit.slice(0, 10)}</a>, {snap.registry.license} licence, copyright {snap.registry.licenseHolder} (<a href={snap.registry.licenseUrl}>licence</a>).
              </p>
            )}
          </section>
        )}
        <details className="reltable">
          <summary>Relationship table for {snap.title.toLowerCase()} ({edges.length} edges)</summary>
          <table>
            <thead><tr><th>Dependent</th><th>Relationship</th><th>Dependency</th><th>Adapter</th></tr></thead>
            <tbody>
              {edges.map((e) => (
                <tr key={e.id}>
                  <td>{nodeById.get(e.from)?.label}</td><td>{REL_NAME[e.relation]}</td>
                  <td>{nodeById.get(e.to)?.label}</td><td>{e.adapter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </footer>
    </>
  );
}

function countAffected(added: UIEdge[], edges: UIEdge[], nodes: Map<string, UINode>) {
  const ids = new Set<string>();
  for (const e of added) for (const id of reverseReach(edges, nodes, e.from).nodes) if (nodes.get(id)?.kind === "position") ids.add(id);
  return ids.size;
}

function Results({ data }: { data: DatasetView }) {
  const base = data.snapshots.find((s) => s.phase === "baseline")?.results ?? [];
  const after = data.snapshots.find((s) => s.phase === "after")?.results ?? [];
  const word = (o?: string) => (o === "succeeded" ? "Succeeded" : o === "reverted" ? "Reverted" : "n/a");
  return (
    <section className="results">
      <h2>Withdrawal experiment <span className="badge demo">Recorded on Arkiv</span></h2>
      <table>
        <thead><tr><th>Position</th><th>At baseline</th><th>After upgrade</th><th>Revert reason</th></tr></thead>
        <tbody>
          {after.map((r) => {
            const b = base.find((x) => x.address === r.address);
            return (
              <tr key={r.address}>
                <th scope="row">{r.label.replace("Vault", "Position")}</th>
                <td><span className={"status " + (b?.outcome === "succeeded" ? "ok" : "revert")}>{word(b?.outcome)}</span></td>
                <td><span className={"status " + (r.outcome === "succeeded" ? "ok" : "revert")}>{word(r.outcome)}</span></td>
                <td>{r.ethCall.decodedError ?? "none"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="note">Local-chain run, each attempt from the same starting state. A graph path alone never marks a withdrawal as failed.</p>
    </section>
  );
}

function Coverage(p: { snap: SnapshotView; data: DatasetView; hidden: number; shown: number; total: number }) {
  const by = (s: string) => p.snap.coverage.filter((c) => c.status === s).length;
  const inspected = p.snap.coverage.filter((c) => c.status !== "not-inspected").length;
  return (
    <section>
      <h2>Coverage</h2>
      <dl className="cov">
        <div><dt>Records in snapshot</dt><dd>{p.snap.counts.deployments}</dd></div>
        <div><dt>Contracts inspected</dt><dd>{inspected}</dd></div>
        <div><dt>Supported edges</dt><dd>{p.snap.edges.filter((e) => e.relation !== "holds").length}</dd></div>
        <div><dt>No supported pattern</dt><dd>{by("no-supported-pattern") + by("no-code")}</dd></div>
        <div><dt>Read errors</dt><dd>{by("error")}</dd></div>
      </dl>
      <p className="note">
        Drawing {p.shown} of {p.total} nodes (cap {NODE_CAP}); {p.hidden} have no supported edge and are listed below. A missing edge does not mean a contract is safe.
      </p>
    </section>
  );
}

function Legend({ mode }: { mode: "scenario" | "registry" }) {
  const items: [Kind, string][] = [
    ["position", mode === "registry" ? "Reserve token (supported position)" : "Position"],
    ["vault", mode === "registry" ? "Proxy contract" : "Vault"], ["implementation", "Implementation"],
    ["beacon", "Beacon"], ["authority", "Supported authority"], ["unknown", "Unknown or unsupported"],
  ];
  return (
    <div className="legend" aria-label="Legend">
      <ul>{items.map(([k, t]) => <li key={k}><i style={{ background: KIND_COLOR[k] }} />{t}</li>)}</ul>
      <ul>
        <li><i className="ring" style={{ borderColor: AFFECTED }} />Potentially affected</li>
        <li><i className="ring" style={{ borderColor: FAIL }} />Withdrawal failed in the experiment</li>
      </ul>
      <p>Bubble area is the number of unique {mode === "registry" ? "reserve tokens" : "positions"} that depend on a node. It is not TVL, balance or risk. Arrows run from dependent to dependency.</p>
    </div>
  );
}

function Drawer(p: {
  node?: UINode; edge?: UIEdge; reach: ReturnType<typeof reverseReach> | null; nodeById: Map<string, UINode>;
  snap: SnapshotView; count: number; posWord: string; onPick: (id: string) => void;
}) {
  const { node, edge, reach, nodeById, snap, count, posWord, onPick } = p;
  const label = (id: string) => nodeById.get(id)?.label ?? shortAddr(id);
  if (edge) {
    return (
      <div className="drawer">
        <h2>{REL_NAME[edge.relation]}</h2>
        <p className="lead">{label(edge.from)} depends on {label(edge.to)}.</p>
        <dl className="ev">
          <dt>Basis</dt><dd>{edge.basis}</dd>
          <dt>Adapter</dt><dd>{edge.adapter} {edge.adapterVersion}</dd>
          <dt>Snapshot</dt><dd className="raw">{snap.id}</dd>
          {edge.block && <><dt>Block</dt><dd className="raw">{edge.block.number} {edge.block.hash}</dd></>}
          <dt>Query</dt><dd className="raw">{edge.call}</dd>
          <dt>Raw response</dt><dd className="raw">{edge.raw}</dd>
          {edge.evidenceHash && <><dt>Evidence hash</dt><dd className="raw">{edge.evidenceHash}</dd></>}
          <dt>Publisher</dt><dd className="raw">{snap.publisher}</dd>
        </dl>
        <p className="note">The hash shows the record was not altered after it was written. It does not show the adapter's reading is right.</p>
      </div>
    );
  }
  if (node) {
    const isPos = node.kind === "position";
    const paths = reach ? [...reach.paths.entries()] : [];
    return (
      <div className="drawer">
        <h2>{node.label}</h2>
        <p className="lead">{node.detail}.</p>
        <dl className="ev">
          <dt>Address</dt><dd className="raw">{node.address}</dd>
          {!isPos && node.visible && <><dt>Dependents</dt><dd>{count} unique {posWord}{count === 1 ? "" : "s"}</dd></>}
          {node.coverage && <><dt>Coverage</dt><dd>{COVERAGE_TEXT[node.coverage.status] ?? node.coverage.status}</dd></>}
          {node.upstream && (
            <><dt>Registry</dt><dd><a href={`https://github.com/${node.upstream.repo}/blob/${node.upstream.commit}/${node.upstream.path}#L${node.upstream.line}`}>line {node.upstream.line}</a>, {node.upstream.license}</dd></>
          )}
        </dl>
        {node.coverage?.notes.length ? <ul className="notes">{node.coverage.notes.map((t, i) => <li key={i} className="note">{t}</li>)}</ul> : null}
        {!node.visible && <p className="note">No supported edge reaches or leaves this contract, so it is not drawn. That is a limit of the adapters, not a safety finding.</p>}
        {isPos && reach && (
          <>
            <h3>Depends on</h3>
            <ul className="chain">
              {[...reach.nodes].filter((id) => id !== node.id).map((id) => (
                <li key={id}><button onClick={() => onPick(id)}><i style={{ background: KIND_COLOR[nodeById.get(id)!.kind] }} />{label(id)}</button></li>
              ))}
            </ul>
          </>
        )}
        {!isPos && node.visible && (
          <>
            <h3>Reachable {posWord}s</h3>
            {paths.length === 0 ? <p className="note">No supported {posWord} reaches this node.</p> : (
              <ul className="paths">
                {paths.map(([id, path]) => (
                  <li key={id}>
                    <button onClick={() => onPick(id)}>{label(id)}</button>
                    <span className="route">{path.map((e) => label(e.from)).concat(node.label).join(" to ")}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="note">Reachable means potentially exposed, not exploitable.</p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="drawer empty">
      <h2>Evidence</h2>
      <p className="lead">Select a shared implementation or beacon to see which {posWord}s depend on it. Select any line to read the on-chain observation behind it.</p>
    </div>
  );
}
