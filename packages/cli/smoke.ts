// Phase 0 smoke test: write one entity to Arkiv Rabdi and read it back.
// Run: node --env-file=../../.env smoke.ts
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { addr, defineSchema, str } from "@arkiv-network/sdk/schema";
import { http, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const Smoke = defineSchema("blast-radius.phase0-smoke", {
  kind: str().indexed(),
  publisher: addr().indexed(),
  note: str(),
});

const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
const account = privateKeyToAccount(process.env.ARKIV_WRITER_PRIVATE_KEY as Hex);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ chain, transport: http(), account });

console.log("writer address:", account.address);
const block = await publicClient.getBlockNumber();
const balance = await publicClient.getBalance({ address: account.address });
console.log("rabdi block:", block.toString(), " balance:", formatEther(balance), "tGLM");
if (balance === 0n) {
  console.error("Balance is 0. Request tGLM from the faucet for the address above, then re-run.");
  process.exit(2);
}

const { entityKey } = await walletClient.createEntity(
  Smoke,
  { kind: "smoke", publisher: addr(account.address), note: "phase 0 write test" },
  { expiration: ExpirationTime.fromDays(1) },
);
console.log("created entity:", entityKey);

const { entities } = await publicClient
  .select({ $key: true, $owner: true, kind: true, note: true })
  .from(Smoke)
  .ownedBy(account.address)
  .fetch();
console.log("read back", entities.length, "entity(ies):");
for (const e of entities) console.log(" ", e.$key, e.kind.value, e.note.value);
