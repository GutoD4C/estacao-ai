import { cookie } from "./estacao-cookie.js";
import {
  RACAS_CACHORRO, validarNpub, encurtarNpub, entrarNostr, sairNostr, contaAtiva, restaurarDispositivo,
  temNip07, temAssinador, npubToHex, RELAY_PADRAO, requisicao, criarClienteNostr,
  chaveConvite, conviteValido, lerConvite
} from "./estacao-3d-nostr.js";

(function(){
"use strict";
var raiz=document.getElementById("est"),PAG=raiz.dataset.pagina,PROJ=raiz.dataset.projeto;
var E=null,CONSUMO=null,CONTEXTO=null,canal="geral",abertoChat="",timer=null;
var CATALOGO=null,modal=null,arrastando=null,filtroTarefas="todas",novaTarefaAberta=false,mostrarOcultos=false;
var ultimaCarga="",seqCarga=0,enviando=false,rolarFim=false,aba="chat",abaModelos="projetos",chatProj="",abertoEm=Date.now()/1000,VISTO={};
var vistaChat="3d",chatMenuAtivo=true,SCENE3D={key:"",el:null,ctrl:null};
var abaChatsFiltro="pessoais",abaProjetosFiltro="pessoais";
var confirmDialog=null,toastEl=null,toastTimer=null;
var rascunhoTarefa={tit:"",desc:"",ag:""};
var TERMS={projeto:"",ativo:0,split:false,seq:1,tabs:[]};
var redeContatos=null, assinaturaRede="", pulso=null, contatosOnline=new Set();
var convites=new Map(), chaveCaixa="", detalhesConvites=new Map();

function restaurarConvites(autores){
  chaveCaixa="estacao-convites-v1:"+contaAtiva();
  convites.clear();
  detalhesConvites.clear();
  try {
    for(const item of JSON.parse(localStorage.getItem(chaveCaixa)||"[]")){
      if(conviteValido(item.evento,contaAtiva(),autores))convites.set(chaveConvite(item.evento),item);
    }
  } catch {}
}
function guardarConvites(){
  try { localStorage.setItem(chaveCaixa,JSON.stringify(Array.from(convites.values()))); }
  catch { mostrarToast("Não foi possível guardar os convites neste navegador."); }
}
window.addEventListener("storage",e=>{
  if(e.key!==chaveCaixa || !nostrAutenticado())return;
  restaurarConvites(contatosNostr().map(c=>npubToHex(c.npub)));
  atualizarNotificacao();
});
function receberConvite(evento){
  const chave=chaveConvite(evento), anterior=convites.get(chave);
  if(anterior && (anterior.evento.created_at>evento.created_at ||
      (anterior.evento.created_at===evento.created_at && anterior.evento.id<=evento.id)))return;
  const salaAceita=anterior?.salaAceita;
  convites.set(chave,{evento,salaAceita:E.projetos.some(p=>p.id===salaAceita)?salaAceita:null});
  if(anterior)detalhesConvites.delete(anterior.evento.id);
  if(convites.size>50){
    const maisAntigo=Array.from(convites.entries()).sort((a,b)=>a[1].evento.created_at-b[1].evento.created_at)[0];
    convites.delete(maisAntigo[0]);
  }
  guardarConvites();
  atualizarNotificacao();
}
function pendentes(){
  const agora=Date.now()/1000;
  return Array.from(convites.values()).filter(i=>!i.salaAceita && i.evento.created_at+7*86400>agora &&
    i.evento.tags.every(t=>t[0]!=="expiration" || Number(t[1])>agora))
    .sort((a,b)=>b.evento.created_at-a.evento.created_at);
}
function botaoConvites(){
  const botao=h("button",{type:"button",class:"secondary-button",id:"notificacao-convites",
    "aria-haspopup":"dialog","aria-live":"polite","aria-atomic":"true",onclick:abrirConvites});
  rotularNotificacao(botao);
  return botao;
}
function rotularNotificacao(botao){
  const total=pendentes().length;
  botao.textContent="Convites ("+total+")";
  botao.classList.toggle("convites-pendentes",total>0);
}
function atualizarNotificacao(){
  const botao=document.getElementById("notificacao-convites");
  if(botao)rotularNotificacao(botao);
  const lista=document.getElementById("lista-convites");
  if(lista)listarConvites(lista);
}
function abrirConvites(){
  abrirModal("Convites para salas",card=>{
    const lista=h("div",{id:"lista-convites",class:"est-grid est-gap-6px"});
    card.append(lista);
    listarConvites(lista);
  });
}
function listarConvites(lista){
  lista.replaceChildren();
  const itens=pendentes();
  if(!itens.length){lista.append(h("p",{class:"muted",texto:"Você não tem convites pendentes."}));return;}
  if(!temAssinador()){
    lista.append(h("p",{texto:"Reconecte seu assinador Nostr para ler o nome da sala e aceitar o convite."}),
      h("button",{type:"button",class:"secondary-button",texto:"Reconectar assinador Nostr",
        onclick:()=>reconectarAssinador(abrirConvites)}));
  }
  for(const item of itens){
    const evento=item.evento;
    const contato=contatosNostr().find(c=>npubToHex(c.npub)===evento.pubkey);
    if(!contato)continue;
    const nome=h("strong",{texto:"Convite de "+(contato.apelido||encurtarNpub(contato.npub))});
    const linha=h("div",{class:"card est-grid est-gap-6px est-p-12px"},[nome]);
    lista.append(linha);
    if(!temAssinador())continue;
    if(!detalhesConvites.has(evento.id))detalhesConvites.set(evento.id,lerConvite(evento));
    detalhesConvites.get(evento.id).then(projeto=>{
      if(!lista.contains(linha))return;
      nome.textContent=projeto.nome;
      const entrar=h("button",{type:"button",class:"primary-button",texto:"Entrar na sala",onclick:async ()=>{
        const chave=chaveConvite(evento), conta=contaAtiva();
        if(!conviteValido(evento,conta,contatosNostr().map(c=>npubToHex(c.npub))) ||
           convites.get(chave)?.evento.id!==evento.id){atualizarNotificacao();return;}
        entrar.disabled=true;
        try {
          await api({tipo:"sincronizar_sala_compartilhada",projeto,agentes_remotos:[]});
          if(contaAtiva()!==conta)return;
          const atual=convites.get(chave);
          if(atual){
            atual.salaAceita=projeto.id;
            guardarConvites();
          }
          fecharModal();
          if(projeto.eh_chat){
            abaChatsFiltro="compartilhados";
            if(PAG!=="chat")irPara("chat");
            entrarNoChat(projeto,"chat");
          }else{abaProjetosFiltro="compartilhados";irPara("projetos/"+encodeURIComponent(projeto.id));}
        }catch(e){entrar.disabled=false;mostrarToast(e.message);}
      }});
      linha.append(h("span",{class:"muted",texto:"Convidado por "+(contato.apelido||encurtarNpub(contato.npub))}),entrar);
    }).catch(e=>{
      detalhesConvites.delete(evento.id);
      if(lista.contains(linha))linha.append(h("span",{role:"alert",texto:e.message}),
        h("button",{type:"button",class:"secondary-button",texto:"Tentar novamente",onclick:()=>listarConvites(lista)}));
    });
  }
}
function atualizarRedeContatos(){
  var pf=perfilNostr();
  var autores=contatosNostr().map(c=>npubToHex(c.npub)).filter(Boolean).sort();
  var relay=pf.relay_url||RELAY_PADRAO;
  var assinatura=JSON.stringify([pf.pubkey_hex,relay,autores]);
  if(assinatura===assinaturaRede){
    const botao=document.getElementById("notificacao-convites");
    if(botao && botao.textContent!=="Convites ("+pendentes().length+")")atualizarNotificacao();
    return;
  }
  assinaturaRede=assinatura;
  restaurarConvites(autores);
  atualizarNotificacao();
  clearInterval(pulso);
  if(redeContatos)redeContatos.disconnect();
  contatosOnline.clear();
  redeContatos=criarClienteNostr({
    roomId:"contatos",authors:autores,profile:{npub:pf.npub,pubkeyHex:pf.pubkey_hex,relayUrl:relay,displayName:"Operador"},
    onRoomShare:receberConvite,
    onStatusChange:function(st){atualizarIndicadoresRede(st);},
    onPresenceListChange:function(lista){contatosOnline=new Set(lista);atualizarIndicadoresRede();}
  });
  redeContatos.connect();
  pulso=setInterval(function(){
    if(redeContatos.status==="offline" || redeContatos.status==="error")redeContatos.connect();
    else if(autores.length)redeContatos.publishPresence({});
  },8000);
}
function atualizarIndicadoresRede(st){
  var el=document.getElementById("status-relay-contatos");
  if(el){
    var estado=st?.status || redeContatos?.status;
    el.textContent=estado==="signer"?"Relay conectado · reconecte o assinador":estado==="connected"?"Relay conectado":estado==="connecting"?"Conectando ao relay…":"Relay desconectado";
  }
  raiz.querySelectorAll("[data-presenca-npub]").forEach(function(el){
    el.textContent=contatosOnline.has(el.dataset.presencaNpub)?"Online":"Sem presença recente";
  });
}
var lastPresenceSent="";

function racaInfo(id){
  return RACAS_CACHORRO.find(function(r){return r.id===id;})||RACAS_CACHORRO[0];
}
function perfilNostr(){
  return (E&&E.nostr_perfil)||{npub:"",pubkey_hex:"",apelido:"",raca_cachorro:"caramelo",relay_url:RELAY_PADRAO,autenticado:false};
}
function meuNpub(){
  return String(perfilNostr().npub||"").trim();
}
function nostrAutenticado(){
  var pf=perfilNostr();
  return Boolean(contaAtiva() && contaAtiva()===pf.pubkey_hex);
}
function contatosNostr(){
  return (E&&E.nostr_contatos)||[];
}
function contarPessoasSala(p){
  if(!p||!p.compartilhado)return 1;
  var set=new Set();
  var dono=(p.dono_npub||meuNpub()||"").trim();
  if(dono)set.add(dono);
  (p.membros_npub||[]).forEach(function(m){if(m&&m.trim())set.add(m.trim());});
  return Math.max(2,set.size);
}
function limiteAgentesSala(p){
  if(!p||!p.compartilhado)return 6;
  return contarPessoasSala(p)>=3?2:4;
}
function onlineNaSala(p){
  if(!p)return [];
  var arr=(E&&E.presenca_salas&&E.presenca_salas[p.id])||[];
  var set=new Set(arr.filter(Boolean));
  if(meuNpub())set.add(meuNpub());
  return Array.from(set);
}
function agenteHibernando(p,ag){
  if(!p||!p.compartilhado||!ag)return false;
  var dono=String(ag.dono_npub||"").trim();
  if(!dono)return false;
  var my=meuNpub();
  var pres=(E&&E.presenca_salas&&E.presenca_salas[p.id])||[];
  if(pres.length){
    return pres.indexOf(dono)<0;
  }
  return dono!==my;
}
function registrarPresencaLocal(p,npubsLista){
  if(!p||!p.id||!meuNpub())return;
  var set=new Set(Array.isArray(npubsLista)?npubsLista:[]);
  set.add(meuNpub());
  var arr=Array.from(set).sort();
  var key=p.id+"|"+arr.join(",");
  if(key===lastPresenceSent)return;
  lastPresenceSent=key;
  api({tipo:"atualizar_presenca",projeto:p.id,npubs_online:arr}).catch(function(){});
}

// Preserva o assinante em memória ao navegar entre as telas da Estação.
function rotaEstacao(url){
  var base=new URL(document.baseURI),destino=new URL(url,base);
  if(destino.origin!==base.origin || !destino.pathname.startsWith(base.pathname))return null;
  return /^(chat|projetos|modelos|agentes|consumo)(?:\/([^/]+))?$/.exec(destino.pathname.slice(base.pathname.length));
}
function abrirRota(url,historico){
  var rota=rotaEstacao(url);
  if(!rota||!contaAtiva())return false;
  limpar3D();
  if(historico)history.pushState(null,"",url);
  PAG=rota[2]?"projeto":rota[1]==="modelos"?"agentes":rota[1];
  PROJ=rota[2]?decodeURIComponent(rota[2]):"";
  raiz.dataset.pagina=PAG;raiz.dataset.projeto=PROJ;
  modal=confirmDialog=CONTEXTO=CONSUMO=null;chatMenuAtivo=true;ultimaCarga="";
  document.title=({projeto:"Projeto",projetos:"Projetos",agentes:"Modelos de IA",consumo:"Consumo e uso",chat:"Chat"})[PAG]+" · Estação-ai";
  document.body.classList.toggle("estacao-full",PAG==="projeto"||PAG==="chat");
  document.body.classList.toggle("estacao-full-scroll",PAG!=="projeto"&&PAG!=="chat");
  document.querySelectorAll("#app-navigation [data-nav]").forEach(function(a){
    if(a.dataset.nav===({projeto:"projetos",agentes:"modelos"})[PAG]||a.dataset.nav===PAG)a.setAttribute("aria-current","page");
    else a.removeAttribute("aria-current");
  });
  desenhar();
  carregar().catch(function(e){mostrarToast(e.message);});
  return true;
}
function irPara(url){var destino=new URL(url,document.baseURI);if(!abrirRota(destino,true))location.assign(destino);}
document.addEventListener("click",function(ev){
  var a=ev.target.closest("a[href]");
  if(a&&!ev.defaultPrevented&&!ev.ctrlKey&&!ev.metaKey&&!ev.shiftKey&&!ev.altKey&&ev.button===0&&!a.target&&abrirRota(a.href,true))ev.preventDefault();
});
window.addEventListener("popstate",()=>abrirRota(location.href,false));
function mostrarToast(msg){
  if(!msg)return;
  if(!toastEl){
    toastEl=document.createElement("div");
    toastEl.className="est-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent=msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){if(toastEl)toastEl.classList.remove("show");},2400);
}
function confirmarAcao(opts){
  opts=typeof opts==="string"?{mensagem:opts}:(opts||{});
  return new Promise(function(resolve){
    confirmDialog={
      titulo:opts.titulo||"Confirmar ação",
      mensagem:opts.mensagem||"Deseja continuar?",
      textoConfirmar:opts.textoConfirmar||(opts.perigo?"Excluir":"Confirmar"),
      textoCancelar:opts.textoCancelar||"Cancelar",
      perigo:opts.perigo!==false,
      resolve:function(ok){
        confirmDialog=null;
        desenhar();
        resolve(Boolean(ok));
      }
    };
    desenhar();
  });
}
window.EstacaoApp={
  voltarMenuChats:function(){
    if(PAG!=="chat")return;
    chatMenuAtivo=true;
    document.body.classList.remove("chalet-3d-active");
    limpar3D();
    if(window.EstacaoNav)window.EstacaoNav.expand(false);
    desenhar();
  }
};

function limpar3D(){
  if(SCENE3D.ctrl){try{SCENE3D.ctrl.destroy();}catch(_){}}
  SCENE3D={key:"",el:null,ctrl:null};
}

function montarOuAtualizar3D(slot,mode,key,data,callbacks,optsExtra){
  if(!window.Estacao3D){
    slot.replaceChildren(h("div",{class:"card est-p-20px"},[
      h("strong",{texto:"Carregando ambiente 3D…"}),
      h("p",{class:"muted",texto:"Se o ambiente 3D não abrir, recarregue a página."})
    ]));
    return;
  }
  if(SCENE3D.key===key&&SCENE3D.el&&SCENE3D.ctrl){
    if(SCENE3D.el.parentNode!==slot)slot.replaceChildren(SCENE3D.el);
    SCENE3D.ctrl.sync(data);
    return;
  }
  limpar3D();
  var host=document.createElement("div");
  slot.replaceChildren(host);
  var cfg=Object.assign({mode:mode,data:data,callbacks:callbacks},optsExtra||{});
  var ctrl=window.Estacao3D.mount(host,cfg);
  SCENE3D={key:key,el:host,ctrl:ctrl};
}

function h(tag,attrs,filhos){
  var el=document.createElement(tag);
  for(var k in (attrs||{})){
    var v=attrs[k];
    if(v==null||v===false)continue;
    if(k.slice(0,2)==="on")el.addEventListener(k.slice(2),v);
    else if(k==="texto")el.textContent=v;
    else el.setAttribute(k,v===true?"":v);
  }
  var lista=Array.isArray(filhos)?filhos:(filhos!=null?[filhos]:[]);
  lista.forEach(function(f){if(f!=null)el.append(f);});
  return el;
}

function api(corpo){
  return requisicao("estacao/api/acao",{
    method:"POST",
    credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Estacao-UI":"1","X-CSRF-Token":decodeURIComponent(cookie("ai_memory_csrf")||"")},
    body:JSON.stringify(corpo)
  }).then(function(r){
    if(!r.ok)return r.text().then(function(t){throw new Error(t||("Erro "+r.status));});
    return r.text().then(function(t){
      var res=null;
      try{if(t)res=JSON.parse(t);}catch(_){}
      return carregar().then(function(){return res;});
    });
  });
}

function carregarContexto(){
  if(PAG!=="projeto"||!PROJ)return Promise.resolve();
  return requisicao("estacao/api/contexto/"+encodeURIComponent(PROJ),{credentials:"same-origin",cache:"no-store"})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(c){CONTEXTO=c;})
    .catch(function(){});
}

function carregarConsumo(){
  if(PAG!=="consumo")return Promise.resolve();
  return requisicao("estacao/api/consumo",{credentials:"same-origin",cache:"no-store"})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(c){CONSUMO=c;})
    .catch(function(){});
}

function carregar(){
  var minha=++seqCarga;
  return requisicao("estacao/api/estado",{credentials:"same-origin",cache:"no-store"})
    .then(function(r){if(!r.ok)throw new Error("Erro "+r.status);return r.text();})
    .then(function(t){
      if(minha!==seqCarga)return;
      E=JSON.parse(t);
      if(!nostrAutenticado()) { location.reload(); return; }
      atualizarRedeContatos();
      if(E&&Array.isArray(E.agentes)&&E.agentes.length===0&&!window.__estacaoAutoConfigurado){
        window.__estacaoAutoConfigurado=true;
        return api({tipo:"auto_configurar",grupo:"projetos"})
          .catch(function(){})
          .then(function(){return api({tipo:"auto_configurar",grupo:"chat"});})
          .catch(function(){});
      }
      return Promise.all([carregarContexto(),carregarConsumo()]).then(function(){
        if(minha!==seqCarga)return;
        // Só redesenha quando algo mudou: redesenhar à toa mexia na rolagem e no cursor do chat.
        var chave=t+JSON.stringify(CONTEXTO)+JSON.stringify(CONSUMO);
        if(chave===ultimaCarga)return;
        ultimaCarga=chave;
        desenhar();
      });
    });
}

function agente(id){return (E&&E.agentes||[]).find(function(a){return a.id===id;});}
function cliAusente(id){return (E&&E.cli_ausente||[]).indexOf(id)>=0;}
function nomeAutor(id){
  if(id==="voce")return "Você";
  var a=agente(id);
  return a?a.nome:id;
}
function iniciais(nome){
  var p=String(nome||"?").trim().split(/\s+/);
  return (p.length>=2?p[0][0]+p[1][0]:String(nome||"?").slice(0,2)).toUpperCase();
}
function avClasse(forn){
  var f=String(forn||"").toLowerCase();
  if(f==="claude"||f==="claude-code")return "av-claude";
  if(f==="codex")return "av-codex";
  if(f==="opencode")return "av-opencode";
  if(f==="pi")return "av-pi";
  if(f==="gemini")return "av-gemini";
  if(f==="antigravity-cli"||f==="antigravity")return "av-antigravity";
  if(f==="ollama")return "av-ollama";
  return "av-outro";
}
function avatar(a,sm){
  if(a==="voce")return h("span",{class:"av av-outro"+(sm?" sm":""),texto:"VC"});
  var ag=typeof a==="string"?agente(a):a;
  var nome=ag?ag.nome:String(a||"?"),forn=ag?ag.fornecedor:"outro";
  return h("span",{class:"av "+avClasse(forn)+(sm?" sm":""),texto:iniciais(nome)});
}
function dataBR(s){
  if(!s)return "—";
  var d=new Date(s*1000);
  return d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function horaBR(s){
  if(!s)return "";
  return new Date(s*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
}
function campo(rotulo,el){return h("label",{},[rotulo,el]);}
function erroBox(){return h("p",{class:"erro",role:"alert"});}
function falha(box){return function(e){if(box)box.textContent=e.message;};}
function nomeProjetoMemoria(escopo){
  var partes=String(escopo||"").split("/");
  return partes[1]||escopo;
}
function linkWikiProjeto(escopo){
  var p=String(escopo||"").split("/");
  if(p.length!==2)return ".";
  return "w/"+encodeURIComponent(p[0])+"/"+encodeURIComponent(p[1]);
}
function linkWikiPagina(escopo,path){
  var p=String(escopo||"").split("/");
  if(p.length!==2)return ".";
  return "w/"+encodeURIComponent(p[0])+"/"+encodeURIComponent(p[1])+"/p/"+path.split("/").map(encodeURIComponent).join("/");
}

var MODELO_PRESETS=[
  {id:"claude",rotulo:"Claude Code",fornecedor:"claude",comando:"claude -p --permission-mode bypassPermissions --model {modelo} --output-format json",sugestoes:"claude-opus-4-5, claude-sonnet-4-5, sonnet, opus"},
  {id:"codex",rotulo:"Codex CLI",fornecedor:"codex",comando:"codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -m {modelo} -",sugestoes:"gpt-5.4, gpt-5.3-codex, o3, o4-mini"},
  {id:"antigravity",rotulo:"Antigravity",fornecedor:"antigravity-cli",comando:"agy --dangerously-skip-permissions --model {modelo} --output-format json -p \"$(cat)\"",sugestoes:"gemini-4-argon-medium, claude-sonnet-4-5, gemini-2.5-pro"},
  {id:"gemini",rotulo:"Gemini CLI",fornecedor:"gemini",comando:"gemini -y -m {modelo} -p \"$(cat)\"",sugestoes:"gemini-2.5-pro, gemini-2.5-flash"},
  {id:"opencode",rotulo:"OpenCode",fornecedor:"opencode",comando:"opencode run -m {modelo} \"$(cat)\"",sugestoes:"anthropic/claude-sonnet-4-5, openai/gpt-5"},
  {id:"pi",rotulo:"Pi",fornecedor:"pi",comando:"pi -p --model {modelo} \"$(cat)\"",sugestoes:"claude-sonnet-4-5, gpt-5"},
  {id:"ollama",rotulo:"Ollama (Local)",fornecedor:"ollama",comando:"ollama run {modelo}",sugestoes:"qwen2.5-coder:7b, llama3.3, deepseek-r1:8b"},
  {id:"outro",rotulo:"Personalizado",fornecedor:"outro",comando:"",sugestoes:"comando próprio (recebe prompt via stdin)"}
];

function fecharModal(){modal=null;desenhar();}
function abrirModal(titulo,renderFn){modal={titulo:titulo,render:renderFn,el:null,sujo:false};desenhar();}
/* Fecha só por ✕, Cancelar ou Esc; se algo foi digitado, pergunta com modal nativo da aplicação. */
function tentarFecharModal(){
  if(!modal)return;
  if(modal.sujo){
    confirmarAcao({
      titulo:"Descartar alterações?",
      mensagem:"Há alterações não salvas nesta janela. Deseja descartar?",
      textoConfirmar:"Descartar",
      perigo:true
    }).then(function(ok){if(ok)fecharModal();});
    return;
  }
  fecharModal();
}
document.addEventListener("keydown",function(ev){
  if(ev.key==="Escape"&&confirmDialog){ev.preventDefault();confirmDialog.resolve(false);return;}
  if(ev.key==="Enter"&&confirmDialog){ev.preventDefault();confirmDialog.resolve(true);return;}
  if(ev.key==="Escape"&&modal){ev.preventDefault();tentarFecharModal();}
});

function botaoContaNostr(){
  var pf=perfilNostr();
  var rc=racaInfo(pf.raca_cachorro);
  var nCont=contatosNostr().length;
  return h("button",{
    type:"button",
    class:"secondary-button nostr-account-pill",
    title:"Conta Nostr ("+pf.npub+") · Contatos e raça do cachorro",
    onclick:abrirModalNostr
  },[
    h("span",{class:"dot dot-ok"}),
    h("span",{texto:(pf.apelido||"Operador")+" · "+rc.nome}),
    h("span",{class:"mono muted est-text-11px",texto:encurtarNpub(pf.npub)}),
    nCont?h("span",{class:"pill ok est-p-1px-6px est-text-10px",texto:nCont+" contato(s)"}):null
  ]);
}

function abrirModalNostr(){
  var pf=perfilNostr();
  abrirModal("Conta Nostr & Contatos (npub)",function(card){
    var box=erroBox();
    var ok=h("p",{class:"ok-msg"});
    var apelido=h("input",{value:pf.apelido||"Operador",placeholder:"Seu nome de exibição"});
    var relay=h("input",{value:pf.relay_url||RELAY_PADRAO,placeholder:RELAY_PADRAO});
    var racaAtual=pf.raca_cachorro||"caramelo";
    var racaWrap=h("div",{class:"chips"});
    function renderRacas(){
      racaWrap.replaceChildren.apply(racaWrap,RACAS_CACHORRO.map(function(rc){
        return h("button",{
          type:"button",
          class:"chip"+(racaAtual===rc.id?" sel":""),
          title:rc.desc,
          onclick:function(){racaAtual=rc.id;renderRacas();}
        },[
          h("span",{class:"breed-dot",style:"background:"+rc.cor}),
          rc.nome
        ]);
      }));
    }
    renderRacas();

    var npubInput=h("input",{placeholder:"npub1... do contato que deseja conectar"});
    var apelidoContato=h("input",{placeholder:"Apelido do contato (ex.: Ana, Carlos)"});
    var listaContatos=h("div",{class:"est-grid est-gap-6px"});
    function renderContatos(){
      listaContatos.replaceChildren();
      var cs=contatosNostr();
      if(!cs.length){
        listaContatos.append(h("p",{class:"muted est-m-0",texto:"Nenhum contato conectado ainda. Cole o npub1 de alguém acima para conectar e poder adicionar aos seus projetos e chats."}));
        return;
      }
      cs.forEach(function(c){
        listaContatos.append(h("div",{class:"nostr-contact-row"},[
          h("div",{class:"est-min-w-0 est-flex-1"},[
            h("strong",{class:"est-text-13px",texto:c.apelido||encurtarNpub(c.npub)}),
            h("small",{"data-presenca-npub":c.npub,texto:contatosOnline.has(c.npub)?"Online":"Sem presença recente"}),
            h("div",{class:"muted mono corta est-text-11px",title:c.npub,texto:c.npub})
          ]),
          h("button",{type:"button",class:"quiet-button btn-parar est-p-4px-8px est-text-11px",texto:"Remover",onclick:function(){
            api({tipo:"excluir_contato_nostr",npub:c.npub}).then(function(){
              renderContatos();
              mostrarToast("Contato removido");
            }).catch(falha(box));
          }})
        ]));
      });
    }
    renderContatos();

    card.append(
      h("div",{class:"card est-p-12px est-grid est-gap-8px"},[
        h("div",{class:"row est-justify-space-between"},[
          h("strong",{class:"est-text-12px",texto:"Seu endereço Nostr (npub)"}),
          h("button",{type:"button",class:"quiet-button est-p-2px-8px est-text-11px",texto:"Copiar npub",onclick:function(){
            if(navigator.clipboard)navigator.clipboard.writeText(pf.npub||"");
            mostrarToast("npub copiado!");
          }})
        ]),
        h("div",{class:"mono corta est-text-11-5px",title:pf.npub||"",texto:pf.npub||"—"}),
        campo("Apelido",apelido),
        h("div",{class:"est-grid est-gap-5px"},[
          h("span",{class:"muted est-text-11-5px",texto:"Seu cachorro no Chalé 3D"}),
          racaWrap
        ]),
        campo("Relay Nostr",relay),
        temAssinador() && redeContatos?.status!=="signer"?null:h("button",{type:"button",class:"secondary-button",texto:"Reconectar assinador Nostr",onclick:function(){reconectarAssinador();}}),
        h("small",{id:"status-relay-contatos",role:"status",texto:redeContatos?.status==="connected"?"Relay conectado":"Aguardando relay"}),
        h("div",{class:"row est-justify-space-between est-mt-4px"},[
          h("button",{type:"button",class:"quiet-button btn-parar",texto:"Trocar / Sair da conta Nostr",onclick:function(){
            confirmarAcao({
              titulo:"Sair da conta Nostr?",
              mensagem:"Você voltará para a tela de acesso Nostr para entrar com outra chave privada ou extensão.",
              textoConfirmar:"Sair",
              perigo:true
            }).then(function(sim){
              if(!sim)return;
              sairNostr().catch(function(err){mostrarToast(err.message);});
            });
          }}),
          h("button",{type:"button",class:"primary-button",texto:"Salvar perfil",onclick:function(){
            api({tipo:"salvar_perfil_nostr",perfil:Object.assign({},pf,{
              apelido:apelido.value.trim()||"Operador",
              raca_cachorro:racaAtual,
              relay_url:relay.value.trim()||RELAY_PADRAO,
              autenticado:true
            })}).then(function(){
              ok.textContent="✓ Perfil Nostr e raça do cachorro salvos!";
              mostrarToast("Perfil atualizado");
            }).catch(falha(box));
          }})
        ])
      ]),
      h("div",{class:"card est-p-12px est-grid est-gap-8px est-mt-10px"},[
        h("strong",{class:"est-text-13px",texto:"Conectar pessoas via npub"}),
        h("p",{class:"muted est-m-0 est-text-11-5px",texto:"Adicione o npub de outras pessoas para depois incluí-las em projetos e chats compartilhados."}),
        h("form",{class:"est-grid est-gap-8px",onsubmit:function(ev){
          ev.preventDefault();
          var np=npubInput.value.trim();
          if(!validarNpub(np)){box.textContent="Informe um npub válido iniciado com npub1.";return;}
          box.textContent="";
          api({tipo:"salvar_contato_nostr",contato:{npub:np,apelido:apelidoContato.value.trim(),raca_cachorro:"caramelo",conectado_em:0}})
            .then(function(){
              npubInput.value="";apelidoContato.value="";
              renderContatos();
              ok.textContent="✓ Contato conectado! Agora você pode adicioná-lo em Projetos e Chats.";
              mostrarToast("Contato Nostr conectado");
            }).catch(falha(box));
        }},[
          npubInput,
          h("div",{class:"row"},[
            apelidoContato,
            h("button",{type:"submit",class:"primary-button est-flex-shrink-0",texto:"+ Conectar npub"})
          ])
        ]),
        listaContatos
      ]),
      ok,
      box
    );
  });
}

function abrirModalCompartilhar(p){
  if (!temAssinador() || redeContatos?.status==="signer") {
    reconectarAssinador(function(){abrirModalCompartilhar(p);});
    return;
  }
  var ehSalaChat=ehChat(p);
  abrirModal("Compartilhar "+(ehSalaChat?"chat":"projeto")+": "+p.nome,function(card){
    var box=erroBox();
    var cs=contatosNostr();
    var selecionados=new Set((p.membros_npub||[]).slice());
    var compartilhadoAtivo=Boolean(p.compartilhado||selecionados.size>0);
    var listaWrap=h("div",{class:"est-grid est-gap-6px"});
    var cotaInfo=h("div",{class:"card est-p-10px est-text-12px"});

    function atualizarInfo(){
      var pessoas=1+selecionados.size;
      var comp=compartilhadoAtivo||selecionados.size>0;
      var lim=!comp?6:(pessoas>=3?2:4);
      cotaInfo.innerHTML="";
      cotaInfo.append(
        h("strong",{texto:comp?("Modo Compartilhado · "+Math.max(2,pessoas)+" pessoa(s)"):"Modo Pessoal (1 pessoa)"}),
        h("p",{class:"muted est-m-4px-0-0",texto:"Limite automático de agentes por pessoa: até "+lim+" agente(s) cada. Agentes de pessoas offline ficam hibernando (zzz) e pular/continuar exige todos os presentes."})
      );
    }

    function renderLista(){
      listaWrap.replaceChildren();
      if(!cs.length){
        listaWrap.append(h("div",{class:"card est-p-12px est-grid est-gap-8px"},[
          h("span",{class:"muted",texto:"Você ainda não conectou nenhum contato Nostr via npub."}),
          h("button",{type:"button",class:"secondary-button",texto:"Conectar contatos (npub)…",onclick:abrirModalNostr})
        ]));
      }else{
        cs.forEach(function(c){
          var ativo=selecionados.has(c.npub);
          listaWrap.append(h("button",{
            type:"button",
            class:"nostr-contact-pick"+(ativo?" sel":""),
            onclick:function(){
              if(selecionados.has(c.npub))selecionados.delete(c.npub);else selecionados.add(c.npub);
              compartilhadoAtivo=selecionados.size>0;
              renderLista();atualizarInfo();
            }
          },[
            h("span",{class:"dot "+(ativo?"dot-ok":"dot-off")}),
            h("div",{class:"est-min-w-0 est-flex-1 est-text-align-left"},[
              h("strong",{class:"est-text-13px",texto:c.apelido||encurtarNpub(c.npub)}),
              h("div",{class:"muted mono corta est-text-11px",texto:c.npub})
            ]),
            h("span",{class:"pill "+(ativo?"ok":""),texto:ativo?"✓ Adicionado":"+ Adicionar"})
          ]));
        });
      }
    }
    renderLista();
    atualizarInfo();

    card.append(
      cotaInfo,
      h("div",{class:"est-grid est-gap-6px est-mt-8px"},[
        h("div",{class:"row est-justify-space-between"},[
          h("strong",{class:"est-text-12px",texto:"Contatos conectados (npub)"}),
          h("button",{type:"button",class:"quiet-button est-p-2px-8px est-text-11px",texto:"+ Novo contato npub",onclick:abrirModalNostr})
        ]),
        listaWrap
      ]),
      box,
      h("div",{class:"row est-justify-space-between est-mt-10px"},[
        p.compartilhado?h("button",{type:"button",class:"quiet-button btn-parar",texto:"Tornar Pessoal",onclick:function(){
          api({tipo:"compartilhar_projeto",projeto:p.id,compartilhado:false,membros_npub:[]}).then(function(){
            fecharModal();
            mostrarToast("Movido para Pessoais");
          }).catch(falha(box));
        }}):h("span",{}),
        h("div",{class:"row"},[
          h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
          h("button",{type:"button",class:"primary-button",texto:"Salvar compartilhamento",onclick:function(){
            var lista=Array.from(selecionados);
            api({tipo:"compartilhar_projeto",projeto:p.id,compartilhado:lista.length>0,membros_npub:lista}).then(async function(){
              if(lista.length>0){
                if(ehSalaChat)abaChatsFiltro="compartilhados";else abaProjetosFiltro="compartilhados";
              }
              fecharModal();
              if(!lista.length){mostrarToast("Atualizado para Pessoal");return;}
              if(p.dono_npub && p.dono_npub!==meuNpub()){mostrarToast("Membros atualizados nesta Estação");return;}
              const convite={projeto:{id:p.id,nome:p.nome,eh_chat:ehSalaChat,dono_npub:meuNpub(),membros_npub:lista}};
              try {
                const envios=await Promise.all(lista.map(n=>redeContatos.publishRoomShare(n,convite)));
                mostrarToast(envios.every(Boolean)?"Convites aceitos pelo relay. Os contatos podem entrar pela notificação.":"Membros salvos. Reconecte ao relay para enviar os convites.");
              } catch(err){mostrarToast(err.message);}
            }).catch(falha(box));
          }})
        ])
      ])
    );
  });
}

function reconectarAssinador(depois){
  fecharModal();
  clearTimeout(timer);
  clearInterval(pulso);
  assinaturaRede="";
  redeContatos?.disconnect();
  limpar3D();
  document.body.classList.remove("chalet-3d-active");
  telaLoginNostr(perfilNostr().pubkey_hex, depois);
}

function telaLoginNostr(contaEsperada, depois){
  document.body.classList.add("nostr-gated");
  var box=erroBox();
  box.setAttribute("role","alert");
  var chave=h("input",{id:"nostr-chave",type:"password",autocomplete:"off",autocapitalize:"none",spellcheck:"false",required:true,placeholder:"nsec1… ou chave privada em hexadecimal"});
  var entrar=h("button",{type:"submit",class:"primary-button",texto:"Entrar"});
  var areaQR=h("div",{hidden:true,class:"nostr-pareamento"});
  var controleQR;
  var qr=h("button",{type:"button",class:"secondary-button",texto:"Entrar com QR Code",onclick:function(){login(null,true);}});
  var extensao=temNip07()?h("button",{type:"button",class:"secondary-button",texto:"Usar extensão Nostr (NIP-07)",onclick:function(){login(null);}}):null;

  async function login(segredo,usarQR){
    if(entrar.disabled)return;
    entrar.disabled=true;
    qr.disabled=true;
    var prazoQR;
    if(usarQR){
      controleQR=new AbortController();
      prazoQR=setTimeout(function(){controleQR.abort(new Error("O QR Code expirou. Gere outro para entrar."));},120000);
    }
    if(extensao)extensao.disabled=true;
    box.textContent="";
    try {
      await entrarNostr(segredo,usarQR?function(imagem,uri){
        areaQR.hidden=false;
        areaQR.replaceChildren(
          h("img",{src:imagem,alt:"QR Code de conexão Nostr para este dispositivo"}),
          h("p",{texto:"Escaneie com um assinador Nostr compatível com NIP-46 e aprove o acesso. O código vale por 2 minutos."}),
          h("a",{href:uri,texto:"Abrir no assinador deste dispositivo"}),
          h("button",{type:"button",class:"quiet-button",texto:"Cancelar",onclick:function(){controleQR.abort(new Error("Pareamento cancelado."));}})
        );
      }:null,usarQR?controleQR.signal:undefined,contaEsperada);
      chave.value="";
      ultimaCarga="";
      document.body.classList.remove("nostr-gated");
      await carregar();
      ciclo();
      if (depois) depois();
    } catch(err){
      box.textContent=err.message;
    } finally {
      clearTimeout(prazoQR);
      qr.disabled=false;
      areaQR.hidden=true;
      areaQR.replaceChildren();
      entrar.disabled=false;
      if(extensao)extensao.disabled=false;
    }
  }

  raiz.replaceChildren(h("div",{class:"nostr-gate"},[
    h("form",{class:"nostr-gate-card",onsubmit:function(ev){ev.preventDefault();login(chave.value);}},[
      h("div",{class:"nostr-gate-head"},[
        h("img",{src:"static/logo.png",alt:"Estação-ai",class:"nostr-gate-logo"}),
        h("div",{},[
          h("h1",{texto:contaEsperada?"Reconectar assinador Nostr":"Acesso Estação-ai"}),
          h("p",{texto:contaEsperada?"Seu dispositivo está conectado. Autorize a mesma conta para assinar eventos e enviar convites.":"Identifique-se com sua conta Nostr para acessar seus projetos, chats 3D e agentes."})
        ])
      ]),
      h("div",{class:"est-grid est-gap-4px"},[
        h("label",{for:"nostr-chave",texto:"Chave Privada Nostr (nsec1… ou hex)"}),
        h("small",{class:"muted est-text-11px",texto:"A chave fica cifrada neste navegador para assinar eventos durante a sessão de 30 dias."})
      ]),
      chave,
      contaEsperada?h("button",{type:"button",class:"quiet-button",texto:"Voltar à Estação",onclick:function(){window.location.reload();}}):null,
      qr,
      areaQR,
      h("small",{class:"muted",texto:"Este navegador manterá sua conta conectada por 30 dias. Use Sair para encerrar antes."}),
      box,
      entrar,
      extensao?h("div",{class:"est-grid est-gap-8px est-mt-6px"},[
        h("div",{class:"nostr-gate-or",texto:"ou"}),
        extensao
      ]):null,
      h("div",{class:"card est-p-10px est-text-11-5px muted est-mt-4px",style:"line-height:1.45;"},[
        h("strong",{style:"color:var(--dash-text);",texto:"Como funciona o Nostr aqui:"}),
        h("ul",{style:"margin:6px 0 0 16px;padding:0;"},[
          h("li",{texto:"Entre com um assinador pelo QR Code, com uma extensão Nostr ou com sua chave privada."}),
          h("li",{texto:"🤝 Para conectar amigos e salas: você usa a chave pública (npub1…)."})
        ])
      ])
    ])
  ]));
  chave.focus();
}

function desenhar(){
  if(!nostrAutenticado()){
    document.body.classList.add("nostr-gated");
    telaLoginNostr();
    return;
  }
  document.body.classList.remove("nostr-gated");
  delete raiz.dataset.bloqueado;
  var ativo=document.activeElement;
  var focoId=ativo&&raiz.contains(ativo)&&ativo.id?ativo.id:"";
  var sel=focoId&&typeof ativo.selectionStart==="number"?[ativo.selectionStart,ativo.selectionEnd]:null;
  var rolagens={};
  raiz.querySelectorAll("[data-rolagem]").forEach(function(el){
    rolagens[el.dataset.rolagem]={topo:el.scrollTop,fim:el.scrollHeight-el.scrollTop-el.clientHeight<40};
  });
  var inChalet3D=PAG==="chat"&&!chatMenuAtivo&&vistaChat==="3d"&&Boolean(chatProj);
  document.body.classList.toggle("chalet-3d-active",inChalet3D);
  var fsKey=inChalet3D?("juri:"+chatProj+":fs"):"";
  var existingFs=fsKey?raiz.querySelector(".juri-fs-stage[data-fs-key='"+fsKey+"']"):null;
  if(existingFs){
    raiz.querySelectorAll(".modal-back,.confirm-back").forEach(function(n){n.remove();});
    telaChat(existingFs);
  }else{
    raiz.replaceChildren();
    if(PAG==="chat")telaChat();
    else if(PAG==="agentes")telaModelos();
    else if(PAG==="projetos")telaProjetos();
    else if(PAG==="projeto")telaProjeto();
    else if(PAG==="consumo")telaConsumo();
  }

  if(!raiz.querySelector("#notificacao-convites")){
    const botao=botaoConvites();
    botao.classList.add("convites-flutuante");
    raiz.append(botao);
  }
  if(modal){
    if(!modal.el){
      var card=h("div",{class:"modal-card",role:"dialog","aria-modal":"true","aria-label":modal.titulo},[
        h("div",{class:"modal-head"},[
          h("h2",{texto:modal.titulo}),
          h("button",{type:"button",class:"modal-close-btn",title:"Fechar (Esc)","aria-label":"Fechar",texto:"✕",onclick:tentarFecharModal})
        ])
      ]);
      modal.render(card);
      card.addEventListener("input",function(){if(modal)modal.sujo=true;});
      card.addEventListener("click",function(ev){ev.stopPropagation();});
      var back=h("div",{class:"modal-back",onclick:function(){if(!modal||!modal.sujo)tentarFecharModal();}},[card]);
      modal.el=back;
      var primeiro=card.querySelector("input:not([type=hidden]),textarea,select");
      setTimeout(function(){if(primeiro&&!card.contains(document.activeElement))primeiro.focus();},0);
    }
    raiz.append(modal.el);
  }

  if(confirmDialog){
    var dlg=confirmDialog;
    var btnConfirm=h("button",{
      type:"button",
      class:dlg.perigo?"danger-button":"primary-button",
      texto:dlg.textoConfirmar,
      onclick:function(){dlg.resolve(true);}
    });
    var cCard=h("div",{class:"confirm-card",role:"alertdialog","aria-modal":"true","aria-label":dlg.titulo,onclick:function(ev){ev.stopPropagation();}},[
      h("div",{class:"confirm-body"},[
        h("h3",{texto:dlg.titulo}),
        h("p",{texto:dlg.mensagem})
      ]),
      h("div",{class:"confirm-foot"},[
        h("button",{type:"button",class:"secondary-button",texto:dlg.textoCancelar,onclick:function(){dlg.resolve(false);}}),
        btnConfirm
      ])
    ]);
    var cBack=h("div",{class:"confirm-back",onclick:function(){dlg.resolve(false);}},[cCard]);
    raiz.append(cBack);
    setTimeout(function(){btnConfirm.focus();},0);
  }

  raiz.querySelectorAll("[data-rolagem]").forEach(function(el){
    var r=rolagens[el.dataset.rolagem];
    el.scrollTop=(!r||r.fim||rolarFim)?el.scrollHeight:r.topo;
  });
  rolarFim=false;
  if(!confirmDialog&&ativo&&document.contains(ativo)&&ativo!==document.activeElement)ativo.focus();
  var c=!confirmDialog&&focoId&&document.getElementById(focoId);
  if(c&&c!==ativo){c.focus();if(sel&&c.setSelectionRange)c.setSelectionRange(sel[0],sel[1]);}
}

/* ================================================================ MODELOS DE IA */
var GRUPOS_PAPEL=[{id:"projetos",rot:"Projetos"},{id:"chat",rot:"Chat"}];
/* Seletor de papel pré-definido, separado em Projetos e Chat, com a legenda do escolhido. */
function seletorPapel(valor,aoMudar){
  var sel=h("select",{},[h("option",{value:"",texto:"— sem papel pré-definido —"})].concat(GRUPOS_PAPEL.map(function(g){
    return h("optgroup",{label:g.rot},(E.papeis||[]).filter(function(pp){return pp.grupo===g.id;}).map(function(pp){
      return h("option",{value:pp.id,selected:pp.id===valor,texto:pp.nome});
    }));
  })));
  var leg=h("p",{class:"muted legenda-papel"});
  function atualizar(){
    var pp=(E.papeis||[]).find(function(x){return x.id===sel.value;});
    leg.textContent=pp?pp.legenda:"Sem papel: o agente recebe só o contexto e responde ao que for pedido.";
    if(aoMudar)aoMudar(pp||null);
  }
  sel.addEventListener("change",atualizar);
  atualizar();
  return {sel:sel,el:h("div",{class:"est-grid est-gap-5px"},[campo("Papel na equipe",sel),leg])};
}
function nomeLivre(base){
  var n=base,i=2;
  while(E.agentes.some(function(a){return a.nome===n;}))n=base+" "+(i++);
  return n;
}
function comandoComPermissao(base,forn,pp){
  return forn==="claude"&&pp&&pp.permissao_claude?base+" "+pp.permissao_claude:base;
}

function renderFormModelo(a,box){
  a=a||{id:"",nome:"",modelo:"",papel:"",funcao:"",grupo:"projetos",fornecedor:"claude",comando:MODELO_PRESETS[0].comando};
  var nome=h("input",{required:true,value:a.nome,placeholder:"Ex.: Claude Arquiteto, Codex Revisão"});
  var modelo=h("input",{value:a.modelo,placeholder:"Ex.: claude-sonnet-4-5, gpt-5.4 (opcional = padrão da CLI)"});
  var papel=h("input",{value:a.papel||"",placeholder:"Ex.: Backend Rust, Frontend (opcional)"});
  var grupoSel=h("select",{},GRUPOS_PAPEL.map(function(g){
    var gAtual=a.funcao?(grupoDoAgente(a)):(a.grupo||"projetos");
    return h("option",{value:g.id,selected:g.id===gAtual,texto:g.rot});
  }));
  var func=seletorPapel(a.funcao||"",function(pp){
    if(pp)grupoSel.value=pp.grupo==="chat"?"chat":"projetos";
    grupoSel.disabled=Boolean(pp);
  });
  var forn=h("select",{},["claude","codex","antigravity-cli","gemini","opencode","pi","ollama","outro"].map(function(f){
    return h("option",{value:f,selected:f===a.fornecedor,texto:f});
  }));
  var cmd=h("input",{required:true,value:a.comando});
  var dica=h("p",{class:"muted",texto:"Modelos comuns: claude-opus-4-5, claude-sonnet-4-5, gpt-5.4"});
  var sugestoesChips=h("div",{class:"chips"});
  function atualizarChipsModelo(){
    var pv=provedor(forn.value);
    sugestoesChips.replaceChildren();
    if(pv&&pv.modelos&&pv.modelos.length){
      pv.modelos.slice(0,12).forEach(function(m){
        sugestoesChips.append(h("button",{
          type:"button",
          class:"chip"+(modelo.value===m.id?" sel":""),
          texto:m.nome||m.id,
          onclick:function(){modelo.value=m.id;atualizarChipsModelo();}
        }));
      });
    }
  }
  atualizarChipsModelo();
  modelo.addEventListener("input",atualizarChipsModelo);
  function aplicarPreset(p){
    forn.value=p.fornecedor;
    if(p.comando||p.id==="outro")cmd.value=p.comando;
    dica.textContent="Exemplos: "+p.sugestoes;
    atualizarChipsModelo();
  }
  var presets=h("div",{class:"chips"},MODELO_PRESETS.map(function(p){
    return h("button",{type:"button",class:"chip"+(forn.value===p.fornecedor?" sel":""),texto:p.rotulo,onclick:function(){
      aplicarPreset(p);
      Array.from(presets.children).forEach(function(b,i){b.classList.toggle("sel",MODELO_PRESETS[i].id===p.id);});
    }});
  }));
  forn.addEventListener("change",function(){
    var p=MODELO_PRESETS.find(function(x){return x.fornecedor===forn.value;});
    if(p)dica.textContent="Exemplos: "+p.sugestoes;
    atualizarChipsModelo();
  });

  var racaSel=h("select",{},[h("option",{value:"",selected:!a.raca_cachorro,texto:"Automática (conforme o papel)"})].concat(
    RACAS_CACHORRO.map(function(rc){return h("option",{value:rc.id,selected:a.raca_cachorro===rc.id,texto:rc.nome+" — "+rc.desc});})
  ));

  return h("form",{class:"est-grid est-gap-11px",onsubmit:function(ev){
    ev.preventDefault();
    api({tipo:"salvar_agente",agente:{id:a.id,nome:nome.value,modelo:modelo.value,papel:papel.value,funcao:func.sel.value,grupo:grupoSel.value,fornecedor:forn.value,comando:cmd.value,raca_cachorro:racaSel.value}})
      .then(fecharModal).catch(falha(box));
  }},[
    h("div",{},[h("span",{class:"muted",texto:"Atalhos de CLI"}),presets]),
    campo("Nome de exibição na Estação",nome),
    campo("Identificador do modelo ({modelo})",modelo),
    sugestoesChips,
    dica,
    func.el,
    campo("Onde este modelo aparece",grupoSel),
    campo("Raça do cachorro no Chalé 3D (cor natural)",racaSel),
    campo("Especialidade (opcional)",papel),
    campo("Fornecedor (define origem de limites e tokens)",forn),
    campo("Comando da CLI (recebe o prompt via stdin; {modelo} é substituído)",cmd),
    box,
    h("div",{class:"row est-justify-flex-end"},[
      h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
      h("button",{type:"submit",class:"primary-button",texto:a.id?"Salvar alterações":"Cadastrar modelo"})
    ])
  ]);
}

function abrirModalModelo(a){
  abrirModal(a&&a.id?"Editar modelo: "+a.nome:"Adicionar modelo de IA",function(card){
    var box=erroBox();
    card.append(renderFormModelo(a,box));
  });
}

function carregarCatalogo(forcar){
  return requisicao("estacao/api/catalogo"+(forcar?"?atualizar=1":""),{credentials:"same-origin",cache:"no-store"})
    .then(function(r){return r.ok?r.json():[];})
    .then(function(c){CATALOGO=c;if(!modal)desenhar();})
    .catch(function(){CATALOGO=[];});
}
function provedor(forn){return (CATALOGO||[]).find(function(p){return p.fornecedor===forn;});}
function ferramentaAtiva(forn){return !E||!(E.ferramentas_desativadas||[]).includes(forn);}
function statusProvedor(p){
  if(!p.instalado)return {cls:"",txt:"Não instalado"};
  if(!ferramentaAtiva(p.fornecedor))return {cls:"",txt:"Removida (desativada)"};
  if(p.login===false)return {cls:"warn",txt:"Login necessário"};
  return {cls:"ok",txt:"● Selecionada"};
}

/* Assistente: escolher a CLI, escolher o modelo da lista, pronto. */
function abrirAssistente(prov,op){
  op=op||{};
  var grupo=op.grupo?GRUPOS_PAPEL.find(function(g){return g.id===op.grupo;}):null;
  var titulo=grupo?"Montar equipe de "+grupo.rot:(prov?"Adicionar modelo · "+prov.rotulo:"Adicionar modelo de IA");
  abrirModal(titulo,function(card){
    var box=erroBox();
    if(!prov){
      card.append(h("p",{class:"muted",texto:grupo?"Escolha a ferramenta: todos os papéis de "+grupo.rot+" serão criados com o modelo que você escolher a seguir.":"Escolha a ferramenta. A Estação já sabe o comando e lista os modelos disponíveis nela."}));
      if(!CATALOGO){card.append(h("p",{class:"muted",texto:"Detectando ferramentas instaladas…"}));carregarCatalogo().then(function(){abrirAssistente(null,op);});return;}
      card.append(h("div",{class:"grid est-grid-cols-180px"},CATALOGO.filter(function(p){return p.instalado&&ferramentaAtiva(p.fornecedor);}).map(function(p){
        var st=statusProvedor(p);
        return h("button",{type:"button",class:"card p-card est-text-align-left est-cursor-pointer",onclick:function(){abrirAssistente(p,op);}},[
          h("div",{class:"row"},[h("span",{class:"av "+avClasse(p.fornecedor),texto:iniciais(p.rotulo)}),h("strong",{texto:p.rotulo})]),
          h("span",{class:"pill "+st.cls,texto:st.txt}),
          h("span",{class:"muted",texto:p.modelos.length?p.modelos.length+" modelos":"modelo padrão"})
        ]);
      })));
      card.append(h("div",{class:"row est-justify-space-between est-mt-6px"},[
        grupo?h("span",{}):h("button",{type:"button",class:"quiet-button",texto:"Comando personalizado…",onclick:function(){abrirModalModelo({id:"",nome:"",modelo:"",papel:"",funcao:op.funcao||"",fornecedor:"outro",comando:""});}}),
        h("button",{type:"button",class:"quiet-button",texto:"↻ Detectar de novo",onclick:function(){CATALOGO=null;carregarCatalogo(true).then(function(){abrirAssistente(null,op);});}})
      ]));
      return;
    }
    var escolhido=prov.modelos[0]||null,papelAtual=null,modeloManual=false;
    var nome=h("input",{required:!grupo,value:escolhido?escolhido.nome:prov.rotulo});
    var nomeMexido=false;nome.addEventListener("input",function(){nomeMexido=true;});
    var cmd=h("input",{value:prov.comando});
    var cmdMexido=false;cmd.addEventListener("input",function(){cmdMexido=true;});
    var outro=h("input",{placeholder:"ou digite o identificador de outro modelo"});
    function nomeSugerido(){
      if(papelAtual)return nomeLivre(nomeCurto(papelAtual));
      return escolhido?escolhido.nome:(outro.value.trim()?prov.rotulo+" "+outro.value.trim():prov.rotulo);
    }
    function perfilChat(pp){
      return (grupo?.id||pp?.grupo||op.grupoPadrao)==="chat"?prov.perfil_chat:null;
    }
    function comandoSugerido(pp){
      var perfil=perfilChat(pp);
      if(perfil&&perfil.modelo===escolhido?.id)return perfil.comando;
      return comandoComPermissao(prov.comando,prov.fornecedor,pp);
    }
    var func=seletorPapel(op.funcao||"",function(pp){
      papelAtual=pp;
      if(!modeloManual){
        var perfil=perfilChat(pp);
        escolhido=prov.modelos.find(function(m){return m.id===perfil?.modelo;})||prov.modelos[0]||null;
        if(lista)desenharLista();
      }
      if(!nomeMexido)nome.value=nomeSugerido();
      if(!cmdMexido)cmd.value=comandoSugerido(pp);
    });
    var busca=h("input",{type:"search",placeholder:"Filtrar modelos…"});
    var lista=h("div",{class:"modelo-lista"});
    function marcar(m){
      modeloManual=true;escolhido=m;
      if(m)outro.value="";
      if(!nomeMexido)nome.value=nomeSugerido();
      if(!cmdMexido)cmd.value=comandoSugerido(papelAtual);
      desenharLista();
    }
    function desenharLista(){
      var f=busca.value.trim().toLowerCase();
      lista.replaceChildren.apply(lista,prov.modelos.filter(function(m){return !f||(m.id+" "+m.nome).toLowerCase().indexOf(f)>=0;}).map(function(m){
        return h("button",{type:"button",class:"modelo-opcao","aria-pressed":String(escolhido===m),onclick:function(){marcar(m);}},[h("strong",{texto:m.nome}),h("span",{class:"muted mono",texto:m.id})]);
      }));
    }
    outro.addEventListener("input",function(){if(outro.value.trim())marcar(null);});
    busca.addEventListener("input",desenharLista);
    desenharLista();
    var papel=h("input",{placeholder:"Ex.: Backend, Frontend (opcional)"});
    var semProjeto=grupo&&grupo.id==="chat"?"— abrir na sala \"Conversas\" —":"— não adicionar a um projeto agora —";
    var alvosProj=grupo&&grupo.id==="chat"?E.projetos.filter(ehChat):E.projetos.filter(function(p){return !ehChat(p);});
    var proj=h("select",{},[h("option",{value:"",texto:semProjeto})].concat(alvosProj.map(function(p){return h("option",{value:p.id,texto:p.nome});})));
    var papeisGrupo=grupo?(E.papeis||[]).filter(function(pp){return pp.grupo===grupo.id;}):[];
    function adicionarAoProjeto(ids){
      if(!ids.length)return Promise.resolve();
      var p=proj.value&&E.projetos.find(function(x){return x.id===proj.value;});
      if(p)return api({tipo:"salvar_projeto",projeto:Object.assign({},p,{agentes:p.agentes.concat(ids.filter(function(i){return p.agentes.indexOf(i)<0;}))})});
      if(grupo&&grupo.id==="chat"){
        var sala=E.projetos.find(function(x){return ehChat(x)&&x.nome==="Conversas";});
        var base=sala||{id:"",nome:"Conversas",descricao:"Conversa geral com os papéis de Chat.",pasta:"",agentes:[],memoria:"",contexto:"",eh_chat:true};
        return api({tipo:"salvar_projeto",projeto:Object.assign({},base,{eh_chat:true,agentes:base.agentes.concat(ids.filter(function(i){return base.agentes.indexOf(i)<0;}))})});
      }
      return Promise.resolve();
    }
    card.append(h("form",{class:"est-grid est-gap-11px",onsubmit:function(ev){
      ev.preventDefault();
      var id=outro.value.trim()||(escolhido?escolhido.id:"");
      var criados=[];
      var lista=grupo?papeisGrupo:[papelAtual];
      lista.reduce(function(prom,pp){
        return prom.then(function(){
          var grpFinal=pp?(pp.grupo==="chat"?"chat":"projetos"):(op.grupoPadrao||"projetos");
          var ag=grupo
            ?{id:"",nome:nomeLivre(nomeCurto(pp)),modelo:id,papel:"",funcao:pp.id,grupo:grpFinal,fornecedor:prov.fornecedor,comando:comandoSugerido(pp)}
            :{id:"",nome:nome.value,modelo:id,papel:papel.value,funcao:pp?pp.id:"",grupo:grpFinal,fornecedor:prov.fornecedor,comando:cmd.value};
          return api({tipo:"salvar_agente",agente:ag}).then(function(r){if(r&&r.id)criados.push(r.id);});
        });
      },Promise.resolve())
        .then(function(){return adicionarAoProjeto(criados);})
        .then(function(){fecharModal();carregarConsumo();})
        .catch(falha(box));
    }},[
      prov.login===false?h("div",{class:"card est-border-color-warning est-p-10px"},[h("strong",{texto:"Login necessário para uso sem tela. "}),h("span",{class:"muted",texto:prov.dica})]):null,
      prov.modelos.length?h("div",{class:"est-grid est-gap-6px"},[h("span",{class:"muted",texto:"Modelo"}),prov.modelos.length>8?busca:null,lista,outro]):campo("Modelo (vazio = padrão da ferramenta)",outro),
      grupo?h("div",{class:"card est-p-10px est-grid est-gap-4px"},[h("strong",{class:"est-text-12px",texto:"Serão criados "+papeisGrupo.length+" agentes:"})].concat(papeisGrupo.map(function(pp){
        return h("span",{class:"muted"},[h("strong",{texto:nomeCurto(pp)+": "}),pp.legenda]);
      }))):func.el,
      grupo?null:campo("Nome na equipe",nome),
      grupo?null:campo("Especialidade (opcional)",papel),
      E.projetos.length||(grupo&&grupo.id==="chat")?campo("Adicionar ao projeto",proj):null,
      h("p",{class:"muted",texto:"Consumo: "+prov.consumo}),
      grupo?null:h("details",{},[h("summary",{class:"muted",texto:"Avançado: comando executado (inclui a permissão sugerida para o papel)"}),h("div",{class:"est-mt-8px"},[cmd])]),
      box,
      h("div",{class:"row est-justify-space-between"},[
        h("button",{type:"button",class:"secondary-button",texto:"← Outra ferramenta",onclick:function(){abrirAssistente(null,op);}}),
        h("button",{type:"submit",class:"primary-button",texto:grupo?"Criar "+papeisGrupo.length+" agentes":"Adicionar modelo"})
      ])
    ]));
  });
}

function grupoDoAgente(a){
  var pp=papelDe(a);
  if(pp)return pp.grupo==="chat"?"chat":"projetos";
  return a&&a.grupo==="chat"?"chat":"projetos";
}

function abrirModalAutoConfig(grupoAtual,papeisGrupo,okBox){
  abrirModal("Configurar automático · "+grupoAtual.rot,function(card){
    var box=erroBox();
    var inputs={};
    card.append(h("p",{class:"muted",texto:"Escolha quantos agentes criar para cada papel usando apenas as ferramentas selecionadas neste computador (0 = não criar)."}));
    var lista=h("div",{class:"est-grid est-gap-8px"});
    papeisGrupo.forEach(function(pp){
      var atuais=E.agentes.filter(function(a){return a.funcao===pp.id;}).length;
      var inp=h("input",{type:"number",min:"0",max:"8",value:String(atuais||1),class:"est-w-74px est-text-align-center"});
      inputs[pp.id]=inp;
      lista.append(h("div",{class:"papel-item est-items-center est-justify-space-between"},[
        h("div",{class:"est-min-w-0 est-flex-1"},[
          h("strong",{class:"est-text-13px",texto:pp.nome}),
          h("p",{class:"legenda-papel muted",texto:pp.legenda})
        ]),
        h("label",{class:"est-flex est-items-center est-gap-6px est-flex-shrink-0"},[
          h("span",{class:"muted",texto:"Qtd:"}),
          inp
        ])
      ]));
    });
    card.append(h("form",{class:"est-grid est-gap-12px",onsubmit:function(ev){
      ev.preventDefault();
      var q={};
      Object.keys(inputs).forEach(function(k){
        var v=parseInt(inputs[k].value,10);
        q[k]=isNaN(v)?0:Math.max(0,Math.min(8,v));
      });
      api({tipo:"auto_configurar",grupo:grupoAtual.id,quantidades:q}).then(function(){
        fecharModal();
        if(okBox)okBox.textContent="✓ Modelos de "+grupoAtual.rot+" configurados conforme as quantidades escolhidas!";
      }).catch(falha(box));
    }},[
      lista,
      box,
      h("div",{class:"row est-justify-flex-end"},[
        h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
        h("button",{type:"submit",class:"primary-button",texto:"Aplicar configuração"})
      ])
    ]));
  });
}

function telaModelos(){
  if(!CATALOGO)carregarCatalogo();
  var agProj=E.agentes.filter(function(a){return grupoDoAgente(a)==="projetos";});
  var agChat=E.agentes.filter(function(a){return grupoDoAgente(a)==="chat";});
  var grupoAtual=GRUPOS_PAPEL.find(function(g){return g.id===abaModelos;})||GRUPOS_PAPEL[0];
  var listaAgentes=abaModelos==="chat"?agChat:agProj;
  var papeisGrupo=(E.papeis||[]).filter(function(pp){return pp.grupo===grupoAtual.id;});

  var box=erroBox();
  var ok=h("p",{class:"ok-msg"});
  raiz.append(
    h("div",{class:"head-bar"},[
      h("div",{},[
        h("h1",{texto:"Modelos de IA"}),
        h("p",{class:"sub",texto:"Escolha a ferramenta e o modelo; a Estação configura e distribui os papéis da aba ativa entre provedores."})
      ]),
      h("div",{class:"row"},[
        h("button",{type:"button",class:"secondary-button",title:"Escolhe quantos agentes criar para cada papel usando as ferramentas selecionadas",texto:"Configurar automático ("+grupoAtual.rot+")",onclick:function(){abrirModalAutoConfig(grupoAtual,papeisGrupo,ok);}}),
        h("button",{type:"button",class:"primary-button",texto:"+ Adicionar modelo",onclick:function(){abrirAssistente(null,abaModelos==="chat"?{funcao:"pessoa",grupoPadrao:"chat"}:{grupoPadrao:"projetos"});}})
      ])
    ]),
    box,
    ok
  );

  // 1. Ferramentas detectadas neste computador (PRIMEIRO)
  var instTotal=(CATALOGO||[]).filter(function(p){return p.instalado;}).length;
  var instAtivas=(CATALOGO||[]).filter(function(p){return p.instalado&&ferramentaAtiva(p.fornecedor);}).length;
  raiz.append(h("div",{class:"row est-justify-space-between est-items-baseline est-mt-8px"},[
    h("div",{class:"row est-items-baseline est-gap-10px"},[
      h("h2",{class:"est-m-0",texto:"Ferramentas neste computador"}),
      CATALOGO?h("span",{class:"muted",texto:instAtivas+" de "+instTotal+" selecionada(s)"}):null
    ]),
    h("button",{type:"button",class:"quiet-button est-text-11px",texto:"↻ Detectar de novo",onclick:function(){CATALOGO=null;carregarCatalogo(true);}})
  ]));
  var ferr=h("div",{class:"grid est-grid-cols-220px est-m-10px-0-22px"});
  if(!CATALOGO)ferr.append(h("p",{class:"muted",texto:"Detectando ferramentas de IA instaladas…"}));
  (CATALOGO||[]).forEach(function(p){
    var st=statusProvedor(p);
    var ativa=p.instalado&&ferramentaAtiva(p.fornecedor);
    ferr.append(h("div",{class:"card"+(ativa?"":" est-opacity-inactive")+" est-grid est-gap-8px"},[
      h("div",{class:"row"},[h("span",{class:"av "+avClasse(p.fornecedor),texto:iniciais(p.rotulo)}),h("div",{class:"est-flex-1 est-min-w-0"},[h("strong",{texto:p.rotulo}),h("div",{class:"muted",texto:p.instalado?(p.modelos.length?p.modelos.length+" modelos disponíveis":"modelo padrão"):"não encontrado"})])]),
      h("span",{class:"pill est-justify-self-start "+st.cls,texto:st.txt}),
      p.dica?h("p",{class:"muted est-m-0 est-text-11px",texto:p.dica}):null,
      p.instalado?h("div",{class:"row est-gap-6px"},[
        ativa?h("button",{type:"button",class:"secondary-button est-flex-1",texto:"+ Adicionar",onclick:function(){abrirAssistente(p,abaModelos==="chat"?{funcao:"pessoa",grupoPadrao:"chat"}:{grupoPadrao:"projetos"});}}):null,
        ativa
          ?h("button",{type:"button",class:"quiet-button btn-parar",title:"Remove esta ferramenta da lista selecionável neste computador",texto:"Remover",onclick:function(){api({tipo:"alternar_ferramenta",fornecedor:p.fornecedor,ativa:false}).catch(falha(box));}})
          :h("button",{type:"button",class:"secondary-button est-flex-1",title:"Reativa esta ferramenta neste computador",texto:"+ Ativar ferramenta",onclick:function(){api({tipo:"alternar_ferramenta",fornecedor:p.fornecedor,ativa:true}).catch(falha(box));}})
      ]):null
    ]));
  });
  raiz.append(ferr);

  // 2. Modelos de Projetos e Chat (SEGUNDO)
  raiz.append(h("div",{class:"tabs-bar",role:"tablist","aria-label":"Categorias de modelos"},[
    h("button",{type:"button",role:"tab",class:"tab-btn","aria-selected":String(abaModelos==="projetos"),onclick:function(){abaModelos="projetos";desenhar();}},[
      "Projetos",
      h("span",{class:"tab-count",texto:String(agProj.length)})
    ]),
    h("button",{type:"button",role:"tab",class:"tab-btn","aria-selected":String(abaModelos==="chat"),onclick:function(){abaModelos="chat";desenhar();}},[
      "Chat",
      h("span",{class:"tab-count",texto:String(agChat.length)})
    ])
  ]));

  raiz.append(h("div",{class:"row est-justify-space-between est-items-center est-mt-20px est-mb-10px"},[
    h("h2",{class:"est-m-0",texto:"Modelos de "+grupoAtual.rot+" ("+listaAgentes.length+")"}),
    listaAgentes.length?h("button",{type:"button",class:"quiet-button btn-parar est-text-11-5px",texto:"Excluir todos de "+grupoAtual.rot,onclick:function(){
      confirmarAcao({
        titulo:"Excluir todos os modelos de "+grupoAtual.rot+"?",
        mensagem:"Todos os "+listaAgentes.length+" modelos de "+grupoAtual.rot+" serão removidos e sairão de todos os projetos.",
        textoConfirmar:"Excluir todos",
        perigo:true
      }).then(function(sim){
        if(!sim)return;
        api({tipo:"excluir_agentes_grupo",grupo:grupoAtual.id}).then(function(){
          ok.textContent="✓ Todos os modelos de "+grupoAtual.rot+" foram excluídos.";
          mostrarToast("Modelos excluídos");
        }).catch(falha(box));
      });
    }}):null
  ]));
  if(!listaAgentes.length){
    raiz.append(h("div",{class:"card est-text-align-center est-p-28px"},[
      h("strong",{texto:"Nenhum modelo de "+grupoAtual.rot+" cadastrado ainda"}),
      h("p",{class:"muted est-m-6px-0-14px",texto:"Clique em “Configurar automático ("+grupoAtual.rot+")” para escolher quantos agentes criar por papel usando as ferramentas selecionadas."}),
      h("div",{class:"row est-justify-center"},[
        h("button",{type:"button",class:"primary-button",texto:"Configurar automático ("+grupoAtual.rot+")",onclick:function(){abrirModalAutoConfig(grupoAtual,papeisGrupo,ok);}})
      ])
    ]));
  }else{
    var g=h("div",{class:"grid"});
    listaAgentes.forEach(function(a){
      var ausente=cliAusente(a.id),pv=provedor(a.fornecedor);
      var semLogin=pv&&pv.login===false;
      var st=ausente?{cls:"err",txt:"⚠ CLI ausente"}:semLogin?{cls:"warn",txt:"⚠ Login necessário"}:{cls:"ok",txt:"● Pronto"};
      var trocaModelo=null;
      if(pv&&pv.modelos&&pv.modelos.length){
        var optsM=[h("option",{value:a.modelo||"",texto:a.modelo||"modelo padrão"})];
        pv.modelos.forEach(function(m){
          if(m.id!==a.modelo)optsM.push(h("option",{value:m.id,texto:m.nome&&m.nome!==m.id?(m.nome+" ("+m.id+")"):m.id}));
        });
        optsM.push(h("option",{value:"__outro__",texto:"Outro identificador…"}));
        var selM=h("select",{"aria-label":"Trocar identificador do modelo de "+a.nome,class:"est-text-11-5px est-p-4px-8px est-flex-1 est-min-w-140px",onchange:function(){
          if(selM.value==="__outro__"){selM.value=a.modelo||"";abrirModalModelo(a);return;}
          api({tipo:"salvar_agente",agente:Object.assign({},a,{modelo:selM.value})}).then(function(){
            ok.textContent="✓ Modelo de "+a.nome+" alterado para "+selM.value;
          }).catch(falha(box));
        }},optsM);
        selM.value=a.modelo||"";
        trocaModelo=h("div",{class:"row est-gap-6px"},[
          h("span",{class:"muted est-text-11px est-flex-shrink-0",texto:"Modelo:"}),
          selM
        ]);
      }
      g.append(h("div",{class:"card p-card"},[
        h("div",{class:"p-card-head"},[
          avatar(a),
          h("div",{class:"est-min-w-0 est-flex-1"},[
            h("h3",{texto:a.nome}),
            h("p",{class:"muted",texto:(pv?pv.rotulo:rotuloFornecedor(a.fornecedor))+" · "+(a.modelo||"modelo padrão")+(a.papel?" · "+a.papel:"")})
          ]),
          h("span",{class:"pill "+st.cls,texto:st.txt})
        ]),
        semLogin?h("p",{class:"muted est-m-0 est-text-11px",texto:pv.dica}):null,
        papelDe(a)?h("p",{class:"muted est-m-0"},[h("span",{class:"pill accent",texto:papelDe(a).nome})," ",papelDe(a).legenda]):null,
        trocaModelo,
        h("div",{class:"row"},[
          h("span",{class:"pill",texto:a.execucoes+" execuções"}),
          h("span",{class:"pill",texto:Math.round(a.segundos/60)+" min"}),
          h("span",{class:"pill accent",texto:"consumo configurado"})
        ]),
        h("div",{class:"p-card-foot"},[
          h("span",{class:"muted",texto:E.projetos.filter(function(p){return p.agentes.indexOf(a.id)>=0;}).map(function(p){return p.nome;}).join(", ")||"Em nenhum projeto"}),
          h("div",{class:"row"},[
            h("button",{type:"button",class:"quiet-button",title:"Envia um prompt curto de teste para validar se esta CLI responde",texto:"Testar",onclick:function(ev){
              var btn=ev.currentTarget;btn.disabled=true;btn.textContent="Testando…";box.textContent="";ok.textContent="";
              api({tipo:"testar_agente",id:a.id}).then(function(r){
                btn.disabled=false;btn.textContent="Testar";
                ok.textContent="✓ "+a.nome+" respondeu: "+(r&&r.id?r.id:"OK!");
              }).catch(function(err){
                btn.disabled=false;btn.textContent="Testar";
                box.textContent="Falha ao testar "+a.nome+": "+err.message;
              });
            }}),
            h("button",{type:"button",class:"secondary-button",texto:"Editar",onclick:function(){abrirModalModelo(a);}}),
            h("button",{type:"button",class:"quiet-button btn-parar",texto:"Excluir",onclick:function(){
              confirmarAcao({
                titulo:"Excluir modelo",
                mensagem:"Deseja excluir o modelo \""+a.nome+"\"? Ele sairá de todos os projetos e chats.",
                textoConfirmar:"Excluir modelo",
                perigo:true
              }).then(function(sim){
                if(sim)api({tipo:"excluir_agente",id:a.id}).then(function(){mostrarToast("Modelo excluído");});
              });
            }})
          ])
        ])
      ]));
    });
    raiz.append(g);
  }

  // 3. Papéis pré-definidos por último, em formato de lista organizada
  var papeisLista=h("div",{class:"role-list"},[
    h("div",{class:"role-list-head"},[
      h("strong",{class:"est-text-14px",texto:"Papéis de "+grupoAtual.rot}),
      h("span",{class:"muted",texto:grupoAtual.id==="projetos"?"funções de trabalho nos projetos":"perfis de conversa e debate"})
    ])
  ].concat(papeisGrupo.map(function(pp){
    var atribuidos=E.agentes.filter(function(a){return a.funcao===pp.id;});
    return h("div",{class:"role-row"},[
      h("div",{class:"role-row-main"},[
        h("div",{class:"role-row-title"},[
          h("strong",{texto:pp.nome}),
          atribuidos.length?h("span",{class:"pill ok",texto:atribuidos.map(function(x){return rotuloFornecedor(x.fornecedor);}).join(", ")}):h("span",{class:"pill",texto:"não configurado"})
        ]),
        h("p",{class:"role-row-desc",texto:pp.legenda})
      ]),
      h("button",{type:"button",class:"secondary-button est-p-6px-12px est-text-12px est-flex-shrink-0",texto:"+ Criar",onclick:function(){abrirAssistente(null,{funcao:pp.id});}})
    ]);
  })));
  raiz.append(h("h2",{texto:"Papéis pré-definidos · "+grupoAtual.rot}),papeisLista);
}

/* ================================================================ CHAT (sessões de conversa em balões) */
function ehChat(p){
  return Boolean(p&&p.eh_chat)||Boolean(p&&p.nome==="Conversas"&&!p.pasta&&!p.memoria);
}

function ultimaMsgChat(p){
  var ult=null;
  E.mensagens.forEach(function(m){
    if(m.projeto===p.id&&(!ult||m.em>=ult.em))ult=m;
  });
  return ult;
}

function chatsOrdenados(){
  return E.projetos.filter(ehChat).sort(function(a,b){
    var ma=ultimaMsgChat(a),mb=ultimaMsgChat(b);
    var ta=ma?ma.em:0,tb=mb?mb.em:0;
    if(ta!==tb)return tb-ta;
    return a.nome.localeCompare(b.nome,"pt-BR");
  });
}

function abrirModalChat(p){
  var editando=Boolean(p&&p.id);
  var chatIds=E.agentes.filter(function(a){return grupoDoAgente(a)==="chat";}).map(function(a){return a.id;});
  var limitePadrao=p?limiteAgentesSala(p):(abaChatsFiltro==="compartilhados"?4:6);
  var padrao=editando
    ?p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="chat";}).slice(0,limitePadrao)
    :chatIds.slice(0,limitePadrao);
  abrirModal(editando?"Gerenciar conversa: "+p.nome:"Novo chat",function(card){
    var box=erroBox();
    var nome=h("input",{required:true,value:p?p.nome:"",placeholder:"Ex.: Dúvidas de arquitetura, Ideias da semana, Bate-papo"});
    var desc=h("input",{value:p?p.descricao:"",placeholder:"Assunto ou objetivo desta conversa (opcional)"});
    var ctx=h("textarea",{class:"est-min-h-70px",placeholder:"Instruções só para esta conversa (ex.: responda em tópicos curtos)…"});
    ctx.value=p?p.contexto:"";
    var sel=seletorModelos(padrao,{grupo:"chat",atalhos:true,limite:limitePadrao});
    card.append(h("form",{class:"est-grid est-gap-12px",onsubmit:function(ev){
      ev.preventDefault();
      api({tipo:"salvar_projeto",projeto:{
        id:p?p.id:"",
        nome:nome.value,
        descricao:desc.value,
        pasta:"",
        agentes:sel.valor(),
        memoria:"",
        contexto:ctx.value,
        eh_chat:true,
        compartilhado:p?Boolean(p.compartilhado):(abaChatsFiltro==="compartilhados"),
        membros_npub:p?(p.membros_npub||[]):[]
      }}).then(function(r){
        if(r&&r.id){chatProj=r.id;canal="geral";abertoChat="";}
        fecharModal();
      }).catch(falha(box));
    }},[
      campo("Nome / assunto do chat",nome),
      campo("Descrição do assunto (opcional)",desc),
      h("div",{class:"est-grid est-gap-6px"},[
        h("span",{class:"muted",texto:"Modelos de Chat disponíveis nesta sessão (limite: "+limitePadrao+" por pessoa)"}),
        sel
      ]),
      h("details",{open:Boolean(p&&p.contexto)},[
        h("summary",{class:"muted",texto:"Instruções extras para esta conversa (opcional)"}),
        h("div",{class:"est-mt-8px"},[ctx])
      ]),
      box,
      h("div",{class:"row est-justify-space-between"},[
        editando?h("button",{type:"button",class:"quiet-button btn-parar",texto:"Excluir chat",onclick:function(){
          confirmarAcao({
            titulo:"Excluir chat",
            mensagem:"Excluir o chat \""+p.nome+"\" e todas as mensagens dele? Esta ação não pode ser desfeita.",
            textoConfirmar:"Excluir chat",
            perigo:true
          }).then(function(sim){
            if(!sim)return;
            api({tipo:"excluir_projeto",id:p.id}).then(function(){
              if(chatProj===p.id){chatProj="";chatMenuAtivo=true;}
              canal="geral";abertoChat="";fecharModal();
              mostrarToast("Chat excluído");
            }).catch(falha(box));
          });
        }}):h("span",{}),
        h("div",{class:"row"},[
          h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
          h("button",{type:"submit",class:"primary-button",texto:editando?"Salvar alterações":"Criar chat"})
        ])
      ])
    ]));
  });
}

function escaparHtml(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function exportarConversaPDF(p,canalAtual){
  var msgs=E.mensagens.filter(function(m){return m.projeto===p.id&&m.canal===canalAtual;});
  var agCanal=canalAtual==="geral"?null:agente(canalAtual);
  var titulo=p.nome+(agCanal?" · "+agCanal.nome:" · Chat Geral");
  var participantes=p.agentes.map(function(id){
    var a=agente(id);
    return a?(a.nome+" ("+rotuloFornecedor(a.fornecedor)+(a.modelo?" · "+a.modelo:"")+")"):id;
  }).join(", ")||"Nenhum modelo";
  var blocos=msgs.map(function(m){
    var ehVoce=m.autor==="voce",ag=ehVoce?null:agente(m.autor);
    var nome=ehVoce?"Você":nomeAutor(m.autor);
    var meta=ag?((rotuloPapel(ag)?rotuloPapel(ag)+" · ":"")+(ag.modelo||rotuloFornecedor(ag.fornecedor))):"";
    var corpo=m.html&&m.texto?m.html:("<pre class='pdf-texto'>"+escaparHtml(m.texto)+"</pre>");
    return "<article class='pdf-msg "+(ehVoce?"pdf-voce":"")+"'>"
      +"<header><strong>"+escaparHtml(nome)+"</strong>"
      +(meta?" <span class='pdf-badge'>"+escaparHtml(meta)+"</span>":"")
      +" <span class='pdf-hora'>"+escaparHtml(dataBR(m.em))+"</span></header>"
      +"<div class='pdf-body'>"+corpo+"</div></article>";
  }).join("");
  var html="<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>"+escaparHtml(titulo)+" · Estação-ai</title>"
    +"</head><body>"
    +"<div class='pdf-top'><h1>"+escaparHtml(titulo)+"</h1>"
    +"<p class='pdf-meta'><strong>Exportado em:</strong> "+escaparHtml(dataBR(Date.now()/1000))+" · <strong>Mensagens:</strong> "+msgs.length+"</p>"
    +"<p class='pdf-meta'><strong>Participantes:</strong> "+escaparHtml(participantes)+"</p></div>"
    +(blocos||"<p>Nenhuma mensagem registrada nesta conversa.</p>")
    +"</body></html>";
  var w=window.open("","_blank","width=920,height=720");
  var iframe=null;
  if(!w){
    iframe=document.createElement("iframe");
    iframe.className="est-iframe-impressao";
    document.body.appendChild(iframe);
    w=iframe.contentWindow;
  }
  var doc=w.document;
  doc.open();
  doc.write(html);
  doc.close();

  var css=doc.createElement("link");
  css.rel="stylesheet";
  css.href=new URL("static/estacao-impressao.css",document.baseURI).href;
  function imprimir(){
    w.focus();
    setTimeout(function(){w.print();if(iframe)setTimeout(function(){iframe.remove();},1500);},iframe?200:250);
  }
  css.addEventListener("load",imprimir,{once:true});
  css.addEventListener("error",imprimir,{once:true});
  doc.head.append(css);
}

function bolhaChat(m,p,box){
  var ehVoce=m.autor==="voce",ag=ehVoce?null:agente(m.autor);
  var corpo=m.estado==="pensando"?(m.texto||"Pensando…"):m.texto;
  var body=h("div",{class:"msg-body"});
  if(m.html&&m.texto){
    body.innerHTML=m.html;
  }else{
    body.className="msg-body l-raw";
    body.textContent=corpo||"";
  }
  var acoes=!ehVoce&&m.estado==="ok"&&m.texto&&p?h("div",{class:"dc-msg-actions"},[
    h("button",{type:"button",class:"dc-act-btn",title:"Copiar resposta",texto:"Copiar",onclick:function(ev){
      var b=ev.currentTarget;
      if(navigator.clipboard)navigator.clipboard.writeText(m.texto);
      b.textContent="Copiado";setTimeout(function(){b.textContent="Copiar";},1200);
    }}),
    p.agentes.length>=1?h("button",{type:"button",class:"dc-act-btn",title:"Pedir para outra IA verificar esta resposta",texto:"Verificar",onclick:function(){
      api({tipo:"verificar_ideias",projeto:p.id,canal:canal,mensagem_id:m.id}).catch(falha(box));
    }}):null
  ]):null;
  return h("div",{class:"dc-msg "+(ehVoce?"voce ":"")+m.estado},[
    acoes,
    h("div",{class:"dc-msg-av"},[avatar(ehVoce?"voce":m.autor)]),
    h("div",{class:"dc-msg-content"},[
      h("div",{class:"dc-msg-head"},[
        h("span",{class:"dc-msg-name "+(ehVoce?"":avClasse(ag&&ag.fornecedor)),texto:nomeAutor(m.autor)}),
        ag&&rotuloPapel(ag)?h("span",{class:"dc-tag role",texto:rotuloPapel(ag)}):null,
        ag&&ag.fornecedor?h("span",{class:"dc-tag",texto:rotuloFornecedor(ag.fornecedor)+(ag.modelo?" · "+ag.modelo:"")}):null,
        h("span",{class:"dc-time",texto:horaBR(m.em)}),
        m.estado==="pensando"?h("span",{class:"pill warn est-p-1px-6px est-text-10px",texto:"● respondendo…"}):null,
        m.estado==="erro"?h("span",{class:"pill err est-p-1px-6px est-text-10px",texto:"erro"}):null
      ]),
      body
    ])
  ]);
}

function entrarNoChat(c,modo){
  if(!c)return;
  chatProj=c.id;
  canal="geral";
  abertoChat="";
  rolarFim=true;
  chatMenuAtivo=false;
  vistaChat=modo||"3d";
  if(vistaChat==="3d"&&window.EstacaoNav){
    window.EstacaoNav.collapse(false);
  }
  desenhar();
}

function telaChat(existingFs){
  var box=erroBox();
  var chats=chatsOrdenados();
  var p=chats.find(function(x){return x.id===chatProj;})||chats[0]||null;
  if(p&&!chatProj)chatProj=p.id;
  if(!p)chatMenuAtivo=true;

  // 1. MENU DE CHATS (Pessoais | Compartilhados via Nostr, adicionar, remover, compartilhar e entrar no Chalé 3D)
  if(chatMenuAtivo){
    limpar3D();
    document.body.classList.remove("chalet-3d-active");
    var temChatModels=E.agentes.some(function(a){return grupoDoAgente(a)==="chat";});
    var chatsPessoais=chats.filter(function(c){return !c.compartilhado;});
    var chatsCompartilhados=chats.filter(function(c){return Boolean(c.compartilhado);});
    var chatsVisiveis=abaChatsFiltro==="compartilhados"?chatsCompartilhados:chatsPessoais;
    var hub=h("div",{class:"chats-hub"});
    hub.append(
      h("div",{class:"head-bar"},[
        h("div",{},[
          h("h1",{texto:"Chats"}),
          h("p",{class:"sub",texto:"Escolha um chat pessoal (até 6 agentes) ou compartilhado via Nostr (4 agentes para 2 pessoas · 2 para 3+) para entrar no Chalé 3D."})
        ]),
        h("div",{class:"row"},[
          botaoConvites(),botaoContaNostr(),
          !temChatModels?h("button",{type:"button",class:"secondary-button",texto:"Configurar automático (Chat)",onclick:function(){
            api({tipo:"auto_configurar",grupo:"chat"}).then(function(r){
              if(r&&r.id){chatProj=r.id;mostrarToast("Modelos e sala de Chat configurados");}
            }).catch(falha(box));
          }}):null,
          h("button",{type:"button",class:"primary-button",texto:"+ Novo chat",onclick:function(){abrirModalChat();}})
        ])
      ]),
      h("div",{class:"tabs-bar",role:"tablist","aria-label":"Filtro de chats pessoais ou compartilhados"},[
        h("button",{type:"button",role:"tab",class:"tab-btn","aria-selected":String(abaChatsFiltro==="pessoais"),onclick:function(){abaChatsFiltro="pessoais";desenhar();}},[
          "Pessoais",
          h("span",{class:"tab-count",texto:String(chatsPessoais.length)})
        ]),
        h("button",{type:"button",role:"tab",class:"tab-btn","aria-selected":String(abaChatsFiltro==="compartilhados"),onclick:function(){abaChatsFiltro="compartilhados";desenhar();}},[
          "Compartilhados",
          h("span",{class:"tab-count",texto:String(chatsCompartilhados.length)})
        ])
      ]),
      box
    );

    if(!chatsVisiveis.length){
      hub.append(h("div",{class:"card est-text-align-center est-p-34px"},[
        h("strong",{texto:abaChatsFiltro==="compartilhados"?"Nenhum chat compartilhado ainda":(temChatModels?"Nenhum chat pessoal criado ainda":"Nenhum modelo de Chat cadastrado ainda")}),
        h("p",{class:"muted est-m-8px-auto-16px est-max-w-540px"},[
          abaChatsFiltro==="compartilhados"
            ?"Compartilhe um chat seu com contatos Nostr (npub) ou conecte-se ao relay para ver chats compartilhados com você."
            :(temChatModels
              ?"Crie seu primeiro chat pessoal para entrar no Chalé 3D com até 6 agentes cachorrinhos."
              :"Clique em “Configurar automático (Chat)” para detectar suas CLIs instaladas e preparar o Chalé 3D.")
        ]),
        h("div",{class:"row est-justify-center"},[
          abaChatsFiltro==="compartilhados"
            ?h("button",{type:"button",class:"primary-button",texto:"Conectar contatos (npub)",onclick:abrirModalNostr})
            :h("button",{type:"button",class:"primary-button",texto:temChatModels?"+ Novo chat":"Configurar automático (Chat)",onclick:function(){
              if(temChatModels)abrirModalChat();
              else api({tipo:"auto_configurar",grupo:"chat"}).then(function(r){if(r&&r.id)chatProj=r.id;}).catch(falha(box));
            }}),
          abaChatsFiltro==="compartilhados"
            ?h("button",{type:"button",class:"secondary-button",texto:"+ Novo chat compartilhado",onclick:function(){abrirModalChat();}})
            :null
        ])
      ]));
    }else{
      var grid=h("div",{class:"grid chats-hub-grid"});
      chatsVisiveis.forEach(function(c){
        var ult=ultimaMsgChat(c);
        var cChatIds=c.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="chat";});
        var pensando=cChatIds.some(function(id){return statusModeloNoProjeto(c,id).ocupado;});
        var totalMsgs=E.mensagens.filter(function(m){return m.projeto===c.id;}).length;
        var preview=c.descricao||(ult?ult.texto.replace(/\s+/g," ").trim():"Pronto para iniciar conversa no Chalé 3D");
        var ehMeu=!c.dono_npub||c.dono_npub===meuNpub();
        var pessoas=contarPessoasSala(c);
        var lim=limiteAgentesSala(c);
        var chips=h("div",{class:"chips"},cChatIds.slice(0,6).map(function(id){
          var a=agente(id);
          var hib=agenteHibernando(c,a);
          return h("span",{class:"pill"+(hib?" sleeping":""),texto:(hib?"💤 ":"")+(a?a.nome:id)});
        }).concat(cChatIds.length>6?[h("span",{class:"pill",texto:"+"+(cChatIds.length-6)})]:[]));

        grid.append(h("div",{class:"card p-card chat-hub-card",onclick:function(){entrarNoChat(c,"3d");}},[
          h("div",{class:"p-card-head"},[
            h("span",{class:"p-icon",texto:"#"}),
            h("div",{class:"est-min-w-0 est-flex-1"},[
              h("h3",{texto:c.nome}),
              h("p",{class:"muted corta",texto:preview})
            ]),
            h("span",{class:"pill"+(pensando?" warn":" ok"),texto:pensando?"● respondendo":(totalMsgs+" msg(s)")})
          ]),
          h("div",{class:"row"},[
            c.compartilhado
              ?h("span",{class:"pill accent",texto:(ehMeu?"Compartilhado por você":"Compartilhado com você")+" · "+pessoas+" pessoas (até "+lim+"/pessoa)"})
              :h("span",{class:"pill",texto:"Pessoal · até 6 agentes"})
          ]),
          chips,
          h("div",{class:"p-card-foot",onclick:function(ev){ev.stopPropagation();}},[
            h("div",{class:"row"},[
              h("button",{type:"button",class:"secondary-button",texto:"Editar",onclick:function(){abrirModalChat(c);}}),
              h("button",{type:"button",class:"quiet-button",texto:"Compartilhar",onclick:function(){abrirModalCompartilhar(c);}}),
              h("button",{type:"button",class:"quiet-button",texto:"Chat 2D",onclick:function(){entrarNoChat(c,"chat");}}),
              h("button",{type:"button",class:"quiet-button btn-parar",title:"Remover chat",texto:"Remover",onclick:function(){
                confirmarAcao({
                  titulo:"Remover chat",
                  mensagem:"Deseja remover o chat \""+c.nome+"\" e todas as mensagens dele? Esta ação não pode ser desfeita.",
                  textoConfirmar:"Remover chat",
                  perigo:true
                }).then(function(sim){
                  if(!sim)return;
                  api({tipo:"excluir_projeto",id:c.id}).then(function(){
                    if(chatProj===c.id)chatProj="";
                    canal="geral";abertoChat="";
                    mostrarToast("Chat removido");
                  }).catch(falha(box));
                });
              }})
            ]),
            h("button",{type:"button",class:"primary-button",texto:"Entrar no Chalé 3D →",onclick:function(){entrarNoChat(c,"3d");}})
          ])
        ]));
      });
      hub.append(grid);
    }
    raiz.append(hub);
    return;
  }

  var chatAgIds=p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="chat";});
  if(canal!=="geral"&&chatAgIds.indexOf(canal)<0)canal="geral";
  VISTO[p.id+"/"+canal]=Date.now()/1000;
  registrarPresencaLocal(p);

  var agCanal=canal==="geral"?null:agente(canal),ppCanal=papelDe(agCanal);
  var msgs=msgsCanal(p);

  // 2. MODO CHALÉ 3D PRIORITÁRIO (Tela cheia total, cachorrinhos, almofadas, fogueira com bancos, Nostr & consenso Q)
  if(vistaChat==="3d"){
    var slot3D=h("div",{class:"slot-3d"});
    var payload3D={
      chatId:p.dono_npub===meuNpub()?npubToHex(meuNpub())+"-"+p.id:p.id,
      title:p.nome,
      subtitle:p.descricao||"Chalé 3D da Estação-ai",
      shared:Boolean(p.compartilhado),
      userProfile:perfilNostr(),
      autoresNostr:[p.dono_npub||meuNpub()].concat(p.membros_npub||[],p.compartilhado?[]:contatosNostr().map(c=>c.npub)).map(npubToHex).filter(Boolean),
      onlineNpubs:onlineNaSala(p),
      agents:chatAgIds.map(function(id){
        var a=agente(id),st=statusModeloNoProjeto(p,id),pp=papelDe(a),hib=agenteHibernando(p,a);
        return {
          id:a.id,name:a.nome,funcao:a.funcao||"",fornecedor:a.fornecedor||"",modelo:a.modelo||"",
          raca_cachorro:a.raca_cachorro||"",
          roleLabel:pp?nomeCurto(pp):"Chat",providerLabel:rotuloFornecedor(a.fornecedor),
          busy:st.ocupado,ausente:Boolean(st.ausente),hibernando:hib,statusText:hib?"Hibernando (zzz)":st.texto
        };
      }),
      messages:E.mensagens.filter(function(m){return m.projeto===p.id&&m.canal==="geral";}),
      avaliacoes:(E.avaliacoes||[]).filter(function(av){return av.projeto===p.id;})
    };
    var fsCallbacks={
      onSend:function(texto){
        api({tipo:"enviar",projeto:p.id,canal:"geral",texto:texto}).catch(falha(box));
      },
      onDebate:function(tema){
        if(tema&&tema.trim()){
          api({tipo:"enviar",projeto:p.id,canal:"geral",texto:"debate: "+tema.trim()}).catch(falha(box));
        }else{
          abrirModalDebate(p);
        }
      },
      onVerify:function(){
        api({tipo:"verificar_ideias",projeto:p.id,canal:"geral",mensagem_id:null}).catch(falha(box));
      },
      onScore:function(){
        api({tipo:"avaliar_mediador",projeto:p.id,canal:"geral",mensagem_id:null}).catch(falha(box));
      },
      onManageChat:function(){
        abrirModalChat(p);
      },
      onChangeBreed:function(novaRaca){
        var pf=perfilNostr();
        api({tipo:"salvar_perfil_nostr",perfil:Object.assign({},pf,{raca_cachorro:novaRaca,autenticado:true})}).catch(function(){});
      },
      onReconnectSigner:function(){reconectarAssinador();},
      onPresenceChange:function(npubs){
        registrarPresencaLocal(p,npubs);
      },
      onSwitchView:function(v){
        vistaChat=v;
        document.body.classList.remove("chalet-3d-active");
        desenhar();
      },
      onExitToChats:function(){
        chatMenuAtivo=true;
        document.body.classList.remove("chalet-3d-active");
        limpar3D();
        if(window.EstacaoNav)window.EstacaoNav.expand(false);
        desenhar();
      },
      onOpenMainMenu:function(){
        chatMenuAtivo=true;
        document.body.classList.remove("chalet-3d-active");
        limpar3D();
        if(window.EstacaoNav)window.EstacaoNav.expand(true);
        desenhar();
      }
    };
    if(existingFs){
      if(SCENE3D.ctrl)SCENE3D.ctrl.sync(payload3D);
    }else{
      var fsStage=h("div",{class:"juri-fs-stage chalet-full-stage","data-fs-key":"juri:"+p.id+":fs"},[slot3D]);
      raiz.append(box,fsStage);
      montarOuAtualizar3D(slot3D,"juri","juri:"+p.id+":fs",payload3D,fsCallbacks,{fullscreen:true,currentView:"3d"});
    }
    return;
  }

  // 3. MODO CHAT 2D EDGE-TO-EDGE (ocupa 100% da tela / monitor inteiro quando menu recolhido)
  var shell=h("div",{class:"dc-shell"});
  var colEsq=h("aside",{class:"dc-rail","aria-label":"Sessões de chat"});
  colEsq.append(h("div",{class:"dc-rail-head"},[
    h("button",{type:"button",class:"quiet-button est-p-4px-8px est-text-11-5px",texto:"← Chats",onclick:function(){
      chatMenuAtivo=true;limpar3D();desenhar();
    }}),
    h("button",{type:"button",class:"primary-button est-p-4px-10px est-text-11px",texto:"+ Novo",onclick:function(){abrirModalChat();}})
  ]));
  var lista=h("div",{class:"dc-rail-body"});
  chats.forEach(function(c){
    var ult=ultimaMsgChat(c);
    var cChatIds=c.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="chat";});
    var pensando=cChatIds.some(function(id){return statusModeloNoProjeto(c,id).ocupado;});
    var sub=c.descricao
      ?c.descricao
      :(ult?ult.texto.replace(/\s+/g," ").trim():(cChatIds.length+" modelo(s)"));
    var rowWrap=h("div",{class:"row est-gap-4px est-flex-wrap-nowrap est-items-stretch"},[
      h("button",{
        type:"button",
        class:"dc-chan est-flex-1 est-min-w-0",
        "aria-selected":String(c.id===p.id),
        onclick:function(){
          if(chatProj!==c.id){chatProj=c.id;canal="geral";abertoChat="";rolarFim=true;desenhar();}
        }
      },[
        h("span",{class:"dc-chan-hash",texto:"#"}),
        h("div",{class:"chat-session-meta"},[
          h("div",{class:"row est-gap-6px est-flex-wrap-nowrap"},[
            h("strong",{class:"est-flex-1 est-min-w-0",texto:c.nome}),
            h("span",{class:"dot "+(pensando?"dot-busy":"dot-ok"),title:pensando?"Respondendo…":"Ativo"})
          ]),
          h("small",{texto:sub})
        ])
      ]),
      h("button",{
        type:"button",
        class:"quiet-button btn-parar est-p-0-7px est-text-11px est-flex-shrink-0 est-opacity-0-7",
        title:"Excluir chat \""+c.nome+"\"",
        texto:"✕",
        onclick:function(ev){
          ev.stopPropagation();
          confirmarAcao({
            titulo:"Excluir chat",
            mensagem:"Excluir o chat \""+c.nome+"\" e todas as mensagens dele?",
            textoConfirmar:"Excluir chat",
            perigo:true
          }).then(function(sim){
            if(!sim)return;
            api({tipo:"excluir_projeto",id:c.id}).then(function(){
              if(chatProj===c.id){chatProj="";chatMenuAtivo=true;}
              canal="geral";abertoChat="";
              mostrarToast("Chat excluído");
            }).catch(falha(box));
          });
        }
      })
    ]);
    lista.append(rowWrap);
  });
  colEsq.append(lista);
  colEsq.append(h("div",{class:"dc-rail-foot"},[
    h("span",{class:"muted",texto:chats.length+" canal(is)"}),
    h("button",{type:"button",class:"quiet-button est-p-2px-6px est-text-11px",texto:"Modelos →",onclick:function(){irPara("modelos");}})
  ]));

  var colChat=h("section",{class:"dc-main","aria-label":"Conversa"});
  var vistaTabs=h("div",{class:"vista-tabs",role:"group","aria-label":"Modo de visualização"},[
    h("button",{type:"button","aria-pressed":String(vistaChat==="3d"),texto:"Chalé 3D",onclick:function(){
      vistaChat="3d";
      if(window.EstacaoNav)window.EstacaoNav.collapse(false);
      desenhar();
    }}),
    h("button",{type:"button","aria-pressed":String(vistaChat==="chat"),texto:"Chat 2D",onclick:function(){vistaChat="chat";desenhar();}})
  ]);
  var maisAcoes=[];
  if(msgs.length&&chatAgIds.length>=1){
    maisAcoes.push(h("button",{type:"button",texto:"Verificar ideias",onclick:function(){
      api({tipo:"verificar_ideias",projeto:p.id,canal:canal,mensagem_id:null}).catch(falha(box));
    }}));
  }
  if(msgs.length&&chatAgIds.some(function(id){var a=agente(id);return a&&a.funcao==="mediador";})){
    maisAcoes.push(h("button",{type:"button",texto:"Pontuar Mediador",onclick:function(){
      api({tipo:"avaliar_mediador",projeto:p.id,canal:canal,mensagem_id:null}).catch(falha(box));
    }}));
  }
  if(msgs.length){
    maisAcoes.push(h("button",{type:"button",texto:"Exportar PDF",onclick:function(){exportarConversaPDF(p,canal);}}));
  }
  maisAcoes.push(h("button",{type:"button",texto:"Modelos da conversa",onclick:function(){abrirModalChat(p);}}));
  if(msgs.length){
    maisAcoes.push(h("button",{type:"button",class:"danger",texto:"Limpar mensagens",onclick:function(){
      confirmarAcao({
        titulo:"Limpar mensagens",
        mensagem:"Apagar todas as mensagens "+(agCanal?"com "+agCanal.nome:"desta conversa")+"? Não dá para desfazer.",
        textoConfirmar:"Limpar",
        perigo:true
      }).then(function(sim){
        if(sim)api({tipo:"limpar_chat",projeto:p.id,canal:canal}).then(function(){mostrarToast("Mensagens limpas");}).catch(falha(box));
      });
    }}));
  }
  maisAcoes.push(h("button",{type:"button",class:"danger",texto:"Excluir chat",onclick:function(){
    confirmarAcao({
      titulo:"Excluir chat",
      mensagem:"Excluir o chat \""+p.nome+"\" e todas as mensagens dele?",
      textoConfirmar:"Excluir chat",
      perigo:true
    }).then(function(sim){
      if(!sim)return;
      api({tipo:"excluir_projeto",id:p.id}).then(function(){
        if(chatProj===p.id){chatProj="";chatMenuAtivo=true;}
        canal="geral";abertoChat="";
        mostrarToast("Chat excluído");
      }).catch(falha(box));
    });
  }}));
  var menuMais=h("details",{class:"dc-more"},[
    h("summary",{title:"Mais ações",texto:"⋯"}),
    h("div",{class:"dc-more-pop"},maisAcoes)
  ]);

  colChat.append(h("div",{class:"dc-header"},[
    h("div",{class:"dc-header-title"},[
      agCanal?avatar(agCanal,true):h("span",{class:"dc-chan-hash est-background-accent-soft est-color-accent",texto:"#"}),
      h("div",{},[
        h("strong",{texto:p.nome+(agCanal?" · "+agCanal.nome:"")}),
        h("span",{texto:agCanal
          ?((agCanal.modelo||rotuloFornecedor(agCanal.fornecedor))+(ppCanal?" · "+nomeCurto(ppCanal):"")+" (conversa individual)")
          :(p.descricao||"Canal geral com "+(chatAgIds.length?chatAgIds.length+" modelos de Chat":"nenhum modelo"))})
      ])
    ]),
    h("div",{class:"row"},[
      vistaTabs,
      !agCanal&&chatAgIds.length>=2?h("button",{type:"button",class:"secondary-button est-p-5px-10px est-text-11-5px",title:"Iniciar debate estruturado entre as IAs",texto:"Debate",onclick:function(){abrirModalDebate(p);}}):null,
      chatAgIds.some(function(id){return statusModeloNoProjeto(p,id).ocupado;})?h("button",{type:"button",class:"quiet-button btn-parar est-p-5px-9px est-text-11-5px",title:"Para os modelos que estão respondendo",texto:"Parar",onclick:function(){
        api({tipo:"parar",projeto:p.id,agente:null}).catch(falha(box));
      }}):null,
      menuMais
    ])
  ]));

  var modeBar=h("div",{class:"dc-members"},[
    h("button",{
      type:"button",
      class:"chip"+(canal==="geral"?" sel":""),
      "aria-pressed":String(canal==="geral"),
      onclick:function(){canal="geral";rolarFim=true;desenhar();}
    },"# Todos ("+chatAgIds.length+")")
  ]);
  chatAgIds.forEach(function(id){
    var a=agente(id);if(!a)return;
    var st=statusModeloNoProjeto(p,id);
    modeBar.append(h("button",{
      type:"button",
      class:"chip"+(canal===id?" sel":""),
      "aria-pressed":String(canal===id),
      title:"Conversar só com "+a.nome+" ("+rotuloFornecedor(a.fornecedor)+")",
      onclick:function(){canal=id;rolarFim=true;desenhar();}
    },[
      h("span",{class:"dot "+st.cls}),
      a.nome
    ]));
  });
  modeBar.append(h("button",{type:"button",class:"quiet-button est-ml-auto est-p-3px-9px est-text-11px",texto:"+ Participantes",onclick:function(){abrirModalChat(p);}}));
  colChat.append(modeBar);

  var avsChat=(E.avaliacoes||[]).filter(function(av){return av.projeto===p.id;});
  if(avsChat.length){
    var ultAvs={};
    avsChat.forEach(function(av){ultAvs[av.agente_id]=av;});
    var itensAv=Object.keys(ultAvs).map(function(k){return ultAvs[k];});
    colChat.append(h("div",{class:"chat-scoreboard"},[
      h("strong",{class:"est-color-score",texto:"Placar do Mediador:"})
    ].concat(itensAv.map(function(av){
      return h("span",{class:"pill warn",title:"Clareza "+av.nota_clareza+" · Fundamentação "+av.nota_fundamentacao+" · Colaboração "+av.nota_colaboracao+(av.melhorar?"\nMelhorar: "+av.melhorar:""),texto:av.agente_nome+" "+Number(av.media||0).toFixed(1)+"/10"});
    }))));
  }

  var entrada=h("textarea",{
    id:"chat-entrada",
    "aria-label":"Mensagem",
    placeholder:canal==="geral"
      ?"Converse no #"+p.nome+" (escreva \"debate: seu tema\" ou use @Nome)…"
      :"Conversar apenas com "+nomeAutor(canal)+"…"
  });
  if(abertoChat&&abertoChat.canal===canal)entrada.value=abertoChat.texto;
  entrada.addEventListener("input",function(){abertoChat={canal:canal,texto:entrada.value};});

  if(canal==="geral"&&chatAgIds.length>1){
    var mb=h("div",{class:"mention-bar"},[
      h("span",{class:"muted est-self-center est-text-11px",texto:"Atalhos:"}),
      h("button",{type:"button",class:"mention-btn",texto:"debate:",onclick:function(){
        entrada.value="debate: "+(entrada.value||"");
        abertoChat={canal:canal,texto:entrada.value};
        entrada.focus();
      }})
    ]);
    chatAgIds.forEach(function(id){
      var a=agente(id);if(!a)return;
      mb.append(h("button",{type:"button",class:"mention-btn",texto:"@"+a.nome,onclick:function(){
        var v=entrada.value;
        var sep=v&&!/\s$/.test(v)?" ":"";
        entrada.value=v+sep+"@"+a.nome+" ";
        abertoChat={canal:canal,texto:entrada.value};
        entrada.focus();
      }}));
    });
    colChat.append(mb);
  }

  var feed=h("div",{class:"dc-feed","data-rolagem":"chat-livre-"+p.id+"-"+canal,role:"log","aria-live":"polite"});
  if(!msgs.length){
    feed.append(h("div",{class:"chat-welcome est-m-16px"},[
      h("strong",{texto:canal==="geral"?"Bem-vindo ao canal #"+p.nome:"Conversa direta com "+nomeAutor(canal)}),
      h("p",{texto:canal==="geral"
        ?(chatAgIds.length
          ?"Participantes ativos: "+chatAgIds.map(nomeAutor).join(", ")+". Escreva \"debate: <tema>\" ou entre no Chalé 3D acima."
          :"Nenhum modelo de Chat selecionado nesta conversa ainda. Clique em “+ Participantes” acima.")
        :"Nesta aba você conversa apenas com "+nomeAutor(canal)+", mantendo o assunto \""+p.nome+"\"."})
    ]));
  }else{
    msgs.forEach(function(m){feed.append(bolhaChat(m,p,box));});
  }
  colChat.append(feed);

  var enviarForm=h("form",{onsubmit:function(ev){
    ev.preventDefault();
    var t=entrada.value;
    if(!t.trim()||enviando)return;
    enviando=true;abertoChat="";entrada.value="";rolarFim=true;
    api({tipo:"enviar",projeto:p.id,canal:canal,texto:t}).catch(function(e){
      if(!abertoChat||!abertoChat.texto)abertoChat={canal:canal,texto:t};
      box.textContent=e.message;
      desenhar();
    }).then(function(){enviando=false;});
  }},[
    h("div",{class:"dc-composer-box"},[
      entrada,
      h("button",{type:"submit",class:"primary-button est-p-8px-14px",texto:"Enviar"})
    ])
  ]);
  entrada.addEventListener("keydown",function(ev){
    if(ev.isComposing||ev.keyCode===229)return;
    if(ev.key==="Enter"&&!ev.shiftKey){
      ev.preventDefault();
      enviarForm.requestSubmit();
    }
  });
  colChat.append(h("div",{class:"dc-composer"},[
    enviarForm,
    h("div",{class:"composer-hint"},[
      h("span",{texto:"Enter envia · Shift+Enter quebra linha"}),
      h("span",{texto:chatAgIds.length+" modelo(s) de Chat neste canal"})
    ])
  ]));

  limpar3D();
  shell.append(colEsq,colChat);
  raiz.append(box,shell);
}

