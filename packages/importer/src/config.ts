export const REPO = "aave-dao/aave-address-book";
export const DEFAULT_COMMIT = "506b86708cc2993a8c0e22fa117f557d4269dc90";
export const REGISTRY_PATH = "src/AaveV3Ethereum.sol";
export const DATASET_ID = "aave-v3-ethereum-mirror";
export const CHAIN_ID = 1;
export const IMPORTER_VERSION = "0.1.0";
export const DEFAULT_RPC = "https://ethereum-rpc.publicnode.com";
/** Disclosed default subset: all core registry addresses plus these reserves' aToken and debt token. */
export const DEFAULT_ASSETS = [
  "WETH", "wstETH", "WBTC", "USDC", "DAI", "LINK", "AAVE", "USDT", "GHO", "weETH", "cbBTC", "sUSDe",
];
export const LICENSE = {
  spdx: "MIT",
  holder: "BGD Labs",
  url: (commit: string) => `https://github.com/${REPO}/blob/${commit}/LICENSE`,
};
export const SLOTS = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
} as const;
export const BEACON_IMPLEMENTATION_SELECTOR = "0x5c60da1b"; // implementation()
/** Publishers a reader trusts by default. Entity ownership, not a payload field, identifies the publisher. */
export const DEFAULT_PUBLISHERS = ["0x4bB1264FE54770d74aA0313ceBa6d9ed5c9C1417"] as const;
