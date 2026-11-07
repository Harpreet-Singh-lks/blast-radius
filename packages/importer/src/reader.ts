import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import type { Hex, Reader } from "./types.ts";

async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * 2 ** i)); }
  }
  throw last;
}

class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  private max: number;
  constructor(max: number) { this.max = max; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }
}

export interface PinnedBlock { number: bigint; hash: Hex; timestamp: bigint }

export function makeClient(rpcUrl: string) {
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
}

export async function pinFinalizedBlock(rpcUrl: string, explicit?: bigint): Promise<PinnedBlock> {
  const c = makeClient(rpcUrl);
  const b = await retry(() => (explicit ? c.getBlock({ blockNumber: explicit }) : c.getBlock({ blockTag: "finalized" })));
  return { number: b.number!, hash: b.hash!, timestamp: b.timestamp };
}

/** True when the pinned block is still canonical (same hash at that height). */
export async function isStillCanonical(rpcUrl: string, pinned: PinnedBlock): Promise<boolean> {
  const b = await retry(() => makeClient(rpcUrl).getBlock({ blockNumber: pinned.number }));
  return b.hash === pinned.hash;
}

export function makeReader(rpcUrl: string, pinned: PinnedBlock, concurrency = 4): Reader {
  const c = makeClient(rpcUrl);
  const gate = new Gate(concurrency);
  const blockNumber = pinned.number;
  return {
    blockNumber,
    blockHash: pinned.hash,
    getStorageAt: (address, slot) =>
      gate.run(() => retry(async () => (await c.getStorageAt({ address, slot, blockNumber })) ?? ("0x" as Hex))),
    getCode: (address) => gate.run(() => retry(() => c.getCode({ address, blockNumber }))),
    call: (to, data) =>
      gate.run(() => retry(async () => (await c.call({ to, data, blockNumber })).data ?? ("0x" as Hex))),
  };
}
