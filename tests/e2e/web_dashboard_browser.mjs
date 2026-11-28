#!/usr/bin/env node
// Real Chromium + the built Rust server. No npm dependencies or DOM substitutes.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = path.resolve(process.env.AI_MEMORY_BIN || path.join(root, 'target/debug/estacao-ai'));
const artifacts = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ai-memory-web-e2e-'));
fs.chmodSync(artifacts, 0o700);
const token = 'FAKEfake0123456789WebDashboardRoot';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function contrast(a, b) {
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255;return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const mutation = process.argv.find(arg => arg.startsWith('--mutation='))?.split('=')[1];
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.split('=')[1];
const mutations = {
  'all-panels-visible': {test: 'tabs', from: 'panel.hidden=!selected', to: 'panel.hidden=false'},
  'disable-live-refresh': {test: 'live-usage', from: 'timer=setTimeout(refresh,10000);', to: 'timer=0;'},
  'disable-session-live-refresh': {test: 'session-live-usage', from: 'timer=setTimeout(refresh,10000);', to: 'timer=0;'},
  'drop-usage-query': {test: 'call-history', from: 'new FormData(form).forEach(function(value,key){url.searchParams.set(key,value);});', to: 'void form;'},
  'forget-theme': {test: 'themes', from: 'localStorage.setItem(key,selected)', to: 'void selected'},
  'steal-browser-shortcut': {test: 'tabs', from: 'if(event.altKey||event.ctrlKey||event.metaKey)return;', to: ''},
  'disable-release-auto-submit': {test: 'documentation', from: 'releaseSelect.form.requestSubmit();', to: 'void releaseSelect;'},
  'restore-stale-release-on-history': {test: 'documentation', from: 'releaseSelect.form.reset();', to: 'void releaseSelect;'},
};
assert(!mutation || mutations[mutation], 'Unknown mutation');
const report = {mutation: mutation || null, mutationApplied: 0, cases: []};
const children = [];
let cdp;

function chromePath() {
  if (process.env.AI_MEMORY_BROWSER) return process.env.AI_MEMORY_BROWSER;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(cache)) {
    const versions = fs.readdirSync(cache).filter(name => /^chromium_headless_shell-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
    for (const version of versions) {
      const executable = path.join(cache, version, 'chrome-headless-shell-linux64/chrome-headless-shell');
      if (fs.existsSync(executable)) return executable;
    }
  }
  const systemNames = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  const searchDirs = [...new Set([
    ...(process.env.PATH ? process.env.PATH.split(path.delimiter).filter(Boolean) : []),
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
  ])];
  const isExecutable = candidate => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  };
  for (const name of systemNames) {
    for (const dir of searchDirs) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  for (const candidate of ['/opt/google/chrome/google-chrome']) {
    if (isExecutable(candidate)) return candidate;
  }
  throw Error('Chromium required: set AI_MEMORY_BROWSER or install the pinned browser from docs/testing-dashboard.md');
}

function launch(executable, args, env, log) {
  const fd = fs.openSync(path.join(artifacts, log), 'w', 0o600);
  try {
    const child = spawn(executable, args, {cwd: artifacts, env, stdio: ['ignore', fd, fd]});
    child.completion = new Promise(resolve => {
      child.once('error', error => resolve({error: error.message}));
      child.once('exit', code => resolve({code}));
    });
    children.push(child);
    return child;
  } finally { fs.closeSync(fd); }
}

async function until(predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do {
    if (await predicate()) return;
    await delay(50);
  } while (Date.now() < deadline);
  assert.fail(label);
}

// Values interpolated into code sent to Runtime.evaluate: escape the characters
// JSON leaves raw that can end or re-parse a script, not only quotes.
const literal = value => JSON.stringify(value).replace(/[<>\/\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

class Cdp {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.listeners = new Map(); this.errors = [];
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Error(message.error.message)); else pending.resolve(message.result);
      } else {
        if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
        const listener = this.listeners.get(message.method);
        if (typeof listener === 'function') Promise.resolve(listener(message)).catch(error => this.errors.push(error.message));
      }
    };
    socket.onclose = () => {
      for (const pending of this.pending.values()) {clearTimeout(pending.timer);pending.reject(Error('Chromium disconnected'));}
      this.pending.clear();
    };
  }
  send(method, params = {}, sessionId = this.sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {this.pending.delete(id);reject(Error('CDP timeout: ' + method));}, 10000);
      this.pending.set(id, {resolve, reject, timer});
      this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async goto(url, selector, expected = url) {
    await this.send('Page.navigate', {url});
    await until(() => this.evaluate(`location.href===${literal(expected)}&&document.readyState==='complete'&&!!document.querySelector(${literal(selector)})`), 'Page did not load: ' + selector);
  }
  async reload() {
    await this.evaluate('window.reloadMarker=true');await this.send('Page.reload');
    await until(() => this.evaluate('!window.reloadMarker&&document.readyState==="complete"'), 'Page did not reload');
  }
  async key(key) {
    await this.send('Input.dispatchKeyEvent', {type: 'keyDown', key});
    await this.send('Input.dispatchKeyEvent', {type: 'keyUp', key});
  }
}

