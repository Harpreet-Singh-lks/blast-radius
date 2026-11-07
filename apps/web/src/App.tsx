import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDataset, PUBLISHER, resetCache } from "./arkivData.ts";
import { CompareMap, type Side } from "./CompareMap.tsx";
import { compareSets, memberPaths, type Bubble } from "./compare.ts";
import { GraphView, type RenderLink, type RenderNode } from "./GraphView.tsx";
import { dependentCounts, diffEdges, forwardReach, reverseReach } from "./graph.ts";
import { shortAddr } from "./model.ts";
import { BRAND, KIND_COLOR, KIND_NAME, REL_NAME } from "./theme.ts";
import type { DatasetKey, DatasetView, Kind, SnapshotView, UIEdge, UINode, UIRelation } from "./types.ts";

const NODE_CAP = 150;
const COVERAGE_TEXT: Record<string, string> = {
  "edges-found": "A supported proxy pattern was read",
  "no-supported-pattern": "No supported proxy pattern found (this is not a safety finding)",
  "no-code": "No contract code at this block",
  "not-inspected": "Found as an edge endpoint; not inspected itself",
  error: "A read failed; nothing was inferred",
};

type Selection = { type: "node" | "edge"; id: string } | { type: "more"; side: Side } | null;
type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: DatasetView };
type Tab = "changes" | "experiment" | "coverage" | "relationships" | "snapshot";

const ago = (ts: string) => {
  const s = Number(ts) - Date.now() / 1000;
  const f = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(s);
  if (abs < 3600) return f.format(Math.round(s / 60), "minute");
  if (abs < 86400) return f.format(Math.round(s / 3600), "hour");
  return f.format(Math.round(s / 86400), "day");
};
const groupOf = (n: UINode) => (n.kind === "position" ? "position" : "dependency");

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
      <TopBar dsKey={dsKey} setDsKey={setDsKey} load={load} />
      {load.state === "ready" ? (
        <Workspace key={dsKey} data={load.data} />
      ) : (
        <main className="load-state">
          {load.state === "loading" ? (
            <><div className="spinner" aria-hidden /><h2>Reading from Arkiv</h2><p>Fetching the completed snapshot published by {shortAddr(PUBLISHER)}.</p></>
          ) : (
            <>
              <h2>Arkiv data could not be loaded</h2>
              <p>{/HTTP request failed|Failed to fetch/i.test(load.message)
                ? "This browser could not reach the Arkiv public endpoint. It may be offline or rate limited. Nothing is shown until real data loads."
                : load.message}</p>
              <details><summary>Technical details</summary><p className="raw">{load.message}</p></details>
              <button className="btn primary" onClick={() => { resetCache(); fetchDs(dsKey); }}>Try again</button>
            </>
          )}
        </main>
      )}
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="#F5B73B" strokeWidth="2" opacity=".45" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#F5B73B" strokeWidth="2" opacity=".75" />
      <circle cx="16" cy="16" r="4" fill="#F5B73B" />
    </svg>
  );
}