/* ================================================================ PROJETOS */
function seletorModelos(sel,op){
  var filtro=op&&op.grupo?op.grupo:null;
  var limite=(op&&op.limite)||6;
  var baseAgentes=filtro
    ?E.agentes.filter(function(a){return grupoDoAgente(a)===filtro;})
    :E.agentes;
  var validosSet=new Set(baseAgentes.map(function(a){return a.id;}));
  var marcados=new Set((sel||[]).filter(function(id){return validosSet.has(id);}).slice(0,limite));
  var cont=h("div",{class:"est-grid est-gap-8px"});
  var wrap=h("div",{class:"chips"});
  var contador=h("span",{class:"pill",texto:marcados.size+"/"+limite+" selecionados"});
  function redesenharChips(){
    contador.textContent=marcados.size+"/"+limite+" selecionados";
    contador.className="pill"+(marcados.size>=limite?" warn":" ok");
    wrap.querySelectorAll("button[data-ag]").forEach(function(c){
      var ativo=marcados.has(c.dataset.ag);
      c.classList.toggle("sel",ativo);
      c.setAttribute("aria-pressed",String(ativo));
    });
  }
  if(op&&op.atalhos&&baseAgentes.length){
    cont.append(h("div",{class:"row"},[
      contador,
      h("button",{type:"button",class:"quiet-button est-p-3px-9px est-text-11px",texto:"Até o limite ("+Math.min(limite,baseAgentes.length)+")",onclick:function(){
        marcados=new Set(baseAgentes.slice(0,limite).map(function(a){return a.id;}));
        redesenharChips();
      }}),
      h("button",{type:"button",class:"quiet-button est-p-3px-9px est-text-11px",texto:"Limpar",onclick:function(){marcados=new Set();redesenharChips();}})
    ]));
  }
  baseAgentes.forEach(function(a){
    var c=h("button",{
      type:"button",
      "data-ag":a.id,
      class:"chip"+(marcados.has(a.id)?" sel":""),
      "aria-pressed":String(marcados.has(a.id)),
      texto:a.nome+(a.modelo?" · "+a.modelo:"")+(cliAusente(a.id)?" (CLI ausente)":"")
    });
    c.addEventListener("click",function(){
      if(marcados.has(a.id)){
        marcados.delete(a.id);
      }else{
        if(marcados.size>=limite){
          mostrarToast("Limite máximo de "+limite+" agentes atingido nesta sala.");
          return;
        }
        marcados.add(a.id);
      }
      redesenharChips();
    });
    wrap.append(c);
  });
  if(!baseAgentes.length)wrap.append(h("span",{class:"muted"},["Nenhum modelo de "+(filtro==="chat"?"Chat":"Projetos")+" cadastrado ainda. ",h("a",{href:"modelos",texto:"Cadastrar modelos de IA"})]));
  cont.append(wrap);
  cont.valor=function(){return Array.from(marcados);};
  return cont;
}

