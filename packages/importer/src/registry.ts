import { createHash } from "node:crypto";
import { REGISTRY_PATH, REPO } from "./config.ts";
import type { Hex } from "./types.ts";

export interface RegistryEntry { group: string; role: string; address: Hex; line: number }

const LIB = /^[ \t]*library\s+(\w+)/gm;
// \s* spans newlines: the upstream generator wraps long declarations onto two lines
const CONST = /address\s+internal\s+constant\s+(\w+)\s*=\s*(0x[0-9a-fA-F]{40})\s*;/g;

export function parseRegistry(src: string): RegistryEntry[] {
  const libs = [...src.matchAll(LIB)].map((m) => ({ name: m[1], at: m.index! }));
  const lineAt = (idx: number) => src.slice(0, idx).split("\n").length;
  const out: RegistryEntry[] = [];
  for (const m of src.matchAll(CONST)) {
    const lib = [...libs].reverse().find((l) => l.at < m.index!);
    if (!lib) continue;
    out.push({ group: lib.name, role: m[1], address: m[2].toLowerCase() as Hex, line: lineAt(m.index!) });
  }
  return out;
}

/** Core library + external libraries in full; reserve tokens only for the named assets (or all). */
export function selectScope(entries: RegistryEntry[], assets: string[] | "all"): RegistryEntry[] {
  const wanted = assets === "all" ? null : new Set(assets);
  return entries.filter((e) => {
    if (e.group.endsWith("Assets")) {
      const m = /^(.+?)_(A_TOKEN|V_TOKEN)$/.exec(e.role);
      if (!m || m[1].endsWith("_STATIC")) return false;
      return wanted ? wanted.has(m[1]) : true;
    }
    return e.group === "AaveV3Ethereum" || e.group === "AaveV3EthereumExternalLibraries";
  });
}

export interface RegistrySource { text: string; sha256: string; url: string }

export async function fetchRegistry(commit: string): Promise<RegistrySource> {
  const url = `https://raw.githubusercontent.com/${REPO}/${commit}/${REGISTRY_PATH}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status} ${url}`);
  const text = await res.text();
  return { text, url, sha256: createHash("sha256").update(text).digest("hex") };
}
