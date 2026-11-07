import { BEACON_IMPLEMENTATION_SELECTOR, SLOTS } from "./config.ts";
import type { EdgeDraft, Hex, Observation, Reader } from "./types.ts";

const OWNER_SELECTOR = "0x8da5cb5b"; // owner()
const ZERO = "0x0000000000000000000000000000000000000000";
export const ADAPTER_VERSION = "0.1.0";

/** Last 20 bytes of a 32-byte word as a lowercase address. */
export function wordToAddress(word: Hex | undefined): Hex {
  if (!word || word.length < 42) return ZERO as Hex;
  return ("0x" + word.slice(-40).toLowerCase()) as Hex;
}

const hasCode = async (r: Reader, a: Hex) => {
  const code = await r.getCode(a);
  return !!code && code !== "0x";
};

/** Adapter 1: EIP-1967 implementation slot. Candidate relationship only; says nothing about upgrade authority. */
async function erc1967Implementation(r: Reader, proxy: Hex, out: Observation) {
  out.attempted.push("erc1967-implementation");
  const raw = await r.getStorageAt(proxy, SLOTS.implementation);
  const target = wordToAddress(raw);
  if (target === ZERO) return;
  if (!(await hasCode(r, target))) {
    out.notes.push(`implementation slot holds ${target} but that address has no code at this block`);
    return;
  }
  out.edges.push({
    source: proxy, target, relation: "implementation-slot",
    adapterId: "erc1967-implementation", adapterVersion: ADAPTER_VERSION,
    evidence: { kind: "storage-slot", slot: SLOTS.implementation as Hex, raw },
  });
}

/** Adapter 2: supported beacon proxy. Emits proxy->beacon and beacon->implementation. */
async function beaconProxy(r: Reader, proxy: Hex, out: Observation) {
  out.attempted.push("beacon-proxy");
  const raw = await r.getStorageAt(proxy, SLOTS.beacon);
  const beacon = wordToAddress(raw);
  if (beacon === ZERO) return;
  if (!(await hasCode(r, beacon))) {
    out.notes.push(`beacon slot holds ${beacon} but that address has no code at this block`);
    return;
  }
  const ret = await r.call(beacon, BEACON_IMPLEMENTATION_SELECTOR as Hex);
  const impl = wordToAddress(ret);
  if (impl === ZERO || !(await hasCode(r, impl))) {
    out.notes.push(`beacon ${beacon} did not return an implementation with code from implementation()`);
    return;
  }
  const mk = (e: Omit<EdgeDraft, "adapterId" | "adapterVersion">): EdgeDraft => ({
    ...e, adapterId: "beacon-proxy", adapterVersion: ADAPTER_VERSION,
  });
  out.edges.push(
    mk({ source: proxy, target: beacon, relation: "beacon-slot",
      evidence: { kind: "storage-slot", slot: SLOTS.beacon as Hex, raw } }),
    mk({ source: beacon, target: impl, relation: "beacon-implementation",
      evidence: { kind: "call", call: "implementation()", raw: ret } }),
  );
}

/**
 * Adapter 3: known Ownable beacon. Only runs for beacon addresses the caller explicitly vouches for.
 * owner() on an arbitrary contract proves nothing about upgrade permission, so this never runs by default.
 */
async function ownableBeacon(r: Reader, beacon: Hex, out: Observation) {
  out.attempted.push("ownable-beacon");
  const ret = await r.call(beacon, OWNER_SELECTOR as Hex);
  const owner = wordToAddress(ret);
  if (owner === ZERO) { out.notes.push("owner() returned the zero address"); return; }
  out.edges.push({
    source: beacon, target: owner, relation: "beacon-owner",
    adapterId: "ownable-beacon", adapterVersion: ADAPTER_VERSION,
    evidence: { kind: "call", call: "owner()", raw: ret },
  });
}

export interface ObserveOptions { knownOwnableBeacons?: ReadonlySet<Hex> }

export async function observeContract(r: Reader, address: Hex, opts: ObserveOptions = {}): Promise<Observation> {
  const out: Observation = { edges: [], attempted: [], notes: [], status: "no-supported-pattern" };
  try {
    if (!(await hasCode(r, address))) return { ...out, status: "no-code" };
    await erc1967Implementation(r, address, out);
    await beaconProxy(r, address, out);
    if (opts.knownOwnableBeacons?.has(address)) await ownableBeacon(r, address, out);
    // Recorded for the reader, deliberately not turned into an edge: slot content is not proof of authority.
    const admin = wordToAddress(await r.getStorageAt(address, SLOTS.admin));
    if (admin !== ZERO) out.notes.push(`erc1967 admin slot holds ${admin} (observed; not interpreted as upgrade authority)`);
    out.status = out.edges.length ? "edges-found" : "no-supported-pattern";
  } catch (e) {
    out.status = "error";
    out.notes.push(`read failed: ${(e as Error).message.slice(0, 200)}`);
  }
  return out;
}