function renderFormProjeto(p,box,depois){
  p=p||{id:"",nome:"",descricao:"",pasta:"",agentes:[],memoria:"",contexto:"",compartilhado:abaProjetosFiltro==="compartilhados",membros_npub:[]};
  var limiteSala=limiteAgentesSala(p);
  var nome=h("input",{required:true,value:p.nome,placeholder:"Ex.: Estação-ai, Transporte AIPF"});
  var desc=h("textarea",{placeholder:"Objetivo do projeto, stack principal…"});
  desc.value=p.descricao||"";
  var pasta=h("input",{value:p.pasta||"",placeholder:"~/Área de trabalho/Projetos/meu-projeto"});
  var escopos=(E.memorias||[]).map(function(m){return m.escopo;});
  if(p.memoria&&escopos.indexOf(p.memoria)<0)escopos.unshift(p.memoria);
  var memSel=h("select",{},[h("option",{value:"",texto:"— sem memória ligada —"})].concat(
    escopos.map(function(es){return h("option",{value:es,selected:es===p.memoria,texto:es});})
  ));
  var memCustom=h("input",{value:p.memoria||"",placeholder:"ou digite workspace/projeto (ex.: default/meu-app)"});
  memSel.addEventListener("change",function(){
    memCustom.value=memSel.value;
    if(!pasta.value&&memSel.value){
      var m=(E.memorias||[]).find(function(x){return x.escopo===memSel.value;});
      if(m&&m.pasta)pasta.value=m.pasta;
    }
  });
  var ctx=h("textarea",{placeholder:"Regras e contexto deste projeto (injetado em todos os modelos do projeto)"});
  ctx.value=p.contexto||"";
  var agsProj=(p.agentes||[]).filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="projetos";}).slice(0,limiteSala);
  var ags=seletorModelos(agsProj,{grupo:"projetos",atalhos:true,limite:limiteSala});

  return h("form",{class:"est-grid est-gap-11px",onsubmit:function(ev){
    ev.preventDefault();
    api({tipo:"salvar_projeto",projeto:{
      id:p.id||"",
      nome:nome.value,
      descricao:desc.value,
      pasta:pasta.value,
      agentes:ags.valor(),
      memoria:memCustom.value.trim(),
      contexto:ctx.value,
      compartilhado:Boolean(p.compartilhado),
      membros_npub:p.membros_npub||[]
    }}).then(function(res){
      fecharModal();
      if(depois)depois(res);
    }).catch(falha(box));
  }},[
    campo("Nome do projeto",nome),
    campo("Descrição",desc),
    campo("Pasta onde os modelos trabalham",pasta),
    h("div",{},[h("span",{class:"muted est-block est-mb-6px est-weight-600",texto:"Modelos / aplicações de IA designados (limite: "+limiteSala+" por pessoa)"}),ags]),
    campo("Memória ligada",memSel),
    campo("Escopo de memória (workspace/projeto)",memCustom),
    campo("Contexto do projeto (injetado em todo prompt)",ctx),
    box,
    h("div",{class:"row est-justify-space-between"},[
      p.id?h("button",{type:"button",class:"quiet-button est-color-danger",texto:"Excluir projeto",onclick:function(){
        confirmarAcao({
          titulo:"Excluir projeto",
          mensagem:"Excluir o projeto \""+p.nome+"\", suas tarefas e conversas? A memória (páginas e sessões) não é apagada.",
          textoConfirmar:"Excluir projeto",
          perigo:true
        }).then(function(sim){
          if(sim)api({tipo:"excluir_projeto",id:p.id}).then(function(){fecharModal();irPara("projetos");}).catch(falha(box));
        });
      }}):h("span",{}),
      h("div",{class:"row"},[
        h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
        h("button",{type:"submit",class:"primary-button",texto:"Salvar projeto"})
      ])
    ])
  ]);
}

