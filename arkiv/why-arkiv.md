# Why Arkiv

## What a Postgres copy would lose

- **Publisher identity from the protocol.** Every record is owned by the writing wallet. A reader asks for "records
  owned by `0x4bB1…1417`" and does not have to trust a column. Independent publishers can mirror the same registry
  and coexist without being merged.
- **Reading without a backend.** The CLI query in the README reads from the public RPC only. In a database setup
  someone has to run and expose the database, and readers have to be granted access to it.
- **A lifecycle that is part of the data.** Each record has an expiry set at write time, so stale mirrors age out
  without anyone running a cleanup job.

## What the Arkiv copy enables that the original source does not

The Aave Address Book contains addresses and names. It does not contain relationships, evidence or time. The mirror
adds:

- observed proxy and implementation edges with the raw storage word that supports each one
- per-contract coverage (which contracts the adapters understood and which they did not)
- block-pinned snapshots, so two points in time can be compared
- a controlled experiment dataset whose results are queryable next to the edges

## Limits of this benefit

- Arkiv does not make a claim true. A signed record says who published it, not that the adapter was right. Evidence
  hashes prove integrity against the recorded data only.
- Anyone can write entities with any attributes, so every query must filter by owner.
- The testnet and public RPC are rate limited. Expiry is at most about 182.5 days, so this is not permanent
  storage.
- A conventional database would serve these reverse-dependency queries faster, and could do joins. Here the client
  downloads the edges (a few pages of 100) and traverses them itself.
- We have one publisher. Independent publishing is possible but has not been demonstrated with a second wallet.
