import { nip44, decode, npubEncode, nsecEncode, finalizeEvent, getPublicKey, verifyEvent } from "./nostr-crypto.js";
import { cookie } from "./estacao-cookie.js";
export const RELAY_PADRAO = "wss://nostr.mom";
let chave = null, conta = "", token = "";
let remoto = null;
let extensaoAtiva = null;
let aoPerderSessaoFn = null;
let vinculoDesktop = new URLSearchParams(location.hash.slice(1)).get("estacao-vinculo");
if (vinculoDesktop) history.replaceState(history.state, "", location.pathname + location.search);

export function definirAoPerderSessao(fn) {
  aoPerderSessaoFn = typeof fn === "function" ? fn : null;
}
function notificarSessaoPerdida() {
  if (aoPerderSessaoFn) aoPerderSessaoFn();
  else window.location.reload();
}

export function bytesToHex(bytes) {
  return Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

export function hexToBytes(hex) {
  var clean = String(hex || "").trim();
  var bytes = new Uint8Array(clean.length / 2);
  for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

export function gerarContaNostr() {
  var privBytes = new Uint8Array(32);
  if (!window.crypto?.getRandomValues) throw new Error("Este navegador não oferece geração segura de chaves.");
  window.crypto.getRandomValues(privBytes);
  var privHex = bytesToHex(privBytes);
  var nsec = nsecEncode(privHex);
  var pubHex = getPublicKey(privBytes);
  var npub = npubEncode(pubHex);
  return { privHex: privHex, nsec: nsec, pubHex: pubHex, npub: npub };
}

export function npubToHex(value) {
  try {
    const { type, data } = decode(value.trim());
    return type === "npub" && /^[0-9a-f]{64}$/.test(data) ? data : "";
  } catch { return ""; }
}
export function validarNpub(value) { return Boolean(npubToHex(value)); }
export function temNip07() { return Boolean(window.nostr?.getPublicKey && window.nostr?.signEvent); }
export function contaAtiva() { return token && conta; }
export function temAssinador() { return Boolean(chave || remoto || extensaoAtiva); }

export function limparSessao() {
  remoto?.fechar();
  remoto = null;
  extensaoAtiva = null;
  if (chave) chave.fill(0);
  chave = null;
  conta = token = "";
  venceSessao = 0;
}

export async function requisicao(url, opts = {}) {
  const sessao = token;
  const headers = { ...opts.headers, "X-Estacao-Sessao": sessao };
  if (conta && sessao) headers["X-Estacao-Conta"] = conta;
  const resp = await fetch(url, { ...opts, headers, cache: "no-store", credentials: "same-origin" });
  if (resp.headers.has("x-estacao-login") && sessao && sessao === token) {
    limparSessao();
    notificarSessaoPerdida();
  }
  return resp;
}

function post(prova) {
  return { method: "POST", headers: { "Content-Type": "application/json", "X-Estacao-UI": "1",
    "X-CSRF-Token": decodeURIComponent(cookie("ai_memory_csrf") || "") }, body: JSON.stringify(prova) };
}

async function assinar(evento) {
  conferirPrazo();
  const assinador = remoto?.signer || extensaoAtiva;
  if (!chave && !assinador) throw new Error("Reconecte seu assinador Nostr no menu da conta.");
  const assinado = chave ? finalizeEvent(evento, chave) : await assinador.signEvent(evento);
  if (assinado.pubkey !== conta || !verifyEvent(assinado)) throw new Error("Assinatura Nostr inválida.");
  return assinado;
}

async function conviteNip44(operacao, pubkey, conteudo) {
  conferirPrazo();
  if (chave) {
    const segredo = nip44.utils.getConversationKey(chave, pubkey);
    try { return nip44[operacao](conteudo, segredo); } finally { segredo.fill(0); }
  }
  if (remoto) return operacao === "encrypt" ? remoto.signer.nip44Encrypt(pubkey, conteudo) : remoto.signer.nip44Decrypt(pubkey, conteudo);
  const extensao = extensaoAtiva?.nip44;
  if (!extensao?.[operacao]) throw new Error("A extensão precisa oferecer NIP-44 para compartilhar salas.");
  return extensao[operacao](pubkey, conteudo);
}

function aguardar(promessa, signal) {
  if (!signal) return promessa;
  return new Promise((resolve, reject) => {
    const cancelar = () => reject(signal.reason);
    if (signal.aborted) cancelar();
    else signal.addEventListener("abort", cancelar, {once:true});
    promessa.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancelar));
  });
}