function abrirModalProjeto(p,depois){
  abrirModal(p&&p.id?"Configurar projeto: "+p.nome:"Novo projeto",function(card){
    var box=erroBox();
    card.append(renderFormProjeto(p,box,depois));
  });
}

function abrirModalContextoGlobal(){
  abrirModal("Contexto global (todos os projetos)",function(card){
    var box=erroBox();
    var ctx=h("textarea",{class:"est-min-h-160px",placeholder:"Ex.: Responder sempre em pt-BR. Nunca remover comentários existentes. Seguir arquitetura X…"});
    ctx.value=E.contexto_global||"";
    card.append(
      h("p",{class:"muted",texto:"Este contexto é enviado automaticamente para todos os modelos em todos os projetos da Estação-ai, junto com as regras globais da memória (default/_global)."}),
      ctx,
      box,
      h("div",{class:"row est-justify-flex-end"},[
        h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
        h("button",{type:"button",class:"primary-button",texto:"Salvar contexto global",onclick:function(){
          api({tipo:"contexto_global",texto:ctx.value}).then(fecharModal).catch(falha(box));
        }})
      ])
    );
  });
}

function ativarMemoria(m,abrirDireto){
  var base={
    id:"",
    nome:nomeProjetoMemoria(m.escopo),
    descricao:"Projeto ligado à memória "+m.escopo,
    pasta:m.pasta||"",
    agentes:E.agentes.filter(function(a){return grupoDoAgente(a)==="projetos";}).map(function(a){return a.id;}),
    memoria:m.escopo,
    contexto:""
  };
  if(abrirDireto){
    api({tipo:"salvar_projeto",projeto:base}).then(function(res){
      if(res&&res.id)irPara("projetos/"+encodeURIComponent(res.id));
    });
  }else{
    abrirModalProjeto(base,function(res){
      if(res&&res.id)irPara("projetos/"+encodeURIComponent(res.id));
    });
  }
}

