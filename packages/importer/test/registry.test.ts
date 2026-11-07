import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegistry, selectScope } from "../src/registry.ts";

const SRC = `
library AaveV3Ethereum {
  address internal constant POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
  uint8 internal constant FOO = 1;
}
library AaveV3EthereumAssets {
  address internal constant WETH_A_TOKEN = 0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8;
  address internal constant WETH_STATIC_A_TOKEN = 0x252231882FB38481497f3C767469106297c8d93b;
  address internal constant ONE_INCH_A_TOKEN = 0x71Aef7b30728b9BB371578f36c5A1f1502a5723e;
  address internal constant WETH_ORACLE = 0x5424384B256154046E9667dDFaaa5e550145215e;
}
library AaveV3EthereumExternalLibraries {
  address internal constant POOL_LOGIC = 0xD70593841C57cbaA04957cc3EAcE95708e48853b;
}`;

test("parses constants per library, lowercases addresses, skips non-addresses", () => {
  const e = parseRegistry(SRC);
  assert.equal(e.length, 6);
  assert.equal(e[0].group, "AaveV3Ethereum");
  assert.equal(e[0].address, "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2");
});

test("parses declarations wrapped across two lines (regression: they were silently dropped)", () => {
  const wrapped = `library AaveV3Ethereum {
  address internal constant DEFAULT_VARIABLE_DEBT_TOKEN_IMPL =
    0xb27C52c7f84819e3157993489741cB60786aE330;
}`;
  const e = parseRegistry(wrapped);
  assert.equal(e.length, 1);
  assert.equal(e[0].role, "DEFAULT_VARIABLE_DEBT_TOKEN_IMPL");
  assert.equal(e[0].line, 2);
});

test("scope keeps core + libraries, only requested reserves, never STATIC or oracles", () => {
  const roles = (a: string[] | "all") => selectScope(parseRegistry(SRC), a).map((x) => x.role);
  assert.deepEqual(roles(["WETH"]), ["POOL", "WETH_A_TOKEN", "POOL_LOGIC"]);
  assert.deepEqual(roles("all"), ["POOL", "WETH_A_TOKEN", "ONE_INCH_A_TOKEN", "POOL_LOGIC"]);
});