// Reutilizamos o mesmo cliente NIP-46 durante o prazo autorizado pelo operador.
async function parearQR(mostrar, signal) {
  const { BunkerSigner, createNostrConnectURI, SimplePool, qrcode } = await import("./nostr-qr.js");
  signal.throwIfAborted();
  const transporte = window.crypto.getRandomValues(new Uint8Array(32));
  const relays = ["wss://nos.lol", "wss://relay.nsec.app"];
  const uri = createNostrConnectURI({clientPubkey:getPublicKey(transporte), relays,
    secret:bytesToHex(window.crypto.getRandomValues(new Uint8Array(16))), name:"Estação I.A",
    perms:["get_public_key","sign_event:20081","sign_event:20077","sign_event:20078","sign_event:30078","nip44_encrypt","nip44_decrypt"]});
  const codigo = qrcode(0, "M");
  codigo.addData(uri);
  codigo.make();
  const pool = new SimplePool();
  let signer;
  function fechar() {
    signer?.close().catch(() => {});
    pool.destroy();
    transporte.fill(0);
  }
  signal.addEventListener("abort", fechar, {once:true});
  try {
    const conectado = BunkerSigner.fromURI(transporte, uri, {pool}, 120000);
    mostrar(codigo.createDataURL(5, 20), uri);
    signer = await aguardar(conectado, signal);
    signal.throwIfAborted();
    return {signer, fechar, transporte};
  } catch (err) { fechar(); throw err; }
}

const nomeCofre = () => "estacao-assinador-v1:" + new URL("estacao/api/sessao", document.baseURI).pathname;
let venceSessao = 0;

function conferirPrazo() {
  if (venceSessao && Date.now() >= venceSessao) {
    limparSessao();
    notificarSessaoPerdida();
    throw new Error("Sua sessão Nostr expirou.");
  }
}

async function cofreDoAssinador(resposta, guardar) {
  const material = resposta.headers.get("x-estacao-cofre");
  if (!material) return; // Compatibilidade durante a atualização do servidor.
  const nome = nomeCofre();
  const expira = Number(resposta.headers.get("x-estacao-vence")) * 1000;
  if (!Number.isFinite(expira) || expira <= Date.now()) throw new Error("Sessão expirada.");
  venceSessao = expira;
  const aes = await crypto.subtle.importKey("raw", hexToBytes(material), "AES-GCM", false, ["encrypt","decrypt"]);
  const contexto = new TextEncoder().encode(conta);
  if (guardar) {
    const dados = chave ? {tipo:"local", segredo:bytesToHex(chave)} : remoto ?
      {tipo:"qr", transporte:bytesToHex(remoto.transporte), bunker:remoto.signer.bp} : {tipo:"extensao"};
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const texto = new TextEncoder().encode(JSON.stringify(dados));
    try {
      const cifrado = await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:contexto},aes,texto);
      localStorage.setItem(nome,JSON.stringify({iv:bytesToHex(iv),dados:bytesToHex(new Uint8Array(cifrado))}));
    } finally { texto.fill(0); }
    return;
  }
  const salvo = localStorage.getItem(nome);
  if (!salvo) return;
  const {iv,dados} = JSON.parse(salvo);
  const claro = new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:hexToBytes(iv),additionalData:contexto},aes,hexToBytes(dados)));
  try {
    const registro = JSON.parse(new TextDecoder().decode(claro));
    if (registro.tipo === "local") {
      const bytes = hexToBytes(registro.segredo);
      if (getPublicKey(bytes) !== conta) throw new Error("Conta do assinador divergente.");
      chave = bytes;
    } else if (registro.tipo === "extensao") {
      if (temNip07()) extensaoAtiva = window.nostr;
    } else if (registro.tipo === "qr") {
      const {BunkerSigner, SimplePool} = await import("./nostr-qr.js");
      const transporte = hexToBytes(registro.transporte), pool = new SimplePool();
      const signer = BunkerSigner.fromBunker(transporte,registro.bunker,{pool});
      remoto = {signer, transporte, fechar() { signer.close().catch(()=>{}); pool.destroy(); transporte.fill(0); }};
    }
  } finally { claro.fill(0); }
}