function telaProjetos(){
  var err=erroBox();
  var todosProjetos=E.projetos.filter(function(p){return !ehChat(p);});
  var projPessoais=todosProjetos.filter(function(p){return !p.compartilhado;});
  var projCompartilhados=todosProjetos.filter(function(p){return Boolean(p.compartilhado);});
  var projetosLista=abaProjetosFiltro==="compartilhados"?projCompartilhados:projPessoais;

  raiz.append(
    h("div",{class:"head-bar"},[
      h("div",{},[
        h("h1",{texto:"Projetos"}),
        h("p",{class:"sub",texto:"Workspace 2D dinâmico com Pensador coordenando entregas, lista viva de tarefas e multi-terminal integrado. Pessoais (até 6 agentes) ou Compartilhados via Nostr."})
      ]),
      h("div",{class:"row"},[
        botaoConvites(),botaoContaNostr(),
        h("button",{type:"button",class:"secondary-button",texto:"◈ Contexto global",onclick:abrirModalContextoGlobal}),
        h("button",{type:"button",class:"primary-button",texto:"+ Novo projeto",onclick:function(){abrirModalProjeto(null,function(res){if(res&&res.id)irPara("projetos/"+encodeURIComponent(res.id));});}})
      ])
    ]),
    h("div",{class:"tabs-bar",role:"tablist","aria-label":"Filtro de projetos pessoais ou compartilhados"},[
      h("button",{type:"button",role:"tab",class:"tab-btn","aria-selected":String(abaProjetosFiltro==="pessoais"),onclick:function(){abaProjetosFiltro="pessoais";desenhar();}},[
        "Pessoais",
        h("span",{class:"tab-count",texto:String(projPessoais.length)})
      ]),
      h("button",{type:"button",role:"tab",class:"tab-btn","aria-selected":String(abaProjetosFiltro==="compartilhados"),onclick:function(){abaProjetosFiltro="compartilhados";desenhar();}},[
        "Compartilhados",
        h("span",{class:"tab-count",texto:String(projCompartilhados.length)})
      ])
    ]),
    err
  );

  var ligados=new Set();
  todosProjetos.forEach(function(p){if(p.memoria)ligados.add(p.memoria);});
  var g=h("div",{class:"grid"});
  projetosLista.forEach(function(p){
    var ts=E.tarefas.filter(function(t){return t.projeto===p.id;});
    var exec=ts.filter(function(t){return t.status==="executando";}).length;
    var conc=ts.filter(function(t){return t.status==="concluida";}).length;
    var mem=(E.memorias||[]).find(function(m){return m.escopo===p.memoria;});
    var agProjP=p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="projetos";});
    var ehMeu=!p.dono_npub||p.dono_npub===meuNpub();
    var pessoas=contarPessoasSala(p);
    var lim=limiteAgentesSala(p);
    var chips=h("div",{class:"chips"},agProjP.length?agProjP.map(function(id){
      var a=agente(id);
      var ativo=ts.some(function(t){return t.agente===id&&t.status==="executando";});
      var hib=agenteHibernando(p,a);
      return h("span",{class:"pill"+(hib?" sleeping":(ativo?" warn":"")),texto:(hib?"💤 ":(ativo?"● ":""))+nomeAutor(id)+(a&&a.modelo?" · "+a.modelo:"")});
    }):[h("span",{class:"muted",texto:"Nenhum modelo de projeto designado"})]);

    g.append(h("div",{class:"card p-card"},[
      h("div",{class:"p-card-head"},[
        h("span",{class:"p-icon",texto:"▦"}),
        h("div",{class:"est-min-w-0 est-flex-1"},[
          h("h3",{texto:p.nome}),
          h("p",{class:"muted",texto:p.descricao||"Sem descrição"})
        ]),
        exec?h("span",{class:"pill warn",texto:"● "+exec+" em execução"}):h("span",{class:"pill",texto:ts.length+" tarefa(s)"})
      ]),
      h("div",{class:"row"},[
        p.compartilhado
          ?h("span",{class:"pill accent",texto:(ehMeu?"Compartilhado por você":"Compartilhado com você")+" · "+pessoas+" pessoas (até "+lim+"/pessoa)"})
          :h("span",{class:"pill",texto:"Pessoal · até 6 agentes"})
      ]),
      chips,
      h("div",{class:"muted mono corta",title:p.pasta||"",texto:p.pasta||"Sem pasta definida"}),
      h("div",{class:"row"},[
        p.memoria?h("span",{class:"pill accent",texto:"◈ "+p.memoria+(mem?" ("+mem.paginas+" págs · "+mem.sessoes+" sessões)":"")}):h("span",{class:"pill",texto:"Sem memória ligada"}),
        conc?h("span",{class:"pill ok",texto:conc+" concluída(s)"}):null
      ]),
      h("div",{class:"p-card-foot"},[
        h("div",{class:"row"},[
          h("button",{type:"button",class:"secondary-button",texto:"Configurar",onclick:function(){abrirModalProjeto(p);}}),
          h("button",{type:"button",class:"quiet-button",texto:"Compartilhar",onclick:function(){abrirModalCompartilhar(p);}}),
          h("button",{type:"button",class:"quiet-button btn-parar",title:"Excluir projeto",texto:"Excluir",onclick:function(){
            confirmarAcao({
              titulo:"Excluir projeto",
              mensagem:"Excluir o projeto \""+p.nome+"\" com suas tarefas e conversas? A memória (páginas e sessões) não é apagada.",
              textoConfirmar:"Excluir projeto",
              perigo:true
            }).then(function(sim){
              if(sim)api({tipo:"excluir_projeto",id:p.id}).then(function(){mostrarToast("Projeto excluído");}).catch(falha(err));
            });
          }})
        ]),
        h("button",{type:"button",class:"primary-button",texto:"Abrir workspace →",onclick:function(){irPara("projetos/"+encodeURIComponent(p.id));}})
      ])
    ]));
  });

  if(!projetosLista.length){
    g.append(h("div",{class:"card est-grid-column-1--1 est-text-align-center est-p-28px"},[
      h("strong",{texto:abaProjetosFiltro==="compartilhados"?"Nenhum projeto compartilhado ainda":"Nenhum projeto pessoal configurado ainda"}),
      h("p",{class:"muted est-m-6px-0-12px",texto:abaProjetosFiltro==="compartilhados"
        ?"Compartilhe um projeto seu com contatos Nostr (npub) ou conecte contatos para colaborar em tempo real."
        :"Crie um projeto novo ou ative um dos projetos descobertos abaixo na memória local."}),
      abaProjetosFiltro==="compartilhados"
        ?h("button",{type:"button",class:"primary-button",texto:"Conectar contatos (npub)",onclick:abrirModalNostr})
        :h("button",{type:"button",class:"primary-button",texto:"+ Criar primeiro projeto",onclick:function(){abrirModalProjeto();}})
    ]));
  }
  raiz.append(g);

  var ocultas=E.memorias_ocultas||[];
  var candidatos=(E.memorias||[]).filter(function(m){
    return !ligados.has(m.escopo)&&m.escopo!=="default/_global"&&!/_profile$/.test(m.escopo);
  });
  var nOcultos=candidatos.filter(function(m){return ocultas.indexOf(m.escopo)>=0;}).length;
  var descobertos=candidatos.filter(function(m){return mostrarOcultos||ocultas.indexOf(m.escopo)<0;});
  if(candidatos.length){
    raiz.append(h("div",{class:"row est-justify-space-between est-mt-18px"},[
      h("h2",{class:"est-m-0",texto:"Projetos detectados na memória"}),
      nOcultos?h("button",{type:"button",class:"quiet-button",texto:mostrarOcultos?"Esconder ocultos":"Mostrar ocultos ("+nOcultos+")",onclick:function(){mostrarOcultos=!mostrarOcultos;desenhar();}}):null
    ]));
  }
  if(descobertos.length){
    var dg=h("div",{class:"grid"});
    descobertos.forEach(function(m){
      dg.append(h("div",{class:"card p-card"},[
        h("div",{class:"p-card-head"},[
          h("span",{class:"p-icon",texto:"◈"}),
          h("div",{class:"est-min-w-0 est-flex-1"},[
            h("h3",{texto:nomeProjetoMemoria(m.escopo)}),
            h("p",{class:"muted mono",texto:m.escopo})
          ]),
          h("span",{class:"pill accent",texto:"Na memória"})
        ]),
        h("div",{class:"row"},[
          h("span",{class:"pill",texto:m.paginas+" página(s)"}),
          h("span",{class:"pill",texto:m.sessoes+" sessão(ões)"}),
          m.abertas?h("span",{class:"pill warn",texto:m.abertas+" aberta(s)"}):null
        ]),
        m.pasta?h("div",{class:"muted mono corta",title:m.pasta,texto:m.pasta}):h("div",{class:"muted",texto:"Pasta não detectada nas sessões"}),
        h("div",{class:"p-card-foot"},[
          ocultas.indexOf(m.escopo)>=0
            ?h("button",{type:"button",class:"quiet-button",texto:"Reexibir",onclick:function(){api({tipo:"ocultar_memoria",escopo:m.escopo,ocultar:false}).catch(falha(err));}})
            :h("button",{type:"button",class:"quiet-button",title:"Tirar da lista (a memória continua guardada)",texto:"Ocultar",onclick:function(){api({tipo:"ocultar_memoria",escopo:m.escopo,ocultar:true}).catch(falha(err));}}),
          h("button",{type:"button",class:"secondary-button",texto:"Escolher modelos",onclick:function(){ativarMemoria(m,false);}}),
          h("button",{type:"button",class:"primary-button",texto:"Ativar e abrir →",onclick:function(){ativarMemoria(m,true);}})
        ])
      ]));
    });
    raiz.append(dg);
  }
}

