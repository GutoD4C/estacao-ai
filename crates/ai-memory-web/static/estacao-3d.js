import { criarCena, CHALET_ZONES } from "./estacao-3d-cena.js";
import { criarAvatares } from "./estacao-3d-avatares.js";
import { animarAgentes, posicionarRotulos } from "./estacao-3d-animacoes.js";
import { criarCamera } from "./estacao-3d-camera.js";
import { criarClienteNostr, RACAS_CACHORRO, RELAY_PADRAO, requisicao } from "./estacao-3d-nostr.js";

(function () {
  "use strict";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var k in (attrs || {})) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    var list = Array.isArray(children) ? children : (children != null ? [children] : []);
    list.forEach(function (c) { if (c != null) node.append(c); });
    return node;
  }

  function resumirTexto(s, lim) {
    var clean = String(s || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return clean.length > lim ? clean.slice(0, lim - 1) + "…" : clean;
  }

  function normalizarTexto(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function extrairYoutubeId(raw) {
    var s = String(raw || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    var m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  }

  /* ---------------- Spatial Command Parser (Chalé 3D) ---------------- */
  var ZONE_PATTERNS = [
    { id: "here", re: /\b(venha[ms]?\s+(ate\s+mim|aqui|ca|comigo)|vem\s+(aqui|ca|comigo)|aqui\s+comigo|perto\s+de\s+mim|ao\s+meu\s+lado|me\s+sigam|siga-me|ate\s+mim)\b/ },
    { id: "fogueira", re: /\b(fogueira|lual|luau|firepit|campfire|fogo\s+la\s+fora|fogo\s+externo)\b/ },
    { id: "varanda", re: /\b(varanda|deck|sacada|alpendre|terraco)\b/ },
    { id: "gazebo", re: /\b(gazebo|pergola|mirante|quiosque)\b/ },
    { id: "jardim", re: /\b(jardim|piquenique|picnic|lago|quintal|gramado|area\s+externa|lado\s+de\s+fora|la\s+fora|ar\s+livre|fora\s+do\s+chale)\b/ },
    { id: "cafe", re: /\b(cafe|cafeteria|balcao|cozinha|espresso|expresso|tomar\s+um\s+cafe|pegar\s+cafe)\b/ },
    { id: "tv", re: /\b(cantinho\s+da\s+tv|televisao|smart\s+tv|\btv\b|sofa\s+da\s+tv|assistir|youtube)\b/ },
    { id: "mesa", re: /\b(mesa\s+de\s+trabalho|mesa\s+de\s+reuniao|escrivaninha|mesa|reuniao|trabalhar\s+na\s+mesa)\b/ },
    { id: "biblioteca", re: /\b(biblioteca|estante|livros|leitura)\b/ },
    { id: "lareira", re: /\b(lareira|roda|sala|dentro\s+do\s+chale|voltem\s+para\s+dentro|entrem\s+no\s+chale|chale|poltronas)\b/ }
  ];

  var MOVE_VERB_RE = /\b(ir|ia|va|vao|vai|vamos|venha|venham|vem|sente|sentem|sentar|reunam|reunir|fica|fiquem|ficar|posicione|posicionem|mude|mudem|ande|andem|caminhe|caminhem|sair|saiam|entrem|voltem|volte|encontrem|encontre|aguardem|esperem|movam|mova|leva|levem|traga|tragam|tomar|assistir|aquecer|aproximem|aproxime|cheguem|chegue)\b/;

  function detectarComandoEspacial(texto, agents) {
    var norm = normalizarTexto(texto);
    if (!norm) return null;
    var matchedZone = null;
    for (var i = 0; i < ZONE_PATTERNS.length; i++) {
      if (ZONE_PATTERNS[i].re.test(norm)) {
        matchedZone = ZONE_PATTERNS[i].id;
        break;
      }
    }
    if (!matchedZone) return null;
    // "here" já tem verbo implícito; demais zonas exigem verbo de movimento/posicionamento ou comando direto curto (/ir ... ou @Agente ...)
    if (matchedZone !== "here" && !MOVE_VERB_RE.test(norm) && !/^(\/ir|\/mover|\/zona|@)/i.test(texto.trim())) {
      return null;
    }
    var targetedIds = [];
    (agents || []).forEach(function (a) {
      var nName = normalizarTexto(a.name);
      if (!nName) return;
      if (norm.indexOf("@" + nName) >= 0 || new RegExp("\\b" + nName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(norm)) {
        targetedIds.push(a.id);
      }
    });
    return {
      zoneId: matchedZone,
      targetIds: targetedIds.length ? targetedIds : null // null = todos os agentes
    };
  }

  /* ---------------- Offline Web Audio Ambient Engine ---------------- */
  function criarMotorMusica() {
    var ctx = null, master = null, timer = null, noiseNode = null, nodes = [];
    var estado = { tocando: false, faixa: "lofi", volume: 0.32, tituloAudio: "" };
    var audioEl = new Audio();
    audioEl.loop = true;

    function ensureCtx() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = estado.volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function limparSynth() {
      if (timer) { clearInterval(timer); timer = null; }
      if (noiseNode) { try { noiseNode.stop(); } catch (_) {} noiseNode = null; }
      nodes.forEach(function (n) { try { n.stop(); n.disconnect(); } catch (_) {} });
      nodes = [];
    }

    function tocarAcorde(freqs, dur, type) {
      var c = ensureCtx(); if (!c) return;
      var now = c.currentTime;
      freqs.forEach(function (f) {
        var osc = c.createOscillator(), g = c.createGain(), flt = c.createBiquadFilter();
        osc.type = type || "triangle";
        osc.frequency.setValueAtTime(f, now);
        flt.type = "lowpass";
        flt.frequency.setValueAtTime(850, now);
        g.gain.setValueAtTime(0.001, now);
        g.gain.exponentialRampToValueAtTime(0.075, now + 0.45);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(flt); flt.connect(g); g.connect(master);
        osc.start(now); osc.stop(now + dur + 0.05);
        nodes.push(osc);
      });
    }

    function iniciarChuva() {
      var c = ensureCtx(); if (!c) return;
      var len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
      var b0 = 0, b1 = 0, b2 = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.08;
      }
      var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      var flt = c.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 1050;
      src.connect(flt); flt.connect(master); src.start();
      noiseNode = src;
    }

    function play(faixa, customUrl, titulo) {
      stop();
      estado.faixa = faixa || estado.faixa;
      estado.tituloAudio = titulo || "";
      if (customUrl) {
        audioEl.src = customUrl;
        audioEl.volume = estado.volume;
        audioEl.play().catch(function () {});
        estado.tocando = true;
        return;
      }
      if (!ensureCtx()) return;
      estado.tocando = true;
      if (estado.faixa === "rain") { iniciarChuva(); return; }
      var seq = [
        [196, 246.94, 293.66, 369.99],
        [174.61, 220, 261.63, 329.63],
        [164.81, 196, 246.94, 329.63],
        [146.83, 220, 261.63, 349.23]
      ];
      var stepIdx = 0;
      tocarAcorde(seq[0], 3.6, "sine");
      timer = setInterval(function () {
        if (!estado.tocando) return;
        stepIdx = (stepIdx + 1) % seq.length;
        tocarAcorde(seq[stepIdx], 3.6, "sine");
      }, 3300);
    }

    function stop() {
      estado.tocando = false;
      limparSynth();
      try { audioEl.pause(); } catch (_) {}
    }

    function setVolume(v) {
      estado.volume = Math.max(0, Math.min(1, v));
      if (master && ctx) master.gain.setValueAtTime(estado.volume, ctx.currentTime);
      audioEl.volume = estado.volume;
    }

    return { estado: estado, play: play, stop: stop, setVolume: setVolume };
  }

  window.Estacao3D = {
    mount: function (host, opts) {
      if (!window.THREE) {
        host.replaceChildren(el("div", { class: "card", style: "padding:18px" }, [
          el("strong", { text: "Motor 3D indisponível" }),
          el("p", { class: "muted", text: "Não foi possível carregar vendor/three.min.js." })
        ]));
        return { sync: function () {}, destroy: function () {} };
      }

      var T = window.THREE;
      var mode = opts.mode === "juri" ? "juri" : "dev";
      var isChalet = mode === "juri";
      var fullscreen = Boolean(opts.fullscreen);
      var callbacks = opts.callbacks || {};
      var liveData = opts.data || { agents: [], messages: [], tasks: [], avaliacoes: [], title: "", subtitle: "", chatId: "" };
      var musica = criarMotorMusica();

      var root = el("div", { class: "aa-wrap" + (fullscreen ? " aa-fullscreen" : "") + (isChalet ? " aa-chalet" : ""), id: "atelier-agentes" });
      var canvasEl = el("canvas", { "aria-label": isChalet ? "Chalé 3D da Estação-ai" : "Estação 3D de Engenharia" });
      var labelsEl = el("div", { class: "labels" });
      var tvOsEl = el("div", { class: "aa-tv-os", hidden: true });
      var btnExitTv = el("button", { type: "button", class: "aa-tv-exit", hidden: true, text: "← Voltar ao Chalé" });
      var btnNextSpeaker = el("button", { type: "button", class: "aa-next-btn", hidden: true, text: "Próximo →" });
      var errEl = el("div", { class: "error", hidden: true, role: "alert" });
      var hintEl = el("div", { class: "float", id: "aa-hint", hidden: isChalet, text: "Arraste para girar · roda para aproximar · clique em um agente ou na TV 3D" });

      // =======================================================================
      // HUD LIMPO DO CHALÉ 3D (Primeira Pessoa · Enter / Chat · ESC Menu)
      // =======================================================================
      var chaletLocPill = null, chaletLocText = null, chaletRoomTitle = null;
      var crosshairEl = null, interactPromptEl = null, chaletToastEl = null, chaletLockHint = null;
      var chaletMiniFeed = null, chaletChatOverlay = null, chaletChatFeed = null, chaletChatInput = null, chaletMentionRow = null;
      var chaletEscOverlay = null, chaletEscCamBtn = null, chaletTimeBtns = {}, chaletSoundBtns = {};
      var chaletDlgPanel = null, chaletDlgName = null, chaletDlgMeta = null, chaletDlgQueue = null;
      var chaletDlgBody = null, chaletDlgTextNode = null, chaletDlgCursor = null, chaletDlgNextBtn = null, chaletDlgFocusBtn = null;
      var chaletNostrStatusEl = null, chaletNostrRelayInput = null, chaletNostrNameInput = null, chaletNostrToggleBtn = null;
      var chaletBooksOverlay = null, chaletBooksBody = null, chaletBooksSearch = null, chaletBooksTabs = {};
      var booksState = { livros: [], filtro: "todos", busca: "", ativo: null, carregando: false, erro: "" };
      var chatOpen = false, escMenuOpen = false, booksOpen = false, expectedUnlock = false;
      var speakerAutoFocus = true, dlgUserScrolled = false;
      var currentTimeOfDay = "dia", currentAmbient = "off";
      var toastTimer = null;

      function showChaletToast(msg) {
        if (!chaletToastEl) return;
        chaletToastEl.textContent = msg;
        chaletToastEl.hidden = false;
        chaletToastEl.classList.remove("show");
        void chaletToastEl.offsetWidth;
        chaletToastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
          if (chaletToastEl) { chaletToastEl.classList.remove("show"); chaletToastEl.hidden = true; }
        }, 2800);
      }

      // Smart TV 3D OS (YouTube & Música dentro do ambiente 3D)
      var tvStatusText = "Smart TV · Pressione [E] para abrir";
      var hasActiveVideo = false, tvTab = "yt";
      ["pointerdown", "pointermove", "pointerup", "click", "wheel"].forEach(function (evName) {
        tvOsEl.addEventListener(evName, function (ev) { ev.stopPropagation(); }, { passive: evName !== "wheel" });
      });

      function buildTvOS() {
        var tabYtBtn = el("button", { type: "button", "aria-pressed": "true", text: "YouTube" });
        var tabMusicBtn = el("button", { type: "button", "aria-pressed": "false", text: "Música & Som" });
        var tvStatusBadge = el("span", { class: "muted", text: "" });
        var btnCloseTv = el("button", { type: "button", text: "✕ Fechar TV" });
        var ytPane = el("div", { class: "aa-tv-body" });
        var musicPane = el("div", { class: "aa-tv-body", hidden: true });

        function setTvTab(next) {
          tvTab = next;
          tabYtBtn.setAttribute("aria-pressed", String(next === "yt"));
          tabMusicBtn.setAttribute("aria-pressed", String(next === "music"));
          ytPane.hidden = next !== "yt";
          musicPane.hidden = next !== "music";
        }
        tabYtBtn.onclick = function () { setTvTab("yt"); };
        tabMusicBtn.onclick = function () { setTvTab("music"); };
        btnCloseTv.onclick = function () { cameraCtrl.exitTvCloseup(); };

        var ytQuery = el("input", { class: "taskinput", placeholder: "Pesquisar no YouTube ou colar link/ID…" });
        var ytForm = el("form", { class: "row" }, [
          ytQuery,
          el("button", { type: "submit", text: "Pesquisar" }),
          el("button", { type: "button", text: "Lo-Fi 24h", onclick: function () { tocarVideoYoutube("jfKfPfyJRdk", "Lofi Hip Hop Radio"); } })
        ]);
        var ytResults = el("div", { class: "aa-yt-results" });
        var ytPlayerSlot = el("div", { class: "aa-yt-player", hidden: true });

        function syncTvBadge() {
          var parts = [];
          if (hasActiveVideo) parts.push("Vídeo ativo");
          if (musica.estado.tocando) parts.push(resumirTexto(musica.estado.tituloAudio || "Música", 22));
          tvStatusBadge.textContent = parts.join(" · ");
        }

        function tocarVideoYoutube(id, title) {
          hasActiveVideo = true;
          tvStatusText = "NO AR: " + resumirTexto(title || id, 34);
          cena.redrawTv();
          syncTvBadge();
          var iframe = document.createElement("iframe");
          iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
          iframe.allowFullscreen = true;
          iframe.title = title || "YouTube TV";
          ytResults.hidden = true;
          ytPlayerSlot.hidden = false;
          ytPlayerSlot.replaceChildren(
            el("div", { class: "row", style: "justify-content:space-between" }, [
              el("strong", { style: "font-size:12px", text: resumirTexto(title || id, 44) }),
              el("div", { class: "row" }, [
                el("button", { type: "button", text: "Resultados", onclick: function () { ytResults.hidden = false; ytPlayerSlot.hidden = true; } }),
                el("button", {
                  type: "button", text: "Desligar", onclick: function () {
                    hasActiveVideo = false;
                    ytPlayerSlot.replaceChildren();
                    ytPlayerSlot.hidden = true;
                    ytResults.hidden = false;
                    tvStatusText = musica.estado.tocando ? resumirTexto(musica.estado.tituloAudio, 32) : "Smart TV · Pressione [E] para abrir";
                    cena.redrawTv();
                    syncTvBadge();
                  }
                })
              ])
            ]),
            iframe
          );
        }

        ytForm.onsubmit = function (ev) {
          ev.preventDefault();
          var qtxt = ytQuery.value.trim(); if (!qtxt) return;
          var directId = extrairYoutubeId(qtxt);
          if (directId) { tocarVideoYoutube(directId, "Vídeo " + directId); return; }
          ytResults.hidden = false; ytPlayerSlot.hidden = true;
          ytResults.replaceChildren(el("span", { class: "muted", text: "Buscando vídeos para \"" + qtxt + "\"…" }));
          requisicao("estacao/api/youtube?q=" + encodeURIComponent(qtxt), { credentials: "same-origin" })
            .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t || "Erro " + r.status); }); return r.json(); })
            .then(function (d) {
              var items = (d && d.itens) || [];
              if (!items.length) { ytResults.replaceChildren(el("span", { class: "muted", text: "Nenhum resultado encontrado." })); return; }
              ytResults.replaceChildren.apply(ytResults, items.map(function (it) {
                return el("button", { type: "button", class: "aa-yt-card", onclick: function () { tocarVideoYoutube(it.id, it.titulo); } }, [
                  el("strong", { text: it.titulo }),
                  el("small", { text: (it.canal || "YouTube") + (it.duracao ? " · " + it.duracao : "") })
                ]);
              }));
            })
            .catch(function (err) {
              ytResults.replaceChildren(el("span", { class: "muted", text: "Falha ao buscar: " + err.message }));
            });
        };
        ytPane.append(ytForm, ytResults, ytPlayerSlot);

        var trackSel = el("select", {}, [
          el("option", { value: "lofi", text: "Lo-Fi Chalé (offline)" }),
          el("option", { value: "rain", text: "Chuva na Floresta (offline)" })
        ]);
        var volInput = el("input", { type: "range", min: "0", max: "100", value: "35", style: "width:95px" });
        var btnPlayMusic = el("button", { type: "button", text: "Tocar" });
        var btnStopMusic = el("button", { type: "button", text: "Parar" });
        btnPlayMusic.onclick = function () {
          var tr = trackSel.value;
          musica.play(tr, "", tr === "rain" ? "Chuva na Floresta" : "Lo-Fi Chalé");
          tvStatusText = musica.estado.tituloAudio;
          cena.redrawTv();
          syncTvBadge();
        };
        btnStopMusic.onclick = function () {
          musica.stop();
          tvStatusText = hasActiveVideo ? tvStatusText : "Smart TV · Pressione [E] para abrir";
          cena.redrawTv();
          syncTvBadge();
        };
        volInput.oninput = function () { musica.setVolume(Number(volInput.value) / 100); };
        musicPane.append(el("div", { class: "row" }, [trackSel, btnPlayMusic, btnStopMusic, el("span", { class: "muted", text: "Vol:" }), volInput]));

        tvOsEl.replaceChildren(
          el("div", { class: "aa-tv-head" }, [
            el("div", { class: "aa-tv-tabs" }, [el("strong", { text: "Smart TV" }), tabYtBtn, tabMusicBtn]),
            el("div", { class: "row" }, [tvStatusBadge, btnCloseTv])
          ]),
          ytPane,
          musicPane
        );
      }
      buildTvOS();

      var sceneArea = el("div", { class: "scene" }, [canvasEl, labelsEl, tvOsEl, btnExitTv, btnNextSpeaker, hintEl, errEl]);

      // Controles legados apenas para o modo Dev (Escritório 3D de Projetos)
      var headerTitle = null, headerTag = null, viewBar = null, editorBox = null, agentsBar = null, scoresBar = null, detailRow = null, emoteBar = null, cmdForm = null, cmdInput = null, messageEl = null;
      var btnWalk = null, btnPause = null, btnFullscreen = null, btnZoomIn = null, btnZoomOut = null, btnFollow = null, btnEdit = null;
      var roomSel = null, themeSel = null, objSel = null, itemSel = null, btnAdd = null, btnMove = null, btnRotate = null, btnDelete = null, btnCancel = null, editMsgEl = null;
      var selectedNameEl = null, selectedRoleEl = null, activitySel = null, btnSpeakAt = null, btnReplayBubble = null, btnExtra1 = null, btnExtra2 = null;
      var hudTopRef = null, syncHudTop = function () {};

      if (isChalet) {
        chaletRoomTitle = el("strong", { text: liveData.title || "Chalé 3D" });
        chaletLocText = el("span", { text: "Chalé · Lareira" });
        chaletLocPill = el("div", { class: "chalet-loc-pill" }, [
          el("span", { class: "dot dot-ok" }),
          chaletRoomTitle,
          el("span", { class: "chalet-sep", text: "·" }),
          chaletLocText
        ]);

        crosshairEl = el("div", { class: "chalet-crosshair", "aria-hidden": "true" });
        interactPromptEl = el("div", { class: "chalet-interact-prompt", hidden: true });
        chaletToastEl = el("div", { class: "chalet-toast", hidden: true });
        chaletLockHint = el("div", { class: "chalet-lock-hint" }, [
          el("span", { text: "Clique para olhar · WASD andar · E interagir · Q próximo diálogo · Enter / chat · ESC menu" })
        ]);

        // Mini-feed discreto quando o chat está fechado
        chaletMiniFeed = el("div", { class: "chalet-mini-feed" });

        // Overlay de Chat (aberto com Enter ou /)
        chaletChatFeed = el("div", { class: "chalet-chat-feed" });
        chaletMentionRow = el("div", { class: "chalet-chat-shortcuts" });
        chaletChatInput = el("input", {
          type: "text",
          id: "chalet-chat-input",
          class: "chalet-chat-input",
          autocomplete: "off",
          placeholder: "Fale com os agentes ou peça para irem a um local (ex.: vamos para a fogueira lá fora)…"
        });
        var chaletChatForm = el("form", { class: "chalet-chat-form" }, [
          chaletChatInput,
          el("button", { type: "submit", class: "chalet-send-btn", text: "Enviar" })
        ]);
        var btnCloseChatOverlay = el("button", { type: "button", class: "chalet-icon-btn", title: "Fechar chat (ESC)", text: "✕", onclick: function () { setChatOpen(false, true); } });
        chaletChatOverlay = el("div", { class: "chalet-chat-overlay", hidden: true }, [
          el("div", { class: "chalet-chat-head" }, [
            el("span", { text: "Chat do Chalé" }),
            el("span", { class: "chalet-chat-hint", text: "Enter envia · ESC fecha" }),
            btnCloseChatOverlay
          ]),
          chaletChatFeed,
          chaletMentionRow,
          chaletChatForm
        ]);

        // Menu de Pausa / Opções (ESC)
        var chaletBreedBtns = {};
        var currentBreed = (liveData.userProfile && liveData.userProfile.raca_cachorro) || "caramelo";
        var breedRow = el("div", { class: "chalet-seg chalet-seg-5" }, RACAS_CACHORRO.map(function (rc) {
          var b = el("button", {
            type: "button", "aria-pressed": String(rc.id === currentBreed), text: rc.nome, title: rc.desc,
            onclick: function () { setOperatorBreedUI(rc.id); }
          });
          chaletBreedBtns[rc.id] = b;
          return b;
        }));
        chaletEscCamBtn = el("button", {
          type: "button", class: "chalet-menu-btn", text: "Câmera: Primeira Pessoa (V)",
          onclick: function () { toggleCameraPerspective(); }
        });
        var timeRow = el("div", { class: "chalet-seg" }, ["dia", "entardecer", "noite"].map(function (t) {
          var rot = t === "dia" ? "Dia" : (t === "entardecer" ? "Entardecer" : "Noite");
          var b = el("button", {
            type: "button", "aria-pressed": String(t === currentTimeOfDay), text: rot,
            onclick: function () { setTimeOfDayUI(t); }
          });
          chaletTimeBtns[t] = b;
          return b;
        }));
        var soundRow = el("div", { class: "chalet-seg" }, [
          { id: "off", rot: "Silêncio" },
          { id: "lofi", rot: "Lo-Fi" },
          { id: "rain", rot: "Chuva" }
        ].map(function (s) {
          var b = el("button", {
            type: "button", "aria-pressed": String(s.id === currentAmbient), text: s.rot,
            onclick: function () { setAmbientSoundUI(s.id); }
          });
          chaletSoundBtns[s.id] = b;
          return b;
        }));
        var sensSlider = el("input", {
          type: "range", min: "10", max: "55", value: "24", class: "chalet-range",
          oninput: function () { cameraCtrl.setSensitivity(Number(sensSlider.value) / 10000); }
        });

        // Painel lateral de diálogo com foco de câmera no orador + scroll com roda do mouse + [Q] Próximo
        chaletDlgName = el("strong", { text: "" });
        chaletDlgMeta = el("span", { class: "chalet-dlg-meta", text: "" });
        chaletDlgQueue = el("span", { class: "chalet-dlg-queue", hidden: true, text: "" });
        chaletDlgTextNode = document.createTextNode("");
        chaletDlgCursor = el("span", { class: "aa-cursor", text: "▍" });
        chaletDlgBody = el("div", { class: "chalet-dlg-body" }, [chaletDlgTextNode, chaletDlgCursor]);
        chaletDlgBody.addEventListener("scroll", function () {
          var nearBottom = chaletDlgBody.scrollHeight - chaletDlgBody.scrollTop - chaletDlgBody.clientHeight < 28;
          dlgUserScrolled = !nearBottom;
        });
        chaletDlgFocusBtn = el("button", {
          type: "button", class: "chalet-dlg-btn", title: "Alternar foco automático de câmera (F)", text: "[F] Foco: ON",
          onclick: function () { toggleSpeakerAutoFocus(); }
        });
        chaletDlgNextBtn = el("button", {
          type: "button", class: "chalet-dlg-btn primary", text: "[Q] Próximo →",
          onclick: function () { avancarOuCompletarDialogo(); }
        });
        chaletDlgPanel = el("aside", { class: "chalet-dlg-panel", hidden: true, "aria-label": "Diálogo do agente em foco" }, [
          el("div", { class: "chalet-dlg-head" }, [
            el("div", { class: "chalet-dlg-title" }, [chaletDlgName, chaletDlgMeta]),
            chaletDlgQueue
          ]),
          chaletDlgBody,
          el("div", { class: "chalet-dlg-foot" }, [
            el("span", { class: "chalet-dlg-hint", text: "Scroll: rolar resposta" }),
            el("div", { class: "row", style: "gap:6px" }, [chaletDlgFocusBtn, chaletDlgNextBtn])
          ])
        ]);

        // Configuração Nostr (preparação multi-operadores via relay) dentro do Menu ESC
        chaletNostrStatusEl = el("span", { class: "chalet-nostr-badge", text: "Solo (offline)" });
        chaletNostrRelayInput = el("input", { type: "text", class: "chalet-esc-input", placeholder: RELAY_PADRAO, value: RELAY_PADRAO });
        chaletNostrNameInput = el("input", { type: "text", class: "chalet-esc-input", placeholder: "Seu nome de operador", value: "Operador" });
        chaletNostrToggleBtn = el("button", { type: "button", class: "chalet-menu-btn", text: "Conectar Relay Nostr" });

        chaletEscOverlay = el("div", { class: "chalet-esc-overlay", hidden: true }, [
          el("div", { class: "chalet-esc-card", role: "dialog", "aria-modal": "true", "aria-label": "Menu do Chalé 3D" }, [
            el("div", { class: "chalet-esc-head" }, [
              el("div", {}, [
                el("h2", { text: "Menu do Chalé" }),
                el("p", { text: "WASD mover · Mouse olhar · E interagir · Q próximo diálogo · Scroll rolar fala · Enter / chat · V câmera" })
              ])
            ]),
            el("div", { class: "chalet-esc-actions" }, [
              el("button", { type: "button", class: "chalet-menu-btn primary", text: "Continuar no Chalé", onclick: function () { setEscMenuOpen(false, true); } }),
              el("button", { type: "button", class: "chalet-menu-btn", text: "Abrir Chat (Enter ou /)", onclick: function () { setEscMenuOpen(false, false); setChatOpen(true); } }),
              chaletEscCamBtn
            ]),
            el("div", { class: "chalet-esc-section" }, [
              el("span", { class: "chalet-esc-label", text: "Seu Cachorro (Raça do Operador)" }),
              breedRow
            ]),
            el("div", { class: "chalet-esc-section" }, [
              el("span", { class: "chalet-esc-label", text: "Ambiente / Horário" }),
              timeRow
            ]),
            el("div", { class: "chalet-esc-section" }, [
              el("span", { class: "chalet-esc-label", text: "Som Ambiente" }),
              soundRow
            ]),
            el("div", { class: "chalet-esc-section" }, [
              el("span", { class: "chalet-esc-label", text: "Sensibilidade do Mouse" }),
              sensSlider
            ]),
            el("div", { class: "chalet-esc-section chalet-nostr-box" }, [
              el("div", { class: "row", style: "justify-content:space-between" }, [
                el("span", { class: "chalet-esc-label", text: "Comunicação Nostr (Multi-Operador)" }),
                chaletNostrStatusEl
              ]),
              chaletNostrNameInput,
              chaletNostrRelayInput,
              chaletNostrToggleBtn
            ]),
            el("div", { class: "chalet-esc-grid" }, [
              el("button", { type: "button", class: "chalet-menu-btn", text: "Estante de Conhecimento", onclick: function () { setEscMenuOpen(false, false); setBooksOpen(true); } }),
              el("button", { type: "button", class: "chalet-menu-btn", text: "Iniciar Debate", onclick: function () { setEscMenuOpen(false, false); if (callbacks.onDebate) callbacks.onDebate(""); } }),
              el("button", { type: "button", class: "chalet-menu-btn", text: "Participantes", onclick: function () { setEscMenuOpen(false, false); if (callbacks.onManageChat) callbacks.onManageChat(); } }),
              el("button", { type: "button", class: "chalet-menu-btn", text: "Modo Chat 2D", onclick: function () { setEscMenuOpen(false, false); if (callbacks.onSwitchView) callbacks.onSwitchView("chat"); } }),
              el("button", { type: "button", class: "chalet-menu-btn", text: "Reunir na Lareira", onclick: function () { moveAgentsToZone("lareira", null, true); setEscMenuOpen(false, true); } })
            ]),
            el("div", { class: "chalet-esc-divider" }),
            el("div", { class: "chalet-esc-actions" }, [
              el("button", { type: "button", class: "chalet-menu-btn", text: "← Sair para Menu de Chats", onclick: function () { setEscMenuOpen(false, false); if (callbacks.onExitToChats) callbacks.onExitToChats(); } }),
              el("button", { type: "button", class: "chalet-menu-btn", text: "Menu Principal do Estação-ai", onclick: function () { setEscMenuOpen(false, false); if (callbacks.onOpenMainMenu) callbacks.onOpenMainMenu(); } })
            ])
          ])
        ]);

        // Overlay da Estante de Conhecimento (Livros de entregas concluídas, memória e debates)
        chaletBooksSearch = el("input", {
          type: "text",
          class: "chalet-esc-input",
          placeholder: "Pesquisar livros concluídos, páginas de memória ou debates…",
          oninput: function () {
            booksState.busca = chaletBooksSearch.value.trim().toLowerCase();
            renderBooksOverlay();
          }
        });
        var catList = [
          { id: "todos", label: "Todos os livros" },
          { id: "tarefa", label: "Concluídos" },
          { id: "memoria", label: "Memória" },
          { id: "debate", label: "Debates" }
        ];
        var booksTabRow = el("div", { class: "chalet-seg" }, catList.map(function (c) {
          var b = el("button", {
            type: "button",
            "aria-pressed": String(c.id === "todos"),
            text: c.label,
            onclick: function () {
              booksState.filtro = c.id;
              booksState.ativo = null;
              Object.keys(chaletBooksTabs).forEach(function (k) {
                chaletBooksTabs[k].setAttribute("aria-pressed", String(k === c.id));
              });
              renderBooksOverlay();
            }
          });
          chaletBooksTabs[c.id] = b;
          return b;
        }));
        chaletBooksBody = el("div", { class: "chalet-books-body" });
        chaletBooksOverlay = el("div", { class: "chalet-esc-overlay chalet-books-overlay", hidden: true }, [
          el("div", { class: "chalet-esc-card chalet-books-card", role: "dialog", "aria-modal": "true", "aria-label": "Estante de Conhecimento" }, [
            el("div", { class: "chalet-esc-head", style: "display:flex;align-items:flex-start;justify-content:space-between;gap:12px" }, [
              el("div", {}, [
                el("h2", { text: "Estante de Conhecimento" }),
                el("p", { text: "Consulte tarefas concluídas, páginas da memória e sínteses de debates em formato de livros." })
              ]),
              el("div", { class: "row", style: "gap:6px" }, [
                el("button", { type: "button", class: "chalet-menu-btn", text: "↻ Atualizar", onclick: function () { carregarLivrosEstante(); } }),
                el("button", { type: "button", class: "chalet-menu-btn primary", text: "Fechar (ESC)", onclick: function () { setBooksOpen(false, true); } })
              ])
            ]),
            el("div", { class: "chalet-books-toolbar" }, [booksTabRow, chaletBooksSearch]),
            chaletBooksBody
          ])
        ]);

        [chaletChatOverlay, chaletEscOverlay, chaletBooksOverlay, chaletDlgPanel, btnNextSpeaker].forEach(function (node) {
          ["pointerdown", "pointermove", "pointerup", "click", "wheel"].forEach(function (evName) {
            node.addEventListener(evName, function (ev) { ev.stopPropagation(); }, { passive: evName !== "wheel" });
          });
        });

        chaletChatForm.onsubmit = function (ev) {
          ev.preventDefault();
          var txt = chaletChatInput.value.trim();
          if (!txt) {
            setChatOpen(false, true);
            return;
          }
          chaletChatInput.value = "";
          handleOutgoingChatText(txt);
        };

        sceneArea.append(chaletLocPill, crosshairEl, interactPromptEl, chaletToastEl, chaletLockHint, chaletMiniFeed, chaletDlgPanel, chaletChatOverlay, chaletEscOverlay, chaletBooksOverlay);
        root.append(sceneArea);
      } else {
        // Modo Dev (Escritório 3D de Projetos)
        headerTitle = el("h2", { text: "Estação 3D de Engenharia" });
        headerTag = el("span", { class: "tag", text: "Baias separadas · Pensamento em tempo real · TV & Música" });
        btnWalk = el("button", { type: "button", id: "aa-walk", "aria-pressed": "false", text: "Entrar no espaço" });
        btnPause = el("button", { type: "button", id: "aa-pause", text: "Pausar" });
        btnFullscreen = el("button", { type: "button", id: "aa-fs", text: "⛶ Tela cheia" });
        btnZoomIn = el("button", { type: "button", id: "aa-zoom-in", "aria-label": "Aproximar", text: "+" });
        btnZoomOut = el("button", { type: "button", id: "aa-zoom-out", "aria-label": "Afastar", text: "−" });
        btnFollow = el("button", { type: "button", id: "aa-follow", "aria-pressed": "false", text: "Seguir agente" });
        btnEdit = el("button", { type: "button", id: "aa-edit", "aria-pressed": "false", text: "Mobiliar" });

        var viewButtons = [
          { id: "all", rot: "Vista Geral" },
          { id: "coord", rot: "Coordenação" },
          { id: "devs", rot: "Baias Dev" },
          { id: "qa", rot: "Testes & QA" },
          { id: "docs", rot: "Docs & Git" },
          { id: "tv", rot: "Close TV" }
        ];
        viewBar = el("div", { class: "row" }, viewButtons.map(function (v) {
          return el("button", { type: "button", "data-view": v.id, text: v.rot });
        }).concat([btnEdit, btnZoomIn, btnZoomOut, el("span", { class: "spacer" }), btnFollow, btnWalk, btnPause, btnFullscreen]));

        roomSel = el("select", {}, [
          el("option", { value: "0", text: "Coordenação & Lounge" }),
          el("option", { value: "1", text: "Desenvolvimento" }),
          el("option", { value: "2", text: "Testes & QA" }),
          el("option", { value: "3", text: "Docs & Git" })
        ]);
        themeSel = el("select", {}, [
          el("option", { value: "0", text: "Natural" }),
          el("option", { value: "1", text: "Criativo" }),
          el("option", { value: "2", text: "Executivo" }),
          el("option", { value: "3", text: "Contemporâneo" })
        ]);
        objSel = el("select", {}, [el("option", { value: "", text: "Selecione um móvel" })]);
        itemSel = el("select", {}, [
          el("option", { value: "desk", text: "Mesa de trabalho" }),
          el("option", { value: "sofa", text: "Sofá" }),
          el("option", { value: "meeting", text: "Mesa de reunião" }),
          el("option", { value: "plant", text: "Planta" }),
          el("option", { value: "shelf", text: "Estante" })
        ]);
        btnAdd = el("button", { type: "button", text: "+ Adicionar" });
        btnMove = el("button", { type: "button", disabled: true, text: "Mover" });
        btnRotate = el("button", { type: "button", disabled: true, text: "Girar 90°" });
        btnDelete = el("button", { type: "button", disabled: true, text: "Remover" });
        btnCancel = el("button", { type: "button", text: "Cancelar" });
        editMsgEl = el("div", { class: "muted", text: "Selecione um móvel ou adicione outro." });
        editorBox = el("div", { id: "aa-editor", hidden: true }, [
          el("div", { class: "row" }, [el("label", {}, ["Sala:", roomSel]), el("label", {}, ["Tema:", themeSel]), objSel]),
          el("div", { class: "row" }, [itemSel, btnAdd, btnMove, btnRotate, btnDelete, btnCancel]),
          editMsgEl
        ]);

        agentsBar = el("div", { class: "agents" });
        scoresBar = el("div", { class: "aa-scores", hidden: true });
        selectedNameEl = el("strong", { text: "Agente" });
        selectedRoleEl = el("span", { class: "tag-role", text: "" });
        activitySel = el("select", {}, [
          el("option", { value: "work", text: "Na baia" }),
          el("option", { value: "meeting", text: "Reunião" }),
          el("option", { value: "rest", text: "Descanso" }),
          el("option", { value: "you", text: "Vir até você" })
        ]);
        btnSpeakAt = el("button", { type: "button", text: "Chamar" });
        btnReplayBubble = el("button", { type: "button", text: "Reler fala" });
        detailRow = el("div", { class: "detail" }, [selectedNameEl, selectedRoleEl, el("span", { class: "spacer" }), activitySel, btnSpeakAt, btnReplayBubble]);
        cmdInput = el("input", { class: "taskinput", placeholder: "Enviar instrução ou criar tarefa para o agente selecionado…" });
        btnExtra1 = el("button", { type: "button", text: "Criar tarefa" });
        btnExtra2 = el("button", { type: "button", text: "Verificar ideias" });
        cmdForm = el("form", { class: "row" }, [cmdInput, el("button", { type: "submit", text: "Enviar" }), btnExtra1, btnExtra2]);
        messageEl = el("div", { class: "message", text: "" });

        root.append(
          el("div", { class: "top" }, [
            el("div", {}, [el("div", { class: "eyebrow", text: "ESTAÇÃO-AI / ESCRITÓRIO 3D" }), headerTitle]),
            headerTag
          ]),
          sceneArea,
          el("div", { class: "bottom" }, [viewBar, editorBox, agentsBar, scoresBar, detailRow, cmdForm, messageEl])
        );
      }

      host.replaceChildren(root);

      var renderer;
      try {
        renderer = new T.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
      } catch (e) {
        errEl.hidden = false;
        errEl.textContent = "A visualização 3D precisa de WebGL ativado.";
        return { sync: function () {}, destroy: function () { musica.stop(); } };
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;

      var cena = criarCena(T, mode, function () { return tvStatusText; });
      var {
        scene, tvScreenMesh, speakerGlowMat, speakerRings, pulpitSpotMesh,
        furniture, rooms, dims, itemNames, addFurniture, applyPalette,
        blocked, rebuildGrid, route, destinoJuri, destinoDev, destinoZonaChale,
        updateEnvironment, describeLocation, setTimeOfDay
      } = cena;
      var { escolherChassi, buildAgentMesh, criarGerenciadorOperadores } = criarAvatares(T, cena, labelsEl, el);

      // Modelo 3D do Operador (Cachorro escolhível pelo usuário) + gerenciador multiplayer via Nostr
      var operadores = criarGerenciadorOperadores();
      var initProfile = liveData.userProfile || {};
      var localOperator = isChalet ? operadores.createLocal({
        name: initProfile.apelido || "Você",
        role: "Operador",
        breed: initProfile.raca_cachorro || "caramelo"
      }) : null;
      var nostrClient = null;
      var skipVotes = { key: "", voters: new Set() };
      var onlineNpubsLocal = Array.isArray(liveData.onlineNpubs) ? liveData.onlineNpubs.slice() : [];
      if (initProfile.npub && onlineNpubsLocal.indexOf(initProfile.npub) < 0) {
        onlineNpubsLocal.push(initProfile.npub);
      }

      function setOperatorBreedUI(breedId) {
        if (!isChalet) return;
        currentBreed = breedId || "caramelo";
        if (localOperator && localOperator.setBreed) localOperator.setBreed(currentBreed);
        Object.keys(chaletBreedBtns).forEach(function (k) {
          chaletBreedBtns[k].setAttribute("aria-pressed", String(k === currentBreed));
        });
        if (nostrClient) nostrClient.updateProfile({ breed: currentBreed });
        if (callbacks.onChangeBreed) callbacks.onChangeBreed(currentBreed);
        showChaletToast("Cachorro alterado para " + currentBreed);
      }

      function activePresentCount() {
        var set = new Set();
        var myId = (initProfile && initProfile.npub) || (nostrClient && nostrClient.config.npub) || "local";
        set.add(myId);
        (liveData.onlineNpubs || []).forEach(function (n) { if (n) set.add(n); });
        onlineNpubsLocal.forEach(function (n) { if (n) set.add(n); });
        return set.size;
      }

      function currentSpeakerKey(cur) {
        if (!cur) return "";
        return cur.id + ":" + String(cur.bubbleFull || "").slice(0, 40);
      }

      function registerSkipVote(voterId, key) {
        var cur = currentPulpitSpeaker();
        if (!cur) return false;
        var spkKey = key || currentSpeakerKey(cur);
        if (spkKey !== currentSpeakerKey(cur)) return false;
        if (skipVotes.key !== spkKey) {
          skipVotes = { key: spkKey, voters: new Set() };
        }
        skipVotes.voters.add(voterId);
        var needed = activePresentCount();
        if (skipVotes.voters.size >= needed) {
          skipVotes = { key: "", voters: new Set() };
          avancarPulpito(cur);
          return true;
        }
        syncSpeakerDialogueUI();
        return false;
      }

      if (isChalet) {
        window.EstacaoOperadores = operadores;
        nostrClient = criarClienteNostr({
          authors: liveData.autoresNostr,
          roomId: liveData.chatId || liveData.title || "chalet",
          profile: {
            npub: initProfile.npub || "",
            pubkeyHex: initProfile.pubkey_hex || "",
            displayName: initProfile.apelido || "Operador",
            breed: initProfile.raca_cachorro || "caramelo",
            relayUrl: initProfile.relay_url || RELAY_PADRAO
          },
          onRemotePresence: function (ev) {
            if (!ev || !ev.id) return;
            if (ev.action === "leave") {
              operadores.removeRemote(ev.id);
            } else {
              operadores.upsertRemote(ev.id, ev);
            }
          },
          onPresenceListChange: function (npubs) {
            onlineNpubsLocal = Array.isArray(npubs) ? npubs.slice() : [];
            if (callbacks.onPresenceChange) callbacks.onPresenceChange(onlineNpubsLocal);
            syncSpeakerDialogueUI();
          },
          onSkipVote: function (ev) {
            if (ev && ev.npub && ev.speakerKey) {
              registerSkipVote(ev.npub, ev.speakerKey);
            }
          },

          onStatusChange: function (st) {
            if (!chaletNostrStatusEl || !chaletNostrToggleBtn) return;
            chaletNostrStatusEl.classList.remove("online", "connecting", "error");
            if (st.status === "connected") {
              chaletNostrStatusEl.classList.add("online");
              chaletNostrStatusEl.textContent = "Online · " + (st.peers || 0) + " peer(s)";
              chaletNostrToggleBtn.textContent = "Desconectar Relay Nostr";
            } else if (st.status === "connecting") {
              chaletNostrStatusEl.classList.add("connecting");
              chaletNostrStatusEl.textContent = "Conectando…";
              chaletNostrToggleBtn.textContent = "Cancelar conexão";
            } else if (st.status === "signer") {
              chaletNostrStatusEl.textContent = "Sala conectada · assinador pendente";
              chaletNostrToggleBtn.textContent = "Reconectar assinador Nostr";
            } else if (st.status === "error") {
              chaletNostrStatusEl.classList.add("error");
              chaletNostrStatusEl.textContent = "Erro de conexão";
              chaletNostrToggleBtn.textContent = "Tentar novamente";
              if (st.error) showChaletToast("Nostr: " + st.error);
            } else {
              chaletNostrStatusEl.textContent = "Solo (offline)";
              chaletNostrToggleBtn.textContent = "Conectar Relay Nostr";
            }
          }
        });
        window.EstacaoNostr = nostrClient;
        if (liveData.shared) nostrClient.connect();
        if (chaletNostrNameInput) {
          chaletNostrNameInput.value = nostrClient.config.displayName || "Operador";
          chaletNostrNameInput.onchange = function () {
            nostrClient.updateProfile({ displayName: chaletNostrNameInput.value.trim() || "Operador" });
          };
        }
        if (chaletNostrRelayInput) {
          chaletNostrRelayInput.value = nostrClient.config.relayUrl || RELAY_PADRAO;
          chaletNostrRelayInput.onchange = function () {
            nostrClient.updateProfile({ relayUrl: chaletNostrRelayInput.value.trim() || RELAY_PADRAO });
          };
        }
        if (chaletNostrToggleBtn) {
          chaletNostrToggleBtn.onclick = function () {
            if (nostrClient.status === "signer") {
              callbacks.onReconnectSigner?.();
            } else if (nostrClient.status === "connected" || nostrClient.status === "connecting") {
              nostrClient.disconnect();
              showChaletToast("Relay Nostr desconectado");
            } else {
              var nameVal = chaletNostrNameInput ? chaletNostrNameInput.value.trim() : "Operador";
              var relayVal = chaletNostrRelayInput ? chaletNostrRelayInput.value.trim() : RELAY_PADRAO;
              nostrClient.updateProfile({ displayName: nameVal || "Operador", relayUrl: relayVal });
              nostrClient.connect(relayVal);
            }
          };
        }
      }

      var agentList = [];
      var pulpitSpeakerId = null, speechQueue = [], firstSync = true;
      var selectedIdx = 0, paused = false, elapsed = 0, simTime = 0;
      var aimedTarget = null;
      var lastProcessedSpatialMsgId = "";

      // Persistência das zonas escolhidas para os agentes no Chalé (permanecem lá para as próximas questões!)
      var zoneStorageKey = "estacao-chalet-zones:" + (liveData.chatId || liveData.title || "default");
      var savedZoneAssignments = {};
      if (isChalet) {
        try {
          var rawZ = localStorage.getItem(zoneStorageKey);
          if (rawZ) savedZoneAssignments = JSON.parse(rawZ) || {};
        } catch (_) {}
      }
      function persistZoneAssignments() {
        if (!isChalet) return;
        try { localStorage.setItem(zoneStorageKey, JSON.stringify(savedZoneAssignments)); } catch (_) {}
      }

      function setTimeOfDayUI(preset) {
        currentTimeOfDay = preset;
        setTimeOfDay(preset);
        Object.keys(chaletTimeBtns).forEach(function (k) {
          chaletTimeBtns[k].setAttribute("aria-pressed", String(k === preset));
        });
      }

      function setAmbientSoundUI(kind) {
        currentAmbient = kind;
        if (kind === "off") musica.stop();
        else musica.play(kind, "", kind === "rain" ? "Chuva na Floresta" : "Lo-Fi Chalé");
        Object.keys(chaletSoundBtns).forEach(function (k) {
          chaletSoundBtns[k].setAttribute("aria-pressed", String(k === kind));
        });
      }

      function toggleCameraPerspective() {
        if (!isChalet) return;
        var next = !cameraCtrl.thirdPerson;
        cameraCtrl.setThirdPerson(next);
        if (chaletEscCamBtn) {
          chaletEscCamBtn.textContent = next ? "Câmera: Terceira Pessoa (V)" : "Câmera: Primeira Pessoa (V)";
        }
        showChaletToast(next ? "Câmera em Terceira Pessoa (Modelo do Operador visível)" : "Câmera em Primeira Pessoa");
      }

      function formatarDataLivro(ts) {
        if (!ts) return "";
        try {
          var d = new Date(ts * 1000);
          return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        } catch (e) { return ""; }
      }

      function renderBooksOverlay() {
        if (!chaletBooksBody) return;
        chaletBooksBody.replaceChildren();
        if (booksState.carregando) {
          chaletBooksBody.append(el("p", { class: "chalet-books-empty", text: "Consultando os livros da Estante de Conhecimento…" }));
          return;
        }
        if (booksState.erro) {
          chaletBooksBody.append(el("p", { class: "chalet-books-empty", text: "Não foi possível carregar a estante: " + booksState.erro }));
          return;
        }
        if (booksState.ativo) {
          var lv = booksState.ativo;
          var catNome = lv.categoria === "tarefa" ? "Entrega Concluída" : (lv.categoria === "debate" ? "Caderno de Debate" : "Página da Memória");
          var reader = el("div", { class: "chalet-book-reader" }, [
            el("div", { class: "chalet-book-reader-top" }, [
              el("button", { type: "button", class: "chalet-menu-btn", text: "← Voltar para a estante", onclick: function () { booksState.ativo = null; renderBooksOverlay(); } }),
              lv.link ? el("a", { href: lv.link, class: "chalet-menu-btn primary", text: "Abrir origem →", style: "text-decoration:none" }) : el("span")
            ]),
            el("div", { class: "chalet-book-page", style: "border-left:6px solid " + (lv.cor || "#7c583c") }, [
              el("div", { class: "chalet-book-meta" }, [
                el("span", { class: "chalet-book-cat", text: catNome }),
                el("span", { text: lv.projeto || "" }),
                lv.autor ? el("span", { text: "Por " + lv.autor }) : el("span"),
                lv.data ? el("span", { text: formatarDataLivro(lv.data) }) : el("span")
              ]),
              el("h3", { class: "chalet-book-title", text: lv.titulo }),
              lv.subtitulo ? el("p", { class: "chalet-book-sub", text: lv.subtitulo }) : el("span"),
              el("pre", { class: "chalet-book-content", text: lv.conteudo || "(Sem conteúdo detalhado registrado.)" })
            ])
          ]);
          chaletBooksBody.append(reader);
          return;
        }

        var filtrados = (booksState.livros || []).filter(function (lv) {
          if (booksState.filtro !== "todos" && lv.categoria !== booksState.filtro) return false;
          if (booksState.busca) {
            var hay = ((lv.titulo || "") + " " + (lv.subtitulo || "") + " " + (lv.projeto || "") + " " + (lv.autor || "") + " " + (lv.conteudo || "")).toLowerCase();
            if (hay.indexOf(booksState.busca) < 0) return false;
          }
          return true;
        });

        if (!filtrados.length) {
          chaletBooksBody.append(el("div", { class: "chalet-books-empty" }, [
            el("strong", { text: "Nenhum livro encontrado nesta prateleira." }),
            el("p", { text: "Conclua tarefas em Projetos, registre páginas na Memória ou faça debates com o Mediador para preencher os livros da estante." })
          ]));
          return;
        }

        var shelfGrid = el("div", { class: "chalet-books-grid" }, filtrados.map(function (lv) {
          var catBadge = lv.categoria === "tarefa" ? "Concluído" : (lv.categoria === "debate" ? "Debate" : "Memória");
          return el("button", {
            type: "button",
            class: "chalet-book-card",
            style: "--book-color:" + (lv.cor || "#7c583c"),
            onclick: function () { booksState.ativo = lv; renderBooksOverlay(); }
          }, [
            el("span", { class: "chalet-book-spine" }),
            el("div", { class: "chalet-book-card-body" }, [
              el("div", { class: "chalet-book-card-top" }, [
                el("span", { class: "chalet-book-cat", text: catBadge }),
                lv.data ? el("span", { class: "chalet-book-date", text: formatarDataLivro(lv.data) }) : el("span")
              ]),
              el("strong", { class: "chalet-book-card-title", text: lv.titulo }),
              el("span", { class: "chalet-book-card-sub", text: lv.subtitulo || lv.projeto || "" }),
              el("span", { class: "chalet-book-card-preview", text: String(lv.conteudo || "").slice(0, 120) + (String(lv.conteudo || "").length > 120 ? "…" : "") })
            ])
          ]);
        }));
        chaletBooksBody.append(shelfGrid);
      }

      function carregarLivrosEstante() {
        booksState.carregando = true;
        booksState.erro = "";
        renderBooksOverlay();
        requisicao("estacao/api/estante", { credentials: "same-origin" })
          .then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("Erro " + r.status)); });
            return r.json();
          })
          .then(function (d) {
            booksState.carregando = false;
            booksState.livros = (d && d.livros) || [];
            renderBooksOverlay();
          })
          .catch(function (err) {
            booksState.carregando = false;
            booksState.erro = (err && err.message) || "Falha ao consultar a estante.";
            renderBooksOverlay();
          });
      }

      function setBooksOpen(open, relock) {
        if (!isChalet) return;
        booksOpen = Boolean(open);
        if (chaletBooksOverlay) chaletBooksOverlay.hidden = !booksOpen;
        if (crosshairEl) crosshairEl.hidden = chatOpen || escMenuOpen || booksOpen || cameraCtrl.tvCloseup;
        if (booksOpen) {
          chatOpen = false;
          escMenuOpen = false;
          booksState.ativo = null;
          if (chaletChatOverlay) chaletChatOverlay.hidden = true;
          if (chaletEscOverlay) chaletEscOverlay.hidden = true;
          if (chaletMiniFeed) chaletMiniFeed.hidden = false;
          expectedUnlock = true;
          cameraCtrl.setPointerLock(false);
          carregarLivrosEstante();
        } else if (relock && !(speakerAutoFocus && currentPulpitSpeaker())) {
          cameraCtrl.setPointerLock(true);
        }
        syncSpeakerDialogueUI();
      }

      function setChatOpen(open, relock) {
        if (!isChalet) return;
        chatOpen = Boolean(open);
        if (chaletChatOverlay) chaletChatOverlay.hidden = !chatOpen;
        if (chaletMiniFeed) chaletMiniFeed.hidden = chatOpen;
        if (crosshairEl) crosshairEl.hidden = chatOpen || escMenuOpen || booksOpen || cameraCtrl.tvCloseup;
        if (chatOpen) {
          escMenuOpen = false;
          booksOpen = false;
          if (chaletEscOverlay) chaletEscOverlay.hidden = true;
          if (chaletBooksOverlay) chaletBooksOverlay.hidden = true;
          expectedUnlock = true;
          cameraCtrl.setPointerLock(false);
          renderChaletChatFeed();
          setTimeout(function () { if (chaletChatInput) chaletChatInput.focus(); }, 10);
        } else if (relock && !(speakerAutoFocus && currentPulpitSpeaker())) {
          cameraCtrl.setPointerLock(true);
        }
        syncSpeakerDialogueUI();
      }

      function setEscMenuOpen(open, relock) {
        if (!isChalet) return;
        escMenuOpen = Boolean(open);
        if (chaletEscOverlay) chaletEscOverlay.hidden = !escMenuOpen;
        if (crosshairEl) crosshairEl.hidden = chatOpen || escMenuOpen || booksOpen || cameraCtrl.tvCloseup;
        if (escMenuOpen) {
          chatOpen = false;
          booksOpen = false;
          if (chaletChatOverlay) chaletChatOverlay.hidden = true;
          if (chaletBooksOverlay) chaletBooksOverlay.hidden = true;
          if (chaletMiniFeed) chaletMiniFeed.hidden = false;
          expectedUnlock = true;
          cameraCtrl.setPointerLock(false);
        } else if (relock && !(speakerAutoFocus && currentPulpitSpeaker())) {
          cameraCtrl.setPointerLock(true);
        }
        syncSpeakerDialogueUI();
      }

      function moveAgentsToZone(zoneId, targetIds, announce) {
        if (!isChalet || !agentList.length) return;
        var targets = targetIds && targetIds.length
          ? agentList.filter(function (a) { return targetIds.indexOf(a.id) >= 0; })
          : agentList.slice();
        if (!targets.length) return;

        var opPos = cameraCtrl.walkPos || new T.Vector3(0, 0.12, 6.4);
        if (zoneId === "here") {
          var n = targets.length;
          targets.forEach(function (a, i) {
            var spread = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * Math.min(Math.PI * 0.85, n * 0.42);
            var distHere = 2.4 + (i % 2) * 0.7;
            var baseAng = cameraCtrl.yaw + Math.PI + spread;
            var gx = opPos.x + Math.sin(baseAng) * distHere;
            var gz = opPos.z + Math.cos(baseAng) * distHere;
            var faceYaw = Math.atan2(opPos.x - gx, opPos.z - gz);
            var dest = {
              x: gx, y: gz <= 15.5 ? 0.12 : 0, z: gz, yaw: faceYaw,
              state: "stand", seat: false, zoneId: "here", zona: "Perto de Você"
            };
            a.home = dest;
            a.zoneId = "here";
            a.zona = dest.zona;
            a.seat = false;
            a.state = "stand";
            a.waveUntil = simTime + 2.5;
            moveAgentTo(a, dest.x, dest.y, dest.z, dest.yaw);
            savedZoneAssignments[a.id] = { zoneId: "here", custom: dest };
          });
          persistZoneAssignments();
          if (announce) showChaletToast((targetIds ? targets.map(function (t) { return t.name; }).join(", ") : "Agentes") + " vindo até você");
          return;
        }

        var zDef = CHALET_ZONES[zoneId] || CHALET_ZONES.lareira;
        // Descobre slots já ocupados por agentes que não estão sendo movidos agora
        var usedSlots = new Set();
        agentList.forEach(function (a) {
          if (targets.indexOf(a) < 0 && a.zoneId === zDef.id && a.zoneSlot != null) {
            usedSlots.add(a.zoneSlot);
          }
        });
        var nextSlot = 0;
        targets.forEach(function (a) {
          while (usedSlots.has(nextSlot) && nextSlot < zDef.slots.length * 2) nextSlot++;
          var slotIdx = nextSlot++;
          usedSlots.add(slotIdx);
          var dest = destinoZonaChale(zDef.id, slotIdx);
          a.home = dest;
          a.zoneId = zDef.id;
          a.zoneSlot = slotIdx;
          a.zona = dest.zona;
          a.seat = dest.seat;
          a.state = dest.state;
          a.waveUntil = simTime + 1.8;
          moveAgentTo(a, dest.x, dest.y, dest.z, dest.yaw);
          savedZoneAssignments[a.id] = { zoneId: zDef.id, slot: slotIdx };
        });
        persistZoneAssignments();
        if (announce) {
          var quem = targetIds ? targets.map(function (t) { return t.name; }).join(", ") : "Todos os agentes";
          showChaletToast(quem + " indo para " + zDef.label);
        }
      }

      function handleOutgoingChatText(txt) {
        if (isChalet) {
          var cmd = detectarComandoEspacial(txt, agentList);
          if (cmd) {
            moveAgentsToZone(cmd.zoneId, cmd.targetIds, true);
          }
        }
        if (callbacks.onSend) callbacks.onSend(txt);
      }

      function renderChaletChatFeed() {
        if (!isChalet) return;
        var msgs = (liveData.messages || []).slice(-35);
        var nameById = new Map();
        agentList.forEach(function (a) { nameById.set(a.id, a.name); });
        function autorNome(id) { return id === "voce" ? "Você" : (nameById.get(id) || id); }

        if (chaletChatFeed) {
          chaletChatFeed.replaceChildren();
          if (!msgs.length) {
            chaletChatFeed.append(el("div", { class: "chalet-chat-empty", text: "Converse normalmente ou diga, por exemplo: \"vamos para a fogueira lá fora\" ou \"@Filósofo 1 vai ao café\"." }));
          } else {
            msgs.forEach(function (m) {
              var isYou = m.autor === "voce";
              var txt = m.estado === "pensando" ? (m.texto || "Pensando…") : (m.texto || "");
              chaletChatFeed.append(el("div", { class: "chalet-chat-msg" + (isYou ? " you" : "") + (m.estado === "pensando" ? " busy" : "") }, [
                el("strong", { text: autorNome(m.autor) }),
                el("span", { text: resumirTexto(txt, 380) })
              ]));
            });
          }
          chaletChatFeed.scrollTop = chaletChatFeed.scrollHeight;
        }

        if (chaletMiniFeed) {
          var recent = msgs.slice(-3);
          chaletMiniFeed.replaceChildren.apply(chaletMiniFeed, recent.map(function (m) {
            var isYou = m.autor === "voce";
            var txt = m.estado === "pensando" ? (m.texto || "Pensando…") : (m.texto || "");
            return el("div", { class: "chalet-mini-line" + (isYou ? " you" : "") }, [
              el("strong", { text: autorNome(m.autor) + ": " }),
              document.createTextNode(resumirTexto(txt, 110))
            ]);
          }));
        }

        if (chaletMentionRow) {
          var chips = [];
          [
            { rot: "Fogueira", cmd: "Vamos todos para a fogueira lá fora" },
            { rot: "Lareira", cmd: "Voltem para a roda da lareira" },
            { rot: "Varanda", cmd: "Venham para a varanda" },
            { rot: "Café", cmd: "Vamos para o balcão de café" },
            { rot: "TV", cmd: "Vamos para o cantinho da TV" },
            { rot: "Mesa", cmd: "Vamos para a mesa de trabalho" },
            { rot: "Vir até mim", cmd: "Venham até mim" }
          ].forEach(function (z) {
            chips.push(el("button", {
              type: "button", class: "chalet-chip zone", text: z.rot,
              onclick: function () {
                chaletChatInput.value = z.cmd;
                chaletChatInput.focus();
              }
            }));
          });
          agentList.slice(0, 12).forEach(function (a) {
            chips.push(el("button", {
              type: "button", class: "chalet-chip", text: "@" + a.name,
              onclick: function () {
                var v = chaletChatInput.value;
                var sep = v && !/\s$/.test(v) ? " " : "";
                chaletChatInput.value = v + sep + "@" + a.name + " ";
                chaletChatInput.focus();
              }
            }));
          });
          chaletMentionRow.replaceChildren.apply(chaletMentionRow, chips);
        }
      }

      function triggerEmote(a, emoji, txt, dur) {
        if (!a || !a.emoteEl) return;
        a.emoteEmoji = emoji || "";
        a.emoteLabel = txt || "";
        a.emoteUntil = simTime + (dur || 2.2);
        a.emoteEl.innerHTML = "";
        if (a.emoteEmoji) a.emoteEl.append(document.createTextNode(a.emoteEmoji + " "));
        if (a.emoteLabel) a.emoteEl.append(el("small", { text: a.emoteLabel }));
        a.emoteEl.classList.remove("burst");
        void a.emoteEl.offsetWidth;
        a.emoteEl.classList.add("burst");
        a.emoteEl.hidden = false;
      }

      function currentPulpitSpeaker() {
        if (!pulpitSpeakerId) return null;
        return agentList.find(function (x) { return x.id === pulpitSpeakerId && !x.bubbleClosed && Boolean(x.bubbleFull); }) || null;
      }

      function scrollDialogue(deltaY) {
        if (!isChalet || !chaletDlgBody || !chaletDlgPanel || chaletDlgPanel.hidden) return;
        chaletDlgBody.scrollTop += deltaY * 0.85;
        var nearBottom = chaletDlgBody.scrollHeight - chaletDlgBody.scrollTop - chaletDlgBody.clientHeight < 28;
        dlgUserScrolled = !nearBottom;
      }

      function toggleSpeakerAutoFocus() {
        if (!isChalet) return;
        speakerAutoFocus = !speakerAutoFocus;
        if (chaletDlgFocusBtn) {
          chaletDlgFocusBtn.textContent = speakerAutoFocus ? "[F] Foco: ON" : "[F] Foco: OFF";
          chaletDlgFocusBtn.setAttribute("aria-pressed", String(speakerAutoFocus));
        }
        syncSpeakerDialogueUI();
      }

      function syncSpeakerDialogueUI() {
        if (!isChalet || !chaletDlgPanel) return;
        var cur = currentPulpitSpeaker();
        var tvOn = typeof cameraCtrl !== "undefined" && cameraCtrl && cameraCtrl.tvCloseup;
        var showPanel = Boolean(cur && !escMenuOpen && !booksOpen && !tvOn);
        var shouldFocus = Boolean(showPanel && speakerAutoFocus && !chatOpen);

        chaletDlgPanel.hidden = !showPanel;
        btnNextSpeaker.hidden = true;

        if (showPanel) {
          chaletDlgPanel.classList.toggle("thinking", Boolean(cur.busy));
          chaletDlgName.textContent = cur.name + (cur.funcao === "mediador" ? " ★" : "");
          chaletDlgMeta.textContent = (cur.roleLabel || cur.providerLabel || "Agente") + " · " + (cur.zona || "Chalé");
          if (speechQueue.length) {
            chaletDlgQueue.hidden = false;
            chaletDlgQueue.textContent = "+" + speechQueue.length + " na fila";
          } else {
            chaletDlgQueue.hidden = true;
          }
          var txt = cur.bubbleFull || "";
          var pos = Math.floor(cur.bubblePos || 0);
          var typing = pos < txt.length || cur.busy;
          chaletDlgTextNode.nodeValue = txt.slice(0, pos);
          chaletDlgCursor.hidden = !typing;
          if (typing && !dlgUserScrolled) {
            chaletDlgBody.scrollTop = chaletDlgBody.scrollHeight;
          }
          if (cur.busy) {
            chaletDlgNextBtn.textContent = "Pensando…";
            chaletDlgNextBtn.disabled = true;
            chaletDlgNextBtn.classList.remove("ready");
          } else if (pos < txt.length) {
            chaletDlgNextBtn.textContent = "[Q] Completar →";
            chaletDlgNextBtn.disabled = false;
            chaletDlgNextBtn.classList.remove("ready");
          } else {
            var q = speechQueue.length;
            var needConsensus = Boolean(liveData.shared) && activePresentCount() > 1;
            var curKey = currentSpeakerKey(cur);
            var votesNow = skipVotes.key === curKey ? skipVotes.voters.size : 0;
            var totalPresent = activePresentCount();
            if (needConsensus) {
              var myId = (initProfile && initProfile.npub) || (nostrClient && nostrClient.config.npub) || "local";
              var jaVotou = skipVotes.key === curKey && skipVotes.voters.has(myId);
              chaletDlgNextBtn.textContent = jaVotou
                ? ("Aguardando todos (" + votesNow + "/" + totalPresent + ")")
                : ("[Q] Votar " + (q ? "Próximo" : "Continuar") + " (" + votesNow + "/" + totalPresent + ")");
              chaletDlgNextBtn.disabled = jaVotou;
              chaletDlgNextBtn.classList.toggle("ready", !jaVotou);
            } else {
              chaletDlgNextBtn.textContent = q ? ("[Q] Próximo (" + q + ") →") : "[Q] Fechar";
              chaletDlgNextBtn.disabled = false;
              chaletDlgNextBtn.classList.add("ready");
            }
          }
        }

        if (typeof cameraCtrl !== "undefined" && cameraCtrl) {
          var nextFocus = shouldFocus ? cur : null;
          if (nextFocus && !cameraCtrl.speakerFocusAgent && cameraCtrl.pointerLocked) {
            expectedUnlock = true;
          }
          cameraCtrl.setSpeakerFocus(nextFocus);
        }
      }

      function updateNextBtn() {
        if (isChalet) {
          syncSpeakerDialogueUI();
          return;
        }
        var cur = currentPulpitSpeaker();
        if (!cur || (typeof cameraCtrl !== "undefined" && cameraCtrl && cameraCtrl.tvCloseup) || escMenuOpen) { btnNextSpeaker.hidden = true; return; }
        btnNextSpeaker.hidden = false;
        var txt = cur.bubbleFull || "";
        var typing = (cur.bubblePos || 0) < txt.length;
        if (cur.busy) {
          btnNextSpeaker.textContent = cur.name + " pensando…";
          btnNextSpeaker.classList.remove("ready");
          btnNextSpeaker.disabled = true;
        } else if (typing) {
          btnNextSpeaker.textContent = "Completar fala →";
          btnNextSpeaker.classList.remove("ready");
          btnNextSpeaker.disabled = false;
        } else {
          var q = speechQueue.length;
          btnNextSpeaker.textContent = q ? ("Próximo → (" + q + ")") : "Fechar fala";
          btnNextSpeaker.classList.add("ready");
          btnNextSpeaker.disabled = false;
        }
      }

      function avancarPulpito(a) {
        var cur = a || currentPulpitSpeaker();
        if (cur) {
          cur.bubbleClosed = true;
          cur.closedKey = cur.bubbleFull || "";
          cur.bubbleDoneAt = null;
          cur.bubble.hidden = true;
          if (pulpitSpeakerId === cur.id) pulpitSpeakerId = null;
          // Mantém o agente no local/zona atual em que foi posicionado!
          if (isChalet && cur.home) {
            cur.state = cur.home.state || "seat";
          }
        }
        var ativou = false;
        while (speechQueue.length) {
          var item = speechQueue.shift();
          var nxt = agentList.find(function (x) { return x.id === item.agentId; });
          if (nxt) {
            pulpitSpeakerId = nxt.id;
            nxt.closedKey = "";
            setBubble(nxt, item.text, true);
            nxt.state = "speak";
            ativou = true;
            break;
          }
        }
        if (!ativou) {
          var nxtBusy = agentList.find(function (x) { return x.busy; });
          if (nxtBusy) {
            pulpitSpeakerId = nxtBusy.id;
            nxtBusy.closedKey = "";
            setBubble(nxtBusy, nxtBusy.pendingThinkText || ("Analisando (" + (nxtBusy.roleLabel || nxtBusy.name) + ")…"), true);
          }
        }
        updateNextBtn();
      }

      function avancarOuCompletarDialogo() {
        var cur = currentPulpitSpeaker();
        if (!cur || cur.busy) return false;
        if ((cur.bubblePos || 0) < (cur.bubbleFull || "").length) {
          cur.bubblePos = cur.bubbleFull.length;
          cur.bubbleDoneAt = simTime;
          renderBubbleText(cur);
          updateNextBtn();
          return true;
        }
        // Em salas compartilhadas com 2+ pessoas presentes online, exige consenso de todos para pular/continuar!
        if (isChalet && liveData.shared && activePresentCount() > 1) {
          var myId = (initProfile && initProfile.npub) || (nostrClient && nostrClient.config.npub) || "local";
          var spkKey = currentSpeakerKey(cur);
          if (nostrClient) nostrClient.publishSkipVote(spkKey);
          var avancou = registerSkipVote(myId, spkKey);
          if (!avancou) {
            showChaletToast("Voto registrado (" + skipVotes.voters.size + "/" + activePresentCount() + ") · aguardando todos apertarem Q");
          }
          return true;
        }
        avancarPulpito(cur);
        return true;
      }

      btnNextSpeaker.onclick = function (ev) {
        ev.stopPropagation();
        avancarOuCompletarDialogo();
      };

      function wireBubbleButtons(a) {
        if (a._wiredBubble) return;
        a._wiredBubble = true;
        a.bubble.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
        a.bubbleReplay.onclick = function (ev) {
          ev.stopPropagation();
          a.bubblePos = 0; a.bubbleClosed = false; a.closedKey = ""; a.bubbleDoneAt = null;
          pulpitSpeakerId = a.id;
          renderBubbleText(a);
          updateNextBtn();
        };
        a.bubbleFast.onclick = function (ev) {
          ev.stopPropagation();
          a.bubblePos = (a.bubbleFull || "").length;
          a.bubbleDoneAt = simTime;
          renderBubbleText(a);
          updateNextBtn();
        };
        a.bubbleClose.onclick = function (ev) {
          ev.stopPropagation();
          avancarPulpito(a);
        };
      }

      function renderBubbleText(a) {
        var txt = a.bubbleFull || "";
        var pos = Math.floor(a.bubblePos || 0);
        var typing = pos < txt.length || a.busy;
        a.bubbleTitle.textContent = a.name + " · " + a.zona;
        a.bubbleBodyText.nodeValue = txt.slice(0, pos);
        a.bubbleCursor.hidden = !typing;
        a.bubbleFast.hidden = pos >= txt.length;
        if (typing) a.bubbleBody.scrollTop = a.bubbleBody.scrollHeight;
        if (isChalet && a.id === pulpitSpeakerId) {
          syncSpeakerDialogueUI();
        }
      }

      function setBubble(a, txt, resetTyping) {
        var next = String(txt || "").trim();
        if (!next) { a.bubbleFull = ""; a.bubblePos = 0; a.bubbleDoneAt = null; updateNextBtn(); return; }
        if (next !== a.bubbleFull || resetTyping) {
          a.bubbleFull = next;
          a.bubblePos = 0;
          a.bubbleDoneAt = null;
          a.bubbleClosed = false;
          if (isChalet && a.id === pulpitSpeakerId) {
            dlgUserScrolled = false;
            if (chaletDlgBody) chaletDlgBody.scrollTop = 0;
          }
          renderBubbleText(a);
          updateNextBtn();
        }
      }

      function selectAgent(idx) {
        if (!agentList.length) return;
        selectedIdx = Math.max(0, Math.min(idx, agentList.length - 1));
        var a = agentList[selectedIdx];
        updateHUD();
        if (messageEl) messageEl.textContent = a.name + " (" + a.zona + ") — " + (a.lastText ? ("Última fala: \"" + resumirTexto(a.lastText, 120) + "\"") : a.statusText);
      }

      function moveAgentTo(a, x, y, z, yawGoal) {
        a.targetY = y || 0;
        a.targetYaw = yawGoal;
        a.path = route(a, [x, z]);
        if (a.path.length) {
          a.path.push([x, z]);
        } else {
          a.path = [[x, z]];
        }
      }

      function updateHUD() {
        if (isChalet) {
          renderChaletChatFeed();
          return;
        }
        agentsBar.replaceChildren.apply(agentsBar, agentList.map(function (a, i) {
          var cls = a.busy ? "dot-busy" : (a.ausente ? "dot-off" : "dot-ok");
          return el("button", { type: "button", "aria-pressed": i === selectedIdx ? "true" : "false", onclick: function () { selectAgent(i); } }, [
            el("span", { class: "dot " + cls }),
            " " + a.name
          ]);
        }));
        if (!agentList.length) { selectedNameEl.textContent = "Nenhum modelo"; selectedRoleEl.textContent = ""; return; }
        var sel = agentList[selectedIdx] || agentList[0];
        selectedNameEl.textContent = sel.name;
        selectedRoleEl.textContent = (sel.roleLabel || sel.providerLabel) + " · " + sel.zona;
        activitySel.value = sel.state || sel.home.state;
      }

      function syncData(nextData) {
        liveData = nextData || { agents: [], messages: [], tasks: [], avaliacoes: [], title: "", subtitle: "" };
        if (headerTitle) headerTitle.textContent = "Escritório 3D · " + (liveData.title || "Projeto");
        if (chaletRoomTitle) chaletRoomTitle.textContent = liveData.title || "Chalé 3D";

        var incoming = liveData.agents || [];
        var oldMap = new Map();
        agentList.forEach(function (a) { oldMap.set(a.id, a); });

        var msgs = liveData.messages || [];
        var latestOkId = null;
        for (var mi = msgs.length - 1; mi >= 0; mi--) {
          if (!latestOkId && msgs[mi].estado === "ok" && msgs[mi].autor !== "voce" && msgs[mi].texto) {
            latestOkId = msgs[mi].autor;
            break;
          }
        }

        var counters = { crit: 0, prop: 0, jury: 0, coord: 0, dev: 0, qa: 0, docs: 0 }, usadosChassis = {};
        incoming.forEach(function (s) {
          var prev = oldMap.get(s.id);
          if (prev && prev.chassis) usadosChassis[prev.chassis] = (usadosChassis[prev.chassis] || 0) + 1;
        });

        var kept = new Set(), rebuilt = [];
        incoming.forEach(function (spec, idx) {
          kept.add(spec.id);
          var defaultHome = isChalet ? destinoJuri(spec, idx, counters) : destinoDev(spec, idx, counters);
          var ag = oldMap.get(spec.id);
          if (!ag) {
            // Restaura zona persistida no Chalé se o operador já havia posicionado esse agente
            var initHome = defaultHome;
            if (isChalet && savedZoneAssignments[spec.id]) {
              var sv = savedZoneAssignments[spec.id];
              if (sv.zoneId === "here" && sv.custom) initHome = sv.custom;
              else if (sv.zoneId && CHALET_ZONES[sv.zoneId]) initHome = destinoZonaChale(sv.zoneId, sv.slot || idx);
            }
            var ch = escolherChassi(spec, usadosChassis);
            var mesh = buildAgentMesh(spec, initHome, ch);
            ag = {
              id: spec.id, chassis: mesh.chassis, hoverGroup: mesh.hoverGroup, extraLegs: mesh.extraLegs,
              wheels: mesh.wheels, orbitRings: mesh.orbitRings, coffeeMug: mesh.coffeeMug,
              g: mesh.g, bodyGroup: mesh.bodyGroup, head: mesh.head, arms: mesh.arms, elbows: mesh.elbows,
              legs: mesh.legs, knees: mesh.knees, ears: mesh.ears, tail: mesh.tail, eyeGroups: mesh.eyeGroups, mouth: mesh.mouth,
              ring: mesh.ring, ringMat: mesh.ringMat, label: mesh.label, emoteEl: mesh.emoteEl, zzzEl: mesh.zzzEl, bubble: mesh.bubble,
              bubbleTitle: mesh.bubbleTitle, bubbleBody: mesh.bubbleBody, bubbleBodyText: mesh.bubbleBodyText,
              bubbleCursor: mesh.bubbleCursor, bubbleReplay: mesh.bubbleReplay, bubbleFast: mesh.bubbleFast, bubbleClose: mesh.bubbleClose,
              home: initHome, zoneId: initHome.zoneId || "lareira", zoneSlot: idx, seat: Boolean(initHome.seat),
              targetY: initHome.y || 0, targetYaw: initHome.yaw || 0, path: [], state: initHome.state || "seat",
              lastMsgId: "", lastText: "", bubbleFull: "", bubblePos: 0, bubbleDoneAt: null, bubbleClosed: true, closedKey: "",
              wasBusy: false, emoteUntil: 0, waveUntil: 0, hibernando: Boolean(spec.hibernando)
            };
            wireBubbleButtons(ag);
            ag.g.traverse(function (o) { o.userData.agentId = spec.id; });
          }

          ag.name = spec.name;
          ag.funcao = spec.funcao || "";
          ag.roleLabel = spec.roleLabel || "";
          ag.providerLabel = spec.providerLabel || "";
          ag.busy = Boolean(spec.busy);
          ag.ausente = Boolean(spec.ausente);
          ag.hibernando = Boolean(spec.hibernando);
          ag.statusText = ag.hibernando ? "Hibernando (zzz)" : (spec.statusText || (ag.busy ? "Pensando…" : "Livre"));
          if (!isChalet) {
            ag.home = defaultHome;
            ag.zona = defaultHome.zona;
          } else if (!ag.zona) {
            ag.zona = ag.home.zona || "Roda da Lareira";
          }

          var ultMsg = null;
          for (var j = msgs.length - 1; j >= 0; j--) {
            if (msgs[j].autor === spec.id) { ultMsg = msgs[j]; break; }
          }
          if (ag.busy) {
            var pensamento = ultMsg && ultMsg.texto ? String(ultMsg.texto) : ("Pensando (" + (ag.roleLabel || ag.name) + ")…");
            ag.pendingThinkText = pensamento;
            if (ag.closedKey !== pensamento) {
              var curSpk = currentPulpitSpeaker();
              if (!curSpk || curSpk.id === ag.id) {
                pulpitSpeakerId = ag.id;
                if (ag.bubbleFull !== pensamento) {
                  ag.closedKey = "";
                  setBubble(ag, pensamento, true);
                }
              }
            }
          } else if (ultMsg && ultMsg.estado === "ok" && ultMsg.texto) {
            var mudou = ultMsg.id !== ag.lastMsgId || ultMsg.texto !== ag.lastText;
            ag.lastMsgId = ultMsg.id;
            ag.lastText = ultMsg.texto;
            if (mudou && !firstSync) {
              var txtCompleto = String(ultMsg.texto).trim();
              var activeSpk = currentPulpitSpeaker();
              if (activeSpk && activeSpk.id !== ag.id) {
                if (!speechQueue.some(function (q) { return q.msgId === ultMsg.id; })) {
                  speechQueue.push({ agentId: ag.id, text: txtCompleto, msgId: ultMsg.id });
                }
              } else {
                ag.closedKey = "";
                pulpitSpeakerId = ag.id;
                setBubble(ag, txtCompleto, true);
                if (spec.id === latestOkId) selectedIdx = rebuilt.length;
              }
            }
          }
          ag.wasBusy = ag.busy;

          // No modo Dev, mantém agente em sua baia; no Chalé 3D, agentes FICAM onde foram posicionados!
          if (!isChalet && !ag.path.length) {
            if (Math.hypot(ag.g.position.x - ag.home.x, ag.g.position.z - ag.home.z) > 0.4) {
              moveAgentTo(ag, ag.home.x, ag.home.y, ag.home.z, ag.home.yaw);
            }
          }
          rebuilt.push(ag);
        });

        // Verifica se a última mensagem do operador (inclusive vinda do chat 2D) continha comando espacial novo
        if (isChalet && msgs.length) {
          for (var um = msgs.length - 1; um >= 0; um--) {
            if (msgs[um].autor === "voce") {
              if (!firstSync && msgs[um].id !== lastProcessedSpatialMsgId) {
                lastProcessedSpatialMsgId = msgs[um].id;
                var spCmd = detectarComandoEspacial(msgs[um].texto, rebuilt);
                if (spCmd) moveAgentsToZone(spCmd.zoneId, spCmd.targetIds, false);
              } else if (firstSync) {
                lastProcessedSpatialMsgId = msgs[um].id;
              }
              break;
            }
          }
        }

        firstSync = false;

        oldMap.forEach(function (ag, id) {
          if (!kept.has(id)) {
            scene.remove(ag.g);
            ag.label.remove();
            if (ag.emoteEl) ag.emoteEl.remove();
            if (ag.zzzEl) ag.zzzEl.remove();
            ag.bubble.remove();
          }
        });
        agentList = rebuilt;
        if (selectedIdx >= agentList.length) selectedIdx = 0;
        agentList.forEach(function (a, idx) { a.g.traverse(function (o) { o.userData.agentIndex = idx; }); });
        updateHUD();
        updateNextBtn();
      }

      // ---------------- Interação com [E] ou Clique no Chalé 3D ----------------
      function triggerAimInteraction() {
        if (!isChalet || chatOpen || escMenuOpen || cameraCtrl.tvCloseup) return;
        if (cameraCtrl.sitting && (!aimedTarget || aimedTarget.kind !== "object" || aimedTarget.item.type !== "seat")) {
          cameraCtrl.standUp();
          showChaletToast("Você levantou");
          return;
        }
        if (!aimedTarget) return;
        if (aimedTarget.kind === "agent") {
          var ag = aimedTarget.agent;
          selectAgent(aimedTarget.index);
          ag.waveUntil = simTime + 2.4;
          setChatOpen(true);
          if (chaletChatInput) {
            chaletChatInput.value = "@" + ag.name + " ";
            chaletChatInput.focus();
          }
          return;
        }
        if (aimedTarget.kind === "object") {
          var it = aimedTarget.item;
          if (it.type === "tv") {
            cameraCtrl.enterTvCloseup();
            return;
          }
          if (it.type === "seat") {
            if (cameraCtrl.sitting) {
              cameraCtrl.standUp();
              showChaletToast("Você levantou");
            } else {
              cameraCtrl.sitAt(it.seatPos, it.seatYaw);
              showChaletToast("Sentado · pressione W/A/S/D ou E para levantar");
            }
            return;
          }
          if (it.type === "radio") {
            var nextSound = !musica.estado.tocando ? "lofi" : (currentAmbient === "lofi" ? "rain" : "off");
            setAmbientSoundUI(nextSound);
            showChaletToast(nextSound === "off" ? "Rádio desligado" : musica.estado.tituloAudio);
            return;
          }
          if (it.type === "bookshelf") {
            setBooksOpen(true);
            return;
          }
          if (it.type === "gather") {
            if (agentList.length) moveAgentsToZone(it.zoneId, null, true);
            else showChaletToast("Adicione participantes para reunir os agentes");
            return;
          }
          if (it.onInteract) {
            var feedback = it.onInteract(simTime);
            if (feedback) showChaletToast(feedback);
          }
        }
      }

      // Atalhos globais do Chalé 3D: Enter / / (chat), E (interagir), V (câmera), ESC (menu)
      function onChaletKeyDown(ev) {
        if (!isChalet) return;
        var inInput = /INPUT|SELECT|TEXTAREA/.test((ev.target && ev.target.tagName) || "");
        if (ev.key === "Escape") {
          if (booksOpen) {
            ev.preventDefault();
            if (booksState.ativo) {
              booksState.ativo = null;
              renderBooksOverlay();
            } else {
              setBooksOpen(false, false);
            }
            return;
          }
          if (cameraCtrl.tvCloseup) {
            ev.preventDefault();
            cameraCtrl.exitTvCloseup(false);
            return;
          }
          if (chatOpen) {
            ev.preventDefault();
            setChatOpen(false, false);
            return;
          }
          ev.preventDefault();
          setEscMenuOpen(!escMenuOpen, escMenuOpen);
          return;
        }
        if (inInput) return;
        if (escMenuOpen || booksOpen || cameraCtrl.tvCloseup) return;
        if (ev.key === "Enter" || ev.key === "/") {
          ev.preventDefault();
          setChatOpen(true);
          if (ev.key === "/" && chaletChatInput) {
            chaletChatInput.value = "/";
          }
          return;
        }
        if (ev.key === "e" || ev.key === "E") {
          ev.preventDefault();
          triggerAimInteraction();
          return;
        }
        if (ev.key === "q" || ev.key === "Q") {
          if (avancarOuCompletarDialogo()) {
            ev.preventDefault();
          }
          return;
        }
        if (ev.key === "f" || ev.key === "F") {
          if (currentPulpitSpeaker()) {
            ev.preventDefault();
            toggleSpeakerAutoFocus();
          }
          return;
        }
        if (ev.key === "v" || ev.key === "V") {
          ev.preventDefault();
          toggleCameraPerspective();
        }
      }
      if (isChalet) {
        window.addEventListener("keydown", onChaletKeyDown);
      }

      // Editor Mobiliário (Dev)
      var editMode = false, selectedFurniture = null, pendingType = null, pendingMove = false, activeRoom = 0;
      var editOutline = new T.BoxHelper(new T.Object3D(), "#e4e4e7");
      editOutline.visible = false;
      scene.add(editOutline);
      function clearFurnitureSelection() {
        selectedFurniture = null; pendingMove = false; editOutline.visible = false;
        if (objSel) objSel.value = "";
        if (btnMove) btnMove.disabled = true;
        if (btnRotate) btnRotate.disabled = true;
        if (btnDelete) btnDelete.disabled = true;
      }
      function syncFurnitureList() {
        if (!objSel) return;
        objSel.innerHTML = '<option value="">Selecione um móvel</option>';
        furniture.filter(function (f) { return f.room === activeRoom; }).forEach(function (f) {
          objSel.append(el("option", { value: String(f.id), text: itemNames[f.type] + " #" + f.id }));
        });
        if (selectedFurniture) objSel.value = String(selectedFurniture.id);
      }
      function pickFurniture(f) {
        selectedFurniture = f; activeRoom = f.room;
        roomSel.value = String(activeRoom); themeSel.value = String(rooms[activeRoom].palette);
        editOutline.setFromObject(f.g); editOutline.visible = true; syncFurnitureList();
        btnMove.disabled = false; btnRotate.disabled = false; btnDelete.disabled = false;
        editMsgEl.textContent = itemNames[f.type] + " selecionado.";
      }
      function sectorAt(x, z) { return (z >= 0 ? 2 : 0) + (x >= 0 ? 1 : 0); }
      function canPlace(f, x, z, angle) {
        var r = rooms[activeRoom], wd = dims[f.type], c = Math.cos(angle), s = Math.sin(angle);
        var hx = (Math.abs(c) * wd[0] + Math.abs(s) * wd[1]) / 2 + 0.28, hz = (Math.abs(s) * wd[0] + Math.abs(c) * wd[1]) / 2 + 0.28;
        if (x - hx < r.x - 10.9 || x + hx > r.x + 10.9 || z - hz < r.z - 7.25 || z + hz > r.z + 7.25) return false;
        for (var lx = -wd[0] / 2 - 0.2; lx <= wd[0] / 2 + 0.21; lx += 0.35) {
          for (var lz = -wd[1] / 2 - 0.2; lz <= wd[1] / 2 + 0.21; lz += 0.35) {
            if (blocked(x + c * lx + s * lz, z - s * lx + c * lz, f.id)) return false;
          }
        }
        return true;
      }
      function furnitureChanged() {
        rebuildGrid(); syncFurnitureList();
        if (selectedFurniture) editOutline.setFromObject(selectedFurniture.g);
      }
      function editorClick(ray) {
        if (pendingType || pendingMove) {
          var p = new T.Vector3();
          if (!ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -0.2), p)) return;
          var x = Math.round(p.x * 2) / 2, z = Math.round(p.z * 2) / 2;
          if (sectorAt(x, z) !== activeRoom) { editMsgEl.textContent = "Clique dentro de " + rooms[activeRoom].name + "."; return; }
          var f = pendingMove ? selectedFurniture : { type: pendingType, id: -1 };
          if (!canPlace(f, x, z, pendingMove ? f.g.rotation.y : 0)) { editMsgEl.textContent = "Posição ocupada."; return; }
          if (pendingMove) { f.g.position.set(x, 0, z); pickFurniture(f); }
          else pickFurniture(addFurniture(pendingType, activeRoom, x, z));
          pendingType = null; pendingMove = false; furnitureChanged();
          editMsgEl.textContent = "Móvel posicionado.";
          return;
        }
        var hits = ray.intersectObjects(furniture.map(function (f) { return f.g; }), true);
        if (hits.length) {
          var found = furniture.find(function (f) { return f.id === hits[0].object.userData.furniture; });
          if (found) pickFurniture(found);
        }
      }
      if (!isChalet && btnEdit) {
        btnEdit.onclick = function () {
          editMode = !editMode; btnEdit.setAttribute("aria-pressed", String(editMode)); editorBox.hidden = !editMode;
          if (editMode) { cameraCtrl.pararPercurso(); syncFurnitureList(); }
          else { pendingType = null; clearFurnitureSelection(); }
        };
        roomSel.onchange = function (e) { activeRoom = Number(e.target.value); clearFurnitureSelection(); pendingType = null; themeSel.value = String(rooms[activeRoom].palette); syncFurnitureList(); cameraCtrl.focarSala(rooms[activeRoom]); };
        themeSel.onchange = function (e) { applyPalette(activeRoom, Number(e.target.value)); };
        objSel.onchange = function (e) { var f = furniture.find(function (x) { return x.id === Number(e.target.value); }); if (f) pickFurniture(f); else clearFurnitureSelection(); };
        btnAdd.onclick = function () { pendingType = itemSel.value; pendingMove = false; editMsgEl.textContent = "Clique no piso de " + rooms[activeRoom].name + "."; };
        btnMove.onclick = function () { if (!selectedFurniture) return; pendingMove = true; pendingType = null; };
        btnCancel.onclick = function () { pendingType = null; pendingMove = false; };
        btnRotate.onclick = function () {
          var f = selectedFurniture; if (!f) return;
          var ang = f.g.rotation.y + Math.PI / 2;
          if (!canPlace(f, f.g.position.x, f.g.position.z, ang)) { editMsgEl.textContent = "Sem espaço para girar."; return; }
          f.g.rotation.y = ang; furnitureChanged();
        };
        btnDelete.onclick = function () {
          var f = selectedFurniture; if (!f) return;
          scene.remove(f.g); furniture.splice(furniture.indexOf(f), 1);
          clearFurnitureSelection(); furnitureChanged();
        };
        activitySel.onchange = function (e) {
          var a = agentList[selectedIdx]; if (!a) return;
          var st = e.target.value; a.state = st;
          if (st === "meeting") moveAgentTo(a, -8.5, 0, -8.0, 0);
          else if (st === "rest") moveAgentTo(a, -16.8, 0, -4.2, 0);
          else moveAgentTo(a, a.home.x, 0, a.home.z, a.home.yaw);
        };
        btnSpeakAt.onclick = function () {
          var a = agentList[selectedIdx]; if (!a) return;
          var wp = cameraCtrl.walkPos;
          moveAgentTo(a, wp ? wp.x : 0, 0, wp ? wp.z + 1.8 : 4.0, 0);
        };
        btnReplayBubble.onclick = function () {
          var sel = agentList[selectedIdx]; if (!sel) return;
          pulpitSpeakerId = sel.id; sel.bubbleClosed = false; sel.closedKey = ""; sel.bubbleDoneAt = null;
          setBubble(sel, sel.lastText || sel.bubbleFull || (sel.name + " em " + sel.zona), true);
        };
        btnPause.onclick = function () { paused = !paused; btnPause.textContent = paused ? "Continuar" : "Pausar"; };
        cmdForm.onsubmit = function (ev) {
          ev.preventDefault();
          var txt = cmdInput.value.trim(); if (!txt) return;
          var sel = agentList[selectedIdx];
          var payload = (sel && !/^@|debate/i.test(txt)) ? ("@" + sel.name + " " + txt) : txt;
          cmdInput.value = "";
          if (callbacks.onSend) callbacks.onSend(payload, sel);
        };
        btnExtra1.onclick = function () {
          var txt = cmdInput.value.trim(), sel = agentList[selectedIdx];
          if (!sel || !txt) return;
          cmdInput.value = "";
          if (callbacks.onAssignTask) callbacks.onAssignTask(sel, txt);
        };
        btnExtra2.onclick = function () { if (callbacks.onVerify) callbacks.onVerify(); };
      }

      var cameraCtrl = criarCamera(T, mode, {
        host, root, canvasEl, sceneArea, hudTopRef, renderer, btnExitTv, btnFullscreen, btnFollow, btnWalk, btnZoomIn, btnZoomOut, hintEl
      }, cena, {
        getAgents: function () { return agentList; },
        selectAgent, editorClick, updateNextBtn, syncHudTop,
        editorAtivo: function () { return editMode; },
        fecharEditor: function () {
          if (!isChalet && editorBox) { editMode = false; editorBox.hidden = true; btnEdit.setAttribute("aria-pressed", "false"); clearFurnitureSelection(); }
        },
        isUiBlocking: function () { return chatOpen || escMenuOpen || booksOpen || cameraCtrl.tvCloseup; },
        onInteract: triggerAimInteraction,
        onDialogueScroll: scrollDialogue,
        onPointerLockChange: function (locked) {
          if (!isChalet) return;
          if (chaletLockHint) chaletLockHint.hidden = locked || chatOpen || escMenuOpen || booksOpen || Boolean(cameraCtrl.speakerFocusAgent);
          if (!locked) {
            if (expectedUnlock) {
              expectedUnlock = false;
            } else if (!chatOpen && !escMenuOpen && !booksOpen && !cameraCtrl.tvCloseup && !cameraCtrl.speakerFocusAgent) {
              // Quando o usuário aperta ESC com o cursor travado, o navegador libera o Pointer Lock:
              // abrimos imediatamente o Menu do Chalé para uma resposta instantânea de ESC!
              setEscMenuOpen(true, false);
            }
          }
        }
      });
      var camera = cameraCtrl.camera;

      var clock = new T.Clock(), alive = true, rafId = 0;
      function destroy() {
        if (!alive) return;
        alive = false;
        musica.stop();
        if (nostrClient) nostrClient.disconnect();
        if (isChalet) window.removeEventListener("keydown", onChaletKeyDown);
        if (rafId) cancelAnimationFrame(rafId);
        cameraCtrl.disconnect();
        operadores.destroyAll();
        renderer.dispose();
      }

      function loop() {
        if (!alive) return;
        rafId = requestAnimationFrame(loop);
        var dt = Math.min(clock.getDelta(), 0.06);
        elapsed += dt;
        if (!paused) {
          simTime += dt;
          if (musica.estado.tocando) {
            speakerGlowMat.emissiveIntensity = 0.7 + Math.sin(elapsed * 7.5) * 0.45;
            speakerRings.forEach(function (r, idx) { var sc = 1 + Math.sin(elapsed * 7.5 + idx) * 0.07; r.scale.set(sc, sc, sc); });
          } else {
            speakerGlowMat.emissiveIntensity = 0.3;
          }
          if (isChalet) {
            updateEnvironment(dt, elapsed, simTime, agentList);
          }
          animarAgentes(agentList, selectedIdx, dt, elapsed, simTime, renderBubbleText, updateNextBtn, cameraCtrl.walkPos, pulpitSpeakerId);
        }

        cameraCtrl.update(dt, agentList[selectedIdx], localOperator);

        var speakerFocusActive = Boolean(isChalet && cameraCtrl.speakerFocusAgent);
        if (isChalet && cameraCtrl.walkPos) {
          var locName = describeLocation(cameraCtrl.walkPos.x, cameraCtrl.walkPos.z);
          if (chaletLocText) chaletLocText.textContent = locName;
          if (nostrClient && nostrClient.status === "connected") {
            nostrClient.publishPresence({
              pos: { x: cameraCtrl.walkPos.x, y: cameraCtrl.walkPos.y, z: cameraCtrl.walkPos.z },
              yaw: cameraCtrl.yaw,
              speed: 0,
              sitting: cameraCtrl.sitting,
              zone: locName
            });
          }
          aimedTarget = (chatOpen || escMenuOpen || cameraCtrl.tvCloseup || speakerFocusActive) ? null : cameraCtrl.getAimTarget(agentList);
          if (interactPromptEl) {
            if (aimedTarget) {
              interactPromptEl.hidden = false;
              interactPromptEl.textContent = "[E] " + aimedTarget.label;
            } else if (cameraCtrl.sitting && !chatOpen && !escMenuOpen && !speakerFocusActive) {
              interactPromptEl.hidden = false;
              interactPromptEl.textContent = "[E] Levantar";
            } else {
              interactPromptEl.hidden = true;
            }
          }
          if (crosshairEl) {
            crosshairEl.classList.toggle("active", Boolean(aimedTarget));
            crosshairEl.hidden = chatOpen || escMenuOpen || cameraCtrl.tvCloseup || speakerFocusActive;
          }
          if (chaletLockHint) {
            chaletLockHint.hidden = cameraCtrl.pointerLocked || chatOpen || escMenuOpen || speakerFocusActive;
          }
        }

        var aw = sceneArea.clientWidth, ah = sceneArea.clientHeight, tvCloseup = cameraCtrl.tvCloseup;
        var aimedAgentId = aimedTarget && aimedTarget.kind === "agent" ? aimedTarget.agent.id : null;
        posicionarRotulos(T, agentList, selectedIdx, camera, aw, ah, tvCloseup, pulpitSpeakerId, simTime, el, isChalet, aimedAgentId, operadores.listRemotes(), speakerFocusActive);

        // Projeta a Smart TV 3D interativa somente quando em close na TV
        var showTvOverlay = false;
        if (tvScreenMesh && tvCloseup) {
          tvScreenMesh.updateWorldMatrix(true, false);
          var corners = [
            new T.Vector3(-2.48, -1.39, 0.02),
            new T.Vector3(2.48, -1.39, 0.02),
            new T.Vector3(-2.48, 1.39, 0.02),
            new T.Vector3(2.48, 1.39, 0.02)
          ];
          var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = false;
          corners.forEach(function (c) {
            c.applyMatrix4(tvScreenMesh.matrixWorld).project(camera);
            if (c.z > 1 || c.z < -1) behind = true;
            var px = (c.x * 0.5 + 0.5) * aw, py = (-c.y * 0.5 + 0.5) * ah;
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
          });
          if (!behind) {
            showTvOverlay = true;
            var w = Math.max(360, Math.min(aw - 40, Math.max(540, maxX - minX)));
            var h = Math.max(280, Math.min(ah - 60, Math.max(360, maxY - minY)));
            var cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
            tvOsEl.hidden = false;
            tvOsEl.classList.remove("aa-tv-minimized");
            tvOsEl.style.left = Math.round(Math.max(20, Math.min(aw - w - 20, cx - w * 0.5))) + "px";
            tvOsEl.style.top = Math.round(Math.max(48, Math.min(ah - h - 20, cy - h * 0.5))) + "px";
            tvOsEl.style.width = Math.round(w) + "px";
            tvOsEl.style.height = Math.round(h) + "px";
          }
        }
        if (!showTvOverlay) {
          if (hasActiveVideo) {
            tvOsEl.hidden = false;
            tvOsEl.classList.add("aa-tv-minimized");
          } else {
            tvOsEl.hidden = true;
            tvOsEl.classList.remove("aa-tv-minimized");
          }
        }
        renderer.render(scene, camera);
      }

      function previewSpeaker(idx, text, queueExtras) {
        var ag = agentList[idx || 0];
        if (!ag) return false;
        pulpitSpeakerId = ag.id;
        ag.closedKey = "";
        ag.state = "speak";
        if (Array.isArray(queueExtras)) {
          speechQueue = queueExtras.map(function (it, qi) {
            var ta = agentList[it.idx || 0];
            return ta ? { agentId: ta.id, text: it.text || "", msgId: "preview-" + qi } : null;
          }).filter(Boolean);
        }
        setBubble(ag, text || "Olá! Bem-vindo ao Chalé 3D da Estação-ai.", true);
        return true;
      }

      syncData(liveData);
      loop();

      var api = {
        sync: syncData,
        destroy: destroy,
        el: root,
        moveAgentsToZone: moveAgentsToZone,
        operadores: operadores,
        nostr: nostrClient,
        setPose: cameraCtrl.setPose,
        setTimeOfDay: setTimeOfDayUI,
        setOperatorBreed: setOperatorBreedUI,
        registerSkipVote: registerSkipVote,
        previewSpeaker: previewSpeaker
      };
      if (isChalet) window.EstacaoChalet = api;
      return api;
    }
  };
})();