export async function restaurarDispositivo(esperada) {
  const headers = {"X-Estacao-Sessao":"dispositivo"};
  if (esperada) headers["X-Estacao-Conta"] = esperada;
  if (!esperada && vinculoDesktop) headers["X-Estacao-Vinculo"] = vinculoDesktop;
  const r = await fetch("estacao/api/sessao", {headers, credentials:"same-origin", cache:"no-store"});
  if (r.status === 401) return false;
  if (!r.ok) throw new Error("Não foi possível consultar a sessão. Tente novamente.");
  const confirmada = await r.json();
  if (esperada && esperada !== confirmada) throw new Error("A conta do dispositivo mudou.");
  vinculoDesktop = null;
  conta = confirmada;
  token = "dispositivo";
  if (esperada) await cofreDoAssinador(r, true);
  else {
    // Dispositivos da versão anterior ainda podem abrir o painel; a chave anterior só existia na aba.
    try { await cofreDoAssinador(r, false); } catch { /* vínculo indisponível, permita reconectar o assinador */ }
  }
  return true;
}

export async function entrarNostr(segredo, mostrarQR, signal, contaEsperada) {
  limparSessao();
  try {
    if (mostrarQR) {
      remoto = await parearQR(mostrarQR, signal);
      conta = await aguardar(remoto.signer.getPublicKey(), signal);
      signal.throwIfAborted();
    } else if (segredo === null) {
      if (!temNip07()) throw new Error("Abra sua extensão Nostr para entrar.");
      conta = await window.nostr.getPublicKey();
      extensaoAtiva = window.nostr;
    } else {
      var raw = String(segredo || "").trim();
      if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        chave = hexToBytes(raw);
        conta = getPublicKey(chave);
      } else if (raw.startsWith("nsec1")) {
        try {
          const { type, data } = decode(raw);
          if (type !== "nsec" || data.length !== 32) throw Error();
          chave = data;
          conta = getPublicKey(chave);
        } catch { throw new Error("Chave privada nsec1 inválida."); }
      } else {
        throw new Error("Informe a chave privada da sua conta Nostr (formato nsec1… ou 64 caracteres hex).");
      }
    }
    if (contaEsperada && conta !== contaEsperada) throw new Error("Selecione a mesma conta Nostr que está aberta nesta Estação.");
    const res = await requisicao("estacao/api/desafio");
    if (!res.ok) throw new Error("Não foi possível obter o desafio de login.");
    const prova = await aguardar(assinar({kind: 20081, created_at: Math.floor(Date.now()/1000),
      tags: [["challenge", await res.json()]], content: "estacao-ai/login"}), signal);
    signal?.throwIfAborted();
    const pedido = post(prova);
    pedido.headers["X-Estacao-Dispositivo"] = "1";
    if (vinculoDesktop) pedido.headers["X-Estacao-Vinculo"] = vinculoDesktop;
    const login = await requisicao("estacao/api/entrar", {...pedido, signal});
    if (login.status === 403) throw new Error("Use a conta Nostr vinculada a esta Estação. Para vincular outra conta, abra o atalho no computador onde a Estação está instalada.");
    if (!login.ok) throw new Error("A Estação recusou o login (" + login.status + ").");
    vinculoDesktop = null;
    if (await login.json() !== conta) throw new Error("A conta confirmada é diferente da conta solicitada.");
    if (!await restaurarDispositivo(conta)) throw new Error("O navegador não aceitou o cookie deste dispositivo. Use HTTPS ou localhost.");
  } catch (err) { limparSessao(); throw err; }
}