/* ================================================================ PROJETO EXPANDIDO (COCKPIT) */
function soltavel(el,aoSoltar){
  el.addEventListener("dragover",function(ev){ev.preventDefault();el.classList.add("over");});
  el.addEventListener("dragleave",function(){el.classList.remove("over");});
  el.addEventListener("drop",function(ev){
    ev.preventDefault();ev.stopPropagation();
    el.classList.remove("over");
    if(arrastando)aoSoltar(arrastando);
    arrastando=null;
  });
}

function abrirModalContextoProjeto(p){
  abrirModal("Contextos & Memória · "+p.nome,function(card){
    var box=erroBox();
    var ok=h("p",{class:"ok-msg"});
    var ctxProj=h("textarea",{class:"est-min-h-110px",placeholder:"Instruções específicas deste projeto…"});
    ctxProj.value=p.contexto||"";
    var ctxGlob=h("textarea",{class:"est-min-h-90px",placeholder:"Regras globais compartilhadas entre projetos…"});
    ctxGlob.value=E.contexto_global||"";

    var memSec=h("div",{class:"est-grid est-gap-8px"});
    if(CONTEXTO){
      var statusRow=h("div",{class:"row"},[
        CONTEXTO.escopo?h("a",{class:"pill accent",href:linkWikiProjeto(CONTEXTO.escopo),texto:"◈ Abrir memória ("+CONTEXTO.escopo+")"}):h("span",{class:"pill",texto:"Sem memória ligada"}),
        p.pasta&&CONTEXTO.escopo?h("span",{class:"pill "+(CONTEXTO.tem_toml?"ok":"warn"),texto:CONTEXTO.tem_toml?"✓ .estacao-ai.toml na pasta":"⚠ .estacao-ai.toml ausente na pasta"}):null,
        p.pasta&&CONTEXTO.escopo&&!CONTEXTO.tem_toml?h("button",{type:"button",class:"secondary-button",texto:"Gravar .estacao-ai.toml na pasta",onclick:function(){
          api({tipo:"vincular_pasta",projeto:p.id}).then(function(){ok.textContent=".estacao-ai.toml gravado em "+p.pasta;}).catch(falha(box));
        }}):null
      ]);
      memSec.append(statusRow);

      if(CONTEXTO.paginas_projeto&&CONTEXTO.paginas_projeto.length){
        memSec.append(h("strong",{class:"est-text-12px",texto:"Páginas do projeto na memória ("+CONTEXTO.paginas_projeto.length+")"}));
        var lista=h("div",{class:"est-grid est-gap-6px est-max-h-200px est-overflow-y-auto"});
        CONTEXTO.paginas_projeto.forEach(function(pg){
          lista.append(h("div",{class:"mem-item"},[
            h("div",{class:"row est-justify-space-between"},[
              h("a",{href:linkWikiPagina(CONTEXTO.escopo,pg.path),texto:pg.title}),
              h("span",{class:"pill",texto:(pg.pinned?"Fixado · ":"")+pg.tier})
            ]),
            h("div",{class:"muted mono",texto:pg.path}),
            pg.resumo?h("p",{class:"muted est-mt-4px",texto:pg.resumo}):null
          ]));
        });
        memSec.append(lista);
      }else if(CONTEXTO.escopo){
        memSec.append(h("p",{class:"muted",texto:"Nenhuma página compilada ainda em "+CONTEXTO.escopo+". As sessões gravam observações automaticamente."}));
      }
      if(CONTEXTO.paginas_globais&&CONTEXTO.paginas_globais.length){
        memSec.append(h("strong",{class:"est-text-12px",texto:"Regras globais (default/_global)"}));
        CONTEXTO.paginas_globais.forEach(function(pg){
          memSec.append(h("div",{class:"mem-item"},[
            h("a",{href:linkWikiPagina("default/_global",pg.path),texto:pg.title}),
            pg.resumo?h("p",{class:"muted est-mt-3px",texto:pg.resumo}):null
          ]));
        });
      }
    }

    card.append(
      campo("Contexto deste projeto",ctxProj),
      campo("Contexto global (todos os projetos)",ctxGlob),
      h("div",{class:"row est-justify-flex-end"},[
        h("button",{type:"button",class:"primary-button",texto:"Salvar contextos",onclick:function(){
          var projAtualizado=Object.assign({},p,{contexto:ctxProj.value});
          Promise.all([
            api({tipo:"salvar_projeto",projeto:projAtualizado}),
            api({tipo:"contexto_global",texto:ctxGlob.value})
          ]).then(function(){ok.textContent="Contextos salvos e já ativos nos próximos prompts.";}).catch(falha(box));
        }})
      ]),
      memSec,
      ok,
      box
    );
  });
}

function msgsCanal(p){return E.mensagens.filter(function(m){return m.projeto===p.id&&m.canal===canal;});}

function papelDe(a){return a&&(E.papeis||[]).find(function(x){return x.id===a.funcao;})||null;}
function nomeCurto(pp){return pp.nome.replace(/\s*\(.*\)$/,"");}
/* Papel só aparece quando acrescenta algo ao nome do agente. */
function rotuloPapel(a){var pp=papelDe(a);return pp&&nomeCurto(pp)!==a.nome?nomeCurto(pp):"";}

/* Estado no estilo herdr: trabalhando, terminou (resposta nova não vista) ou ocioso. */
function statusModeloNoProjeto(p,id){
  var ag=agente(id);
  if(agenteHibernando(p,ag))return {ocupado:false,hibernando:true,cls:"dot-off",rot:"zzz hibernando",texto:"💤 Hibernando (dono offline)"};
  var tarefaAtiva=E.tarefas.find(function(t){return t.projeto===p.id&&t.agente===id&&t.status==="executando";});
  if(tarefaAtiva)return {ocupado:true,cls:"dot-busy",rot:"trabalhando",texto:"Executando: "+tarefaAtiva.titulo};
  var pensando=E.mensagens.find(function(m){return m.projeto===p.id&&m.autor===id&&m.estado==="pensando";});
  if(pensando)return {ocupado:true,cls:"dot-busy",rot:"trabalhando",texto:"Respondendo no chat…"};
  if(cliAusente(id))return {ocupado:false,ausente:true,cls:"dot-off",rot:"CLI ausente",texto:"CLI ausente"};
  var nova=E.mensagens.some(function(m){return m.projeto===p.id&&m.autor===id&&m.canal!==canal&&m.em>(VISTO[p.id+"/"+m.canal]||abertoEm);});
  if(nova)return {ocupado:false,cls:"dot-new",rot:"terminou",texto:"Respondeu em outro canal"};
  return {ocupado:false,cls:"dot-ok",rot:"ocioso",texto:"Livre · pronto"};
}

function abrirModalTarefa(p,t){
  abrirModal("Editar tarefa",function(card){
    var box=erroBox();
    var tit=h("input",{required:true,value:t.titulo});
    var desc=h("textarea",{class:"est-min-h-110px"});desc.value=t.descricao||"";
    var ag=h("select",{},[h("option",{value:"",texto:"— sem modelo (fila) —"})].concat(
      p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="projetos";}).map(function(id){return h("option",{value:id,selected:t.agente===id,texto:nomeAutor(id)});})
    ));
    card.append(h("form",{class:"est-grid est-gap-11px",onsubmit:function(ev){
      ev.preventDefault();
      api({tipo:"salvar_tarefa",tarefa:{id:t.id,projeto:p.id,titulo:tit.value,descricao:desc.value,agente:ag.value||null}})
        .then(fecharModal).catch(falha(box));
    }},[
      campo("Título",tit),campo("Descrição",desc),campo("Modelo responsável",ag),box,
      h("div",{class:"row est-justify-flex-end"},[
        h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
        h("button",{type:"submit",class:"primary-button",texto:"Salvar tarefa"})
      ])
    ]));
  });
}

function abrirModalDebate(p){
  abrirModal("Debate no chat geral",function(card){
    var box=erroBox();
    var tema=h("textarea",{class:"est-min-h-70px",placeholder:"Sobre o que eles vão debater?"});
    tema.value="A inteligência artificial vai criar mais empregos do que vai eliminar?";
    var grpAlvo=ehChat(p)?"chat":"projetos";
    var agElegiveis=p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)===grpAlvo;});
    var marcados=new Set(agElegiveis);
    var chips=h("div",{class:"chips"},agElegiveis.map(function(id){
      var a=agente(id);
      var c=h("button",{type:"button",class:"chip"+(marcados.has(id)?" sel":""),"aria-pressed":String(marcados.has(id)),texto:nomeAutor(id)+(a&&rotuloPapel(a)?" · "+rotuloPapel(a):"")});
      c.addEventListener("click",function(){
        if(marcados.has(id))marcados.delete(id);else marcados.add(id);
        c.classList.toggle("sel");c.setAttribute("aria-pressed",String(marcados.has(id)));
      });
      return c;
    }));
    var rodadas=h("select",{},[1,2,3,4,5].map(function(n){return h("option",{value:n,selected:n===2,texto:n+(n===1?" rodada":" rodadas")});}));
    card.append(h("form",{class:"est-grid est-gap-11px",onsubmit:function(ev){
      ev.preventDefault();
      var ordem=agElegiveis.filter(function(id){return marcados.has(id);});
      api({tipo:"debate",projeto:p.id,tema:tema.value,participantes:ordem,rodadas:Number(rodadas.value)})
        .then(function(){canal="geral";aba="chat";rolarFim=true;fecharModal();}).catch(falha(box));
    }},[
      h("p",{class:"muted",texto:"Os participantes falam um de cada vez no chat geral, respondendo ao argumento anterior. Bom para testar modelos e papéis de conversa (Cético, Otimista, Mediador, Filósofo, Pessoa)."}),
      campo("Tema",tema),
      h("div",{},[h("span",{class:"muted est-block est-mb-6px est-weight-600",texto:"Participantes (na ordem do projeto)"}),chips]),
      campo("Rodadas (cada participante fala uma vez por rodada)",rodadas),
      h("p",{class:"muted",texto:"Cada fala é uma execução do modelo e consome a cota dele. Use ■ Parar para interromper."}),
      box,
      h("div",{class:"row est-justify-flex-end"},[
        h("button",{type:"button",class:"secondary-button",texto:"Cancelar",onclick:tentarFecharModal}),
        h("button",{type:"submit",class:"primary-button",texto:"Começar debate"})
      ])
    ]));
  });
}

