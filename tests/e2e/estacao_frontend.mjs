import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const STATIC_DIR = new URL("../../crates/ai-memory-web/static/", import.meta.url);
const TEMPLATES_DIR = new URL("../../crates/ai-memory-web/templates/", import.meta.url);

const moduleURL = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");

const cryptoSource = await readFile(new URL("vendor/nostr-crypto.js", STATIC_DIR), "utf8");
const cookieTemplateSource = await readFile(new URL("_js_cookie.html", TEMPLATES_DIR), "utf8");
const nostrRawSource = await readFile(new URL("estacao-3d-nostr.js", STATIC_DIR), "utf8");

const cryptoURL = moduleURL(cryptoSource);
const cookieModuleSource = `${cookieTemplateSource}\nexport { cookie };\n`;
const cookieURL = moduleURL(cookieModuleSource);

const cryptoLib = await import(cryptoURL);
const {
  nip44,
  npubEncode,
  nsecEncode,
  finalizeEvent,
  getPublicKey,
  verifyEvent,
} = cryptoLib;

function bytesToHexLocal(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeKeypair(seedByte) {
  const privBytes = new Uint8Array(32).fill(seedByte);
  const privHex = bytesToHexLocal(privBytes);
  const pubHex = getPublicKey(privBytes);
  return {
    privBytes,
    privHex,
    nsec: nsecEncode(privHex),
    pubHex,
    npub: npubEncode(pubHex),
  };
}

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
    this._waiters = [];
    MockWebSocket.instances.push(this);
  }

  send(frame) {
    const parsed = JSON.parse(frame);
    this.sent.push(parsed);
    for (let i = this._waiters.length - 1; i >= 0; i--) {
      const waiter = this._waiters[i];
      if (waiter.predicate(parsed)) {
        this._waiters.splice(i, 1);
        waiter.resolve(parsed);
      }
    }
  }

  waitForFrame(predicate, startIndex = 0) {
    for (let i = startIndex; i < this.sent.length; i++) {
      if (predicate(this.sent[i])) return Promise.resolve(this.sent[i]);
    }
    return new Promise((resolve) => {
      this._waiters.push({ predicate, resolve });
    });
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitMessage(payload) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}
MockWebSocket.instances = [];

let moduleSeq = 0;

async function withMockBrowser(opts, fn) {
  const saved = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document,
    history: globalThis.history,
    localStorageDesc: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    WebSocket: globalThis.WebSocket,
    fetch: globalThis.fetch,
    DateNow: Date.now,
  };

  let reloads = 0;
  const storageListeners = [];
  const localStorageMock = opts.localStorage || createMemoryStorage(opts.initialStorage);
  const locationUrl = new URL(opts.url || "http://localhost/web/estacao");
  const locationMock = {
    href: locationUrl.href,
    pathname: locationUrl.pathname,
    search: locationUrl.search,
    hash: locationUrl.hash,
    reload() {
      reloads++;
    },
  };

  const windowMock = {
    crypto: globalThis.crypto,
    location: locationMock,
    nostr: opts.nostr,
    addEventListener(type, listener) {
      if (type === "storage") storageListeners.push(listener);
    },
  };

  const documentMock = {
    baseURI: opts.baseURI || "http://localhost/web/estacao",
    cookie: opts.cookie || "",
  };

  const historyMock = {
    state: null,
    replaceState() {},
  };

  MockWebSocket.instances = [];

  globalThis.window = windowMock;
  globalThis.location = locationMock;
  globalThis.document = documentMock;
  globalThis.history = historyMock;
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  globalThis.WebSocket = MockWebSocket;
  globalThis.fetch =
    opts.fetch ||
    (async () => {
      throw new Error("Unexpected fetch call in test");
    });

  const patchedSource =
    `// test-instance-${++moduleSeq}\n` +
    nostrRawSource
      .replace('"./nostr-crypto.js"', JSON.stringify(cryptoURL))
      .replace('"./estacao-cookie.js"', JSON.stringify(cookieURL));

  try {
    const mod = await import(moduleURL(patchedSource));
    return await fn({
      mod,
      windowMock,
      documentMock,
      localStorageMock,
      storageListeners,
      getReloads: () => reloads,
      getSockets: () => MockWebSocket.instances,
    });
  } finally {
    globalThis.window = saved.window;
    globalThis.location = saved.location;
    globalThis.document = saved.document;
    globalThis.history = saved.history;
    if (saved.localStorageDesc) {
      Object.defineProperty(globalThis, "localStorage", saved.localStorageDesc);
    } else {
      delete globalThis.localStorage;
    }
    globalThis.WebSocket = saved.WebSocket;
    globalThis.fetch = saved.fetch;
    Date.now = saved.DateNow;
  }
}

