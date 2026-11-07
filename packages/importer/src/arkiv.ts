import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { asc, eq } from "@arkiv-network/sdk/query";
import { http, hexToString, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const chain = () => rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
export const publicClient = () => createPublicClient({ chain: chain(), transport: http() });

export function writer() {
  const pk = process.env.ARKIV_WRITER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("ARKIV_WRITER_PRIVATE_KEY is not set (see .env.example)");
  const account = privateKeyToAccount(pk);
  return { account, client: createWalletClient({ chain: chain(), transport: http(), account }) };
}

export interface Fetched { logicalId?: string; record: any }

/** Read every row of `schema` for one snapshot and publisher, paging 100 at a time in a fixed key order. */
export async function fetchSnapshotRows(schema: any, snapshotId: string, owner: Hex, withLogicalId = true): Promise<Fetched[]> {
  const pc = publicClient();
  const out: Fetched[] = [];
  for (let offset = 0; ; offset += 100) {
    const sel: any = withLogicalId ? { logicalId: true, payload: true } : { payload: true };
    const { entities } = await (pc as any)
      .select(sel).from(schema).where(eq("snapshotId", snapshotId)).ownedBy(owner)
      .orderBy(asc("$key")).limit(100).offset(offset).fetch();
    for (const e of entities) {
      out.push({ logicalId: e.logicalId?.value, record: JSON.parse(hexToString(e.payload.value)) });
    }
    if (entities.length < 100) break;
  }
  return out;
}