function renderCartaoTarefa(p,t,box){
  var st=t.status||"a_fazer";
  var rot={a_fazer:"na fila",executando:"● executando",concluida:"✓ concluída",erro:"✕ erro"}[st]||st;
  var pillCls={a_fazer:"",executando:"warn",concluida:"ok",erro:"err"}[st]||"";
  var ag=t.agente?agente(t.agente):null;
  var hib=agenteHibernando(p,ag);

  var sel=h("select",{title:"Atribuir ou redistribuir modelo",onchange:function(){
    api({tipo:"atribuir",tarefa:t.id,agente:sel.value||null}).catch(falha(box));
  }},[h("option",{value:"",selected:!t.agente,texto:"— sem modelo —"})].concat(
    p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="projetos";}).map(function(id){return h("option",{value:id,selected:t.agente===id,texto:nomeAutor(id)});})
  ));

  var liveMsg=t.progresso||(st==="executando"?"Executando agora…":"");
  var card=h("div",{class:"task-card task-st-"+st,draggable:"true"},[
    h("div",{class:"row est-items-flex-start"},[
      h("span",{class:"grip",texto:"⠿"}),
      h("span",{class:"task-title",texto:t.titulo}),
      h("span",{class:"pill "+pillCls,texto:rot})
    ]),
    t.descricao?h("p",{class:"task-desc",texto:t.descricao}):null,
    liveMsg?h("div",{class:"task-live "+st},[
      h("span",{class:"task-live-dot"}),
      h("span",{texto:liveMsg})
    ]):null,
    t.resultado?h("details",{class:"task-res-details"},[
      h("summary",{texto:"Ver saída / resultado da execução"}),
      h("pre",{class:"task-res-pre",texto:t.resultado})
    ]):null,
    h("div",{class:"row est-mt-7px"},[
      ag?avatar(ag,true):null,
      h("span",{class:"muted",texto:ag?(ag.nome+(ag.modelo?" · "+ag.modelo:"")+(hib?" · 💤 zzz":"")):"Arraste um agente para cá"})
    ]),
    h("div",{class:"task-foot"},[
      sel,
      st==="executando"
        ?h("button",{type:"button",class:"secondary-button btn-parar est-p-5px-10px est-text-11px",title:"Interrompe a execução e devolve a tarefa para a fila",texto:"■ Parar",onclick:function(){
            api({tipo:"parar",projeto:p.id,agente:t.agente||null}).catch(falha(box));
          }})
        :h("button",{type:"button",class:"primary-button est-p-5px-10px est-text-11px",disabled:!t.agente||hib,title:hib?"Agente hibernando (dono offline)":"Executar tarefa",texto:"▶ Executar",onclick:function(){
            api({tipo:"executar",tarefa:t.id}).catch(falha(box));
          }}),
      st!=="executando"?h("button",{type:"button",class:"quiet-button",title:"Editar tarefa",texto:"✎",onclick:function(){abrirModalTarefa(p,t);}}):null,
      (st==="concluida"||st==="erro")?h("button",{type:"button",class:"quiet-button",title:"Mover de volta para a fazer",texto:"↻",onclick:function(){
        api({tipo:"reabrir_tarefa",id:t.id}).catch(falha(box));
      }}):null,
      h("button",{type:"button",class:"quiet-button",title:"Excluir tarefa",texto:"✕",onclick:function(){
        confirmarAcao({
          titulo:"Excluir tarefa",
          mensagem:"Deseja excluir a tarefa \""+t.titulo+"\"?",
          textoConfirmar:"Excluir tarefa",
          perigo:true
        }).then(function(sim){
          if(sim)api({tipo:"excluir_tarefa",id:t.id}).then(function(){mostrarToast("Tarefa excluída");}).catch(falha(box));
        });
      }})
    ])
  ]);

  card.addEventListener("dragstart",function(){arrastando={tarefa:t.id};});
  soltavel(card,function(d){
    if(d.agente!==undefined)api({tipo:"atribuir",tarefa:t.id,agente:d.agente}).catch(falha(box));
    else if(d.tarefa&&d.tarefa!==t.id)api({tipo:"atribuir",tarefa:d.tarefa,agente:t.agente||null}).catch(falha(box));
  });
  return card;
}

/* ---------------------------------------------------------------- multi-terminal estilo Herdr */
var ATALHOS_TERMINAL=["git status","git log --oneline -5","ls -la","cargo test","gh auth status"];
function garantirTerminais(p){
  if(TERMS.projeto!==p.id||!TERMS.tabs.length){
    TERMS.projeto=p.id;
    TERMS.seq=1;
    TERMS.ativo=0;
    TERMS.split=false;
    TERMS.tabs=[criarAbaTerminal(p,"term-1")];
  }
}
function criarAbaTerminal(p,nome){
  return {
    id:"t"+(TERMS.seq++),
    nome:nome||("term-"+(TERMS.tabs.length+1)),
    pasta:p.pasta||"",
    linhas:[],
    ocupado:false,
    historico:[],
    pos:-1,
    rascunho:""
  };
}
function rodarNoTerminalAba(tab,cmd,p){
  cmd=String(cmd||"").trim();
  if(!cmd||tab.ocupado)return;
  if(cmd==="clear"||cmd==="cls"){tab.linhas=[];tab.rascunho="";desenhar();return;}
  tab.historico.push(cmd);tab.pos=-1;tab.rascunho="";
  tab.linhas.push({tipo:"cmd",pasta:tab.pasta,texto:cmd});
  tab.ocupado=true;rolarFim=true;desenhar();
  requisicao("estacao/api/terminal",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Estacao-UI":"1","X-CSRF-Token":decodeURIComponent(cookie("ai_memory_csrf")||"")},
    body:JSON.stringify({pasta:tab.pasta||"",comando:cmd})
  }).then(function(r){
    if(!r.ok)return r.text().then(function(t){throw new Error(t||("Erro "+r.status));});
    return r.json();
  }).then(function(r){
    tab.pasta=r.pasta;
    if(r.saida)tab.linhas.push({tipo:r.codigo===0?"saida":"erro",texto:r.saida});
    if(r.codigo!==0&&r.codigo!=null)tab.linhas.push({tipo:"info",texto:"(código de saída "+r.codigo+")"});
  }).catch(function(e){
    tab.linhas.push({tipo:"erro",texto:e.message});
  }).then(function(){
    if(tab.linhas.length>400)tab.linhas=tab.linhas.slice(-400);
    tab.ocupado=false;rolarFim=true;desenhar();
  });
}

function renderInstanciaTerminal(tab,p,isAtivo){
  var saida=h("div",{class:"term-saida","data-rolagem":"terminal-"+tab.id,role:"log","aria-live":"polite"});
  if(!tab.linhas.length){
    saida.append(h("div",{class:"t-info",texto:"["+tab.nome+"] Multi-terminal integrado · bash/sh no Linux, PowerShell no Windows. Cada aba mantém seu diretório e histórico."}));
  }
  tab.linhas.forEach(function(l){
    if(l.tipo==="cmd")saida.append(h("div",{class:"t-cmd"},[h("span",{class:"t-pasta",texto:(l.pasta||"~")+" "}),h("span",{class:"t-prompt",texto:"$ "}),l.texto]));
    else saida.append(h("div",{class:"t-"+l.tipo,texto:l.texto}));
  });
  if(tab.ocupado)saida.append(h("div",{class:"t-info",texto:"⠋ executando…"}));
  var entrada=h("input",{id:isAtivo?"term-entrada":"term-entrada-"+tab.id,class:"term-input",autocomplete:"off",spellcheck:"false","aria-label":"Comando em "+tab.nome,placeholder:tab.ocupado?"aguarde o comando terminar…":"comando em "+tab.nome+" (Enter executa)"});
  entrada.value=tab.rascunho;
  entrada.addEventListener("input",function(){tab.rascunho=entrada.value;});
  entrada.addEventListener("keydown",function(ev){
    if(ev.isComposing)return;
    if(ev.key==="Enter"){ev.preventDefault();rodarNoTerminalAba(tab,entrada.value,p);}
    else if(ev.key==="ArrowUp"||ev.key==="ArrowDown"){
      if(!tab.historico.length)return;
      ev.preventDefault();
      var n=tab.historico.length;
      tab.pos=ev.key==="ArrowUp"?(tab.pos<0?n-1:Math.max(0,tab.pos-1)):(tab.pos<0?-1:tab.pos+1);
      if(tab.pos>=n)tab.pos=-1;
      entrada.value=tab.pos<0?"":tab.historico[tab.pos];tab.rascunho=entrada.value;
    }
  });
  return h("div",{class:"herdr-term-pane"+(isAtivo?" active":""),onclick:function(){
    var idx=TERMS.tabs.indexOf(tab);
    if(idx>=0&&TERMS.ativo!==idx){TERMS.ativo=idx;desenhar();}
  }},[
    h("div",{class:"term-barra"},[
      h("span",{class:"herdr-term-badge",texto:tab.nome}),
      h("span",{class:"mono corta",title:tab.pasta||"~",texto:"▸ "+(tab.pasta||"~")}),
      h("span",{class:"spacer"}),
      p.pasta?h("button",{type:"button",class:"quiet-button",texto:"Raiz",onclick:function(){tab.pasta=p.pasta;desenhar();}}):null,
      h("button",{type:"button",class:"quiet-button",texto:"Limpar",onclick:function(){tab.linhas=[];desenhar();}})
    ]),
    saida,
    h("div",{class:"term-atalhos"},ATALHOS_TERMINAL.map(function(c){
      return h("button",{type:"button",class:"mention-btn",texto:c,disabled:tab.ocupado,onclick:function(){rodarNoTerminalAba(tab,c,p);}});
    })),
    h("div",{class:"composer-bar term-linha"},[h("span",{class:"t-prompt",texto:"$"}),entrada])
  ]);
}

function painelTerminal(p){
  garantirTerminais(p);
  if(TERMS.ativo>=TERMS.tabs.length)TERMS.ativo=Math.max(0,TERMS.tabs.length-1);
  var tabBar=h("div",{class:"herdr-tabs"},TERMS.tabs.map(function(t,idx){
    return h("div",{class:"herdr-tab"+(idx===TERMS.ativo?" active":""),onclick:function(){TERMS.ativo=idx;desenhar();}},[
      h("span",{class:"dot "+(t.ocupado?"dot-busy":"dot-ok")}),
      h("span",{texto:t.nome}),
      TERMS.tabs.length>1?h("button",{type:"button",class:"herdr-tab-close",title:"Fechar "+t.nome,texto:"✕",onclick:function(ev){
        ev.stopPropagation();
        TERMS.tabs.splice(idx,1);
        if(TERMS.ativo>=TERMS.tabs.length)TERMS.ativo=TERMS.tabs.length-1;
        if(TERMS.tabs.length<2)TERMS.split=false;
        desenhar();
      }}):null
    ]);
  }).concat([
    h("button",{type:"button",class:"herdr-tab-add",title:"Abrir novo terminal",texto:"+ Terminal",onclick:function(){
      var nova=criarAbaTerminal(p,"term-"+TERMS.seq);
      TERMS.tabs.push(nova);
      TERMS.ativo=TERMS.tabs.length-1;
      desenhar();
    }}),
    h("button",{type:"button",class:"herdr-tab-split"+(TERMS.split?" active":""),title:"Dividir tela com 2 terminais lado a lado",texto:TERMS.split?"⊟ Unir":"⊞ Dividir",onclick:function(){
      if(!TERMS.split&&TERMS.tabs.length<2){
        TERMS.tabs.push(criarAbaTerminal(p,"term-"+TERMS.seq));
      }
      TERMS.split=!TERMS.split;
      desenhar();
    }})
  ]));

  var ativoTab=TERMS.tabs[TERMS.ativo];
  var body;
  if(TERMS.split&&TERMS.tabs.length>=2){
    var segundoIdx=TERMS.ativo===0?1:0;
    body=h("div",{class:"herdr-split-grid"},[
      renderInstanciaTerminal(ativoTab,p,true),
      renderInstanciaTerminal(TERMS.tabs[segundoIdx],p,false)
    ]);
  }else{
    body=h("div",{class:"herdr-single-grid"},[renderInstanciaTerminal(ativoTab,p,true)]);
  }
  return [tabBar,body];
}

/* ---------------------------------------------------------------- chat 2D estilo Buzz Agents */
function linhaChat(m,p,box){
  var ehVoce=m.autor==="voce",a=ehVoce?null:agente(m.autor);
  var corpo=m.estado==="pensando"?(m.texto||"Analisando pedido e organizando tarefas…"):m.texto;
  var txt=h("div",{class:"l-txt buzz-body"});
  if(m.html&&m.texto){
    txt.innerHTML=m.html;
  }else{
    txt.className="l-txt buzz-body l-raw";
    txt.textContent=corpo||"";
  }
  // Destaca linhas de delegação `@Agente: tarefa` como chips visuais estilo Buzz Agents!
  var delegChips=[];
  if(!ehVoce&&m.texto){
    String(m.texto).split("\n").forEach(function(ln){
      var mDel=ln.trim().replace(/^[-*•]\s*/,"").match(/^@([^:]{1,40}):\s*(.+)$/);
      if(mDel)delegChips.push(h("span",{class:"buzz-deleg-chip",texto:"→ Tarefa @"+mDel[1].trim()+": "+mDel[2].trim().slice(0,72)}));
    });
  }
  return h("article",{class:"buzz-msg "+(ehVoce?"buzz-voce ":"buzz-ag ")+"l-"+m.estado},[
    h("div",{class:"buzz-msg-av"},[avatar(ehVoce?"voce":m.autor,true)]),
    h("div",{class:"buzz-msg-main"},[
      h("div",{class:"buzz-msg-head"},[
        h("strong",{class:"l-quem "+(ehVoce?"":avClasse(a&&a.fornecedor)),texto:ehVoce?(perfilNostr().apelido||"Você"):nomeAutor(m.autor)}),
        a&&rotuloPapel(a)?h("span",{class:"buzz-pill role",texto:rotuloPapel(a)}):null,
        a&&a.modelo?h("span",{class:"buzz-pill",texto:a.modelo}):null,
        h("span",{class:"l-hora",texto:horaBR(m.em)}),
        m.estado==="pensando"?h("span",{class:"l-spin",texto:"⠋ coordenando…"}):null,
        m.estado==="erro"?h("span",{class:"l-erro",texto:"✕ erro"}):null,
        !ehVoce&&m.estado==="ok"&&m.texto&&p?h("div",{class:"buzz-msg-acts"},[
          h("button",{type:"button",class:"quiet-button est-p-1px-6px est-text-10px",texto:"Copiar",onclick:function(ev){
            var b=ev.currentTarget;
            if(navigator.clipboard)navigator.clipboard.writeText(m.texto);
            b.textContent="Copiado";setTimeout(function(){b.textContent="Copiar";},1200);
          }}),
          h("button",{type:"button",class:"quiet-button est-p-1px-6px est-text-10px",texto:"Verificar",onclick:function(){
            api({tipo:"verificar_ideias",projeto:p.id,canal:canal,mensagem_id:m.id}).catch(falha(box));
          }})
        ]):null
      ]),
      txt,
      delegChips.length?h("div",{class:"buzz-deleg-row"},delegChips):null
    ])
  ]);
}