export async function sairNostr() {
  const r = await requisicao("estacao/api/sair", post(null));
  if (!r.ok) throw new Error("Não foi possível encerrar a sessão. Tente novamente.");
  try { localStorage.removeItem?.(nomeCofre()); } catch {}
  limparSessao(); window.location.reload();
}

window.addEventListener?.("storage", ev => {
  // Só encerra a sessão local quando o cofre é explicitamente removido em outra aba (sair),
  // evitando recarregamentos quando outra aba grava ou atualiza o mesmo cofre.
  if (ev.key === nomeCofre() && ev.newValue === null && token) {
    limparSessao();
    notificarSessaoPerdida();
  }
});

const STORAGE_KEY = "estacao-nostr-config-v1";
const PRESENCE_KIND = 20077;
const VOTE_KIND = 20078;
const SHARE_KIND = 30078;
const LEGACY_SHARE_KIND = 20079;
const INVITE_TTL = 7 * 86400;

export function chaveConvite(event) {
  if (event.kind === LEGACY_SHARE_KIND) return event.id;
  const d = event.tags.find(t => t[0] === "d")?.[1];
  return /^estacao-convite:[0-9a-f]{64}$/.test(d) ? event.pubkey + "/" + d : "";
}

export function conviteValido(event, destinatario, autores) {
  const agora = Math.floor(Date.now()/1000);
  try {
    return [SHARE_KIND, LEGACY_SHARE_KIND].includes(event.kind) && autores.includes(event.pubkey) &&
      event.created_at > agora - INVITE_TTL && event.created_at <= agora + 60 &&
      event.content.length <= 65536 && event.tags.some(t => t[0] === "p" && t[1] === destinatario) &&
      event.tags.every(t => t[0] !== "expiration" || Number(t[1]) > agora) &&
      Boolean(chaveConvite(event)) && verifyEvent(event);
  } catch { return false; }
}

export async function lerConvite(event) {
  const {projeto: p} = JSON.parse(await conviteNip44("decrypt", event.pubkey, event.content));
  const dono = npubEncode(event.pubkey);
  if (p?.dono_npub !== dono || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
      typeof p.nome !== "string" || !p.nome.trim() || !Array.isArray(p.membros_npub) ||
      !p.membros_npub.includes(npubEncode(conta))) throw new Error("Convite inválido para esta conta.");
  return {id:event.pubkey + "-" + p.id, nome:p.nome.slice(0,160), eh_chat:p.eh_chat === true,
    dono_npub:dono, compartilhado_por:dono, membros_npub:p.membros_npub.filter(validarNpub)};
}

export const RACAS_CACHORRO = [
  { id: "caramelo", nome: "Caramelo", desc: "Vira-lata caramelo clássico, orelhas espertas e rabo alegre", cor: "#c8823c" },
  { id: "salsicha", nome: "Salsicha", desc: "Dachshund alongado, patinhas curtas e orelhas compridas", cor: "#6b3e26" },
  { id: "bulldog", nome: "Bulldog", desc: "Robusto, focinho largo expressivo e porte firme", cor: "#b58b67" },
  { id: "shiitsu", nome: "Shih-tzu", desc: "Peludo fofinho com orelhas longas e topete charmoso", cor: "#d8ccb8" },
  { id: "poodle", nome: "Poodle", desc: "Elegante, topete cacheado e pompons fofos", cor: "#e7e2da" },
  { id: "husky", nome: "Husky Siberiano", desc: "Pelagem cinza e branca marcante com olhos azuis e orelhas pontudas", cor: "#7a8694" },
  { id: "golden", nome: "Golden Retriever", desc: "Dourado acolhedor, orelhas macias caídas e sorriso simpático", cor: "#d9a24c" },
  { id: "dalmata", nome: "Dálmata", desc: "Branco clássico com pintinhas pretas e coleira vermelha", cor: "#f4f4f5" },
  { id: "corgi", nome: "Corgi", desc: "Patinhas curtas, orelhas grandes eretas e peito branquinho", cor: "#d9823b" },
  { id: "shiba", nome: "Shiba Inu", desc: "Ruivo vibrante com bochechas creme e rabinho enrolado", cor: "#c96a2b" }
];