async function installInviteFixture() {
  const fetchOriginal = window.fetch.bind(window);
  const {getPublicKey, npubEncode, finalizeEvent, nip44} = await import(new URL('static/nostr-crypto.js', document.baseURI));
  const recipientKey = new Uint8Array(32).fill(1);
  const senderKey = new Uint8Array(32).fill(2);
  const recipient = getPublicKey(recipientKey), sender = getPublicKey(senderKey);
  const owner = npubEncode(sender), member = npubEncode(recipient);
  const conversationKey = nip44.utils.getConversationKey(senderKey, recipient);
  const invitation = (id, nome, digit) => finalizeEvent({
    kind: 30078, created_at: Math.floor(Date.now() / 1000) - 3600,
    tags: [['p', recipient], ['d', 'estacao-convite:' + digit.repeat(64)]],
    content: nip44.encrypt(JSON.stringify({projeto:{id, nome, eh_chat:true, dono_npub:owner, membros_npub:[member]}}), conversationKey),
  }, senderKey);
  // A relay replays the same signed events on reconnect, including their IDs.
  const retained = sessionStorage.getItem('fixture-relay-events');
  const [first, second] = retained ? JSON.parse(retained) : [
    invitation('first', 'Sala de teste', '1'),
    invitation('second', 'Outro convite', '2'),
  ];
  if (!retained) sessionStorage.setItem('fixture-relay-events', JSON.stringify([first, second]));
  const inboxKey = 'estacao-convites-v1:' + recipient;
  const roomKey = 'estacao-test-shared-room';
  window.__inviteFixture = {inboxKey, first, second, secret:Array.from(recipientKey, byte => byte.toString(16).padStart(2,'0')).join('')};
  window.__estacaoAutoConfigurado = true;
  window.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() { super(); setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
    send(frame) {
      const [type, id, , invitationFilter] = JSON.parse(frame);
      if (type === 'REQ' && invitationFilter?.kinds.includes(30078)) {
        this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(['EVENT', id, first])}));
      }
    }
    close() { this.readyState = 3; }
  };
  window.fetch = async (url, options) => {
    const endpoint = new URL(url, document.baseURI).pathname.split('/estacao/api/')[1];
    if (endpoint === 'entrar') { sessionStorage.setItem("fixture-login","1"); return Response.json(recipient); }
    if (endpoint === 'sessao') return sessionStorage.getItem("fixture-login") ?
      Response.json(recipient,{headers:{"x-estacao-cofre":"cd".repeat(32),"x-estacao-vence":String(Math.floor(Date.now()/1000)+86400)}}) : new Response(null,{status:401});
    if (endpoint === 'desafio') return Response.json('browser-test-challenge');
    if (endpoint === 'atualizacao') return Response.json({disponivel: false});
    if (endpoint === 'estado') {
      const accepted = JSON.parse(localStorage.getItem(roomKey));
      return Response.json({
        nostr_perfil:{npub:member,pubkey_hex:recipient,autenticado:true},
        nostr_contatos:[{npub:owner,apelido:'Remetente de teste'}],
        projetos:accepted ? [accepted] : [], agentes:[], mensagens:[], tarefas:[],
      });
    }
    if (endpoint === 'acao') {
      const action = JSON.parse(options.body);
      if (action.tipo === 'sincronizar_sala_compartilhada') {
        await new Promise(resolve => { window.__inviteFixture.finish = resolve; });
        localStorage.setItem(roomKey, JSON.stringify({...action.projeto, compartilhado:true, agentes:[]}));
      }
      return Response.json(null);
    }
    return fetchOriginal(url, options);
  };
}

