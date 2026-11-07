import type { Kind, UIRelation } from "./types.ts";

export const BRAND = "Blast Radius";

export const KIND_COLOR: Record<Kind, string> = {
  position: "#2DD4BF", vault: "#4C8DFF", implementation: "#9B7BFF",
  beacon: "#F5B73B", authority: "#FF7A6B", unknown: "#8A94A8",
};
export const KIND_NAME: Record<Kind, string> = {
  position: "Position", vault: "Vault or proxy", implementation: "Implementation",
  beacon: "Beacon", authority: "Supported authority", unknown: "Unknown or unsupported",
};
export const REL_NAME: Record<UIRelation, string> = {
  holds: "Position in vault",
  "implementation-slot": "Proxy to implementation (ERC-1967 slot)",
  "beacon-slot": "Proxy to beacon",
  "beacon-implementation": "Beacon to implementation",
  "beacon-owner": "Beacon to owner",
};
export const FAIL = "#FF4D5E";
export const AFFECTED = "#F5B73B";
