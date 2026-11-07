import { test } from "node:test";
import assert from "node:assert/strict";
import { observeContract, wordToAddress } from "../src/adapters.ts";
import { SLOTS } from "../src/config.ts";
import type { Hex, Reader } from "../src/types.ts";

const A = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Hex;
const word = (a: Hex) => ("0x" + "0".repeat(24) + a.slice(2)) as Hex;
const ZERO_WORD = ("0x" + "0".repeat(64)) as Hex;

function fake(opts: { code: Hex[]; storage?: Record<string, Hex>; calls?: Record<string, Hex> }): Reader {
  return {
    blockNumber: 1n, blockHash: ("0x" + "11".repeat(32)) as Hex,
    getStorageAt: async (a, s) => opts.storage?.[`${a}:${s}`] ?? ZERO_WORD,
    getCode: async (a) => (opts.code.includes(a) ? ("0x6080" as Hex) : undefined),
    call: async (to) => opts.calls?.[to] ?? ZERO_WORD,
  };
}

test("wordToAddress decodes the low 20 bytes", () => {
  assert.equal(wordToAddress(word(A(0xabc))), A(0xabc));
  assert.equal(wordToAddress("0x"), A(0));
});

test("ERC-1967 implementation slot yields one candidate edge", async () => {
  const [proxy, impl] = [A(1), A(2)];
  const r = fake({ code: [proxy, impl], storage: { [`${proxy}:${SLOTS.implementation}`]: word(impl) } });
  const o = await observeContract(r, proxy);
  assert.equal(o.status, "edges-found");
  assert.deepEqual(o.edges.map((e) => [e.source, e.target, e.relation]), [[proxy, impl, "implementation-slot"]]);
});

test("empty slots yield no edge and honest 'no supported pattern'", async () => {
  const r = fake({ code: [A(1)] });
  const o = await observeContract(r, A(1));
  assert.equal(o.status, "no-supported-pattern");
  assert.equal(o.edges.length, 0);
});

test("address without code is reported as no-code", async () => {
  assert.equal((await observeContract(fake({ code: [] }), A(9))).status, "no-code");
});

test("slot pointing at an address without code makes no edge and leaves a note", async () => {
  const [proxy, ghost] = [A(1), A(7)];
  const r = fake({ code: [proxy], storage: { [`${proxy}:${SLOTS.implementation}`]: word(ghost) } });
  const o = await observeContract(r, proxy);
  assert.equal(o.edges.length, 0);
  assert.match(o.notes[0], /no code/);
});

test("beacon proxy emits proxy->beacon and beacon->implementation", async () => {
  const [proxy, beacon, impl] = [A(1), A(2), A(3)];
  const r = fake({
    code: [proxy, beacon, impl],
    storage: { [`${proxy}:${SLOTS.beacon}`]: word(beacon) },
    calls: { [beacon]: word(impl) },
  });
  const o = await observeContract(r, proxy);
  assert.deepEqual(o.edges.map((e) => [e.source, e.target, e.relation]), [
    [proxy, beacon, "beacon-slot"], [beacon, impl, "beacon-implementation"],
  ]);
});

test("admin slot is noted but never becomes an authority edge", async () => {
  const [proxy, impl, admin] = [A(1), A(2), A(5)];
  const r = fake({ code: [proxy, impl], storage: {
    [`${proxy}:${SLOTS.implementation}`]: word(impl), [`${proxy}:${SLOTS.admin}`]: word(admin) } });
  const o = await observeContract(r, proxy);
  assert.equal(o.edges.length, 1);
  assert.match(o.notes.join(" "), /not interpreted as upgrade authority/);
});

test("reader failures surface as status error, not as fabricated edges", async () => {
  const r = fake({ code: [A(1)] });
  r.getStorageAt = async () => { throw new Error("rpc down"); };
  const o = await observeContract(r, A(1));
  assert.equal(o.status, "error");
  assert.equal(o.edges.length, 0);
});

test("ownable-beacon adapter emits an owner edge only for beacons the caller vouches for", async () => {
  const [beacon, owner] = [A(2), A(0xdd)];
  const r = fake({ code: [beacon], calls: { [beacon]: word(owner) } });
  const unvouched = await observeContract(r, beacon);
  assert.equal(unvouched.edges.length, 0);
  const vouched = await observeContract(r, beacon, { knownOwnableBeacons: new Set([beacon]) });
  assert.deepEqual(vouched.edges.map((e) => [e.source, e.target, e.relation]), [[beacon, owner, "beacon-owner"]]);
});
