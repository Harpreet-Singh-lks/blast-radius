# Reach

## What the mirrored data is

The [Aave Address Book](https://github.com/aave-dao/aave-address-book) (a Solidity registry of Aave contract
addresses, MIT licence, copyright BGD Labs). We mirror its Ethereum V3 subset and add dependency edges that the
registry does not contain (which proxy points at which implementation, observed at a pinned block).

## Evidence of upstream use

Measured on 2026-11-07. These numbers describe the upstream registry, not our mirror.

| Measure | Value | Source |
| --- | --- | --- |
| npm downloads of `@bgd-labs/aave-address-book`, 2026-10-07 to 2026-11-05 | 37,283 | `https://api.npmjs.org/downloads/point/last-month/@bgd-labs/aave-address-book` |
| Current npm version / licence | 4.44.22 / MIT | `https://registry.npmjs.org/@bgd-labs/aave-address-book/latest` |
| GitHub stars / forks | 186 / 92 | `https://api.github.com/repos/aave-dao/aave-address-book` |
| Last push | 2026-11-06 | same |
| Repository created | 2022-05-11 | same |

Caveat: npm download counts include CI installs and mirrors, so they bound interest, not distinct users. We have not
identified named consumers of the package and do not claim any.

## Who the Arkiv copy is for

There are no users of this mirror yet. The intended consumers below are proposals, not adoption:

- **Developers and reviewers who need to know what shares an implementation.** Today the registry gives addresses
  only. With the mirror, "which reserve tokens share one implementation, and what is the evidence" is one query.
  In the imported subset, 11 aTokens share `DEFAULT_A_TOKEN_IMPL`; across the full registry scope the figure is 66
  aTokens and 66 debt tokens.
- **Anyone building a monitor or dashboard on top of dependency changes.** Snapshots are comparable across blocks.
- **Anyone who wants the data without trusting our server.** Reads need only the public RPC and the publisher
  address.

## Reproducing the evidence

```sh
curl -s https://api.npmjs.org/downloads/point/last-month/@bgd-labs/aave-address-book
curl -s https://api.github.com/repos/aave-dao/aave-address-book | grep -E '"(stargazers_count|forks_count|pushed_at)"'
```
