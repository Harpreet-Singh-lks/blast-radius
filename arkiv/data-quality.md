# Data quality

## Provenance

- **Source:** `aave-dao/aave-address-book` at commit `506b86708cc2993a8c0e22fa117f557d4269dc90`, file
  `src/AaveV3Ethereum.sol`. The file's SHA-256 is recorded in each snapshot payload (`afe8adbbf8fe7d70…`).
- **Licence:** MIT, copyright 2026 BGD Labs, linked from every deployment record and the README.
- **Observation:** one finalized Ethereum mainnet block (26359782, hash `0xcc57d3dc…f03f72ac2`), read through a single
  public RPC (`ethereum-rpc.publicnode.com`).

## Coverage (the published snapshot `26359782-cc57d3dc9c`)

| Measure | Count |
| --- | --- |
| Registry records imported | 65 |
| Contracts inspected | 65 |
| Supported edges (ERC-1967 implementation slot) | 29 |
| Contracts with no supported pattern | 36 |
| Edge endpoints not in the registry (kept as `observed`, not inspected) | 7 |

Scope: all core registry addresses and the five external libraries, plus the aToken and debt token of 12 reserves
(WETH, wstETH, WBTC, USDC, DAI, LINK, AAVE, USDT, GHO, weETH, cbBTC, sUSDe). `--assets all` imports 175 records.

Known gaps, stated plainly:

- Only two proxy patterns are understood: the ERC-1967 implementation slot and OpenZeppelin beacon proxies. No beacon
  proxy exists in this data.
- Upgrade authority is **not** inferred. Where an ERC-1967 admin slot is non-zero the address is recorded in the
  contract's coverage notes and never turned into an edge.
- "No supported pattern" means the adapters found nothing, not that the contract is safe or not upgradeable.
- Registry labels are not evidence of behaviour. For example the registry's `POOL_IMPL` matches the implementation
  read from the `POOL` proxy, but that was checked, not assumed.

## Correctness checks

- 12 unit tests cover the registry parser and the adapters, including beacon proxies, which the real data does not
  exercise. `pnpm test` in `packages/importer`.
- A parser bug was found and fixed during this work: constants wrapped onto two lines were silently skipped, which
  also made an earlier ad-hoc count too low. A regression test covers it.
- The publisher refuses a manifest whose digest does not match its records, and refuses a block that is no longer
  canonical.
- After writing, it reads every record back from Arkiv and compares counts and the manifest digest. It writes the
  snapshot entity only if they match.

## Freshness and updates

- A snapshot is a point in time. It is as fresh as its block timestamp, shown in the payload.
- Freshness is a client policy, not a storage property. Records expire after 60 days; that is a lifecycle and does
  not mean the data is stale or valid.
- Staying current is a re-run: `pnpm import:registry` pins a new finalized block and creates a new snapshot. There is
  no scheduler or event subscription yet. Older snapshots remain queryable until they expire.

## Reorg policy

- Imports read a finalized block. Before writing the manifest and again before publishing, the importer checks that
  the block hash at that height is unchanged. A mismatch aborts the run.
- A snapshot whose block later becomes non-canonical would need to be marked invalid and rebuilt. That marking is
  **not implemented**; finality makes it unlikely but not impossible.
- The controlled-demo dataset comes from a local chain. Its blocks cannot be re-checked after the node stops, so its
  records are self-contained (receipt fields and revert data are copied into each result).

## Filtering the way people search

Indexed columns: dataset, chain, address, source, target, relation, snapshot, adapter, role, status, outcome. Typical
questions and the filters behind them:

- "What depends on this implementation?" `target = <address> AND snapshotId = <id>` (the CLI does this and walks
  reverse edges).
- "What changed between two snapshots?" fetch the `dependency` entities of both snapshot ids and compare.
- "Which contracts could the adapters not read?" `status = "no-supported-pattern"` on `blast-radius.coverage`.

A runnable query is in the README.
