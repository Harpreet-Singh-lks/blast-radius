# Arkiv friction

Observed while building against `@arkiv-network/sdk` 1.0.1 on Rabdi (chain 7794095), November 2026. Only things that
actually happened are listed. Each item says how to reproduce it.

## 1. A numeric column accepts a bare `bigint` in one path and rejects it at write time in another

- **What happened:** I wrote a snapshot entity with `blockNumber: BigInt(...)` for a `u64()` column. The write failed
  at runtime: `SchemaMismatchError: Column "blockNumber": a u64 column, but the value is a u256. Write u64(...)
  around the value.`
- **Why it cost time:** It failed on the last step of a publish, after 173 other entities had been written and read
  back. The message itself is clear and gave the fix.
- **Caveat:** I called the SDK through an `any` cast in that script, so TypeScript could not have caught it. The typed
  path may report it at compile time. I did not test that.
- **Reproduce:** `defineSchema("x", { n: u64().indexed() })`, then `createEntity(schema, { n: 5n }, { expiration })`.
- **Suggestion:** document that a bare `bigint` maps to `u256`, next to the column types.

## 2. Access key display

- **What happened:** The access-keys page showed the key shortened with an ellipsis (`ark_live_xxxx…xxxx`). Copying
  the visible text, instead of using the copy control, gives an unusable key that fails without a clear message.
- **Suggestion:** make the shortened form visibly non-copyable, or state next to it that the full key is behind the
  copy button.

## 3. No numeric write limits or rate limits in the docs

- The Limits page gives per-entity limits (32 attributes, 128-byte strings, 128 KiB bytes, about 182.5 days
  lifetime, 100 rows per query page) but no write rate limit, no maximum batch size and no minimum expiry.
- **Measured:** nine `executeBatch` transactions of up to 20 creates each, 173 entities in total, all succeeded with
  no throttling and cost about 0.052 tGLM. I did not probe larger batches or higher rates.
- **Suggestion:** state the batch ceiling and the public-RPC rate limit as numbers.

## 4. Offset paging reads the latest block on every request

- The Read Methods page documents offset paging and warns that concurrent creates can repeat or skip rows. The
  importer pages with `ORDER BY $key` and `offset`, which is fine for a snapshot that is no longer being written, but
  it is the weaker of the two methods the page describes (keyset paging with `$key > key(0x…)` is the other).
- **Suggestion:** a `.after(key)` helper on the builder would make the safe path the easy one.

## 5. The quickstart is split across snippets

- The "Your First Entity" page has no single runnable file. I assembled one from its snippets (imports from
  `@arkiv-network/sdk`, `/chains`, `/schema` and `viem`). It worked on the first run once the key and wallet were
  funded.
- **Suggestion:** end the page with one copy-pasteable file.

## 6. Setup steps that are outside Arkiv but sit on the critical path

- A hex private key without the `0x` prefix fails viem's account helper. Mine had no prefix. Not an Arkiv bug, but
  the quickstart reads `process.env.PRIVATE_KEY as Hex` with no mention of the prefix.
- The faucet and access key are browser-only, so a fully scripted setup is not possible.

## What worked well

- `executeBatch` is one atomic transaction, which made all-or-nothing batches simple and made retries safe.
- Owner-based filtering (`ownedBy`) made publisher identity a protocol property instead of a payload convention.
- Reading entities back with only the public RPC and no backend was straightforward.