function parseNamedImports(source, specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`, "g");
  const names = [];
  for (const match of source.matchAll(re)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim();
      if (!clean) continue;
      const [imported] = clean.split(/\s+as\s+/);
      names.push(imported.trim());
    }
  }
  return names;
}

function parseNamedExports(source) {
  const names = new Set();
  const declRe = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declRe)) {
    names.add(match[1]);
  }
  const listRe = /export\s*\{([\s\S]*?)\}/g;
  for (const match of source.matchAll(listRe)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim();
      if (!clean) continue;
      const parts = clean.split(/\s+as\s+/);
      names.add((parts[1] || parts[0]).trim());
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// (a) Verificação de sintaxe e contrato de imports/exports
// ---------------------------------------------------------------------------

test("sintaxe válida em todos os 9 scripts estacao*.js e contrato de imports em estacao.js", async () => {
  const staticPath = fileURLToPath(STATIC_DIR);
  const files = readdirSync(staticPath)
    .filter((name) => /^estacao.*\.js$/.test(name))
    .sort();

  assert.equal(files.length, 9, `esperados 9 arquivos estacao*.js, encontrados: ${files.join(", ")}`);

  for (const file of files) {
    const absPath = fileURLToPath(new URL(file, STATIC_DIR));
    execFileSync(process.execPath, ["--check", absPath], { stdio: "pipe" });
  }

  const estacaoSource = await readFile(new URL("estacao.js", STATIC_DIR), "utf8");
  const importedFromNostr = parseNamedImports(estacaoSource, "./estacao-3d-nostr.js");
  const importedFromCookie = parseNamedImports(estacaoSource, "./estacao-cookie.js");

  assert.ok(importedFromNostr.length > 0, "estacao.js deve importar símbolos de ./estacao-3d-nostr.js");
  assert.ok(importedFromCookie.length > 0, "estacao.js deve importar símbolos de ./estacao-cookie.js");

  const nostrDeclaredExports = parseNamedExports(nostrRawSource);
  for (const sym of importedFromNostr) {
    assert.ok(
      nostrDeclaredExports.has(sym),
      `símbolo '${sym}' importado em estacao.js não está exportado em estacao-3d-nostr.js`
    );
  }

  // Confirma também os exports em tempo de execução do módulo carregado.
  await withMockBrowser({}, ({ mod }) => {
    for (const sym of importedFromNostr) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(mod, sym),
        `símbolo '${sym}' ausente nos exports runtime de estacao-3d-nostr.js`
      );
    }
  });

  // Valida contrato com templates/_js_cookie.html (servido como /static/estacao-cookie.js).
  assert.match(cookieTemplateSource, /function\s+cookie\s*\(/);
  const cookieExports = parseNamedExports(cookieModuleSource);
  for (const sym of importedFromCookie) {
    assert.ok(
      cookieExports.has(sym),
      `símbolo '${sym}' importado em estacao.js não está disponível em templates/_js_cookie.html`
    );
  }
});

// ---------------------------------------------------------------------------
// (b) Testes unitários do helper cookie() de templates/_js_cookie.html
// ---------------------------------------------------------------------------

test("helper cookie() lê múltiplos cookies, valores com '=' e ausentes", async () => {
  const savedDocument = globalThis.document;
  try {
    const { cookie } = await import(cookieURL);
    globalThis.document = {
      cookie: "tema=escuro; ai_memory_csrf=abc%3D123==fim; sessao=a=b=c; outro_nome=1; outro=2",
    };

    assert.equal(cookie("tema"), "escuro");
    assert.equal(cookie("ai_memory_csrf"), "abc%3D123==fim");
    assert.equal(cookie("sessao"), "a=b=c");
    assert.equal(cookie("outro"), "2");
    assert.equal(cookie("outro_nome"), "1");
    assert.equal(cookie("inexistente"), undefined);

    globalThis.document = { cookie: "" };
    assert.equal(cookie("tema"), undefined);
  } finally {
    globalThis.document = savedDocument;
  }
});

// ---------------------------------------------------------------------------
// (c) Testes abrangentes de crates/ai-memory-web/static/estacao-3d-nostr.js
// ---------------------------------------------------------------------------

test("bytesToHex/hexToBytes, npubToHex/validarNpub/encurtarNpub e carregarConfigNostr", async () => {
  await withMockBrowser({}, ({ mod, localStorageMock }) => {
    const sample = new Uint8Array([0x00, 0x01, 0x0f, 0x10, 0xab, 0xff]);
    assert.equal(mod.bytesToHex(sample), "00010f10abff");
    assert.deepEqual(mod.hexToBytes("  00010f10abff \n"), sample);
    assert.equal(mod.bytesToHex(new Uint8Array()), "");
    assert.equal(mod.hexToBytes("").length, 0);

    const kp = makeKeypair(0x11);
    assert.equal(mod.npubToHex(kp.npub), kp.pubHex);
    assert.equal(mod.npubToHex(`  ${kp.npub}  `), kp.pubHex);
    assert.equal(mod.validarNpub(kp.npub), true);
    assert.equal(mod.npubToHex(kp.nsec), "");
    assert.equal(mod.validarNpub(kp.nsec), false);
    assert.equal(mod.npubToHex("npub1invalido"), "");
    assert.equal(mod.validarNpub(""), false);

    assert.equal(mod.encurtarNpub("npub1curto"), "npub1curto");
    assert.equal(mod.encurtarNpub("  "), "");
    assert.equal(
      mod.encurtarNpub(kp.npub),
      `${kp.npub.slice(0, 10)}…${kp.npub.slice(-6)}`
    );

    // Sem config prévia: usa padrão e persiste no localStorage.
    const defCfg = mod.carregarConfigNostr();
    assert.equal(defCfg.relayUrl, mod.RELAY_PADRAO);
    assert.equal(defCfg.enabled, false);
    assert.match(defCfg.sessionId, /^[0-9a-f]{32}$/);
    assert.ok(localStorageMock.getItem("estacao-nostr-config-v1"));

    // Migração do relay legado ws://127.0.0.1:8080 para RELAY_PADRAO.
    localStorageMock.setItem(
      "estacao-nostr-config-v1",
      JSON.stringify({
        enabled: true,
        relayUrl: "ws://127.0.0.1:8080",
        displayName: "Operador Local",
      })
    );
    const migrado = mod.carregarConfigNostr();
    assert.equal(migrado.relayUrl, mod.RELAY_PADRAO);
    assert.equal(migrado.displayName, "Operador Local");
    assert.equal(migrado.enabled, true);

    // Relay customizado diferente permanece intacto.
    localStorageMock.setItem(
      "estacao-nostr-config-v1",
      JSON.stringify({ relayUrl: "wss://relay.custom.local" })
    );
    assert.equal(mod.carregarConfigNostr().relayUrl, "wss://relay.custom.local");
  });
});

test("entrarNostr suporta hex, nsec1, NIP-07, erro de conta divergente e valida desafio kind 20081 + headers", async () => {
  const kp = makeKeypair(0x22);
  const outro = makeKeypair(0x33);
  const desafio = "desafio-aleatorio-001";
  const csrfRaw = "csrf+token/valor=ok";
  const csrfCookie = `ai_memory_csrf=${encodeURIComponent(csrfRaw)}`;

  function makeLoginFetch(expectedPubHex, calls) {
    return async (url, init = {}) => {
      calls.push({ url, init });
      if (url === "estacao/api/desafio") {
        return Response.json(desafio);
      }
      if (url === "estacao/api/entrar") {
        const prova = JSON.parse(init.body);
        assert.equal(prova.kind, 20081);
        assert.equal(prova.pubkey, expectedPubHex);
        assert.equal(prova.content, "estacao-ai/login");
        assert.deepEqual(prova.tags, [["challenge", desafio]]);
        assert.equal(verifyEvent(prova), true);
        assert.equal(init.headers["X-Estacao-UI"], "1");
        assert.equal(init.headers["X-CSRF-Token"], csrfRaw);
        assert.equal(init.headers["X-Estacao-Dispositivo"], "1");
        return Response.json(expectedPubHex);
      }
      if (url === "estacao/api/sessao") {
        assert.equal(init.headers["X-Estacao-Sessao"], "dispositivo");
        assert.equal(init.headers["X-Estacao-Conta"], expectedPubHex);
        return Response.json(expectedPubHex);
      }
      throw new Error(`URL inesperada: ${url}`);
    };
  }

  // 1. Entrada com chave privada hex de 64 caracteres
  {
    const calls = [];
    await withMockBrowser(
      { cookie: csrfCookie, fetch: makeLoginFetch(kp.pubHex, calls) },
      async ({ mod }) => {
        await mod.entrarNostr(kp.privHex);
        assert.equal(mod.contaAtiva(), kp.pubHex);
        assert.equal(mod.temAssinador(), true);
        assert.deepEqual(
          calls.map((c) => c.url),
          ["estacao/api/desafio", "estacao/api/entrar", "estacao/api/sessao"]
        );
      }
    );
  }

  // 2. Entrada com chave privada nsec1
  {
    const calls = [];
    await withMockBrowser(
      { cookie: csrfCookie, fetch: makeLoginFetch(kp.pubHex, calls) },
      async ({ mod }) => {
        await mod.entrarNostr(kp.nsec);
        assert.equal(mod.contaAtiva(), kp.pubHex);
        assert.equal(mod.temAssinador(), true);
      }
    );
  }

  // 3. Entrada com extensão NIP-07 (segredo === null)
  {
    const calls = [];
    const nip07 = {
      async getPublicKey() {
        return kp.pubHex;
      },
      async signEvent(ev) {
        return finalizeEvent(ev, kp.privBytes);
      },
    };
    await withMockBrowser(
      { cookie: csrfCookie, nostr: nip07, fetch: makeLoginFetch(kp.pubHex, calls) },
      async ({ mod }) => {
        assert.equal(mod.temNip07(), true);
        await mod.entrarNostr(null);
        assert.equal(mod.contaAtiva(), kp.pubHex);
        assert.equal(mod.temAssinador(), true);
      }
    );
  }

  // 4. Rejeição de conta divergente, nsec1 inválida e ausência de NIP-07
  {
    let fetched = 0;
    await withMockBrowser(
      {
        cookie: csrfCookie,
        fetch: async () => {
          fetched++;
          return Response.json(kp.pubHex);
        },
      },
      async ({ mod }) => {
        await assert.rejects(
          mod.entrarNostr(kp.privHex, null, null, outro.pubHex),
          /mesma conta Nostr/
        );
        assert.equal(fetched, 0);
        assert.equal(Boolean(mod.contaAtiva()), false);
        assert.equal(mod.temAssinador(), false);

        await assert.rejects(mod.entrarNostr("nsec1invalida"), /nsec1 inválida/);
        await assert.rejects(mod.entrarNostr("chave-curta"), /64 caracteres hex/);
        await assert.rejects(mod.entrarNostr(null), /extensão Nostr/);
      }
    );
  }
});

test("dispositivo restaura pelo vínculo desktop sem copiar a credencial ao localStorage", async () => {
  const kp = makeKeypair(0x43);
  const storage = createMemoryStorage();
  let consultas = 0;
  await withMockBrowser({
    url: "http://localhost/web/estacao#estacao-vinculo=ticket-de-teste",
    localStorage: storage,
    fetch: async (url, init) => {
      if (url === "estacao/api/sessao") {
        assert.equal(init.headers["X-Estacao-Vinculo"], consultas++ === 0 ? "ticket-de-teste" : undefined);
        assert.equal(init.credentials, "same-origin");
        return Response.json(kp.pubHex);
      }
      assert.equal(init.headers["X-Estacao-Sessao"], "dispositivo");
      return new Response(null, { status: 204 });
    },
  }, async ({ mod }) => {
    assert.equal(await mod.restaurarDispositivo(), true);
    assert.equal(mod.contaAtiva(), kp.pubHex);
    assert.equal(await mod.restaurarDispositivo(), true);
    assert.equal(storage.store.size, 0);
    await mod.sairNostr();
    assert.equal(storage.store.size, 0);
  });
  await withMockBrowser({
    fetch: async () => new Response(null, { status: 401 }),
  }, async ({ mod }) => {
    assert.equal(await mod.restaurarDispositivo(), false);
    assert.equal(Boolean(mod.contaAtiva()), false);
  });
});

test("cofre AES-GCM em restaurarDispositivo grava/restaura com AAD, rejeita divergente/expirado e recarrega ao vencer prazo", async () => {
  const kp = makeKeypair(0x44);
  const outro = makeKeypair(0x55);
  const cofreKeyBytes = new Uint8Array(32).fill(0x9a);
  const cofreKeyHex = bytesToHexLocal(cofreKeyBytes);
  const sharedStorage = createMemoryStorage();
  const baseURI = "http://localhost/web/estacao";
  const expectedCofreKey = "estacao-assinador-v1:/web/estacao/api/sessao";

  const nowSec = Math.floor(Date.now() / 1000);
  const venceFuturo = nowSec + 3600;

  // 1. Grava chave local no cofre AES-GCM com AAD da conta durante entrarNostr -> restaurarDispositivo(conta)
  await withMockBrowser(
    {
      baseURI,
      localStorage: sharedStorage,
      cookie: "ai_memory_csrf=tok1",
      fetch: async (url) => {
        if (url === "estacao/api/desafio") return Response.json("ch-cofre");
        if (url === "estacao/api/entrar") return Response.json(kp.pubHex);
        if (url === "estacao/api/sessao") {
          return Response.json(kp.pubHex, {
            headers: {
              "x-estacao-cofre": cofreKeyHex,
              "x-estacao-vence": String(venceFuturo),
            },
          });
        }
        throw new Error(`URL inesperada: ${url}`);
      },
    },
    async ({ mod }) => {
      await mod.entrarNostr(kp.privHex);
      const rawVault = sharedStorage.getItem(expectedCofreKey);
      assert.ok(rawVault, "cofre cifrado deve ser salvo no localStorage");
      assert.ok(!rawVault.includes(kp.privHex), "chave privada não pode ficar em texto claro no localStorage");

      // Valida explicitamente a vinculação por AAD da conta.
      const { iv, dados } = JSON.parse(rawVault);
      const aes = await crypto.subtle.importKey("raw", cofreKeyBytes, "AES-GCM", false, ["decrypt"]);
      await assert.rejects(
        crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: mod.hexToBytes(iv),
            additionalData: new TextEncoder().encode(outro.pubHex),
          },
          aes,
          mod.hexToBytes(dados)
        )
      );
    }
  );

  // 2. Nova instância (simulando reload): restaura chave local do cofre e valida uso real + expiração em conferirPrazo
  await withMockBrowser(
    {
      baseURI,
      localStorage: sharedStorage,
      fetch: async (url) => {
        assert.equal(url, "estacao/api/sessao");
        return Response.json(kp.pubHex, {
          headers: {
            "x-estacao-cofre": cofreKeyHex,
            "x-estacao-vence": String(venceFuturo),
          },
        });
      },
    },
    async ({ mod, getReloads }) => {
      assert.equal(mod.temAssinador(), false);
      assert.equal(await mod.restaurarDispositivo(), true);
      assert.equal(mod.contaAtiva(), kp.pubHex);
      assert.equal(mod.temAssinador(), true);

      // Comprova que a chave restaurada descriptografa convites NIP-44 normalmente.
      const convKey = nip44.utils.getConversationKey(outro.privBytes, kp.pubHex);
      const payload = {
        projeto: {
          id: "sala_1",
          nome: "Sala Restaurada",
          eh_chat: true,
          dono_npub: outro.npub,
          membros_npub: [kp.npub],
        },
      };
      const convEvent = finalizeEvent(
        {
          kind: 30078,
          created_at: nowSec,
          tags: [
            ["d", "estacao-convite:" + "ab".repeat(32)],
            ["p", kp.pubHex],
          ],
          content: nip44.encrypt(JSON.stringify(payload), convKey),
        },
        outro.privBytes
      );
      const lido = await mod.lerConvite(convEvent);
      assert.equal(lido.nome, "Sala Restaurada");

      // Avança o relógio além do vencimento: conferirPrazo() deve limpar sessão, recarregar e lançar erro.
      Date.now = () => (venceFuturo + 5) * 1000;
      await assert.rejects(mod.lerConvite(convEvent), /Sua sessão Nostr expirou/);
      assert.equal(getReloads(), 1);
      assert.equal(Boolean(mod.contaAtiva()), false);
      assert.equal(mod.temAssinador(), false);
    }
  );

  // 3. Rejeição quando conta confirmada diverge da esperada ou quando cofre pertence a outra conta
  await withMockBrowser(
    {
      baseURI,
      localStorage: sharedStorage,
      fetch: async () =>
        Response.json(outro.pubHex, {
          headers: {
            "x-estacao-cofre": cofreKeyHex,
            "x-estacao-vence": String(venceFuturo),
          },
        }),
    },
    async ({ mod }) => {
      await assert.rejects(
        mod.restaurarDispositivo(kp.pubHex),
        /conta do dispositivo mudou/
      );

      // Sem `esperada`, a sessão de `outro` não consegue decifrar o cofre vinculado ao AAD de `kp`.
      assert.equal(await mod.restaurarDispositivo(), true);
      assert.equal(mod.contaAtiva(), outro.pubHex);
      assert.equal(mod.temAssinador(), false);
    }
  );

  // 4. Rejeição quando `x-estacao-vence` já está expirado
  await withMockBrowser(
    {
      baseURI,
      localStorage: sharedStorage,
      fetch: async () =>
        Response.json(kp.pubHex, {
          headers: {
            "x-estacao-cofre": cofreKeyHex,
            "x-estacao-vence": String(nowSec - 10),
          },
        }),
    },
    async ({ mod }) => {
      await assert.rejects(mod.restaurarDispositivo(kp.pubHex), /Sessão expirada/);

      // Em modo restauração (sem `esperada`), falha do cofre expirado impede restauração do assinador.
      assert.equal(await mod.restaurarDispositivo(), true);
      assert.equal(mod.temAssinador(), false);
    }
  );
});

test("requisicao envia headers de sessão e limpa+recarrega ao receber x-estacao-login", async () => {
  const kp = makeKeypair(0x66);
  const requests = [];
  let forceRelogin = false;

  await withMockBrowser(
    {
      fetch: async (url, init = {}) => {
        requests.push({ url, init });
        if (url === "estacao/api/sessao") return Response.json(kp.pubHex);
        if (forceRelogin) {
          return new Response("login required", {
            status: 401,
            headers: { "x-estacao-login": "1" },
          });
        }
        return Response.json({ ok: true });
      },
    },
    async ({ mod, getReloads }) => {
      assert.equal(await mod.restaurarDispositivo(), true);

      const okResp = await mod.requisicao("estacao/api/estado", {
        headers: { "X-Extra": "sim" },
      });
      assert.equal(okResp.status, 200);
      const req = requests.at(-1);
      assert.equal(req.init.headers["X-Estacao-Sessao"], "dispositivo");
      assert.equal(req.init.headers["X-Estacao-Conta"], kp.pubHex);
      assert.equal(req.init.headers["X-Extra"], "sim");
      assert.equal(req.init.cache, "no-store");
      assert.equal(req.init.credentials, "same-origin");
      assert.equal(getReloads(), 0);

      forceRelogin = true;
      const loginResp = await mod.requisicao("estacao/api/estado");
      assert.equal(loginResp.status, 401);
      assert.equal(getReloads(), 1);
      assert.equal(Boolean(mod.contaAtiva()), false);
      assert.equal(mod.temAssinador(), false);
    }
  );
});

test("sairNostr remove cofre do localStorage, zera sessão e recarrega a página", async () => {
  const kp = makeKeypair(0x77);
  const cofreKeyHex = "cd".repeat(32);
  const baseURI = "http://localhost/web/estacao";
  const expectedCofreKey = "estacao-assinador-v1:/web/estacao/api/sessao";
  const nowSec = Math.floor(Date.now() / 1000);
  const logoutCalls = [];

  await withMockBrowser(
    {
      baseURI,
      cookie: "ai_memory_csrf=sair-csrf",
      fetch: async (url, init = {}) => {
        if (url === "estacao/api/desafio") return Response.json("ch-sair");
        if (url === "estacao/api/entrar") return Response.json(kp.pubHex);
        if (url === "estacao/api/sessao") {
          return Response.json(kp.pubHex, {
            headers: {
              "x-estacao-cofre": cofreKeyHex,
              "x-estacao-vence": String(nowSec + 3600),
            },
          });
        }
        if (url === "estacao/api/sair") {
          logoutCalls.push(init);
          return new Response(null, { status: 204 });
        }
        throw new Error(`URL inesperada: ${url}`);
      },
    },
    async ({ mod, localStorageMock, getReloads }) => {
      await mod.entrarNostr(kp.privHex);
      assert.ok(localStorageMock.getItem(expectedCofreKey));
      assert.equal(mod.contaAtiva(), kp.pubHex);
      assert.equal(mod.temAssinador(), true);

      await mod.sairNostr();
      assert.equal(logoutCalls.length, 1);
      assert.equal(logoutCalls[0].method, "POST");
      assert.equal(logoutCalls[0].headers["X-Estacao-UI"], "1");
      assert.equal(logoutCalls[0].headers["X-CSRF-Token"], "sair-csrf");
      assert.equal(logoutCalls[0].headers["X-Estacao-Sessao"], "dispositivo");
      assert.equal(logoutCalls[0].headers["X-Estacao-Conta"], kp.pubHex);

      assert.equal(localStorageMock.getItem(expectedCofreKey), null);
      assert.equal(Boolean(mod.contaAtiva()), false);
      assert.equal(mod.temAssinador(), false);
      assert.equal(getReloads(), 1);
    }
  );
});

test("convites NIP-44: publishRoomShare (OK true/false/queda), lerConvite e conviteValido (30078 e 20079)", async () => {
  const remetente = makeKeypair(0x88);
  const destinatario = makeKeypair(0x99);
  const terceiro = makeKeypair(0xaa);
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. publishRoomShare: OK true, OK false e queda de conexão
  await withMockBrowser(
    {
      cookie: "ai_memory_csrf=share-csrf",
      fetch: async (url) => {
        if (url === "estacao/api/desafio") return Response.json("ch-share");
        if (url === "estacao/api/entrar") return Response.json(remetente.pubHex);
        if (url === "estacao/api/sessao") return Response.json(remetente.pubHex);
        throw new Error(`URL inesperada: ${url}`);
      },
    },
    async ({ mod, getSockets }) => {
      await mod.entrarNostr(remetente.privHex);
      const client = mod.criarClienteNostr({
        roomId: "sala-comp",
        profile: { pubkeyHex: remetente.pubHex, npub: remetente.npub },
      });

      const roomPayload = {
        projeto: {
          id: "proj_42",
          nome: "Projeto Compartilhado",
          eh_chat: false,
          dono_npub: remetente.npub,
          membros_npub: [remetente.npub, destinatario.npub],
        },
      };

      try {
        client.connect("wss://relay.teste");
        const socket = getSockets().at(-1);
        socket.emitOpen();

        // Caso OK true
        const startIdxOk = socket.sent.length;
        const waitOk = socket.waitForFrame((f) => f[0] === "EVENT", startIdxOk);
        const pOk = client.publishRoomShare(destinatario.npub, roomPayload);
        const evFrame = await waitOk;
        const sentEvent = evFrame[1];
        assert.equal(sentEvent.kind, 30078);
        assert.equal(verifyEvent(sentEvent), true);
        assert.ok(sentEvent.tags.some((t) => t[0] === "p" && t[1] === destinatario.pubHex));
        assert.ok(sentEvent.tags.some((t) => t[0] === "d" && /^estacao-convite:[0-9a-f]{64}$/.test(t[1])));
        socket.emitMessage(["OK", sentEvent.id, true, ""]);
        assert.equal(await pOk, true);

        // Destinatário consegue decifrar com NIP-44
        const convKey = nip44.utils.getConversationKey(destinatario.privBytes, remetente.pubHex);
        const decrypted = JSON.parse(nip44.decrypt(sentEvent.content, convKey));
        assert.equal(decrypted.projeto.id, "proj_42");

        // Caso OK false
        const startIdxFalse = socket.sent.length;
        const waitFalse = socket.waitForFrame((f) => f[0] === "EVENT", startIdxFalse);
        const pFalse = client.publishRoomShare(destinatario.npub, roomPayload);
        const evFalse = (await waitFalse)[1];
        socket.emitMessage(["OK", evFalse.id, false, "blocked: limite atingido"]);
        await assert.rejects(pFalse, /blocked: limite atingido/);

        // Caso queda de conexão antes do OK
        const startIdxDrop = socket.sent.length;
        const waitDrop = socket.waitForFrame((f) => f[0] === "EVENT", startIdxDrop);
        const pDrop = client.publishRoomShare(destinatario.npub, roomPayload);
        await waitDrop;
        socket.emitClose();
        await assert.rejects(pDrop, /relay desconectou antes de confirmar o convite/);
      } finally {
        client.disconnect();
      }
    }
  );

  // 2. lerConvite (válido + truncamento em 160 chars + rejeições) e conviteValido (30078 e 20079)
  await withMockBrowser(
    {
      cookie: "ai_memory_csrf=read-csrf",
      fetch: async (url) => {
        if (url === "estacao/api/desafio") return Response.json("ch-read");
        if (url === "estacao/api/entrar") return Response.json(destinatario.pubHex);
        if (url === "estacao/api/sessao") return Response.json(destinatario.pubHex);
        throw new Error(`URL inesperada: ${url}`);
      },
    },
    async ({ mod }) => {
      await mod.entrarNostr(destinatario.privHex);

      function makeInviteEvent(projetoObj, opts = {}) {
        const sender = opts.sender || remetente;
        const convKey = nip44.utils.getConversationKey(sender.privBytes, destinatario.pubHex);
        const ciphertext = nip44.encrypt(JSON.stringify({ projeto: projetoObj }), convKey);
        const kind = opts.kind ?? 30078;
        const tags =
          opts.tags ||
          (kind === 30078
            ? [
                ["d", "estacao-convite:" + "12".repeat(32)],
                ["p", destinatario.pubHex],
                ["expiration", String(nowSec + 3600)],
              ]
            : [["p", destinatario.pubHex]]);
        return finalizeEvent(
          {
            kind,
            created_at: opts.created_at ?? nowSec,
            tags,
            content: opts.content ?? ciphertext,
          },
          sender.privBytes
        );
      }

      // Válido + truncamento em 160 caracteres + filtro de membros inválidos
      const nomeLongo = "S".repeat(210);
      const valid30078 = makeInviteEvent({
        id: "Sala_Valid-01",
        nome: nomeLongo,
        eh_chat: true,
        dono_npub: remetente.npub,
        membros_npub: [destinatario.npub, "npub-invalido", remetente.npub],
      });
      assert.equal(mod.conviteValido(valid30078, destinatario.pubHex, [remetente.pubHex]), true);
      assert.equal(
        mod.chaveConvite(valid30078),
        `${remetente.pubHex}/estacao-convite:${"12".repeat(32)}`
      );

      const parsed = await mod.lerConvite(valid30078);
      assert.equal(parsed.id, `${remetente.pubHex}-Sala_Valid-01`);
      assert.equal(parsed.nome.length, 160);
      assert.equal(parsed.nome, "S".repeat(160));
      assert.equal(parsed.eh_chat, true);
      assert.equal(parsed.dono_npub, remetente.npub);
      assert.equal(parsed.compartilhado_por, remetente.npub);
      assert.deepEqual(parsed.membros_npub, [destinatario.npub, remetente.npub]);

      // conviteValido para kind 20079 (legado)
      const valid20079 = makeInviteEvent(
        {
          id: "legado_1",
          nome: "Sala Legada",
          dono_npub: remetente.npub,
          membros_npub: [destinatario.npub],
        },
        { kind: 20079 }
      );
      assert.equal(mod.conviteValido(valid20079, destinatario.pubHex, [remetente.pubHex]), true);
      assert.equal(mod.chaveConvite(valid20079), valid20079.id);

      // Rejeições em conviteValido
      assert.equal(mod.conviteValido(valid30078, destinatario.pubHex, [terceiro.pubHex]), false);
      assert.equal(mod.conviteValido(valid30078, terceiro.pubHex, [remetente.pubHex]), false);
      assert.equal(
        mod.conviteValido(
          makeInviteEvent({ id: "x", nome: "x", dono_npub: remetente.npub, membros_npub: [destinatario.npub] }, { created_at: nowSec - 8 * 86400 }),
          destinatario.pubHex,
          [remetente.pubHex]
        ),
        false
      );
      assert.equal(
        mod.conviteValido(
          makeInviteEvent({ id: "x", nome: "x", dono_npub: remetente.npub, membros_npub: [destinatario.npub] }, { created_at: nowSec + 120 }),
          destinatario.pubHex,
          [remetente.pubHex]
        ),
        false
      );
      assert.equal(
        mod.conviteValido(
          makeInviteEvent(
            { id: "x", nome: "x", dono_npub: remetente.npub, membros_npub: [destinatario.npub] },
            {
              tags: [
                ["d", "estacao-convite:" + "12".repeat(32)],
                ["p", destinatario.pubHex],
                ["expiration", String(nowSec - 1)],
              ],
            }
          ),
          destinatario.pubHex,
          [remetente.pubHex]
        ),
        false
      );
      const tamperedWire = JSON.parse(JSON.stringify(valid30078));
      tamperedWire.content += "x";
      assert.equal(
        mod.conviteValido(tamperedWire, destinatario.pubHex, [remetente.pubHex]),
        false
      );

      // Rejeições em lerConvite: dono_npub, id, nome, membros_npub
      const casosInvalidos = [
        {
          id: "ok_1",
          nome: "Sala",
          dono_npub: terceiro.npub,
          membros_npub: [destinatario.npub],
        },
        {
          id: "../invalido",
          nome: "Sala",
          dono_npub: remetente.npub,
          membros_npub: [destinatario.npub],
        },
        {
          id: "a".repeat(81),
          nome: "Sala",
          dono_npub: remetente.npub,
          membros_npub: [destinatario.npub],
        },
        {
          id: "ok_2",
          nome: "   ",
          dono_npub: remetente.npub,
          membros_npub: [destinatario.npub],
        },
        {
          id: "ok_3",
          nome: "Sala",
          dono_npub: remetente.npub,
          membros_npub: "nao-e-array",
        },
        {
          id: "ok_4",
          nome: "Sala",
          dono_npub: remetente.npub,
          membros_npub: [terceiro.npub],
        },
      ];

      for (const projetoInvalido of casosInvalidos) {
        const ev = makeInviteEvent(projetoInvalido);
        await assert.rejects(mod.lerConvite(ev), /Convite inválido para esta conta/);
      }
    }
  );
});

test("presença e votação no relay: publishPresence com debounce, publishSkipVote, recepção válida e rejeições", async () => {
  const local = makeKeypair(0xab);
  const peer = makeKeypair(0xbc);
  const intruso = makeKeypair(0xcd);
  const roomId = "chale-teste";

  await withMockBrowser(
    {
      cookie: "ai_memory_csrf=presence-csrf",
      fetch: async (url) => {
        if (url === "estacao/api/desafio") return Response.json("ch-pres");
        if (url === "estacao/api/entrar") return Response.json(local.pubHex);
        if (url === "estacao/api/sessao") return Response.json(local.pubHex);
        throw new Error(`URL inesperada: ${url}`);
      },
    },
    async ({ mod, getSockets }) => {
      let fakeNow = 1_750_000_000_000;
      Date.now = () => fakeNow;

      await mod.entrarNostr(local.privHex);

      const presences = [];
      const presenceLists = [];
      const skipVotes = [];

      const client = mod.criarClienteNostr({
        roomId,
        authors: [local.pubHex, peer.pubHex],
        profile: {
          pubkeyHex: local.pubHex,
          npub: local.npub,
          displayName: "Local",
          breed: "caramelo",
        },
        onRemotePresence: (p) => presences.push(p),
        onPresenceListChange: (list) => presenceLists.push(list),
        onSkipVote: (v) => skipVotes.push(v),
      });

      try {
        client.connect("wss://relay.teste");
        const socket = getSockets().at(-1);
        socket.emitOpen();

        const reqFrame = socket.sent.find((f) => f[0] === "REQ");
        assert.ok(reqFrame);
        const subId = reqFrame[1];

        // publishPresence com debounce (< 1000ms é ignorado; >= 1000ms publica)
        await client.publishPresence({ pos: { x: 1, y: 0, z: 2 }, yaw: 0.5, speed: 1, sitting: false });
        await client.publishPresence({ pos: { x: 2, y: 0, z: 3 }, yaw: 1.0, speed: 2, sitting: false });
        let presenceFrames = socket.sent.filter((f) => f[0] === "EVENT" && f[1].kind === 20077);
        assert.equal(presenceFrames.length, 1, "segunda chamada dentro de 1s deve ser ignorada pelo debounce");
        assert.equal(verifyEvent(presenceFrames[0][1]), true);
        assert.deepEqual(presenceFrames[0][1].tags[0], ["d", `estacao-room:${roomId}`]);

        fakeNow += 1100;
        await client.publishPresence({ pos: { x: 3, y: 0, z: 4 }, yaw: 1.5, speed: 0, sitting: true });
        presenceFrames = socket.sent.filter((f) => f[0] === "EVENT" && f[1].kind === 20077);
        assert.equal(presenceFrames.length, 2, "após 1s nova presença deve ser publicada");

        // publishSkipVote
        const voted = await client.publishSkipVote("ag_mediador");
        assert.equal(voted, true);
        const voteFrames = socket.sent.filter((f) => f[0] === "EVENT" && f[1].kind === 20078);
        assert.equal(voteFrames.length, 1);
        assert.equal(verifyEvent(voteFrames[0][1]), true);
        assert.deepEqual(JSON.parse(voteFrames[0][1].content), {
          npub: local.npub,
          speakerKey: "ag_mediador",
          action: "skip",
        });

        // Recepção no relay: eventos inválidos devem ser descartados
        const nowSec = Math.floor(fakeNow / 1000);
        const validPresenceEvent = finalizeEvent(
          {
            kind: 20077,
            created_at: nowSec,
            tags: [["d", `estacao-room:${roomId}`]],
            content: JSON.stringify({
              name: "Visitante",
              breed: "poodle",
              pos: { x: 4, y: 0.15, z: 5 },
              yaw: 0.25,
              speed: 0.5,
              sitting: true,
            }),
          },
          peer.privBytes
        );

        const validVoteEvent = finalizeEvent(
          {
            kind: 20078,
            created_at: nowSec,
            tags: [["d", `estacao-room:${roomId}`]],
            content: JSON.stringify({ speakerKey: "ag_dev", action: "skip" }),
          },
          peer.privBytes
        );

        // 1. Adulterado (assinatura inválida)
        socket.emitMessage(["EVENT", subId, { ...validPresenceEvent, content: '{"name":"Hacked"}' }]);
        // 2. Fora da janela de 60s (passado e futuro)
        socket.emitMessage([
          "EVENT",
          subId,
          finalizeEvent(
            { ...validPresenceEvent, created_at: nowSec - 61, id: undefined, sig: undefined },
            peer.privBytes
          ),
        ]);
        socket.emitMessage([
          "EVENT",
          subId,
          finalizeEvent(
            { ...validVoteEvent, created_at: nowSec + 61, id: undefined, sig: undefined },
            peer.privBytes
          ),
        ]);
        // 3. Autor não permitido
        socket.emitMessage([
          "EVENT",
          subId,
          finalizeEvent(
            {
              kind: 20077,
              created_at: nowSec,
              tags: [["d", `estacao-room:${roomId}`]],
              content: JSON.stringify({ name: "Intruso" }),
            },
            intruso.privBytes
          ),
        ]);
        socket.emitMessage([
          "EVENT",
          subId,
          finalizeEvent(
            {
              kind: 20078,
              created_at: nowSec,
              tags: [["d", `estacao-room:${roomId}`]],
              content: JSON.stringify({ speakerKey: "ag_dev", action: "skip" }),
            },
            intruso.privBytes
          ),
        ]);
        // 4. Sala divergente
        socket.emitMessage([
          "EVENT",
          subId,
          finalizeEvent(
            {
              kind: 20077,
              created_at: nowSec,
              tags: [["d", "estacao-room:outra-sala"]],
              content: JSON.stringify({ name: "Outra Sala" }),
            },
            peer.privBytes
          ),
        ]);

        assert.equal(presences.length, 0);
        assert.equal(skipVotes.length, 0);

        // Recepção válida de presença e voto
        socket.emitMessage(["EVENT", subId, validPresenceEvent]);
        socket.emitMessage(["EVENT", subId, validVoteEvent]);

        assert.equal(presences.length, 1);
        assert.equal(presences[0].action, "update");
        assert.equal(presences[0].npub, peer.npub);
        assert.equal(presences[0].name, "Visitante");
        assert.equal(presences[0].breed, "poodle");
        assert.equal(presences[0].sitting, true);
        assert.ok(client.getOnlineNpubs().includes(local.npub));
        assert.ok(client.getOnlineNpubs().includes(peer.npub));
        assert.ok(presenceLists.at(-1).includes(peer.npub));

        assert.equal(skipVotes.length, 1);
        assert.deepEqual(skipVotes[0], {
          npub: peer.npub,
          speakerKey: "ag_dev",
          action: "skip",
        });
      } finally {
        client.disconnect();
      }
    }
  );
});

test("definirAoPerderSessao evita reload em 401 e storage não-nulo não recarrega aba", async () => {
  const kp = makeKeypair(0x55);
  const cofreKeyHex = "ef".repeat(32);
  const baseURI = "http://localhost/web/estacao";
  const expectedCofreKey = "estacao-assinador-v1:/web/estacao/api/sessao";
  const nowSec = Math.floor(Date.now() / 1000);
  let forceRelogin = false;

  await withMockBrowser(
    {
      baseURI,
      cookie: "ai_memory_csrf=csrf-callback",
      fetch: async (url) => {
        if (url === "estacao/api/desafio") return Response.json("ch-cb");
        if (url === "estacao/api/entrar") return Response.json(kp.pubHex);
        if (url === "estacao/api/sessao") {
          return Response.json(kp.pubHex, {
            headers: {
              "x-estacao-cofre": cofreKeyHex,
              "x-estacao-vence": String(nowSec + 3600),
            },
          });
        }
        if (url === "estacao/api/estado" && forceRelogin) {
          return new Response(null, { status: 401, headers: { "x-estacao-login": "1" } });
        }
        throw new Error(`URL inesperada: ${url}`);
      },
    },
    async ({ mod, storageListeners, getReloads }) => {
      let perdeuChamado = 0;
      mod.definirAoPerderSessao(() => {
        perdeuChamado++;
      });

      await mod.entrarNostr(kp.privHex);
      assert.equal(mod.contaAtiva(), kp.pubHex);

      // Atualização de cofre em outra aba (newValue !== null) não deve recarregar nem limpar sessão.
      for (const listener of storageListeners) {
        listener({ key: expectedCofreKey, newValue: '{"atualizado":true}' });
      }
      assert.equal(getReloads(), 0);
      assert.equal(mod.contaAtiva(), kp.pubHex);

      // Remoção real (newValue === null) notifica sem dar location.reload() quando callback está ativo.
      for (const listener of storageListeners) {
        listener({ key: expectedCofreKey, newValue: null });
      }
      assert.equal(getReloads(), 0);
      assert.equal(perdeuChamado, 1);
      assert.equal(Boolean(mod.contaAtiva()), false);

      // 401 com x-estacao-login também usa callback em vez de reload.
      await mod.entrarNostr(kp.privHex);
      forceRelogin = true;
      const resp = await mod.requisicao("estacao/api/estado");
      assert.equal(resp.status, 401);
      assert.equal(getReloads(), 0);
      assert.equal(perdeuChamado, 2);
      assert.equal(Boolean(mod.contaAtiva()), false);
    }
  );
});