async function main() {
  assert(fs.existsSync(binary), 'Build estacao-ai first or set AI_MEMORY_BIN');
  const browserBinary = chromePath();
  const portSocket = net.createServer();await new Promise(resolve => portSocket.listen(0, '127.0.0.1', resolve));
  const port = portSocket.address().port;await new Promise(resolve => portSocket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AI_MEMORY_')));
  env.AI_MEMORY_AUTH_TOKEN = token;
  const server = launch(binary, ['--data-dir', path.join(artifacts, 'server'), 'serve', '--transport', 'http', '--bind', `127.0.0.1:${port}`, '--enable-web', '--no-watcher', '--workspace', 'team', '--project', 'app'], env, 'server.log');
  const request = async (route, payload) => {
    const response = await fetch(base + route, {method: payload === undefined ? 'GET' : 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Estacao-AI-UI': '1'}, ...(payload === undefined ? {} : {body: JSON.stringify(payload)}), signal: AbortSignal.timeout(15000)});
    assert(response.ok, `Fixture request ${route.split('?')[0]} returned ${response.status}`);
    return response;
  };
  await until(async () => {
    assert(server.exitCode === null, 'Isolated server exited');
    try {return (await fetch(base + '/web/', {headers: {Authorization: 'Bearer ' + token}})).ok;} catch {return false;}
  }, 'Isolated server failed to start');
  const sessions = new Map();
  for (const [workspace, project, agent] of [['team','app','codex'], ['team','app','claude-code'], ['team','other','claude-code'], ['other','app','gemini-cli']]) {
    const id = crypto.randomUUID();sessions.set(workspace + '/' + project + '/' + agent, id);
    await request('/hook?' + new URLSearchParams({workspace, project, agent, event: 'session-start'}), {session_id: id, cwd: path.join(artifacts, workspace, project)});
  }
  for (const project of ['app', 'empty']) await request('/admin/write-page', {workspace: 'team', project, path: 'concepts/fixture.md', title: 'Synthetic knowledge', body: '# Synthetic knowledge\n\nPublic fixture only.'});
  const id = sessions.get('team/app/codex');
  const calls = Array.from({length: 5}, (_, i) => ({call_id: 'response-' + i, input_tokens: i === 4 ? 150000 : 1000, output_tokens: i === 3 ? 25000 : 100, cache_read_tokens: 200, cache_write_tokens: 10, model: 'codex-fixture'}));
  const usage = async value => request('/hook?' + new URLSearchParams({workspace: 'team', project: 'app', agent: 'codex', event: 'post-tool-use'}), {session_id: id, tool_name: 'Bash', tool_input: {command: 'echo fixture'}, tool_response: 'fixture', _ai_memory_usage_calls: value});
  await usage(calls);await usage(calls);
  // The Nostr case uses its own signed invite fixture and does not open the usage dashboard.
  if (selectedCase !== 'nostr-invites') await until(async () => {
    const response = await request('/web/w/team/app');return (await response.text()).includes('Chamadas capturadas</span><strong>5</strong>');
  }, 'Hook reports never reached the real server');
  const profile = path.join(artifacts, 'chromium');
  launch(browserBinary, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], env, 'browser.log');
  const active = path.join(profile, 'DevToolsActivePort');await until(() => fs.existsSync(active), 'Chromium did not start');
  const debugPort = fs.readFileSync(active, 'utf8').split('\n')[0];
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve, reject) => {socket.onopen = resolve;socket.onerror = reject;});
  cdp = new Cdp(socket);
  const {targetId} = await cdp.send('Target.createTarget', {url: 'about:blank'});
  cdp.sessionId = (await cdp.send('Target.attachToTarget', {targetId, flatten: true})).sessionId;
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  if (selectedCase !== 'nostr-invites') {
    // Pair the temporary browser with its own server through the desktop login.
    const ticket = randomUUID();
    fs.writeFileSync(path.join(artifacts, 'server', '.nostr-desktop'),
      createHash('sha256').update(ticket).digest('hex'), {mode: 0o600, flag: 'wx'});
    const chat = base + '/web/chat';
    await cdp.goto(chat + '#estacao-vinculo=' + ticket, '#nostr-chave', chat);
    await cdp.evaluate(`(async () => {
      const auth = await import(new URL('static/estacao-3d-nostr.js', document.baseURI));
      await auth.entrarNostr(auth.gerarContaNostr().privHex);
    })()`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false});
  if (mutation) {
    const change = mutations[mutation];
    const paused = async message => {
      const p = message.params;
      if (change && p.responseStatusCode === 200 && p.responseHeaders?.some(h => h.name.toLowerCase() === 'content-type' && h.value.includes('text/html'))) {
        const body = await cdp.send('Fetch.getResponseBody', {requestId: p.requestId});
        let html = body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body;
        if (html.includes(change.from)) {html = html.split(change.from).join(change.to);report.mutationApplied++;}
        await cdp.send('Fetch.fulfillRequest', {requestId: p.requestId, responseCode: 200, responseHeaders: p.responseHeaders.filter(h => !['content-length','content-encoding'].includes(h.name.toLowerCase())), body: Buffer.from(html).toString('base64')});
      } else await cdp.send('Fetch.continueRequest', {requestId: p.requestId});
    };
    // A Page.reload, or the notification poll's own 5s abort, can cancel a paused request before
    // this handler resumes it; Chromium then answers "Invalid InterceptionId." and nothing is left to resume.
    cdp.listeners.set('Fetch.requestPaused', message => paused(message).catch(error => {if (error.message !== 'Invalid InterceptionId.') throw error;}));
    await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Response'}]});
  }
  const project = base + '/web/w/team/app';
  const tab = async name => {
    await cdp.evaluate(`document.querySelector('[data-project-tab="${name}"]').click()`);
    await selected(name);
  };
  const selected = async name => {
    assert.deepEqual(await cdp.evaluate(`Array.from(document.querySelectorAll('[role=tabpanel]')).filter(p=>getComputedStyle(p).display!=='none').map(p=>p.id)`), ['project-panel-' + name]);
    assert.equal(await cdp.evaluate(`document.querySelector('[role=tab][aria-selected=true]').dataset.projectTab`), name);
  };
  const cases = {
    async 'project-messages'() {
      const body = 'Synthetic project message.';
      const sent = await (await request('/admin/messages/send', {
        from_workspace: 'team', from_project: 'other', to_workspace: 'other', to_project: 'app', body,
      })).json();
      assert.ok(sent.message_id);
      const pop = async workspace => (await (await request('/admin/messages/pop', {
        workspace, project: 'app', message_id: sent.message_id,
      })).json()).message;
      assert.equal(await pop('team'), null);
      assert.equal((await pop('other')).body, body);
      assert.equal(await pop('other'), null);
    },
    async 'resumed-session'() {
      const resumedId=crypto.randomUUID(),endpoint='/api/v1/workspaces/team/projects/app/sessions';
      const capture=event=>request('/hook?'+new URLSearchParams({workspace:'team',project:'app',agent:'codex',event}),{session_id:resumedId,cwd:path.join(artifacts,'team/app'),tool_name:'Bash',tool_input:{command:'echo synthetic-resume'},tool_response:'synthetic'});
      const recorded=async includeOpen=>(await (await request(endpoint+'?include_open='+includeOpen)).json()).sessions.find(s=>s.session_id===resumedId);
      await capture('session-start');await capture('post-tool-use');await capture('session-end');
      await until(async()=>!!(await recorded(false))?.ended_at,'Session end was not recorded');
      await capture('post-tool-use');
      await until(async()=>{const row=await recorded(true);return !!row&&!row.ended_at;},'New scoped work must reopen the read view');
      assert.equal(await recorded(false),undefined,'Completed listing must exclude resumed work before pagination');
      await cdp.goto(project+'/s/'+resumedId,'#scrubber');assert(await cdp.evaluate('document.querySelector("main").textContent.includes("ainda aberta")'));
      const foreign=await fetch(base+'/web/w/team/other/s/'+resumedId,{headers:{Authorization:'Bearer '+token}});assert.equal(foreign.status,404);
      await capture('session-end');await until(async()=>!!(await recorded(false))?.ended_at,'A later SessionEnd must close resumed work');
      await cdp.reload();assert.equal(await cdp.evaluate('document.querySelector("main").textContent.includes("ainda aberta")'),false);
    },
    async tabs() {
      await cdp.goto(project, '#project-panel-overview');await selected('overview');
      for (const name of ['agents','tokens','sessions','knowledge']) {await tab(name);assert.equal(new URL(await cdp.evaluate('location.href')).searchParams.get('tab'), name);}
      await cdp.evaluate('history.back()');await until(() => cdp.evaluate(`document.querySelector('[data-project-tab=sessions]').getAttribute('aria-selected')==='true'`), 'Back did not restore Sessions');await selected('sessions');
      await cdp.evaluate('history.forward()');await until(() => cdp.evaluate(`document.querySelector('[data-project-tab=knowledge]').getAttribute('aria-selected')==='true'`), 'Forward did not restore Knowledge');
      for (const [key, expected] of [['ArrowRight','overview'], ['ArrowLeft','knowledge'], ['Home','overview'], ['End','knowledge']]) {await cdp.key(key);await selected(expected);}
      await cdp.reload();await selected('knowledge');
      await cdp.evaluate(`document.querySelector('[data-project-tab=knowledge]').focus();document.addEventListener('keydown',event=>{window.shortcutCanceled=event.defaultPrevented;},{once:true});`);
      await cdp.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'ArrowLeft', modifiers: 1});
      await cdp.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'ArrowLeft', modifiers: 1});
      assert.equal(await cdp.evaluate('window.shortcutCanceled'), false, 'Tabs stole a browser shortcut');
      await cdp.goto(project + '#token-usage', '#token-usage', project + '?tab=tokens');await selected('tokens');
      await cdp.send('Accessibility.enable');const tree = await cdp.send('Accessibility.getFullAXTree');
      assert.equal(tree.nodes.filter(n => !n.ignored && n.role?.value === 'tabpanel').length, 1);
    },
    async 'live-usage'() {
      await cdp.goto(project + '?tab=tokens', '#token-usage');await selected('tokens');
      assert.equal(await cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)'), 5);
      assert(await cdp.evaluate(`Array.from(document.querySelectorAll('[data-call-row]')).some(r=>r.textContent.includes('Above 3× average'))`));
      await cdp.evaluate(`document.getElementById('call-filter').value='codex-fixture';document.getElementById('call-filter').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('call-filter').focus()`);
      await until(()=>cdp.evaluate(`new URL(location.href).searchParams.get('calls_q')==='codex-fixture'&&!document.getElementById('call-query').hasAttribute('aria-busy')`),'Search must settle before testing the periodic refresh');
      const next = {...calls[0], call_id: 'response-live', input_tokens: 321};await usage([next]);await usage([next]);
      await until(() => cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)===6'), 'Live reports did not refresh exactly once', 18000);
      await selected('tokens');assert(await cdp.evaluate(`document.activeElement.id==='call-filter'&&document.getElementById('call-filter').value==='codex-fixture'`));
      await tab('agents');assert.equal(await cdp.evaluate(`Number(document.querySelector('[data-agent=codex] .agent-card-usage div:last-child strong').textContent)`), 6);
      await cdp.goto(project + '/s/' + id, '#token-usage');
      assert.equal(await cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)'), 6);
    },
    async 'capture-backlog'() {
      const cwd=path.join(artifacts,'backlog-repository'),client=path.join(artifacts,'backlog-client'),transcript=path.join(artifacts,'backlog.jsonl'),sid=crypto.randomUUID();
      fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'.estacao-ai.toml'),'workspace = "backlog"\nproject = "capture"\n');
      fs.writeFileSync(transcript,Array.from({length:300},(_,n)=>JSON.stringify({type:'assistant',message:{id:'backlog-'+n,model:'backlog-model',usage:{input_tokens:100,output_tokens:20}}})+'\n').join(''));
      const options={cwd,env:{...env,AI_MEMORY_HOME:client},encoding:'utf8',timeout:15000};
      for(const expected of [256,300,300]) {
        const hook=spawnSync(binary,['--data-dir',client,'hook','--event','post-tool-use','--agent','claude-code','--server-url',base,'--auth-token',token],{...options,input:JSON.stringify({session_id:sid,cwd,transcript_path:transcript,tool_name:'Bash',tool_input:{command:'echo fixture'},tool_response:'fixture'})});
        assert.equal(hook.status,0,'Native catch-up hook failed: '+hook.stderr);
        const drain=spawnSync(binary,['--data-dir',client,'hook-drain'],options);assert.equal(drain.status,0,'Native catch-up drain failed: '+drain.stderr);
        await until(async()=> (await (await request('/web/w/backlog/capture')).text()).includes('Chamadas capturadas</span><strong>'+expected+'</strong>'),'Native backlog did not reach '+expected+' distinct stored responses');
      }
      await cdp.goto(base+'/web/w/backlog/capture?tab=tokens','#token-usage');
      assert.equal(await cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)'),300);
      assert(await cdp.evaluate('document.querySelector(".usage-pagination").textContent.includes("300 respostas correspondentes")'));
    },
    async 'session-live-usage'() {
      await cdp.goto(project+'/s/'+id,'#token-usage');
      const before=await cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)');
      await cdp.evaluate(`document.getElementById('call-filter').value='codex-fixture';document.getElementById('call-filter').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('call-filter').focus()`);
      await until(()=>cdp.evaluate(`new URL(location.href).searchParams.get('calls_q')==='codex-fixture'&&!document.getElementById('call-query').hasAttribute('aria-busy')`),'Session search must settle before the new response');
      await usage([{...calls[0],call_id:'session-live-response',input_tokens:123}]);
      await until(()=>cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)==='+ (before+1)), 'Session usage did not refresh without reload',18000);
      assert(await cdp.evaluate(`document.activeElement.id==='call-filter'&&document.getElementById('call-filter').value==='codex-fixture'`));
      assert(await cdp.evaluate(`Array.from(document.querySelectorAll('[data-call-row]')).some(r=>r.textContent.includes('session-live-response'))`));
    },
    async 'call-history'() {
      const workspace='history',name='app',sid=crypto.randomUUID(),href=base+'/web/w/history/app';
      const hook='/hook?'+new URLSearchParams({workspace,project:name,agent:'codex',event:'post-tool-use'});
      const publish=async rows=>request(hook,{session_id:sid,tool_name:'Bash',tool_input:{command:'echo synthetic'},tool_response:'synthetic',_ai_memory_usage_calls:rows.map(row=>({cache_read_tokens:0,cache_write_tokens:0,...row}))});
      await request('/hook?'+new URLSearchParams({workspace,project:name,agent:'codex',event:'session-start'}),{session_id:sid});
      await publish(Array.from({length:56},(_,n)=>({call_id:'bulk-'+n,input_tokens:1000+n,output_tokens:10,model:'bulk-model'})));
      await until(async()=> (await (await request('/web/w/history/app')).text()).includes('Chamadas capturadas</span><strong>56</strong>'),'History fixture did not settle');
      await publish([{call_id:'tiny-newest',input_tokens:1,output_tokens:1,model:'unique-tiny-model'}]);
      await until(async()=> (await (await request('/web/w/history/app')).text()).includes('Chamadas capturadas</span><strong>57</strong>'),'Small response did not settle');
      await cdp.goto(href+'?tab=tokens','#token-usage');await selected('tokens');
      assert.equal(await cdp.evaluate('document.querySelectorAll("[data-call-row]").length'),50);
      assert(!await cdp.evaluate('document.querySelector(".usage-results").textContent.includes("tiny-newest")'));
      await cdp.evaluate(`document.getElementById('call-sort').value='recent';document.getElementById('call-sort').dispatchEvent(new Event('change',{bubbles:true}))`);
      await until(()=>cdp.evaluate('document.querySelector("[data-call-row]")?.textContent.includes("tiny-newest")'),'Recent ordering omitted the small newest response');
      await cdp.evaluate(`document.getElementById('call-filter').value='unique-tiny-model';document.getElementById('call-filter').dispatchEvent(new Event('input',{bubbles:true}))`);
      await until(()=>cdp.evaluate('document.querySelectorAll("[data-call-row]").length===1&&document.querySelector("[data-call-row]")?.textContent.includes("tiny-newest")'),'Search did not cover calls outside the largest fifty');
      assert.equal(await cdp.evaluate('Number(document.querySelector(".usage-metrics strong").textContent)'),57);
      await cdp.evaluate(`document.getElementById('call-filter').value='';document.querySelector('#call-query').requestSubmit()`);
      await until(()=>cdp.evaluate('document.querySelectorAll("[data-call-row]").length===50&&!!document.querySelector("[data-call-page]")'),'Clearing search did not restore the page');
      await cdp.evaluate('document.querySelector("[data-call-page]").click()');
      await until(()=>cdp.evaluate('document.querySelectorAll("[data-call-row]").length===7&&new URL(location.href).searchParams.get("calls_offset")==="50"'),'Response pagination lost results');
      await cdp.reload();assert.equal(await cdp.evaluate('document.querySelectorAll("[data-call-row]").length'),7);
      assert.equal(await cdp.evaluate('document.getElementById("call-sort").value'),'recent');
      await cdp.goto(href+'/s/'+sid+'?calls_q=unique-tiny-model','#token-usage');
      assert.equal(await cdp.evaluate('document.querySelectorAll("[data-call-row]").length'),1);
      assert(await cdp.evaluate('document.querySelector("[data-call-row]").textContent.includes("tiny-newest")'));
    },
    async 'contextual-investigation'() {
      const sid=crypto.randomUUID(),href=base+'/web/w/investigation/app';
      const hook='/hook?'+new URLSearchParams({workspace:'investigation',project:'app',agent:'codex',event:'post-tool-use'});
      await request('/hook?'+new URLSearchParams({workspace:'investigation',project:'app',agent:'codex',event:'session-start'}),{session_id:sid});
      const rows=Array.from({length:57},(_,n)=>({call_id:'context-'+n,model:n===56?'rare-model':'bulk-model',input_tokens:20,output_tokens:2,cache_read_tokens:0,cache_write_tokens:0,context:{turn_id:'native-turn',response_id:'native-'+n,recorded_at:'2026-10-01T12:00:00Z',tools:[{id:'exec-1',name:'exec_command',relation:'turn',is_error:true}]}}));
      await request(hook,{session_id:sid,tool_name:'Bash',tool_input:{command:'echo synthetic'},tool_response:'synthetic',_ai_memory_usage_calls:rows});
      await until(async()=> (await (await request('/web/w/investigation/app')).text()).includes('Chamadas capturadas</span><strong>57</strong>'),'Context fixture never reached storage');
      await cdp.goto(href+'?tab=tokens','#token-usage');
      await cdp.evaluate(`document.querySelector('[name=calls_model]').value='rare-model';document.querySelector('[name=calls_agent]').value='codex';document.querySelector('[name=calls_session]').value=${literal(sid)};document.querySelector('[name=calls_from]').value='2026-10-01T12:00:00';document.querySelector('[name=calls_until]').value='2026-10-01T12:00:01';document.querySelector('[name=calls_tool]').value='exec_command';document.getElementById('call-query').requestSubmit()`);
      await until(()=>cdp.evaluate('document.querySelectorAll("[data-call-row]").length===1&&!document.querySelector("#call-query").hasAttribute("aria-busy")'),'Server investigation filters did not isolate the response outside the first fifty');
      assert(await cdp.evaluate('document.querySelector("[data-call-row]").textContent.includes("native-56")&&document.querySelector("[data-call-row]").textContent.includes("association")'));
      await cdp.reload();assert.equal(await cdp.evaluate('document.querySelectorAll("[data-call-row]").length'),1);
      await cdp.evaluate(`document.querySelector('[name=calls_model]').value='missing-model';document.querySelector('[name=calls_model]').dispatchEvent(new Event('change',{bubbles:true}))`);
      await until(()=>cdp.evaluate('document.querySelectorAll("[data-call-row]").length===0&&!document.querySelector("#call-query").hasAttribute("aria-busy")'),'A mismatched exact model must remove all rows');
      for(const width of [320,390]) {await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:true});assert(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Investigation controls overflow the viewport');}
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    },
    async 'feature-states'() {
      await cdp.goto(base+'/web/docs/features','.installation-status');
      assert(await cdp.evaluate(`document.querySelector('[data-feature="learning"]').textContent.includes("Indisponível sem LLM")`));
      assert(await cdp.evaluate(`document.querySelector('[data-feature="external-clients"]').textContent.includes("Configuração do cliente desconhecida")`));
      assert(await cdp.evaluate(`document.querySelector('[data-feature="consolidation"]').textContent.includes("Próximo passo:")`));
      assert.equal((await fetch(base+'/api/v1/docs/features/status',{redirect:'manual'})).status,401);
      const status=await (await request('/api/v1/docs/features/status')).json();assert.equal(status.features.find(f=>f.id==='embeddings').state,'Not configured');
    },
    async 'knowledge-evidence'() {
      const sid=sessions.get('team/app/codex');
      const rpc=async(body,session)=> {
        const response=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
        assert(response.ok,'MCP fixture returned '+response.status);
        const text=await response.text();const payload=text.trim().startsWith('{')?JSON.parse(text):JSON.parse(text.split('\n').find(line=>line.startsWith('data: ')).slice(6));return {payload,session:response.headers.get('Mcp-Session-Id')};
      };
      const initialized=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-dashboard-test',version:'1'}}});
      const written=await rpc({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'memory_write_page',arguments:{workspace:'team',project:'app',path:'concepts/evidence.md',body:'# Evidence fixture\n\nVerificationneedle source.',session_id:sid}}},initialized.session);
      assert(!written.payload.error&&!written.payload.result?.isError,'MCP evidence fixture failed: '+JSON.stringify(written.payload));
      const hits = await (await request('/api/v1/search?workspace=team&project=app&q=Verificationneedle')).json();
      const hit = hits.find(hit => hit.path === 'concepts/evidence.md');
      assert(hit, 'Scoped search did not return the written page');
      await cdp.goto(project + '/p/' + hit.path, 'article');
      assert(await cdp.evaluate("document.querySelector('article').textContent.includes('Verificationneedle source.')"));
      for(const width of [320,390]) {await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:true});assert(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Knowledge evidence overflows the viewport');}
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    },
    async themes() {
      await cdp.goto(project, '#project-panel-overview');
      await cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'light'}]});
      await cdp.evaluate(`document.querySelector('[data-theme-choice=dark]').click()`);await cdp.reload();
      assert.equal(await cdp.evaluate('document.documentElement.classList.contains("dark")'), true);
      await cdp.evaluate(`document.querySelector('[data-theme-choice=light]').click()`);
      assert.equal(await cdp.evaluate('document.documentElement.classList.contains("dark")'), false);
      await cdp.evaluate(`document.querySelector('[data-theme-choice=system]').click()`);
      await cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]});
      await until(() => cdp.evaluate('document.documentElement.classList.contains("dark")'), 'System theme did not follow OS');
      await cdp.evaluate(`document.querySelector('[data-theme-choice=light]').click()`);
      const colors = await cdp.evaluate(`({background:getComputedStyle(document.body).backgroundColor,foreground:getComputedStyle(document.body).color})`);
      assert(contrast(colors.background, colors.foreground) >= 4.5, 'Light body text is not readable');
      await cdp.evaluate(`document.querySelector('[data-theme-choice=dark]').click()`);
      assert.notEqual(await cdp.evaluate('getComputedStyle(document.body).backgroundColor'), colors.background);
      assert.notEqual(await cdp.evaluate('getComputedStyle(document.body).color'), colors.foreground);
      const dark = await cdp.evaluate(`({background:getComputedStyle(document.body).backgroundColor,foreground:getComputedStyle(document.body).color})`);
      assert(contrast(dark.background, dark.foreground) >= 4.5, 'Dark body text is not readable');
    },
    async documentation() {
      await cdp.goto(base + '/web/docs', '.docs-search');
      const anonymous = await fetch(base + '/api/v1/docs', {redirect: 'manual'});assert.equal(anonymous.status, 401);
      await cdp.evaluate(`document.getElementById('documentation-query').value='Token accounting';document.querySelector('.docs-search').requestSubmit()`);
      await until(() => cdp.evaluate(`new URL(location.href).searchParams.get('q')==='Token accounting'&&!!document.querySelector('.docs-card a[href="docs/features"]')`), 'Documentation search failed');
      const catalog = await (await request('/api/v1/docs')).json();assert(catalog.documents.length >= 28);
      for (const doc of catalog.documents) {
        const json = await (await request('/api/v1/docs/' + doc.id)).json();
        assert.equal(json.markdown, await (await request('/web/docs/' + doc.id + '.md')).text());
      }
      const release = await (await request('/api/v1/docs/changelog?release=1.7.0')).json();
      assert(release.markdown.startsWith('## [1.7.0]'));assert(!release.markdown.includes('## [1.6.0]'));
      await cdp.goto(base + '/web/docs/changelog', '#release-version');
      assert.equal(await cdp.evaluate('document.querySelector(".docs-release button")'), null, 'JavaScript users should not need a submit button');
      const selectedRelease = async version => {
        await until(() => cdp.evaluate(`new URL(location.href).searchParams.get('release')===${literal(version)}&&document.readyState==='complete'&&document.getElementById('release-version')?.value===${literal(version)}&&document.querySelector('.docs-article h2')?.textContent.startsWith(${literal('[' + version + ']')})`), 'Release selection did not load ' + version);
        assert.equal(await cdp.evaluate('document.getElementById("release-version").value'), version);
        assert(await cdp.evaluate(`new URL(document.querySelector('.page-heading a').href).searchParams.get('release')===${literal(version)}&&Array.from(document.querySelectorAll('.docs-outline a')).every(a=>new URL(a.href).searchParams.get('release')===${literal(version)})`), 'Release links must match the displayed content');
      };
      for (const version of ['1.7.0', '1.6.0', 'Unreleased']) {
        await cdp.evaluate(`(()=>{const select=document.getElementById('release-version');select.value=${literal(version)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await selectedRelease(version);
      }
      await cdp.reload();await selectedRelease('Unreleased');
      await cdp.evaluate('history.back()');await selectedRelease('1.6.0');
      await cdp.evaluate('history.forward()');await selectedRelease('Unreleased');
      await cdp.send('Emulation.setScriptExecutionDisabled', {value: true});
      try {
        await cdp.goto(base + '/web/docs/changelog?release=1.7.0', '.docs-release button');
        assert(await cdp.evaluate('getComputedStyle(document.querySelector(".docs-release button")).display!=="none"'), 'No-JavaScript release submission must remain available');
        await cdp.evaluate(`document.getElementById('release-version').value='1.6.0';document.querySelector('.docs-release button').click()`);
        await selectedRelease('1.6.0');
      } finally {await cdp.send('Emulation.setScriptExecutionDisabled', {value: false});}
      const missing = await fetch(base + '/web/docs/.env.md', {headers: {Authorization: 'Bearer ' + token}});assert.equal(missing.status, 404);
    },
    async 'nostr-invites'() {
      const ready = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `const initialized = (${installInviteFixture})();\n          window.__inviteSetup = initialized;\n          window.fetch = (...args) => initialized.then(() => window.fetch(...args));`,
      });
      const count = total => cdp.evaluate(`document.querySelector('#notificacao-convites')?.textContent==='Convites (${total})'`);
      const click = label => cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${literal(label)})?.click()`);
      const signIn = async () => {
        await cdp.evaluate('window.__inviteSetup');
        await until(() => cdp.evaluate("!!document.querySelector('#nostr-chave')"), 'A fresh browser must ask for the signer');
        assert.equal(await cdp.evaluate("!!document.querySelector('#notificacao-convites')"), false);
        await cdp.evaluate(`document.querySelector('#nostr-chave').value=window.__inviteFixture.secret;document.querySelector('.nostr-gate-card').requestSubmit()`);
      };
      try {
        await cdp.goto(base + '/web/chat', '#est');
        await signIn();
        await until(() => count(1), 'Retained relay invite did not appear');
        await click('Convites (1)');
        await until(() => cdp.evaluate(`document.querySelector('#lista-convites')?.textContent.includes('Sala de teste')`), 'Signer could not decrypt the invite');
        await click('Entrar na sala');
        await until(() => cdp.evaluate('!!window.__inviteFixture.finish'), 'Accept request did not start');

        const inbox = await cdp.evaluate(`({key:window.__inviteFixture.inboxKey, value:JSON.stringify([window.__inviteFixture.first,window.__inviteFixture.second].map(evento=>({evento,salaAceita:null})))})`);
        const {targetId: otherTab} = await cdp.send('Target.createTarget', {url:'about:blank'});
        try {
          const {sessionId} = await cdp.send('Target.attachToTarget', {targetId:otherTab,flatten:true});
          await cdp.send('Page.navigate', {url:base+'/healthz'}, sessionId);
          await until(async () => (await cdp.send('Runtime.evaluate', {expression:`location.origin===${literal(base)}`,returnByValue:true}, sessionId)).result.value, 'Second tab did not load');
          const write = await cdp.send('Runtime.evaluate', {expression:`localStorage.setItem(${literal(inbox.key)},${literal(inbox.value)})`}, sessionId);
          assert(!write.exceptionDetails, 'Second tab failed to update the inbox');
          await until(() => count(2), 'First tab did not receive the storage update');
          await cdp.evaluate('window.__inviteFixture.finish()');
          await until(() => count(1), 'Accepted invite remained pending after the other tab updated the inbox');
        } finally {
          await cdp.send('Target.closeTarget', {targetId:otherTab});
        }

        await cdp.reload();
        await until(() => count(1), 'Session was not restored after reload');
        assert.equal(await cdp.evaluate("!!document.querySelector('#nostr-chave')"),false);
        await click('Convites (1)');
        await until(() => cdp.evaluate(`document.querySelector('#lista-convites')?.textContent.includes('Outro convite')`), 'Restored signer could not decrypt an invitation');
        await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
        await cdp.evaluate(`Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent.startsWith('Compartilhados')).click()`);
        assert(await cdp.evaluate(`document.querySelector('.chats-hub-grid')?.textContent.includes('Sala de teste')`));
      } finally {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {identifier:ready.identifier});
      }
    },
    async responsive() {
      await cdp.goto(project, '#project-panel-overview');
      for (const width of [320,390,768]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {width, height: 960, deviceScaleFactor: 1, mobile: width < 640});
        for (const name of ['overview','agents','tokens','sessions','knowledge']) {
          await tab(name);
          assert(await cdp.evaluate(`document.documentElement.scrollWidth<=innerWidth&&Array.from(document.querySelectorAll('.project-tabs a,.project-tools a')).every(a=>{const r=a.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44;})`), `Navigation overflow or small target at ${width}px`);
        }
      }
    },
  };
  assert(!selectedCase || Object.hasOwn(cases, selectedCase), 'Unknown browser case');
  assert(!selectedCase || !mutation || mutations[mutation].test === selectedCase, 'Mutation targets another browser case');
  for (const [name, run] of Object.entries(cases)) {
    if (selectedCase && selectedCase !== name) continue;
    if (mutation && mutations[mutation].test !== name) continue;
    try {await run();report.cases.push({name, passed: true});console.log('PASS ' + name);}
    catch (error) {
      report.cases.push({name, passed: false, error: error.message});console.error('FAIL ' + name + ': ' + error.message);
      const shot = await cdp.send('Page.captureScreenshot', {format: 'png'}).catch(() => null);
      if (shot) fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }
  assert.deepEqual(cdp.errors, [], 'Browser JavaScript errors');
  assert(!mutation || report.mutationApplied > 0, 'Mutation was not applied');
  assert(report.cases.every(c => c.passed), 'Browser regression checks failed');
}

try {await main();}
catch (error) {report.error = error.message;process.exitCode = 1;console.error(error.message);}
finally {
  if (cdp) cdp.socket.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill('SIGTERM');
    let timer;
    const result = await Promise.race([child.completion, new Promise(resolve => {timer=setTimeout(() => resolve(null),5000);})]);
    clearTimeout(timer);
    if (!result && child.exitCode === null) {child.kill('SIGKILL');await child.completion;}
  }
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Artifacts: ' + artifacts);
}