function telaProjeto(){
  limpar3D(); // Projetos operam exclusivamente em 2D (sem 3D)
  var p=E.projetos.find(function(x){return x.id===PROJ;});
  if(!p){
    raiz.append(h("div",{class:"card"},[h("h1",{texto:"Projeto não encontrado"}),h("p",{class:"muted",texto:"Volte para a lista de projetos."}),h("a",{class:"primary-button",href:"projetos",texto:"← Projetos"})]));
    return;
  }
  registrarPresencaLocal(p);
  var projAgIds=p.agentes.filter(function(id){var a=agente(id);return a&&grupoDoAgente(a)==="projetos";});
  if(canal!=="geral"&&projAgIds.indexOf(canal)<0)canal="geral";
  if(aba==="chat")VISTO[p.id+"/"+canal]=Date.now()/1000;

  var box=erroBox();
  var ts=E.tarefas.filter(function(t){return t.projeto===p.id;});
  var execCount=ts.filter(function(t){return t.status==="executando";}).length;
  var temPensador=projAgIds.some(function(id){var a=agente(id);return a&&a.funcao==="pensador";});
  garantirTerminais(p);

  // Top bar (2D limpo — sem abas 3D!)
  raiz.append(
    h("div",{class:"proj-top"},[
      h("button",{type:"button",class:"secondary-button",texto:"← Projetos",onclick:function(){irPara("projetos");}}),
      h("div",{class:"est-min-w-0 est-flex-1"},[
        h("h1",{texto:p.nome}),
        h("div",{class:"row"},[
          p.descricao?h("span",{class:"muted",texto:p.descricao}):null,
          p.pasta?h("span",{class:"pill mono corta",title:p.pasta,texto:p.pasta}):null,
          p.memoria?h("a",{class:"pill accent",href:linkWikiProjeto(p.memoria),texto:"◈ "+p.memoria}):null,
          p.compartilhado?h("span",{class:"pill accent",texto:"Compartilhado · "+contarPessoasSala(p)+" pessoas"}):h("span",{class:"pill",texto:"Pessoal · até 6 agentes"}),
          execCount?h("span",{class:"pill warn",texto:"● "+execCount+" tarefa(s) rodando"}):null
        ])
      ]),
      h("button",{type:"button",class:"secondary-button",texto:"Compartilhar",onclick:function(){abrirModalCompartilhar(p);}}),
      h("button",{type:"button",class:"secondary-button",texto:"◈ Contextos & Memória",onclick:function(){abrirModalContextoProjeto(p);}}),
      h("button",{type:"button",class:"secondary-button",texto:"⚙ Configurar",onclick:function(){abrirModalProjeto(p);}})
    ]),
    box
  );

  // ESQUERDA: canais & equipe do projeto (Buzz Agents + Herdr)
  var colEsq=h("section",{class:"pane","aria-label":"Equipe e Terminal"});
  colEsq.append(h("div",{class:"pane-head"},[
    h("h2",{texto:"Workspace 2D"}),
    h("span",{class:"pill",texto:projAgIds.length+" agente(s)"})
  ]));
  var listaCanais=h("div",{class:"pane-body"});
  listaCanais.append(
    h("button",{type:"button",class:"chan","aria-selected":String(aba==="chat"&&canal==="geral"),onclick:function(){canal="geral";aba="chat";rolarFim=true;desenhar();}},[
      h("span",{class:"av av-outro sm est-background-general-channel",texto:"#"}),
      h("div",{class:"chan-meta"},[
        h("strong",{texto:"Chat · Pensador"}),
        h("small",{texto:temPensador?"Só o Pensador fala e delega":"chat geral do projeto"})
      ])
    ]),
    h("button",{type:"button",class:"chan","aria-selected":String(aba==="terminal"),onclick:function(){aba="terminal";desenhar();}},[
      h("span",{class:"av av-outro sm",texto:">_"}),
      h("div",{class:"chan-meta"},[
        h("strong",{texto:"Multi-Terminal"}),
        h("small",{texto:TERMS.tabs.some(function(t){return t.ocupado;})?"executando…":(TERMS.tabs.length+" aba(s) ativa(s)")})
      ])
    ])
  );
  if(!projAgIds.length){
    listaCanais.append(h("div",{class:"card est-p-12px est-text-align-center"},[
      h("p",{class:"muted est-mb-8px",texto:"Nenhum modelo de projeto designado."}),
      h("button",{type:"button",class:"primary-button est-w-100pct",texto:"+ Designar modelos",onclick:function(){abrirModalProjeto(p);}})
    ]));
  }else{
    listaCanais.append(h("div",{class:"muted est-text-11px est-p-6px-4px-0",texto:"Equipe (arraste um agente para uma tarefa)"}));
    projAgIds.forEach(function(id){
      var a=agente(id);if(!a)return;
      var st=statusModeloNoProjeto(p,id),pp=papelDe(a);
      var btn=h("button",{
        type:"button",
        class:"chan"+(st.hibernando?" sleeping":""),
        draggable:"true",
        "aria-selected":String(aba==="chat"&&canal===id),
        title:(pp?nomeCurto(pp)+": "+pp.legenda+"\n":"")+"Arraste para uma tarefa ou clique para inspecionar",
        onclick:function(){canal=id;aba="chat";rolarFim=true;desenhar();}
      },[
        h("span",{class:"dot "+st.cls,title:st.texto}),
        h("div",{class:"chan-meta"},[
          h("strong",{texto:(st.hibernando?"💤 ":"")+a.nome}),
          h("small",{texto:(rotuloPapel(a)?rotuloPapel(a)+" · ":"")+st.rot})
        ])
      ]);
      btn.addEventListener("dragstart",function(){arrastando={agente:id};});
      listaCanais.append(btn);
    });
  }
  colEsq.append(listaCanais);
  colEsq.append(h("div",{class:"pane-foot"},[
    h("div",{class:"row est-justify-space-between"},[
      h("span",{class:"muted",texto:"Contexto ativo"}),
      h("button",{type:"button",class:"quiet-button est-p-2px-6px est-text-11px",texto:"Editar",onclick:function(){abrirModalContextoProjeto(p);}})
    ]),
    h("div",{class:"chips est-mt-5px"},[
      h("span",{class:"pill"+(E.contexto_global?" ok":""),texto:E.contexto_global?"✓ Global":"Global vazio"}),
      h("span",{class:"pill"+(p.contexto?" ok":""),texto:p.contexto?"✓ Projeto":"Projeto vazio"}),
      CONTEXTO&&CONTEXTO.paginas_projeto&&CONTEXTO.paginas_projeto.length?h("span",{class:"pill accent",texto:CONTEXTO.paginas_projeto.length+" págs memória"}):null
    ])
  ]));

  // CENTRO: Chat 2D estilo Buzz Agents ou Multi-Terminal estilo Herdr
  var colCentro=h("section",{class:"pane pane-cli","aria-label":aba==="terminal"?"Multi-Terminal":"Chat do Projeto"});
  if(aba==="terminal"){
    colCentro.append(h("div",{class:"pane-head"},[
      h("h2",{texto:"multi-terminal"}),
      h("span",{class:"muted",texto:(navigator.userAgent.indexOf("Windows")>=0?"PowerShell":"bash/sh")+" · "+TERMS.tabs.length+" aba(s)"})
    ]));
    painelTerminal(p).forEach(function(el){colCentro.append(el);});
  }else{
    var agCanal=canal==="geral"?null:agente(canal),ppCanal=papelDe(agCanal);
    colCentro.append(h("div",{class:"pane-head"},[
      h("div",{class:"chat-head-info"},[
        h("div",{},[
          h("strong",{texto:agCanal?("chat direto · "+agCanal.nome):"# chat do projeto (Pensador)"}),
          h("span",{texto:agCanal
            ?((agCanal.modelo||agCanal.fornecedor)+(ppCanal?" · "+nomeCurto(ppCanal):""))
            :(temPensador?"Apenas o Pensador fala aqui e cria/delega tarefas automaticamente na lista TAREFAS ao lado.":"Converse com os agentes do projeto.")})
        ])
      ]),
      h("div",{class:"row"},[
        msgsCanal(p).length&&projAgIds.length>=1?h("button",{type:"button",class:"quiet-button",title:"Outra IA verifica criticamente as ideias e respostas",texto:"Verificar",onclick:function(){
          api({tipo:"verificar_ideias",projeto:p.id,canal:canal,mensagem_id:null}).catch(falha(box));
        }}):null,
        msgsCanal(p).length?h("button",{type:"button",class:"quiet-button",title:"Baixar conversa em PDF",texto:"PDF",onclick:function(){exportarConversaPDF(p,canal);}}):null,
        msgsCanal(p).length?h("button",{type:"button",class:"quiet-button",title:"Apaga as mensagens deste canal",texto:"Limpar",onclick:function(){
          confirmarAcao({
            titulo:"Limpar mensagens",
            mensagem:"Apagar todas as mensagens "+(agCanal?"do chat com "+agCanal.nome:"do chat do projeto")+"? Não dá para desfazer.",
            textoConfirmar:"Limpar",
            perigo:true
          }).then(function(sim){
            if(sim)api({tipo:"limpar_chat",projeto:p.id,canal:canal}).then(function(){mostrarToast("Mensagens limpas");}).catch(falha(box));
          });
        }}):null,
        projAgIds.some(function(id){return statusModeloNoProjeto(p,id).ocupado;})?h("button",{type:"button",class:"quiet-button btn-parar",title:"Para tudo o que os agentes deste projeto estão fazendo",texto:"■ Parar tudo",onclick:function(){
          api({tipo:"parar",projeto:p.id,agente:null}).catch(falha(box));
        }}):null
      ])
    ]));

    var entrada=h("textarea",{
      id:"chat-entrada",
      "aria-label":"Mensagem",
      placeholder:canal==="geral"
        ?(temPensador?"Descreva o que deseja construir ou ajustar — o Pensador responde aqui e delega tarefas aos demais em TAREFAS…":"Descreva sua solicitação para o projeto…")
        :"Conversar diretamente com "+nomeAutor(canal)+"…"
    });
    if(abertoChat&&abertoChat.canal===canal)entrada.value=abertoChat.texto;
    entrada.addEventListener("input",function(){abertoChat={canal:canal,texto:entrada.value};});

    var feed=h("div",{class:"chat-feed buzz-feed","data-rolagem":"chat-"+p.id+"-"+canal,role:"log","aria-live":"polite"});
    var msgs=msgsCanal(p);
    if(!msgs.length){
      feed.append(h("div",{class:"chat-welcome buzz-welcome"},[
        h("strong",{texto:canal==="geral"?"Coordenação central · Pensador":"Canal direto · "+nomeAutor(canal)}),
        h("p",{texto:canal==="geral"
          ?(temPensador
            ?"Escreva o objetivo aqui. Apenas o Pensador responde neste chat: ele quebra o pedido, cria tarefas automaticamente na barra lateral TAREFAS para os demais agentes e acompanha o que cada um está executando."
            :"Adicione um agente com o papel Pensador para coordenar automaticamente as tarefas deste projeto.")
          :"Conversa direta com "+nomeAutor(canal)+", mantendo o contexto e memória do projeto."})
      ]));
    }else{
      msgs.forEach(function(m){feed.append(linhaChat(m,p,box));});
    }
    colCentro.append(feed);

    var enviarForm=h("form",{class:"composer-form",onsubmit:function(ev){
      ev.preventDefault();
      var t=entrada.value;
      if(!t.trim()||enviando)return;
      enviando=true;abertoChat="";entrada.value="";rolarFim=true;
      api({tipo:"enviar",projeto:p.id,canal:canal,texto:t}).catch(function(e){
        if(!abertoChat||!abertoChat.texto)abertoChat={canal:canal,texto:t};
        box.textContent=e.message;
        desenhar();
      }).then(function(){enviando=false;});
    }},[
      entrada,
      h("button",{type:"submit",class:"primary-button",texto:"Enviar"})
    ]);
    entrada.addEventListener("keydown",function(ev){
      if(ev.isComposing||ev.keyCode===229)return;
      if(ev.key==="Enter"&&!ev.shiftKey){
        ev.preventDefault();
        enviarForm.requestSubmit();
      }
    });
    var atalhosProj=canal==="geral"?[
      {rot:"Planejar arquitetura",txt:"Analise o estado atual do projeto e monte um plano técnico claro com tarefas para a equipe."},
      {rot:"Quebrar em tarefas",txt:"Divida o próximo objetivo em tarefas objetivas e delegue cada uma para o especialista certo na lista TAREFAS."},
      {rot:"Revisar e testar",txt:"Organize uma rodada de revisão de qualidade, segurança e testes automatizados com a equipe."},
      {rot:"Atualizar docs",txt:"Peça para revisar e atualizar a documentação e o guia do projeto com as mudanças mais recentes."}
    ]:[];
    colCentro.append(h("div",{class:"composer-bar"},[
      atalhosProj.length?h("div",{class:"proj-quick-chips"},atalhosProj.map(function(at){
        return h("button",{type:"button",class:"proj-quick-chip",texto:at.rot,onclick:function(){
          entrada.value=at.txt;
          abertoChat={canal:canal,texto:at.txt};
          entrada.focus();
        }});
      })):null,
      enviarForm,
      h("div",{class:"composer-hint"},[
        h("span",{texto:"Enter envia · Shift+Enter quebra linha"}),
        h("span",{texto:temPensador?"Coordenado pelo Pensador → TAREFAS":(p.memoria?"Memória: "+p.memoria:"Sem memória ligada")})
      ])
    ]));
  }

  // DIREITA: lista TAREFAS com progresso ao vivo (sem o bloco redundante "O QUE CADA AGENTE ESTÁ FAZENDO"!)
  var colDir=h("section",{class:"pane","aria-label":"Tarefas do projeto"});
  colDir.append(h("div",{class:"pane-head"},[
    h("div",{class:"row est-gap-6px"},[
      h("h2",{texto:"TAREFAS"}),
      execCount?h("span",{class:"pill warn",texto:execCount+" ativa(s)"}):h("span",{class:"pill",texto:String(ts.length)})
    ]),
    h("button",{type:"button",class:"primary-button est-p-4px-10px est-text-11px",texto:novaTarefaAberta?"Fechar":"+ Nova tarefa",onclick:function(){novaTarefaAberta=!novaTarefaAberta;desenhar();}})
  ]));
  var dirBody=h("div",{class:"pane-body"});

  // Barra de progresso dinâmica do projeto + execução rápida da fila
  var concluidasCount=ts.filter(function(t){return t.status==="concluida";}).length;
  var filaPronta=ts.find(function(t){return t.status==="a_fazer"&&t.agente&&!agenteHibernando(p,agente(t.agente));});
  var pctDone=ts.length?Math.round((concluidasCount/ts.length)*100):0;
  if(ts.length){
    dirBody.append(h("div",{class:"proj-progress-box"},[
      h("div",{class:"proj-progress-top"},[
        h("span",{class:"proj-progress-label",texto:concluidasCount+"/"+ts.length+" concluídas ("+pctDone+"%)"}),
        filaPronta&&!execCount?h("button",{type:"button",class:"proj-run-next",title:"Executar próxima tarefa pronta da fila: "+filaPronta.titulo,texto:"▶ Rodar próxima",onclick:function(){
          api({tipo:"executar",tarefa:filaPronta.id}).catch(falha(box));
        }}):(execCount?h("span",{class:"proj-pulse-badge",texto:"● "+execCount+" rodando"}):null)
      ]),
      h("div",{class:"proj-progress-track"},[
        h("div",{class:"proj-progress-fill"+(execCount?" running":""),style:"width:"+pctDone+"%"})
      ])
    ]));
  }

  if(novaTarefaAberta){
    var tTit=h("input",{id:"nova-tarefa-titulo",required:true,placeholder:"Título da tarefa",value:rascunhoTarefa.tit});
    var tDesc=h("textarea",{id:"nova-tarefa-desc",class:"est-min-h-58px",placeholder:"Detalhes, arquivos, critérios de pronto…"});
    tDesc.value=rascunhoTarefa.desc;
    var tAg=h("select",{id:"nova-tarefa-agente"},[h("option",{value:"",texto:"— sem modelo (fila) —"})].concat(
      projAgIds.map(function(id){return h("option",{value:id,selected:rascunhoTarefa.ag===id,texto:nomeAutor(id)});})
    ));
    tTit.addEventListener("input",function(){rascunhoTarefa.tit=tTit.value;});
    tDesc.addEventListener("input",function(){rascunhoTarefa.desc=tDesc.value;});
    tAg.addEventListener("change",function(){rascunhoTarefa.ag=tAg.value;});
    dirBody.append(h("form",{class:"card est-p-11px est-grid est-gap-8px",onsubmit:function(ev){
      ev.preventDefault();
      api({tipo:"salvar_tarefa",tarefa:{id:"",projeto:p.id,titulo:tTit.value,descricao:tDesc.value,agente:tAg.value||null}})
        .then(function(){novaTarefaAberta=false;rascunhoTarefa={tit:"",desc:"",ag:""};desenhar();})
        .catch(falha(box));
    }},[
      h("strong",{class:"est-text-12px",texto:"Nova tarefa"}),
      tTit,
      tDesc,
      campo("Designar para",tAg),
      h("div",{class:"row est-justify-flex-end"},[
        h("button",{type:"button",class:"secondary-button est-p-6px-12px",texto:"Descartar",onclick:function(){
          if(rascunhoTarefa.tit||rascunhoTarefa.desc){
            confirmarAcao({
              titulo:"Descartar rascunho?",
              mensagem:"Descartar a tarefa que você estava escrevendo?",
              textoConfirmar:"Descartar",
              perigo:true
            }).then(function(sim){
              if(!sim)return;
              novaTarefaAberta=false;rascunhoTarefa={tit:"",desc:"",ag:""};desenhar();
            });
            return;
          }
          novaTarefaAberta=false;rascunhoTarefa={tit:"",desc:"",ag:""};desenhar();
        }}),
        h("button",{type:"submit",class:"primary-button est-p-6px-12px",texto:"Criar tarefa"})
      ])
    ]));
  }

  var filtros=[
    {id:"todas",rot:"Todas ("+ts.length+")"},
    {id:"ativas",rot:"Executando / Ativas"},
    {id:"concluidas",rot:"Concluídas"},
    {id:"fila",rot:"Sem modelo"}
  ];
  dirBody.append(
    h("div",{class:"mini-tabs"},filtros.map(function(f){
      return h("button",{type:"button","aria-pressed":String(filtroTarefas===f.id),texto:f.rot,onclick:function(){filtroTarefas=f.id;desenhar();}});
    }))
  );

  var filtradas=ts.filter(function(t){
    if(filtroTarefas==="ativas")return t.status==="a_fazer"||t.status==="executando"||t.status==="erro";
    if(filtroTarefas==="concluidas")return t.status==="concluida";
    if(filtroTarefas==="fila")return !t.agente;
    return true;
  }).slice().sort(function(a,b){
    var ord={executando:0,a_fazer:1,erro:2,concluida:3};
    var oa=ord[a.status]!=null?ord[a.status]:4,ob=ord[b.status]!=null?ord[b.status]:4;
    if(oa!==ob)return oa-ob;
    return (b.atualizado||0)-(a.atualizado||0);
  });
  if(!filtradas.length){
    dirBody.append(h("p",{class:"muted est-p-8px-2px",texto:ts.length?"Nenhuma tarefa neste filtro.":"Nenhuma tarefa ainda. Peça algo ao Pensador no chat ou clique em \"+ Nova tarefa\"."}));
  }else{
    filtradas.forEach(function(t){dirBody.append(renderCartaoTarefa(p,t,box));});
  }

  colDir.append(dirBody);
  raiz.append(h("div",{class:"cockpit cli"},[colEsq,colCentro,colDir]));

  var trabalhando=projAgIds.filter(function(id){return statusModeloNoProjeto(p,id).ocupado;}).length;
  var hibernandoCount=projAgIds.filter(function(id){return statusModeloNoProjeto(p,id).hibernando;}).length;
  raiz.append(h("div",{class:"status-cli"},[
    h("span",{texto:"estação-ai ▸ "+p.nome}),
    h("span",{texto:"● "+trabalhando+" trabalhando"}),
    hibernandoCount?h("span",{texto:"💤 "+hibernandoCount+" hibernando"}):null,
    h("span",{texto:ts.filter(function(t){return t.status!=="concluida";}).length+" tarefa(s) abertas"}),
    h("span",{class:"spacer"}),
    h("span",{texto:aba==="terminal"?("multi-terminal ("+TERMS.tabs.length+")"):(canal==="geral"?"#pensador":"@"+nomeAutor(canal))})
  ]));
}

/* ================================================================ CONSUMO E USO */
function faltaPara(ts){
  var seg=Math.max(0,Math.round(ts-Date.now()/1000));
  var d=Math.floor(seg/86400),hh=Math.floor(seg%86400/3600),mm=Math.floor(seg%3600/60);
  if(d)return d+(d===1?" dia":" dias")+(hh?" e "+hh+" h":"");
  if(hh)return hh+" h"+(mm?" e "+mm+" min":"");
  return mm+" min";
}
function rotuloFornecedor(f){
  var k=String(f||"").toLowerCase();
  if(k==="claude"||k==="claude-code")return "Claude Code";
  if(k==="codex")return "Codex";
  if(k==="antigravity-cli"||k==="antigravity")return "Antigravity";
  if(k==="opencode")return "OpenCode";
  if(k==="gemini")return "Gemini CLI";
  if(k==="pi")return "Pi";
  return f||"outro";
}

function somarJanela(acc,j){
  return {
    usado:acc.usado!=null?acc.usado:j.usado,
    livre:acc.livre!=null?acc.livre:j.livre,
    renova:acc.renova!=null?acc.renova:j.renova,
    tokens:Math.max(acc.tokens||0,j.tokens||0),
    tokens_estacao:(acc.tokens_estacao||0)+(j.tokens_estacao||0)
  };
}

function agruparConsumoPorModelo(agentes){
  var mapa={},ordem=[];
  (agentes||[]).forEach(function(a){
    var mod=a.modelo||"modelo padrão";
    var chave=a.fornecedor+"\0"+mod;
    if(!mapa[chave]){
      mapa[chave]={
        modelo:mod,
        fornecedor:a.fornecedor,
        cli_ausente:a.cli_ausente,
        cinco_horas:Object.assign({},a.cinco_horas),
        semanal:Object.assign({},a.semanal)
      };
      ordem.push(mapa[chave]);
    }else{
      mapa[chave].cli_ausente=mapa[chave].cli_ausente&&a.cli_ausente;
      mapa[chave].cinco_horas=somarJanela(mapa[chave].cinco_horas,a.cinco_horas);
      mapa[chave].semanal=somarJanela(mapa[chave].semanal,a.semanal);
    }
  });
  return ordem;
}

/* Formato simples por modelo: quanto foi usado e quanto ainda tem livre. */
function barraUso(rot,j,forn){
  var temPct=j.usado!=null||j.livre!=null;
  var usado=temPct?(j.usado!=null?Math.round(j.usado):Math.max(0,100-Math.round(j.livre))):null;
  var livre=temPct?(j.livre!=null?Math.round(j.livre):Math.max(0,100-usado)):null;
  var cls=livre==null?"":(livre<=15?"alto":(livre<=40?"medio":""));
  var tok=Math.max(j.tokens||0,j.tokens_estacao||0);
  var esq=temPct
    ?("Usado: "+usado+"%"+(tok>0?" ("+tok.toLocaleString("pt-BR")+" tokens)":""))
    :("Usado: "+tok.toLocaleString("pt-BR")+" tokens");
  var dir=temPct
    ?("Livre: "+livre+"%")
    :("Livre: não informado por "+forn);
  return h("div",{class:"lim"},[
    h("div",{class:"lim-top"},[
      h("strong",{texto:rot}),
      j.renova?h("span",{class:"muted est-text-11px",texto:"Reinicia em "+faltaPara(j.renova)}):null
    ]),
    h("div",{class:"lim-sub"},[h("span",{texto:esq}),h("span",{texto:dir})]),
    h("div",{class:"barra"},[h("span",{class:cls,style:"width:"+(livre==null?0:livre)+"%"})])
  ]);
}

function telaConsumo(){
  raiz.append(
    h("div",{class:"head-bar"},[
      h("div",{},[
        h("h1",{texto:"Consumo e uso"}),
        h("p",{class:"sub",texto:"Quanto foi usado e quanto ainda há livre por provedor e por modelo (janela de 5 horas e semanal)."})
      ]),
      h("button",{type:"button",class:"secondary-button",texto:"↻ Atualizar agora",onclick:carregar})
    ])
  );

  if(!CONSUMO){
    raiz.append(h("p",{class:"muted",texto:"Carregando consumo…"}));
    return;
  }

  var provs=CONSUMO.provedores||[];
  raiz.append(h("h2",{texto:"Provedores de IA ("+provs.length+")"}));
  if(!provs.length){
    raiz.append(h("div",{class:"card"},[
      h("p",{class:"muted"},["Nenhum provedor detectado ou com uso registrado ainda. ",h("a",{href:"modelos",texto:"Ver ferramentas neste computador"})])
    ]));
  }else{
    var gp=h("div",{class:"grid"});
    provs.forEach(function(pv){
      var rot=pv.rotulo||rotuloFornecedor(pv.fornecedor);
      gp.append(h("div",{class:"card"},[
        h("div",{class:"p-card-head"},[
          h("span",{class:"av "+avClasse(pv.fornecedor),texto:iniciais(rot)}),
          h("div",{class:"est-min-w-0 est-flex-1"},[
            h("h3",{class:"est-text-16px est-m-0",texto:rot}),
            h("p",{class:"muted",texto:pv.modelos&&pv.modelos.length?pv.modelos.slice(0,3).join(", ")+(pv.modelos.length>3?"…":""):pv.fornecedor})
          ]),
          h("span",{class:"pill "+(pv.instalado?"ok":""),texto:pv.instalado?"● instalado":"observado"})
        ]),
        barraUso("Janela de 5 horas",pv.cinco_horas,rot),
        barraUso("Janela semanal",pv.semanal,rot),
        h("p",{class:"muted est-m-10px-0-0 est-text-11px",texto:pv.fonte})
      ]));
    });
    raiz.append(gp);
  }

  var lista=agruparConsumoPorModelo(CONSUMO.agentes||[]);
  if(lista.length){
    raiz.append(h("h2",{texto:"Modelos cadastrados ("+lista.length+")"}));
    var g=h("div",{class:"grid"});
    lista.forEach(function(m){
      var forn=rotuloFornecedor(m.fornecedor);
      g.append(h("div",{class:"card"},[
        h("div",{class:"p-card-head"},[
          h("span",{class:"av "+avClasse(m.fornecedor),texto:iniciais(m.modelo)}),
          h("div",{class:"est-min-w-0 est-flex-1"},[
            h("h3",{class:"est-text-16px est-m-0",texto:m.modelo}),
            h("p",{class:"muted",texto:forn})
          ]),
          h("span",{class:"pill "+(m.cli_ausente?"err":"ok"),texto:m.cli_ausente?"CLI ausente":"● ativo"})
        ]),
        barraUso("Janela de 5 horas",m.cinco_horas,forn),
        barraUso("Janela semanal",m.semanal,forn)
      ]));
    });
    raiz.append(g);
  }

  if(!CONSUMO.claude_statusline_ativo&&(provs.some(function(p){return p.fornecedor==="claude";})||(CONSUMO.agentes||[]).some(function(a){return a.fornecedor==="claude";}))){
    var snippet='"statusLine": { "type": "command", "command": "\\"$HOME/Área de trabalho/Projetos/Estacao-ai/scripts/estacao/statusline-limites.sh\\"" }';
    raiz.append(h("div",{class:"card est-mt-16px"},[
      h("strong",{texto:"Ativar leitura de limites (5h e semanal) do Claude Code"}),
      h("p",{class:"muted est-m-4px-0-8px",texto:"Adicione esta linha em ~/.claude/settings.json para exibir % usado e % livre do Claude Code:"}),
      h("div",{class:"cmd-box",texto:snippet}),
      h("div",{class:"row est-mt-8px"},[
        h("button",{type:"button",class:"secondary-button",texto:"Copiar configuração",onclick:function(){
          if(navigator.clipboard)navigator.clipboard.writeText(snippet);
        }})
      ])
    ]));
  }
}

// Arrasto solto fora de um alvo também termina: libera a atualização automática.
document.addEventListener("dragend",function(){setTimeout(function(){arrastando=null;},0);});

function ciclo(){
  clearTimeout(timer);
  var ocupado=E&&(E.mensagens.some(function(m){return m.estado==="pensando";})||E.tarefas.some(function(t){return t.status==="executando";}));
  var intervalo=PAG==="consumo"?30000:(ocupado?2500:8000);
  timer=setTimeout(function(){
    if(modal||arrastando){ciclo();return;}
    var ativo=document.activeElement;
    if(ativo&&raiz.contains(ativo)&&/INPUT|TEXTAREA|SELECT/.test(ativo.tagName)&&ativo.id!=="chat-entrada"){ciclo();return;}
    carregar().then(ciclo,ciclo);
  },intervalo);
}

var ATUALIZACAO_INFO = null;
var ATUALIZACAO_OCULTA_KEY = "estacao_update_ignorado_v1";

function renderBannerAtualizacao(info) {
  var existente = document.getElementById("est-update-banner");
  if (existente) existente.remove();
  if (!info || !info.disponivel || !info.versao_disponivel) return;
  try {
    if (sessionStorage.getItem(ATUALIZACAO_OCULTA_KEY) === info.versao_disponivel) return;
  } catch {}

  var statusEl = h("span", { class: "est-update-status", texto: "" });
  var btnAtualizar = h("button", {
    type: "button",
    class: "primary-button",
    texto: "Atualizar agora",
    onclick: function () {
      btnAtualizar.disabled = true;
      btnAtualizar.textContent = "Atualizando…";
      statusEl.textContent = "Baixando pacote oficial e verificando SHA-256 direto do GitHub…";
      requisicao("estacao/api/atualizacao/aplicar", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Estacao-UI": "1",
          "X-CSRF-Token": decodeURIComponent(cookie("ai_memory_csrf") || "")
        },
        body: "{}"
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { ok: false, mensagem: "Erro HTTP " + r.status };
          });
        })
        .then(function (res) {
          statusEl.textContent = res.mensagem || (res.ok ? "Atualização concluída." : "Falha na atualização.");
          if (res.ok && res.reiniciando) {
            btnAtualizar.textContent = "Reiniciando…";
            setTimeout(function () {
              location.reload();
            }, 3500);
          } else if (res.ok) {
            btnAtualizar.textContent = "Baixado";
          } else {
            btnAtualizar.disabled = false;
            btnAtualizar.textContent = "Tentar novamente";
          }
        })
        .catch(function (err) {
          statusEl.textContent = "Erro ao atualizar: " + (err && err.message ? err.message : err);
          btnAtualizar.disabled = false;
          btnAtualizar.textContent = "Tentar novamente";
        });
    }
  });

  var acoes = [btnAtualizar];
  if (info.url_release) {
    acoes.push(
      h("a", {
        class: "secondary-button",
        href: info.url_release,
        target: "_blank",
        rel: "noopener noreferrer",
        texto: "Ver no GitHub"
      })
    );
  }
  acoes.push(
    h("button", {
      type: "button",
      class: "secondary-button",
      texto: "Depois",
      onclick: function () {
        try {
          sessionStorage.setItem(ATUALIZACAO_OCULTA_KEY, info.versao_disponivel);
        } catch {}
        var el = document.getElementById("est-update-banner");
        if (el) el.remove();
      }
    })
  );

  var banner = h("div", { id: "est-update-banner", class: "est-update-banner", role: "status" }, [
    h("div", { class: "est-update-info" }, [
      h("strong", {
        texto: "Nova versão da Estação I.A disponível: v" + info.versao_disponivel + " (atual: v" + info.versao_atual + ")"
      }),
      info.titulo ? h("span", { class: "est-update-titulo", texto: " · " + info.titulo }) : null,
      statusEl
    ]),
    h("div", { class: "est-update-acoes" }, acoes)
  ]);

  if (raiz && raiz.parentNode) {
    raiz.parentNode.insertBefore(banner, raiz);
  } else {
    document.body.prepend(banner);
  }
}

function verificarAtualizacao(forcar) {
  var qs = forcar ? "?forcar=1" : "";
  return requisicao("estacao/api/atualizacao" + qs, {
    credentials: "same-origin",
    cache: "no-store"
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (info) {
      ATUALIZACAO_INFO = info;
      if (info && info.disponivel) {
        renderBannerAtualizacao(info);
      }
      return info;
    })
    .catch(function () {
      return null;
    });
}

async function iniciar(){
  try {
    if (!await restaurarDispositivo()) { telaLoginNostr(); return; }
    document.body.classList.remove("nostr-gated");
    await carregar();
    verificarAtualizacao(false);
    ciclo();
  } catch {
    raiz.replaceChildren(h("p",{class:"erro",texto:"Não foi possível carregar a Estação."}),
      h("button",{type:"button",class:"secondary-button",texto:"Tentar novamente",onclick:iniciar}));
  }
}
iniciar();
})();
