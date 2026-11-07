# Schema

Five entity kinds, each written through its own named Arkiv schema (`blast-radius.*`). Definitions live in
[`packages/importer/src/schema.ts`](../packages/importer/src/schema.ts).

Every entity carries a `payload` (`bytes`, UTF-8 JSON). The payload is the full record. The indexed columns
duplicate the fields a reader filters on, because `bytes` columns cannot be indexed and a `str` value is limited to
128 bytes.

## Owner and publisher

The publisher of a record is the wallet that owns the entity, never a field in the payload. Anyone can write
entities with any attributes, so readers must filter with `ownedBy(...)`. The CLI and the web app default to one
configured publisher (`DEFAULT_PUBLISHERS` in `packages/importer/src/config.ts`):

| Role | Address |
| --- | --- |
| Writer wallet (testnet, throwaway, holds only test tokens) | `0x4bB1264FE54770d74aA0313ceBa6d9ed5c9C1417` |

## Entities

Indexed columns are filterable. `logicalId` is a SHA-256 hex digest (64 characters) of the record's natural key, so
a re-run can skip records it already wrote.

| Schema | Indexed columns | Payload (JSON) |
| --- | --- | --- |
| `blast-radius.deployment` | `datasetId`, `chainId` (i32), `address` (addr), `protocol`, `role`, `origin`, `snapshotId`, `logicalId` | role and aliases, group, origin (`registry`, `observed` or `scenario`), upstream repo, commit, path, line, license and license URL |
| `blast-radius.dependency` | `datasetId`, `chainId`, `source` (addr), `target` (addr), `relation`, `snapshotId`, `adapterId`, `logicalId` | block number and hash, adapter and version, basis, evidence (kind, slot or call, raw return), evidence hash |
| `blast-radius.coverage` | `datasetId`, `chainId`, `address`, `snapshotId`, `status`, `logicalId` | adapters attempted, notes (for example an ERC-1967 admin slot that was observed but not interpreted) |
| `blast-radius.snapshot` | `datasetId`, `chainId`, `snapshotId`, `status`, `blockNumber` (u64), `blockHash`, `digest` | registry commit, file SHA-256, license, scope, expected counts, completion time, expiry in days, publisher |
| `blast-radius.scenario-result` | `datasetId`, `chainId`, `scenarioId`, `phase`, `address`, `outcome`, `snapshotId`, `logicalId` | call inputs, eth_call return or revert data, decoded error, receipt fields, implementation in effect, position before and after |

Edges run from the dependent to the dependency (`source` depends on `target`). Relations:
`implementation-slot`, `beacon-slot`, `beacon-implementation`, `beacon-owner`.

### Identity

- Node identity is `datasetId + chainId + lowercase address`. The mainnet mirror (`aave-v3-ethereum-mirror`, chain 1)
  and the controlled demo (`controlled-demo`, chain 31337) never merge.
- Snapshot id is `<blockNumber>-<first 10 hex chars of block hash>`, so it identifies one block, not a height.

### Completed snapshots

A snapshot is readable only when its `blast-radius.snapshot` entity exists. The importer writes that entity last,
after reading every other record back and matching counts and the manifest digest. An interrupted run leaves no
snapshot entity and is therefore invisible to readers.

## Expiration policy

All entities are written with a 60-day expiry (`ExpirationTime.fromDays(60)`; configurable with `--days`). The
protocol maximum is 7,884,000 blocks (about 182.5 days). Expiry is a storage lifecycle, not a freshness signal, and
nothing here is permanent. To keep a snapshot, re-run the importer (a new snapshot) or extend the entities.

## Example queries

Filter by schema, snapshot and owner with the SDK:

```ts
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { asc, eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { Dependency } from "./packages/importer/src/schema.ts";

const client = createPublicClient({ chain: rabdi({ accessKey: "" }), transport: http() });
const { entities } = await client
  .select({ payload: true })
  .from(Dependency)
  .where(eq("snapshotId", "26359782-cc57d3dc9c"))
  .ownedBy("0x4bB1264FE54770d74aA0313ceBa6d9ed5c9C1417")
  .orderBy(asc("$key"))
  .limit(100)
  .fetch();
```

Or use the bundled CLI, which also traverses reverse edges (see the README).
