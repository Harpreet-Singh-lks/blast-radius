# Third-party notices

## Data

- **Aave Address Book**, `aave-dao/aave-address-book`, commit `506b86708cc2993a8c0e22fa117f557d4269dc90`.
  MIT licence, Copyright 2026 BGD Labs.
  <https://github.com/aave-dao/aave-address-book/blob/506b86708cc2993a8c0e22fa117f557d4269dc90/LICENSE>
  The importer republishes addresses and constant names from `src/AaveV3Ethereum.sol`. Each deployment record keeps
  the upstream repository, commit, path, line and licence reference.

## Code and libraries

| Component | Version | Licence |
| --- | --- | --- |
| `@arkiv-network/sdk` (Copyright 2025 Arkiv Network) | 1.0.1 | MIT |
| `viem` | 2.57.16 | MIT |
| `react-force-graph-2d` (Vasco Asturiano) | 1.25.5 | MIT |
| `react`, `react-dom` | 18.3.1 | MIT |
| `vite`, `@vitejs/plugin-react` | 5.4.10, 4.3.3 | MIT |
| OpenZeppelin Contracts (`UpgradeableBeacon`, `BeaconProxy`, `Ownable`) | v5.1.0 | MIT |
| `forge-std` | current at install | MIT or Apache-2.0 |
| `typescript`, `@types/node`, `@types/react` | various | Apache-2.0 / MIT |

Dependencies are installed from their registries and not vendored in git (`contracts/lib` is ignored). Licence texts
ship with each package. This is a good-faith list from package metadata, not a full audit of transitive dependencies.
