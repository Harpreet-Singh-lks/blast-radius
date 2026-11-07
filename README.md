# Blast Radius

> Your portfolio has several positions. How many independent dependencies does it really have?

Blast Radius mirrors contract-dependency data into [Arkiv](https://docs.arkiv.network/) and shows which positions share
a control point. It is built for the Arkiv **Mirror something Ethereum depends on** track at ETHGlobal Mumbai.

## Status

Working:

- A re-runnable importer that mirrors a pinned subset of the
  [Aave Address Book](https://github.com/aave-dao/aave-address-book) (Ethereum V3) into Arkiv, enriched with proxy and
  implementation edges observed at a pinned block.
- A controlled experiment on a local chain, published to Arkiv as a separate dataset: three vaults, one shared
  beacon, an authorised upgrade that makes withdrawals revert in A and B but not in C.
- A command-line reader that queries Arkiv with the public RPC only.

- A web app (`apps/web`) that reads both datasets from Arkiv in the browser with the public RPC and no backend: the
  mainnet mirror, and the controlled demo with a baseline/after snapshot switch and the recorded experiment results.
  If Arkiv cannot be reached the app says so and shows no data. Its main view is a **double bubble map**: pick two
  positions (or two dependencies) and see what they share in the middle and what is unique to each around its side.
  Two positions with an empty middle share no dependency. Each bubble opens the path and on-chain evidence behind it.
  The original dependency graph is the second view.

Not finished: no second publisher, no scheduler, and snapshot invalidation after a reorg is not implemented. The web
app has been exercised in a browser by hand (including with the RPC blocked) but has no automated browser test, and
only the data-model, comparison and layout code have unit tests. The public endpoint is rate limited and the first load can be slow.
Details are in [`arkiv/data-quality.md`](arkiv/data-quality.md).

## Claims and limits

Graph reachability means *potential* exposure, not exploitability. Unknown dependencies stay unknown, and a missing
edge is not evidence of safety. Registry labels are not evidence of behaviour. The controlled experiment is a local
scenario, not a discovered live exploit. There is no risk score.

## Data and publisher

| | |
| --- | --- |
| Source data | `aave-dao/aave-address-book` at `506b86708cc2993a8c0e22fa117f557d4269dc90` (MIT, copyright BGD Labs, [licence](https://github.com/aave-dao/aave-address-book/blob/506b86708cc2993a8c0e22fa117f557d4269dc90/LICENSE)) |
| Network | Arkiv Rabdi testnet, chain ID 7794095 |
| Writer wallet | `0x4bB1264FE54770d74aA0313ceBa6d9ed5c9C1417` |
| Mainnet mirror snapshot | `26359782-cc57d3dc9c` (Ethereum block 26359782) |
| Controlled demo snapshots | `11-cf0ea69e02` (baseline), `12-330374e7fb` (after upgrade) |

Not Sourcify data.

## Run a query (no keys needed)

```sh
cd packages/importer
pnpm install
pnpm query:dependents --snapshot 26359782-cc57d3dc9c --address 0xadc45df3cf1584624c97338bef33363bf5b97ada
```

This prints the contracts that depend on Aave's default aToken implementation in that snapshot (11 aTokens), with the
storage slot and raw value behind each. The public endpoint is rate limited; set `ARKIV_ACCESS_KEY` for a free key.

Controlled demo, shared beacon after the upgrade (should print Vault A and Vault B only):

```sh
pnpm query:dependents --snapshot 12-330374e7fb --address 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
```

The addresses of a fresh `demo:run` differ from these. They are the deterministic anvil addresses of the published
run.

## Re-run the importer

Needs Node 24, pnpm and a funded Rabdi wallet.

```sh
cp .env.example .env        # fill in ARKIV_WRITER_PRIVATE_KEY (0x…) and ARKIV_ACCESS_KEY
cd packages/importer
pnpm install
pnpm test                   # 12 unit tests
pnpm import:registry        # pins a finalized block, writes out/<snapshot>.manifest.json
pnpm publish:snapshot --input out/<snapshot>.manifest.json
```

Useful flags: `--commit <sha>`, `--block <n>`, `--assets all|WETH,USDC,…`, `--days 60`, `--batch 20`. Publishing is
resumable and safe to repeat. It reads everything back and compares counts and a digest before it writes the snapshot
entity. `ETHEREUM_RPC_URL` overrides the default public RPC.

## Re-run the controlled experiment

Needs [Foundry](https://book.getfoundry.sh/) (`anvil`, `forge`).

```sh
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge install foundry-rs/forge-std --no-git
forge test                  # 4 tests: baseline, unauthorised upgrade rejected, A/B break and C does not, owners differ
cd ../packages/importer
pnpm demo:run --out out-demo
pnpm publish:snapshot --input out-demo/<snapshot>.manifest.json   # once per manifest
```

Run `forge install` from inside `contracts/`, where `foundry.toml` exists, so the libraries land in `contracts/lib`.

## Web app

```sh
cd apps/web && pnpm install && pnpm dev
```

It reads snapshots published by `0x4bB1264FE54770d74aA0313ceBa6d9ed5c9C1417` from Arkiv. Optional public settings in
`apps/web/.env.local`: `VITE_ARKIV_PUBLISHER` (a different publisher address) and `VITE_ARKIV_ACCESS_KEY` (a free
public-tier key; do not use a writer key in the browser). `pnpm test` is not wired for the web app; run
`node --test test/*.test.ts` there for the data-model tests.

## Layout

```
apps/web/             React + react-force-graph-2d bubble map, reads Arkiv
contracts/            VaultV1, VaultV2Paused and the scenario tests (Foundry)
packages/importer/    registry parser, adapters, manifests, Arkiv publisher, reader CLI, scenario runner
packages/cli/         first Arkiv write/read smoke test
arkiv/                schema, friction, reach, why-arkiv, data-quality
THIRD_PARTY_NOTICES.md
```

## Arkiv submission documents

[`arkiv/schema.md`](arkiv/schema.md) · [`arkiv/friction.md`](arkiv/friction.md) · [`arkiv/reach.md`](arkiv/reach.md) ·
[`arkiv/why-arkiv.md`](arkiv/why-arkiv.md) · [`arkiv/data-quality.md`](arkiv/data-quality.md)

## How AI was used

The code, tests and documents in this repository were written with Claude Code (Anthropic's Claude) working under the
author's direction in a terminal session. The AI assistant wrote and ran the code, the tests and the on-chain and
Arkiv reads, and drafted these documents. Figures quoted in them come from commands run in that session. The author
chose the project, supplied the plan, and created the Arkiv wallet and access key.

## Licence

MIT, see [`LICENSE`](LICENSE). Upstream data and dependencies keep their own licences, listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