function TopBar(p: { dsKey: DatasetKey; setDsKey: (k: DatasetKey) => void; load: Load }) {
  const d = p.load.state === "ready" ? p.load.data : undefined;
  const s = d?.snapshots[d.snapshots.length - 1];
  return (
    <header className="topbar">
      <div className="brand"><Logo /><span>{BRAND}</span></div>
      <div className="seg" role="tablist" aria-label="Dataset">
        <button role="tab" aria-selected={p.dsKey === "mirror"} onClick={() => p.setDsKey("mirror")}>Ethereum mirror</button>
        <button role="tab" aria-selected={p.dsKey === "demo"} onClick={() => p.setDsKey("demo")}>Controlled demo</button>
      </div>
      <span className={"chip " + (p.dsKey === "demo" ? "amber" : "teal")}>{p.dsKey === "demo" ? "Controlled demo" : "Mainnet mirror"}</span>
      {s && (
        <dl className="facts">
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
  const [view, setView] = useState<"compare" | "graph">("compare");
  const [snapIdx, setSnapIdx] = useState(0);
  const [sel, setSel] = useState<Selection>(null);
  const [overlay, setOverlay] = useState(false);
  const [query, setQuery] = useState("");
  const [frozen, setFrozen] = useState(false);
  const [tab, setTab] = useState<Tab>(data.mode === "scenario" ? "changes" : "coverage");
  const [dockOpen, setDockOpen] = useState(data.mode === "scenario");

  const snap: SnapshotView = data.snapshots[Math.min(snapIdx, data.snapshots.length - 1)];
  const paired = data.snapshots.length === 2;
  const relNames = useMemo(() => [...new Set(data.snapshots.flatMap((s) => s.edges.map((e) => e.relation)))], [data]);
  const [rels, setRels] = useState<Set<UIRelation>>(new Set(relNames));

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const filt = useCallback((es: UIEdge[]) => es.filter((e) => rels.has(e.relation)), [rels]);
  const edges = useMemo(() => filt(snap.edges), [snap, filt]);
  const counts = useMemo(() => dependentCounts(edges, data.nodes), [edges, data]);
  const diff = useMemo(() => (paired ? diffEdges(data.snapshots[0].edges, data.snapshots[1].edges) : { added: [], removed: [] }), [data, paired]);
  const posWord = data.mode === "registry" ? "reserve token" : "position";

  const positions = useMemo(() => data.nodes.filter((n) => n.kind === "position"), [data]);
  const deps = useMemo(() => data.nodes.filter((n) => n.visible && n.kind !== "position"), [data]);
  const hiddenNodes = useMemo(() => data.nodes.filter((n) => !n.visible), [data]);

  // ---- comparison pair ----
  const byLabel = useCallback((t: string) => data.nodes.find((n) => n.label === t || n.role === t), [data]);
  const presets = useMemo(() => {
    const defs: [string, string][] = data.mode === "scenario"
      ? [["Position A", "Position B"], ["Position A", "Position C"], ["Shared beacon", "Beacon C"]]
      : [["DEFAULT_A_TOKEN_IMPL", "DEFAULT_VARIABLE_DEBT_TOKEN_IMPL"], ["WETH_A_TOKEN", "USDC_A_TOKEN"], ["WETH_A_TOKEN", "WETH_V_TOKEN"]];
    return defs.flatMap(([a, b]) => { const l = byLabel(a), r = byLabel(b); return l && r ? [{ l, r }] : []; });
  }, [data, byLabel]);
  const [pair, setPair] = useState<{ l: string; r: string }>(() => {
    const first = presets[0];
    return first ? { l: first.l.id, r: first.r.id } : { l: positions[0]?.id ?? deps[0]?.id, r: positions[1]?.id ?? deps[1]?.id };
  });
  const L = nodeById.get(pair.l), R = nodeById.get(pair.r);
  const pairOk = !!L && !!R && groupOf(L) === groupOf(R) && L.id !== R.id;
  const unit = L && groupOf(L) === "position" ? "dependencies" : "positions";

  const sets = useMemo(() => {
    if (!pairOk) return { left: [], shared: [], right: [] } as Record<"left" | "shared" | "right", Bubble[]>;
    const cur = [memberPaths(edges, nodeById, pair.l), memberPaths(edges, nodeById, pair.r)] as const;
    const prevEdges = paired && snapIdx === 1 ? filt(data.snapshots[0].edges) : null;
    const prev = prevEdges ? { L: memberPaths(prevEdges, nodeById, pair.l), R: memberPaths(prevEdges, nodeById, pair.r) } : undefined;
    return compareSets(cur[0], cur[1], nodeById, [pair.l, pair.r], prev);
  }, [pairOk, edges, nodeById, pair, paired, snapIdx, filt, data]);

  const presetShared = useCallback((l: string, r: string) => {
    const a = memberPaths(edges, nodeById, l), b = memberPaths(edges, nodeById, r);
    return [...a.keys()].filter((k) => b.has(k) && k !== l && k !== r).length;
  }, [edges, nodeById]);

  // ---- failure overlay and selection ----
  const afterResults = data.snapshots.find((s) => s.phase === "after")?.results ?? [];
  const failedIds = useMemo(() => new Set(afterResults.filter((r) => r.outcome === "reverted").map((r) => `pos:${r.address}`)), [afterResults]);
  const isFailed = useCallback((id: string) => overlay && snap.phase === "after" && failedIds.has(id), [overlay, snap, failedIds]);

  const selNode = sel?.type === "node" ? nodeById.get(sel.id) : undefined;
  const allEdges = useMemo(() => data.snapshots.flatMap((s) => s.edges), [data]);
  const selEdge = sel?.type === "edge" ? allEdges.find((e) => e.id === sel.id) : undefined;
  const reach = useMemo(() => {
    if (!sel) return null;
    if (sel.type === "edge") return selEdge ? { nodes: new Set([selEdge.from, selEdge.to]), edges: new Set([selEdge.id]), paths: new Map<string, UIEdge[]>() } : null;
    if (sel.type !== "node") return null;
    const n = nodeById.get(sel.id);
    if (!n) return null;
    return n.kind === "position" ? forwardReach(edges, sel.id) : reverseReach(edges, nodeById, sel.id);
  }, [sel, selEdge, edges, nodeById]);
  const affected = useMemo(
    () => (selNode && selNode.kind !== "position" && reach ? new Set([...reach.nodes].filter((id) => nodeById.get(id)?.kind === "position")) : new Set<string>()),
    [selNode, reach, nodeById],
  );
  const pick = useCallback((id: string) => setSel({ type: "node", id }), []);
  const bubbleSel = sel?.type === "node" ? [...sets.left, ...sets.shared, ...sets.right].find((b) => b.id === sel.id) : undefined;

  // ---- graph view data ----
  const shown = useMemo(() => data.nodes.filter((n) => n.visible).slice(0, NODE_CAP), [data]);
  const renderNodes = useMemo<RenderNode[]>(() => shown.map((n) => ({ ...n, fx: n.x, fy: n.y })), [shown]);
  const links = useMemo<RenderLink[]>(() => {
    const ids = new Set(shown.map((n) => n.id));
    const ls: RenderLink[] = edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({
      source: e.from, target: e.to, edge: e, removed: false, changed: paired && snapIdx === 1 && diff.added.some((d) => d.id === e.id),
    }));
    if (paired && snapIdx === 1) for (const e of filt(diff.removed)) ls.push({ source: e.from, target: e.to, edge: e, removed: true, changed: false });
    return ls;
  }, [edges, shown, paired, snapIdx, diff, filt]);
  const radius = useCallback((n: UINode) => 6 + Math.min(14, Math.sqrt(counts.get(n.id) ?? 0) * (data.mode === "registry" ? 4.5 : 7)), [counts, data.mode]);
  const fitRef = useRef<(ms: number) => void>(() => {});

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.nodes.filter((n) => n.address.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [query, data]);
  const toggleRel = (r: UIRelation) => { const n = new Set(rels); n.has(r) ? n.delete(r) : n.add(r); setRels(n); };

  const candidates = (g: "position" | "dependency") => data.nodes.filter((n) => n.visible && groupOf(n) === g);
  const setLeft = (id: string) => {
    const n = nodeById.get(id)!;
    const rightOk = R && groupOf(R) === groupOf(n) && R.id !== id;
    setPair({ l: id, r: rightOk ? R!.id : candidates(groupOf(n)).find((c) => c.id !== id)?.id ?? id });
  };
  const tabs: [Tab, string][] = data.mode === "scenario"
    ? [["changes", "Changes"], ["experiment", "Experiment"], ["coverage", "Coverage"], ["relationships", "Relationships"], ["snapshot", "Snapshot"]]
    : [["coverage", "Coverage"], ["relationships", "Relationships"], ["snapshot", "Snapshot"]];

  return (
    <>
      <aside className="rail" aria-label="Browse">
        <div className="search">
          <label className="sr" htmlFor="q">Search address or label</label>
          <input id="q" placeholder="Search address or label" value={query} onChange={(e) => setQuery(e.target.value)} />
          {hits.length > 0 && (
            <ul className="hits">
              {hits.map((n) => <li key={n.id}><button onClick={() => { pick(n.id); setQuery(""); }}>{n.label}<span>{shortAddr(n.address)}</span></button></li>)}
            </ul>
          )}
        </div>

        <section>
          <h2>Try a comparison</h2>
          <ul className="presets">
            {presets.map(({ l, r }) => {
              const active = pair.l === l.id && pair.r === r.id;
              const n = presetShared(l.id, r.id);
              return (
                <li key={l.id + r.id}>
                  <button className={active ? "on" : ""} onClick={() => { setView("compare"); setPair({ l: l.id, r: r.id }); setSel(null); }}>
                    <span className="p-names">{l.label} <em>and</em> {r.label}</span>
                    <span className={"p-count " + (n === 0 ? "none" : "")}>{n === 0 ? "nothing shared" : `${n} shared`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2>{data.mode === "registry" ? "Reserve tokens" : "Positions"}<span className="count">{positions.length}</span></h2>
          <ul className="list">
            {positions.map((n) => (
              <li key={n.id}>
                <button className={sel?.type === "node" && sel.id === n.id ? "on" : ""} onClick={() => pick(n.id)}>
                  <i style={{ background: KIND_COLOR.position }} />{n.label}
                  {isFailed(n.id) && <b className="tag fail">reverts</b>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Dependencies<span className="count">{deps.length}</span></h2>
          <ul className="list">
            {deps.map((n) => (
              <li key={n.id}>
                <button className={sel?.type === "node" && sel.id === n.id ? "on" : ""} onClick={() => pick(n.id)}>
                  <i style={{ background: KIND_COLOR[n.kind] }} />
                  <span className="grow">{n.label}</span>
                  <span className="n" title={`Unique ${posWord}s that depend on this`}>{counts.get(n.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <details className="filters">
          <summary>Relationship filters</summary>
          {relNames.map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={rels.has(r)} onChange={() => toggleRel(r)} />{REL_NAME[r]}</label>
          ))}
        </details>
      </aside>

      <main className="stage">
        <div className="toolbar">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === "compare"} onClick={() => setView("compare")}>Compare</button>
            <button role="tab" aria-selected={view === "graph"} onClick={() => setView("graph")}>Dependency graph</button>
          </div>

          {view === "compare" ? (
            <div className="pair" role="group" aria-label="Choose two to compare">
              <label className="sr" htmlFor="pl">First</label>
              <select id="pl" value={pair.l} onChange={(e) => setLeft(e.target.value)}>
                <optgroup label={data.mode === "registry" ? "Reserve tokens" : "Positions"}>
                  {candidates("position").map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </optgroup>
                <optgroup label="Dependencies">
                  {candidates("dependency").map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </optgroup>
              </select>
              <button className="icon-btn" title="Swap sides" aria-label="Swap sides" onClick={() => setPair({ l: pair.r, r: pair.l })}>⇄</button>
              <label className="sr" htmlFor="pr">Second</label>
              <select id="pr" value={pair.r} onChange={(e) => setPair({ l: pair.l, r: e.target.value })}>
                {candidates(L ? groupOf(L) : "position").filter((n) => n.id !== pair.l).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
          ) : (
            <div className="pair">
              <button className="btn" onClick={() => fitRef.current(300)}>Fit</button>
              <button className="btn" onClick={() => { setSel(null); fitRef.current(300); }}>Reset</button>
              <button className="btn" aria-pressed={frozen} onClick={() => setFrozen(!frozen)}>{frozen ? "Unfreeze layout" : "Freeze layout"}</button>
            </div>
          )}

          <div className="toolbar-end">
            {paired && (
              <div className="seg" role="tablist" aria-label="Snapshot">
                {data.snapshots.map((s, i) => <button key={s.id} role="tab" aria-selected={snapIdx === i} onClick={() => setSnapIdx(i)}>{s.title}</button>)}
              </div>
            )}
            {data.mode === "scenario" && (
              <label className={"switch " + (snap.phase !== "after" ? "off" : "")} title={snap.phase !== "after" ? "Available on the after-upgrade snapshot" : ""}>
                <input type="checkbox" checked={overlay} disabled={snap.phase !== "after"} onChange={() => setOverlay(!overlay)} />
                <span className="track" aria-hidden />Show experiment outcome
              </label>
            )}
          </div>
        </div>

        <div className="map">
          {!snap.integrity.ok && <p className="banner" role="alert">{snap.integrity.message}</p>}
          {view === "compare" ? (
            pairOk ? (
              <CompareMap
                left={L!} right={R!} unit={unit} positionWord={posWord} bubbles={sets} failed={isFailed}
                selectedId={sel?.type === "node" ? sel.id : null}
                onPick={pick} onMore={(side) => setSel({ type: "more", side })}
              />
            ) : (
              <div className="map-empty"><h2>Pick two to compare</h2><p>Choose two positions, or two dependencies, from the lists above.</p></div>
            )
          ) : (
            <GraphView
              nodes={renderNodes} links={links} reach={reach} affected={affected} failed={isFailed} radius={radius}
              selId={sel?.type === "node" ? sel.id : undefined} frozen={frozen} fitSignal={`${data.key}-${shown.length}`}
              onPick={pick} onPickEdge={(id) => setSel({ type: "edge", id })} onClear={() => setSel(null)} registerFit={(f) => { fitRef.current = f; }}
            />
          )}
        </div>

        <Legend mode={data.mode} view={view} />

        <section className={"dock " + (dockOpen ? "open" : "")} aria-label="Details">
          <div className="dock-bar">
            <div className="tabs" role="tablist">
              {tabs.map(([k, t]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setDockOpen(true); }}>{t}</button>
              ))}
            </div>
            <button className="icon-btn" aria-label={dockOpen ? "Collapse details" : "Expand details"} aria-expanded={dockOpen} onClick={() => setDockOpen(!dockOpen)}>{dockOpen ? "▾" : "▴"}</button>
          </div>
          {dockOpen && (
            <div className="dock-body">
              {tab === "changes" && <Changes data={data} diff={diff} nodeById={nodeById} snap={snap} />}
              {tab === "experiment" && <Results data={data} />}
              {tab === "coverage" && <CoveragePanel snap={snap} hidden={hiddenNodes} shown={shown.length} total={data.nodes.length} sel={sel} onPick={pick} />}
              {tab === "relationships" && <RelTable edges={edges} nodeById={nodeById} title={snap.title} />}
              {tab === "snapshot" && <SnapshotInfo snap={snap} />}
            </div>
          )}
        </section>
      </main>

      <aside className="drawer-wrap" aria-label="Evidence">
        <Drawer
          sel={sel} node={selNode} edge={selEdge} reach={reach} nodeById={nodeById} snap={snap}
          count={selNode ? counts.get(selNode.id) ?? 0 : 0} posWord={posWord} onPick={pick} onPickEdge={(id) => setSel({ type: "edge", id })}
          bubble={view === "compare" ? bubbleSel : undefined} pairLabels={L && R ? [L.label, R.label] : undefined}
          more={sel?.type === "more" ? sets[sel.side] : undefined}
        />
      </aside>
    </>
  );
}

function Legend({ mode, view }: { mode: "scenario" | "registry"; view: "compare" | "graph" }) {
  const items: [Kind, string][] = [
    ["position", mode === "registry" ? "Reserve token" : "Position"], ["vault", mode === "registry" ? "Proxy contract" : "Vault"],
    ["beacon", "Beacon"], ["implementation", "Implementation"], ["authority", "Supported authority"], ["unknown", "Unknown or unsupported"],
  ];
  return (
    <div className="legend" aria-label="Legend">
      <ul>{items.map(([k, t]) => <li key={k}><i style={{ background: KIND_COLOR[k] }} />{t}</li>)}</ul>
      <p>
        {view === "compare"
          ? "The two large bubbles are your picks. A bubble in the middle is shared by both."
          : `Bubble area is the number of unique ${mode === "registry" ? "reserve tokens" : "positions"} that depend on a node. It is not TVL, balance or risk.`}
      </p>
    </div>
  );
}

function Changes(p: { data: DatasetView; diff: { added: UIEdge[]; removed: UIEdge[] }; nodeById: Map<string, UINode>; snap: SnapshotView }) {
  const { diff, nodeById } = p;
  const n = Math.max(diff.removed.length, diff.added.length);
  const name = (e: UIEdge) => `${nodeById.get(e.from)?.label} → ${nodeById.get(e.to)?.label}`;
  const after = p.data.snapshots[1];
  const ids = new Set<string>();
  for (const e of diff.added) for (const id of reverseReach(after.edges, nodeById, e.from).nodes) if (nodeById.get(id)?.kind === "position") ids.add(id);
  return (
    <div className="prose">
      <h3>{n === 0 ? "No edges changed between the two snapshots" : `${n} ${n === 1 ? "edge" : "edges"} changed`}</h3>
      {n > 0 && <p>{diff.removed.map(name).join(", ")} became <b>{diff.added.map(name).join(", ")}</b>.</p>}
      <p>The changed edge makes {ids.size} positions potentially affected. Only the experiment shows what actually happened.</p>
      <details className="repro">
        <summary>Reproduce</summary>
        <p>Run <code>pnpm demo:run</code> in <code>packages/importer</code> with Foundry installed, then publish the two manifests. The browser never calls a privileged RPC.</p>
      </details>
      <p className="muted">{p.snap.integrity.message}</p>
    </div>
  );
}

function Results({ data }: { data: DatasetView }) {
  const base = data.snapshots.find((s) => s.phase === "baseline")?.results ?? [];
  const after = data.snapshots.find((s) => s.phase === "after")?.results ?? [];
  const word = (o?: string) => (o === "succeeded" ? "Succeeded" : o === "reverted" ? "Reverted" : "n/a");
  return (
    <div>
      <table className="grid">
        <thead><tr><th>Position</th><th>At baseline</th><th>After upgrade</th><th>Revert reason</th></tr></thead>
        <tbody>
          {after.map((r) => {
            const b = base.find((x) => x.address === r.address);
            return (
              <tr key={r.address}>
                <th scope="row">{r.label.replace("Vault", "Position")}</th>
                <td><span className={"verdict " + (b?.outcome === "succeeded" ? "ok" : "bad")}>{word(b?.outcome)}</span></td>
                <td><span className={"verdict " + (r.outcome === "succeeded" ? "ok" : "bad")}>{word(r.outcome)}</span></td>
                <td className="mono">{r.ethCall.decodedError ?? "none"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Recorded on Arkiv from a local-chain run, each attempt from the same starting state. A graph path alone never marks a withdrawal as failed.</p>
    </div>
  );
}

function CoveragePanel(p: { snap: SnapshotView; hidden: UINode[]; shown: number; total: number; sel: Selection; onPick: (id: string) => void }) {
  const by = (s: string) => p.snap.coverage.filter((c) => c.status === s).length;
  const inspected = p.snap.coverage.filter((c) => c.status !== "not-inspected").length;
  const stats: [string, number][] = [
    ["Records", p.snap.counts.deployments], ["Inspected", inspected],
    ["Supported edges", p.snap.edges.filter((e) => e.relation !== "holds").length],
    ["No supported pattern", by("no-supported-pattern") + by("no-code")], ["Read errors", by("error")],
  ];
  return (
    <div>
      <dl className="stats">{stats.map(([k, v]) => <div key={k}><dd>{v}</dd><dt>{k}</dt></div>)}</dl>
      <p className="muted">Drawing {p.shown} of {p.total} nodes (cap {NODE_CAP}). A missing edge does not mean a contract is safe.</p>
      {p.hidden.length > 0 && (
        <>
          <h3>{p.hidden.length} contracts without a supported edge (not drawn)</h3>
          <ul className="chips">
            {p.hidden.map((n) => <li key={n.id}><button onClick={() => p.onPick(n.id)}>{n.label}</button></li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function RelTable({ edges, nodeById, title }: { edges: UIEdge[]; nodeById: Map<string, UINode>; title: string }) {
  return (
    <div>
      <p className="muted">{edges.length} edges in the {title.toLowerCase()} snapshot.</p>
      <table className="grid">
        <thead><tr><th>Dependent</th><th>Relationship</th><th>Dependency</th><th>Adapter</th></tr></thead>
        <tbody>
          {edges.map((e) => (
            <tr key={e.id}><td>{nodeById.get(e.from)?.label}</td><td>{REL_NAME[e.relation]}</td><td>{nodeById.get(e.to)?.label}</td><td>{e.adapter}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SnapshotInfo({ snap }: { snap: SnapshotView }) {
  return (
    <div className="prose">
      <dl className="kv">
        <dt>Snapshot</dt><dd className="mono">{snap.id}</dd>
        <dt>Block</dt><dd className="mono">{snap.block.number} {snap.block.hash}</dd>
        <dt>Observed</dt><dd>{ago(snap.block.timestamp)}</dd>
        <dt>Digest</dt><dd className="mono">{snap.digest}</dd>
        <dt>Stored for</dt><dd>{snap.expiryDays ?? "an unknown number of"} days from publishing. Expiry is storage lifecycle, not a freshness judgement.</dd>
        <dt>Integrity</dt><dd>{snap.integrity.message}</dd>
        {snap.registry && (
          <>
            <dt>Registry</dt>
            <dd><a href={`https://github.com/${snap.registry.repo}/tree/${snap.registry.commit}`}>{snap.registry.repo}@{snap.registry.commit.slice(0, 10)}</a>, {snap.registry.license} licence, copyright {snap.registry.licenseHolder} (<a href={snap.registry.licenseUrl}>licence</a>)</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function PathList(p: { who: string; path: UIEdge[]; nodeById: Map<string, UINode>; onPickEdge: (id: string) => void }) {
  const label = (id: string) => p.nodeById.get(id)?.label ?? shortAddr(id);
  return (
    <div className="pathbox">
      <h4>{p.who}</h4>
      <ol>
        {p.path.map((e) => (
          <li key={e.id}>
            <button onClick={() => p.onPickEdge(e.id)}>
              <span>{label(e.from)} <em>depends on</em> {label(e.to)}</span>
              <small>{REL_NAME[e.relation]}</small>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Drawer(p: {
  sel: Selection; node?: UINode; edge?: UIEdge; reach: ReturnType<typeof reverseReach> | null; nodeById: Map<string, UINode>;
  snap: SnapshotView; count: number; posWord: string; onPick: (id: string) => void; onPickEdge: (id: string) => void;
  bubble?: Bubble; pairLabels?: [string, string]; more?: Bubble[];
}) {
  const { node, edge, reach, nodeById, snap, count, posWord, onPick } = p;
  const label = (id: string) => nodeById.get(id)?.label ?? shortAddr(id);

  if (p.more) {
    return (
      <div className="drawer">
        <h2>All {p.more.length} on this side</h2>
        <ul className="chain">
          {p.more.map((b) => <li key={b.id}><button onClick={() => onPick(b.id)}><i style={{ background: KIND_COLOR[b.node.kind] }} />{b.node.label}</button></li>)}
        </ul>
      </div>
    );
  }
  if (edge) {
    return (
      <div className="drawer">
        <h2>{REL_NAME[edge.relation]}</h2>
        <p className="lead">{label(edge.from)} depends on {label(edge.to)}.</p>
        <dl className="ev">
          <dt>Basis</dt><dd>{edge.basis}</dd>
          <dt>Adapter</dt><dd>{edge.adapter} {edge.adapterVersion}</dd>
          <dt>Snapshot</dt><dd className="mono">{snap.id}</dd>
          {edge.block && <><dt>Block</dt><dd className="mono">{edge.block.number} {edge.block.hash}</dd></>}
          <dt>Query</dt><dd className="mono">{edge.call}</dd>
          <dt>Raw response</dt><dd className="mono">{edge.raw}</dd>
          {edge.evidenceHash && <><dt>Evidence hash</dt><dd className="mono">{edge.evidenceHash}</dd></>}
          <dt>Publisher</dt><dd className="mono">{snap.publisher}</dd>
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
        <span className="kind-pill" style={{ ["--c" as any]: KIND_COLOR[node.kind] }}>{KIND_NAME[node.kind]}</span>
        <h2>{node.label}</h2>
        <p className="lead">{node.detail}.</p>
        <dl className="ev">
          <dt>Address</dt><dd className="mono">{node.address}</dd>
          {!isPos && node.visible && <><dt>Dependents</dt><dd>{count} unique {posWord}{count === 1 ? "" : "s"}</dd></>}
          {node.coverage && <><dt>Coverage</dt><dd>{COVERAGE_TEXT[node.coverage.status] ?? node.coverage.status}</dd></>}
          {node.upstream && (
            <><dt>Registry</dt><dd><a href={`https://github.com/${node.upstream.repo}/blob/${node.upstream.commit}/${node.upstream.path}#L${node.upstream.line}`}>line {node.upstream.line}</a>, {node.upstream.license}</dd></>
          )}
        </dl>
        {node.coverage?.notes.length ? <ul className="notes">{node.coverage.notes.map((t, i) => <li key={i} className="note">{t}</li>)}</ul> : null}
        {!node.visible && <p className="note">No supported edge reaches or leaves this contract, so it is not drawn. That is a limit of the adapters, not a safety finding.</p>}

        {p.bubble && p.pairLabels && (
          <>
            <h3>Why it is in this comparison</h3>
            {p.bubble.pathL && <PathList who={p.bubble.side === "shared" ? `Reached from ${p.pairLabels[0]}` : `Reached from ${p.pairLabels[0]}`} path={p.bubble.pathL} nodeById={nodeById} onPickEdge={p.onPickEdge} />}
            {p.bubble.pathR && <PathList who={`Reached from ${p.pairLabels[1]}`} path={p.bubble.pathR} nodeById={nodeById} onPickEdge={p.onPickEdge} />}
            {p.bubble.state !== "present" && <p className="note">{p.bubble.state === "new" ? "Not present in the baseline snapshot." : "Present in the baseline snapshot but gone after the change."}</p>}
          </>
        )}

        {!p.bubble && isPos && reach && (
          <>
            <h3>Depends on</h3>
            <ul className="chain">
              {[...reach.nodes].filter((id) => id !== node.id).map((id) => (
                <li key={id}><button onClick={() => onPick(id)}><i style={{ background: KIND_COLOR[nodeById.get(id)!.kind] }} />{label(id)}</button></li>
              ))}
            </ul>
          </>
        )}
        {!p.bubble && !isPos && node.visible && (
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
      <p className="lead">Select a bubble to see why it is connected, with the on-chain observation behind each step.</p>
    </div>
  );
}
