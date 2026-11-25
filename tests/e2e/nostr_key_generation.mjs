import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Run the browser key generator without importing its DOM/network dependencies.
const source = readFileSync(new URL("../../crates/ai-memory-web/static/estacao-3d-nostr.js", import.meta.url), "utf8");
const body = source.match(/export function gerarContaNostr\(\) \{([\s\S]*?)\n\}/)[1];
const generate = new Function("window", "bytesToHex", "nsecEncode", "getPublicKey", "npubEncode", body);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const identity = (value) => value;
assert.throws(() => generate({}, hex, identity, identity, identity), /geração segura/);
let calls = 0;
const account = generate({ crypto: { getRandomValues(bytes) {
  calls++;
  assert.equal(bytes.length, 32);
  bytes.fill(7);
} } }, hex, identity, identity, identity);
assert.equal(calls, 1);
assert.equal(account.privHex, "07".repeat(32));
console.log("Nostr key generation: secure source required; control passed.");