export function encurtarNpub(npub) {
  var s = String(npub || "").trim();
  if (s.length <= 18) return s;
  return s.slice(0, 10) + "…" + s.slice(-6);
}

function randomHex(bytes) {
  var arr = new Uint8Array(bytes);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    for (var i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

export function carregarConfigNostr() {
  var def = {
    enabled: false,
    relayUrl: RELAY_PADRAO,
    displayName: "Operador",
    breed: "caramelo",
    npub: "",
    pubkeyHex: "",
    accent: "#34d399",
    sessionId: randomHex(16)
  };
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed?.relayUrl === "ws://127.0.0.1:8080") delete parsed.relayUrl;
      return Object.assign(def, parsed || {});
    }
  } catch (_) {}
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(def)); } catch (_) {}
  return def;
}

export function salvarConfigNostr(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) {}
}

export function criarClienteNostr(opts) {
  opts = opts || {};
  var roomId = String(opts.roomId || "default");
  var onRemotePresence = opts.onRemotePresence || function () {};
  var onPresenceListChange = opts.onPresenceListChange || function () {};
  var onSkipVote = opts.onSkipVote || function () {};
  var onRoomShare = opts.onRoomShare || function () {};
  var onStatusChange = opts.onStatusChange || function () {};
  var config = carregarConfigNostr();
  if (opts.profile) {
    config = Object.assign(config, opts.profile);
    salvarConfigNostr(config);
  }
  var ws = null;
  var status = "offline"; // offline | connecting | connected | error
  var lastError = "";
  var subId = "estacao-" + randomHex(6);
  var lastPublishAt = 0, publishing = false;
  var activePeers = new Map();
  var pruneTimer = null;
  const aguardandoRelay = new Map();

  function getOnlineNpubs() {
    var set = new Set();
    if (config.npub) set.add(config.npub);
    activePeers.forEach(function (peer) {
      if (peer && peer.payload && peer.payload.npub) set.add(peer.payload.npub);
    });
    return Array.from(set);
  }

  function notifyPresenceList() {
    onPresenceListChange(getOnlineNpubs());
  }

  function setStatus(next, err) {
    status = next;
    lastError = err || "";
    onStatusChange({ status: status, error: lastError, peers: activePeers.size, config: config, onlineNpubs: getOnlineNpubs() });
  }

  async function sendEvent(unsigned, confirmar = false) {
    const socket = ws;
    if (!token || config.pubkeyHex !== conta || socket?.readyState !== WebSocket.OPEN) return false;
    if (!temAssinador() || status === "signer") return false;
    let signed;
    try { signed = await assinar(unsigned); }
    catch (err) {
      if (socket === ws) setStatus("signer", err?.message || "O assinador recusou o evento.");
      if (confirmar) throw new Error("O convite não foi assinado. Reconecte o assinador da sua conta.");
      return false;
    }
    if (socket !== ws || socket.readyState !== WebSocket.OPEN || !token) return false;
    if (!confirmar) {
      socket.send(JSON.stringify(["EVENT", signed]));
      return true;
    }
    return new Promise((resolve, reject) => {
      const fim = (ok, motivo) => {
        clearTimeout(timer);
        aguardandoRelay.delete(signed.id);
        if (ok) resolve(true); else reject(new Error(motivo || "O relay recusou o convite."));
      };
      const timer = setTimeout(() => fim(false, "O relay não confirmou o convite. Tente novamente."), 10000);
      aguardandoRelay.set(signed.id, fim);
      try { socket.send(JSON.stringify(["EVENT", signed])); }
      catch { fim(false, "A conexão caiu antes de enviar o convite."); }
    });
  }

  function connect(customRelay) {
    disconnect();
    if (customRelay) config.relayUrl = customRelay.trim();
    config.enabled = true;
    salvarConfigNostr(config);
    var url = (config.relayUrl || "").trim();
    if (!/^wss?:\/\//i.test(url)) {
      setStatus("error", "URL de relay inválida (use ws:// ou wss://)");
      return;
    }
    setStatus("connecting", "");
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus("error", e.message || "Falha ao abrir WebSocket");
      return;
    }

    const socket = ws;
    ws.addEventListener("open", function () {
      if (socket !== ws) return;
      setStatus("connected", "");
      notifyPresenceList();
      if (!temAssinador()) setStatus("signer", "Reconecte o assinador para participar da sala.");
      var filters = [
        {
          kinds: [PRESENCE_KIND, VOTE_KIND],
          "#d": ["estacao-room:" + roomId],
          since: Math.floor(Date.now() / 1000) - 60
        }
      ];
      if (opts.authors) {
        filters[0].authors = opts.authors.length ? opts.authors : [config.pubkeyHex];
      }
      var myHex = config.pubkeyHex || npubToHex(config.npub);
      if (myHex && opts.onRoomShare) {
        filters.push({
          kinds: [SHARE_KIND, LEGACY_SHARE_KIND],
          authors: filters[0].authors,
          "#p": [myHex],
          since: Math.floor(Date.now() / 1000) - INVITE_TTL
        });
      }
      try {
        ws.send(JSON.stringify(["REQ", subId].concat(filters)));
      } catch (_) {}
      pruneTimer = setInterval(function () {
        var now = Date.now();
        var changed = false;
        activePeers.forEach(function (peer, key) {
          if (now - peer.seenAt > 20000) {
            activePeers.delete(key);
            onRemotePresence({ action: "leave", id: key, npub: peer.payload && peer.payload.npub });
            changed = true;
          }
        });
        if (changed) {
          notifyPresenceList();
          setStatus(status, lastError);
        }
      }, 5000);
    });

    ws.addEventListener("message", async function (ev) {
      if (ws !== socket) return;
      var msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === "OK" && aguardandoRelay.has(msg[1])) {
        aguardandoRelay.get(msg[1])(msg[2] === true, msg[3]);
        return;
      }
      if (msg[0] === "CLOSED" || (msg[0] === "OK" && msg[2] === false)) {
        setStatus("error", String(msg.at(-1))); return;
      }
      if (msg[0] !== "EVENT" || msg[1] !== subId || !msg[2]) return;
      var event = msg[2];
      if (event.kind === SHARE_KIND || event.kind === LEGACY_SHARE_KIND) {
        if (opts.onRoomShare && conviteValido(event, contaAtiva(), opts.authors || [])) onRoomShare(event);
        return;
      }
      try { if (!verifyEvent(event)) return; } catch { return; }
      const autor = npubEncode(event.pubkey);
      if (opts.authors && !opts.authors.includes(event.pubkey)) return;
      if (!event.tags.some(t => t[0] === "d" && t[1] === "estacao-room:" + roomId) ||
                 Math.abs(Date.now()/1000 - event.created_at) > 60) return;
      var payload = null;
      try {
        if (ws !== socket || !token) return;
        payload = JSON.parse(event.content);
      } catch { return; }

      if (!payload || typeof payload !== "object") return;
      payload.npub = autor;
      if (event.kind === PRESENCE_KIND) {
        var peerId = payload.npub || payload.sessionId || event.pubkey || "";
        if (!peerId || peerId === config.sessionId || (config.npub && peerId === config.npub)) return;
        var isNew = !activePeers.has(peerId);
        activePeers.set(peerId, { seenAt: Date.now(), payload: payload });
        onRemotePresence({
          action: "update",
          id: peerId,
          npub: payload.npub || "",
          name: payload.name || "Operador",
          breed: payload.breed || "caramelo",
          role: "Operador (Nostr)",
          accent: payload.accent || "#38bdf8",
          pos: payload.pos || { x: 0, y: 0.15, z: 6.4 },
          yaw: Number(payload.yaw || 0),
          speed: Number(payload.speed || 0),
          sitting: Boolean(payload.sitting)
        });
        if (isNew) notifyPresenceList();
        setStatus(status, lastError);
      } else if (event.kind === VOTE_KIND) {
        var voter = payload.npub || payload.sessionId || event.pubkey || "";
        if (voter && payload.speakerKey) {
          onSkipVote({ npub: voter, speakerKey: payload.speakerKey, action: payload.action || "skip" });
        }
      }
    });

    ws.addEventListener("error", function () {
      if (socket !== ws) return;
      setStatus("error", "Não foi possível conectar ao relay " + url);
    });

    ws.addEventListener("close", function () {
      if (socket !== ws) return;
      for (const fim of aguardandoRelay.values()) fim(false, "O relay desconectou antes de confirmar o convite.");
      if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
      if (status !== "error") setStatus("offline", "");
    });
  }

  function disconnect() {
    for (const fim of aguardandoRelay.values()) fim(false, "A conexão foi encerrada antes de confirmar o convite.");
    if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
        ws.close();
      } catch (_) {}
      ws = null;
    }
    activePeers.forEach(function (peer, key) {
      onRemotePresence({ action: "leave", id: key, npub: peer.payload && peer.payload.npub });
    });
    activePeers.clear();
    notifyPresenceList();
    setStatus("offline", "");
  }

  async function publishPresence(state) {
    if (status !== "connected" || !temAssinador() || !ws || ws.readyState !== WebSocket.OPEN) return;
    var now = Date.now();
    if (publishing || now - lastPublishAt < 1000) return;
    publishing = true;
    lastPublishAt = now;
    await sendEvent({
      kind: PRESENCE_KIND,
      created_at: Math.floor(now / 1000),
      tags: [["d", "estacao-room:" + roomId], ["client", "estacao-ai"]],
      content: JSON.stringify({
        sessionId: config.sessionId,
        npub: config.npub || "",
        name: config.displayName || "Operador",
        breed: config.breed || "caramelo",
        accent: config.accent || "#34d399",
        pos: state.pos,
        yaw: state.yaw,
        speed: state.speed || 0,
        sitting: Boolean(state.sitting),
        zone: state.zone || ""
      })
    }).finally(() => { publishing = false; });
  }

  async function publishSkipVote(speakerKey) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    return sendEvent({
      kind: VOTE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", "estacao-room:" + roomId], ["client", "estacao-ai"]],
      content: JSON.stringify({
        npub: config.npub || config.sessionId,
        speakerKey: String(speakerKey || ""),
        action: "skip"
      })
    });
  }

  async function publishRoomShare(targetNpub, roomPayload) {
    if (!temAssinador() || status === "signer") throw new Error("Reconecte seu assinador Nostr antes de enviar o convite.");
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    var targetHex = npubToHex(targetNpub);
    if (!targetHex) return false;
    const slot = new TextEncoder().encode(JSON.stringify([targetHex, roomPayload.projeto.id]));
    const d = "estacao-convite:" + bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", slot)));
    const now = Math.floor(Date.now() / 1000);
    return sendEvent({
      kind: SHARE_KIND,
      created_at: now,
      tags: [["d", d], ["p", targetHex], ["expiration", String(now + INVITE_TTL)], ["client", "estacao-ai"]],
      content: await conviteNip44("encrypt", targetHex, JSON.stringify(roomPayload))
    }, true);
  }

  function updateProfile(patch) {
    config = Object.assign({}, config, patch || {});
    salvarConfigNostr(config);
    setStatus(status, lastError);
  }

  return {
    get config() { return config; },
    get status() { return status; },
    get lastError() { return lastError; },
    getOnlineNpubs,
    hasNip07: temNip07,
    connect,
    disconnect,
    publishPresence,
    publishSkipVote,
    publishRoomShare,
    updateProfile
  };
}
