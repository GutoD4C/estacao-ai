import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

// Exercise the shipped browser module with a remembered device and no signer.
// Stub the relay transport so the regression test needs no account or network.
test("a remembered device can read without repeatedly trying to sign presence", async () => {
  const assets = new URL("../../crates/ai-memory-web/static/", import.meta.url);
  const moduleURL = js => "data:text/javascript;base64," + Buffer.from(js).toString("base64");
  const cryptoURL = moduleURL(await readFile(new URL("vendor/nostr-crypto.js", assets), "utf8"));
  const source = (await readFile(new URL("estacao-3d-nostr.js", assets), "utf8"))
    .replace('"./nostr-crypto.js"', JSON.stringify(cryptoURL))
    .replace('"./estacao-cookie.js"', JSON.stringify(moduleURL("export const cookie = () => '';")));
  const account = "ab".repeat(32);
  const frames = [];
  let socket;
  class Relay extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() { super(); socket = this; }
    send(frame) { frames.push(JSON.parse(frame)); }
    close() { this.readyState = 3; }
  }
  globalThis.window = {crypto: globalThis.crypto};
  globalThis.location = new URL("http://localhost/web/chat");
  globalThis.localStorage = {getItem: () => null, setItem() {}};
  globalThis.WebSocket = Relay;
  globalThis.fetch = async () => Response.json(account);
  const {restaurarDispositivo, criarClienteNostr, chaveConvite} = await import(moduleURL(source));
  assert.equal(await restaurarDispositivo(), true);
  const {finalizeEvent,getPublicKey} = await import(cryptoURL);
  const key = crypto.getRandomValues(new Uint8Array(32));
  const author = getPublicKey(key);
  const received = [];
  const client = criarClienteNostr({profile: {pubkeyHex: account}, authors:[author],
    onRoomShare: event => received.push(event)});
  try {
    client.connect();
    socket.dispatchEvent(new Event("open"));
    assert.equal(client.status, "signer");
    await client.publishPresence({});
    await client.publishPresence({});
    assert.equal(client.status, "signer");
    assert.deepEqual(frames.map(frame => frame[0]), ["REQ"]);
    const [,sub,,filter] = frames[0];
    assert.ok(filter.kinds.includes(30078));
    assert.deepEqual(filter["#p"],[account]);
    assert.deepEqual(filter.authors,[author]);
    const now = Math.floor(Date.now()/1000);
    const tags = [["d","estacao-convite:"+"12".repeat(32)],["p",account],["expiration",String(now+86400)]];
    const envelope = {kind:30078,created_at:now,tags,content:"ciphertext"};
    function deliver(event) {
      socket.dispatchEvent(new MessageEvent("message",{data:JSON.stringify(["EVENT",sub,event])}));
    }
    const valid = finalizeEvent({...envelope},key);
    deliver({...valid,content:"changed"});
    deliver(finalizeEvent({...envelope,created_at:now-8*86400},key));
    deliver(finalizeEvent({...envelope,tags:[tags[0],["p",author]]},key));
    deliver(finalizeEvent({...envelope,tags:[tags[0],tags[1],["expiration",String(now-1)]]},key));
    deliver(finalizeEvent({...envelope,tags:[["d","another-app"],tags[1]]},key));
    deliver(finalizeEvent({...envelope},crypto.getRandomValues(new Uint8Array(32))));
    assert.equal(received.length,0);
    deliver(valid);
    assert.equal(received.length,1);
    assert.equal(chaveConvite(received[0]),author+"/"+tags[0][1]);
    await assert.rejects(client.publishRoomShare("destinatario", {}), /Reconecte seu assinador/);
  } finally {
    client.disconnect();
  }
});
