// Visualizador neural interativo do Grafo de Conhecimento (inspirado no Obsidian).
// Lê os nós e sinapses autorizados do SVG SSR (#estacao-grafo-svg) e renderiza um
// canvas HiDPI com física force-directed, zoom/pan, foco por vizinhança, busca,
// filtros de categoria, inspetor lateral e modo expandido em tela cheia.

(function () {
  const svg = document.getElementById("estacao-grafo-svg");
  const container = document.getElementById("estacao-grafo-container");
  const mount = document.getElementById("estacao-grafo-neural");
  if (!svg || !container || !mount) return;

  function safeHref(raw) {
    if (typeof raw !== "string") return "#";
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "#") return "#";
    try {
      const url = new URL(trimmed, document.baseURI);
      if (url.origin === window.location.origin && (url.protocol === "http:" || url.protocol === "https:")) {
        const rel = url.pathname + url.search + url.hash;
        return rel.startsWith("/") ? rel : "#";
      }
    } catch (_) {}
    return "#";
  }

  const rawNodes = Array.from(svg.querySelectorAll("g[data-idx]")).map((g, pos) => {
    const idx = Number.parseInt(g.getAttribute("data-idx") || String(pos), 10);
    const label = g.getAttribute("data-label") || (g.textContent || "").trim();
    const tooltip = g.getAttribute("data-tooltip") || label;
    const href = safeHref(g.getAttribute("data-href") || "#");
    const color = g.getAttribute("data-color") || "#3b82f6";
    const kind = g.getAttribute("data-kind") || "Nó";
    return {
      idx: Number.isFinite(idx) ? idx : pos,
      label,
      tooltip,
      href,
      color,
      kind,
      degree: 0,
      neighbors: new Set(),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    };
  });

  if (!rawNodes.length) return;

  const nodeByIdx = new Map();
  for (const n of rawNodes) nodeByIdx.set(n.idx, n);

  const edges = [];
  const edgeKeys = new Set();
  for (const line of svg.querySelectorAll("line[data-from][data-to]")) {
    const fromIdx = Number.parseInt(line.getAttribute("data-from") || "-1", 10);
    const toIdx = Number.parseInt(line.getAttribute("data-to") || "-1", 10);
    if (!nodeByIdx.has(fromIdx) || !nodeByIdx.has(toIdx) || fromIdx === toIdx) continue;
    const a = Math.min(fromIdx, toIdx);
    const b = Math.max(fromIdx, toIdx);
    const key = `${a}:${b}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const na = nodeByIdx.get(fromIdx);
    const nb = nodeByIdx.get(toIdx);
    na.degree += 1;
    nb.degree += 1;
    na.neighbors.add(nb.idx);
    nb.neighbors.add(na.idx);
    edges.push({ from: na, to: nb });
  }

  svg.style.display = "none";
  svg.setAttribute("aria-hidden", "true");
  const staticLegend = document.getElementById("estacao-grafo-static-legend");
  if (staticLegend) staticLegend.style.display = "none";

  injectStyles();

  const kindsOrder = [];
  const kindsSet = new Set();
  for (const n of rawNodes) {
    if (!kindsSet.has(n.kind)) {
      kindsSet.add(n.kind);
      kindsOrder.push({ kind: n.kind, color: n.color });
    }
  }

  const state = {
    expanded: false,
    paused: false,
    showAllLabels: false,
    settingsOpen: false,
    repulsion: 5200,
    linkDist: 130,
    nodeScale: 1.0,
    query: "",
    activeKinds: new Set(kindsOrder.map((k) => k.kind)),
    hoverIdx: null,
    selectedIdx: null,
    camX: 0,
    camY: 0,
    zoom: 1,
    draggingNode: null,
    panning: false,
    panStartX: 0,
    panStartY: 0,
    camStartX: 0,
    camStartY: 0,
    dragMoved: false,
    pulsePhase: 0,
    rafId: 0,
    energy: 1.0,
    width: 800,
    height: 520,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };

  function seedLayout(spread) {
    const groups = new Map();
    kindsOrder.forEach((k, gi) => groups.set(k.kind, gi));
    const totalGroups = Math.max(1, kindsOrder.length);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const sorted = rawNodes.slice().sort((a, b) => b.degree - a.degree || a.idx - b.idx);
    sorted.forEach((node, rank) => {
      const gi = groups.get(node.kind) || 0;
      const clusterAngle = (gi / totalGroups) * Math.PI * 2;
      const clusterR = totalGroups > 1 ? spread * 0.24 : 0;
      const cx = Math.cos(clusterAngle) * clusterR;
      const cy = Math.sin(clusterAngle) * clusterR;
      const localR = (28 + Math.sqrt(rank + 1) * (spread * 0.14)) * (node.degree > 2 ? 0.65 : 1.0);
      const theta = rank * goldenAngle + gi * 0.7;
      node.x = cx + Math.cos(theta) * localR;
      node.y = cy + Math.sin(theta) * localR;
      node.vx = 0;
      node.vy = 0;
    });
    state.energy = 1.0;
  }

  seedLayout(240);

  // Construção da UI do palco neural
  const shell = el("div", "eg-shell");
  const toolbar = el("div", "eg-toolbar");
  const leftTools = el("div", "eg-tools-group");
  const rightTools = el("div", "eg-tools-group");

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Filtrar neurônios…";
  searchInput.className = "eg-search";
  searchInput.setAttribute("aria-label", "Buscar nó no grafo");

  const statsBadge = el("span", "eg-stats");
  statsBadge.textContent = `${rawNodes.length} nós · ${edges.length} sinapses`;

  const btnZoomOut = toolBtn("−", "Diminuir zoom", () => zoomBy(0.82));
  const btnZoomReset = toolBtn("⌖ Ajustar", "Ajustar todo o grafo à janela", () => fitView(true));
  const btnZoomIn = toolBtn("+", "Aumentar zoom", () => zoomBy(1.22));
  const btnReorg = toolBtn("↻ Reorganizar", "Redistribuir nós no espaço neural", () => {
    state.paused = false;
    btnPause.textContent = "⏸ Pausar";
    seedLayout(state.expanded ? 380 : 250);
    fitView(false);
  });
  const btnPause = toolBtn("⏸ Pausar", "Pausar ou retomar a simulação neural", () => {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? "▶ Animar" : "⏸ Pausar";
    if (!state.paused) state.energy = Math.max(state.energy, 0.45);
  });
  const btnConfig = toolBtn("⚙ Ajustar", "Parâmetros da simulação Obsidian", () => {
    state.settingsOpen = !state.settingsOpen;
    settingsPop.hidden = !state.settingsOpen;
    btnConfig.setAttribute("aria-expanded", String(state.settingsOpen));
  });
  btnConfig.setAttribute("aria-expanded", "false");

  const btnExpand = document.createElement("button");
  btnExpand.type = "button";
  btnExpand.className = "eg-btn eg-btn-primary";
  btnExpand.textContent = "⛶ Expandir grafo";
  btnExpand.title = "Expandir visualizador neural em tela cheia (F)";
  btnExpand.addEventListener("click", () => toggleExpanded());

  leftTools.append(searchInput, statsBadge);
  rightTools.append(btnZoomOut, btnZoomReset, btnZoomIn, btnReorg, btnPause, btnConfig, btnExpand);
  toolbar.append(leftTools, rightTools);

  // Barra de legenda/filtros por categoria
  const legendBar = el("div", "eg-legend");
  const kindButtons = new Map();
  for (const item of kindsOrder) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "eg-chip active";
    const dot = el("span", "eg-chip-dot");
    dot.style.background = item.color;
    chip.append(dot, document.createTextNode(item.kind));
    chip.addEventListener("click", () => {
      if (state.activeKinds.has(item.kind)) {
        if (state.activeKinds.size > 1) state.activeKinds.delete(item.kind);
      } else {
        state.activeKinds.add(item.kind);
      }
      for (const [k, b] of kindButtons) {
        b.classList.toggle("active", state.activeKinds.has(k));
      }
      state.energy = Math.max(state.energy, 0.35);
      updateVisibilityStats();
    });
    kindButtons.set(item.kind, chip);
    legendBar.append(chip);
  }

  // Área principal (Canvas + Popover de Física + Painel Inspetor lateral)
  const stageWrap = el("div", "eg-stage-wrap");
  const canvasWrap = el("div", "eg-canvas-wrap");
  const canvas = document.createElement("canvas");
  canvas.className = "eg-canvas";
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Visualizador neural interativo do grafo de conhecimento");

  const hintBar = el("div", "eg-hint");
  hintBar.textContent = "Arraste nós ou o fundo · Roda para zoom · Clique para fixar sinapses · Duplo clique para abrir";

  // Popover Obsidian Graph Settings
  const settingsPop = el("div", "eg-settings");
  settingsPop.hidden = true;
  settingsPop.append(
    makeSlider("Repulsão neural", 1500, 14000, 250, state.repulsion, (v) => {
      state.repulsion = v;
      state.energy = 0.7;
    }),
    makeSlider("Distância das sinapses", 60, 280, 10, state.linkDist, (v) => {
      state.linkDist = v;
      state.energy = 0.7;
    }),
    makeSlider("Tamanho dos nós", 0.7, 1.8, 0.1, state.nodeScale, (v) => {
      state.nodeScale = v;
    }),
    makeToggle("Sempre mostrar rótulos", state.showAllLabels, (checked) => {
      state.showAllLabels = checked;
    })
  );

  canvasWrap.append(canvas, settingsPop, hintBar);

  // Painel inspetor lateral (aparece no hover/seleção e fica fixo quando expandido)
  const inspector = el("aside", "eg-inspector");
  inspector.hidden = true;
  stageWrap.append(canvasWrap, inspector);

  shell.append(toolbar, legendBar, stageWrap);
  mount.replaceChildren(shell);

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim().toLowerCase();
    updateVisibilityStats();
    if (state.query) {
      const first = rawNodes.find(
        (n) => isNodeVisible(n) && (n.label.toLowerCase().includes(state.query) || n.tooltip.toLowerCase().includes(state.query))
      );
      if (first) {
        state.selectedIdx = first.idx;
        renderInspector();
      }
    }
  });

  function isDarkMode() {
    return document.documentElement.classList.contains("dark");
  }

  function isNodeVisible(node) {
    if (!state.activeKinds.has(node.kind)) return false;
    return true;
  }

  function matchesQuery(node) {
    if (!state.query) return true;
    return node.label.toLowerCase().includes(state.query) || node.tooltip.toLowerCase().includes(state.query);
  }

  function updateVisibilityStats() {
    const visNodes = rawNodes.filter((n) => isNodeVisible(n) && matchesQuery(n));
    const visSet = new Set(visNodes.map((n) => n.idx));
    const visEdges = edges.filter((e) => visSet.has(e.from.idx) && visSet.has(e.to.idx));
    statsBadge.textContent = `${visNodes.length} nó(s) · ${visEdges.length} sinapse(s)`;
  }

  function nodeRadius(node) {
    const base = (4.8 + Math.min(11.5, Math.sqrt(node.degree) * 4.2)) * state.nodeScale;
    const focus = state.hoverIdx === node.idx || state.selectedIdx === node.idx;
    return focus ? base + 2.5 : base;
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - state.width / 2) / state.zoom + state.camX,
      y: (sy - state.height / 2) / state.zoom + state.camY,
    };
  }

  function worldToScreen(wx, wy) {
    return {
      x: (wx - state.camX) * state.zoom + state.width / 2,
      y: (wy - state.camY) * state.zoom + state.height / 2,
    };
  }

  function resizeCanvas() {
    const rect = canvasWrap.getBoundingClientRect();
    state.width = Math.max(320, Math.floor(rect.width));
    state.height = Math.max(320, Math.floor(rect.height));
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
  }

  function zoomBy(factor, clientX, clientY) {
    const prevZoom = state.zoom;
    const nextZoom = Math.min(3.8, Math.max(0.22, prevZoom * factor));
    if (clientX !== undefined && clientY !== undefined) {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const before = screenToWorld(sx, sy);
      state.zoom = nextZoom;
      const after = screenToWorld(sx, sy);
      state.camX += before.x - after.x;
      state.camY += before.y - after.y;
    } else {
      state.zoom = nextZoom;
    }
  }

  function fitView(animateCenter) {
    const vis = rawNodes.filter(isNodeVisible);
    if (!vis.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of vis) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const spanX = Math.max(160, maxX - minX + 140);
    const spanY = Math.max(160, maxY - minY + 140);
    const padRatio = state.expanded ? 0.84 : 0.88;
    const scale = Math.min((state.width * padRatio) / spanX, (state.height * padRatio) / spanY);
    state.zoom = Math.min(1.65, Math.max(0.32, scale));
    if (animateCenter !== false) {
      state.camX = (minX + maxX) / 2;
      state.camY = (minY + maxY) / 2;
    }
  }

  function toggleExpanded(forceValue) {
    const next = forceValue !== undefined ? Boolean(forceValue) : !state.expanded;
    if (next === state.expanded) return;
    state.expanded = next;
    shell.classList.toggle("eg-expanded", next);
    document.body.classList.toggle("eg-lock-scroll", next);
    btnExpand.textContent = next ? "✕ Reduzir" : "⛶ Expandir grafo";
    btnExpand.title = next ? "Voltar ao tamanho normal (Esc)" : "Expandir visualizador neural em tela cheia (F)";

    if (next) {
      state.repulsion = Math.max(state.repulsion, 7800);
      state.linkDist = Math.max(state.linkDist, 165);
    } else {
      state.repulsion = Math.min(state.repulsion, 5200);
      state.linkDist = Math.min(state.linkDist, 130);
    }
    state.energy = Math.max(state.energy, 0.6);

    requestAnimationFrame(() => {
      resizeCanvas();
      for (let i = 0; i < 24; i++) stepPhysics(1.0);
      fitView(true);
      renderInspector();
    });
  }

  function findNodeAtScreen(sx, sy) {
    const world = screenToWorld(sx, sy);
    let best = null;
    let bestDist = Infinity;
    for (let i = rawNodes.length - 1; i >= 0; i--) {
      const n = rawNodes[i];
      if (!isNodeVisible(n)) continue;
      const r = nodeRadius(n) + 7 / Math.max(0.4, state.zoom);
      const dx = world.x - n.x;
      const dy = world.y - n.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= r && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    return best;
  }

  // Eventos do Canvas (Pan, Drag, Zoom, Clique, Duplo clique)
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.12 : 0.89;
    zoomBy(factor, ev.clientX, ev.clientY);
  }, { passive: false });

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    canvas.setPointerCapture(ev.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const hit = findNodeAtScreen(sx, sy);
    state.dragMoved = false;
    state.panStartX = ev.clientX;
    state.panStartY = ev.clientY;

    if (hit) {
      state.draggingNode = hit;
      hit.fx = hit.x;
      hit.fy = hit.y;
      state.energy = Math.max(state.energy, 0.55);
      canvas.style.cursor = "grabbing";
    } else {
      state.panning = true;
      state.camStartX = state.camX;
      state.camStartY = state.camY;
      canvas.style.cursor = "grabbing";
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const distMoved = Math.hypot(ev.clientX - state.panStartX, ev.clientY - state.panStartY);
    if (distMoved > 3) state.dragMoved = true;

    if (state.draggingNode) {
      const w = screenToWorld(sx, sy);
      state.draggingNode.fx = w.x;
      state.draggingNode.fy = w.y;
      state.draggingNode.x = w.x;
      state.draggingNode.y = w.y;
      state.energy = Math.max(state.energy, 0.55);
      return;
    }

    if (state.panning) {
      state.camX = state.camStartX - (ev.clientX - state.panStartX) / state.zoom;
      state.camY = state.camStartY - (ev.clientY - state.panStartY) / state.zoom;
      return;
    }

    const hit = findNodeAtScreen(sx, sy);
    const nextHover = hit ? hit.idx : null;
    if (nextHover !== state.hoverIdx) {
      state.hoverIdx = nextHover;
      canvas.style.cursor = hit ? "pointer" : "grab";
    }
  });

  function endPointer(ev) {
    if (canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    if (state.draggingNode) {
      state.draggingNode.fx = null;
      state.draggingNode.fy = null;
      if (!state.dragMoved) {
        state.selectedIdx = state.selectedIdx === state.draggingNode.idx ? null : state.draggingNode.idx;
        renderInspector();
      }
      state.draggingNode = null;
    } else if (state.panning) {
      if (!state.dragMoved) {
        const hit = findNodeAtScreen(sx, sy);
        state.selectedIdx = hit ? hit.idx : null;
        renderInspector();
      }
      state.panning = false;
    }
    canvas.style.cursor = state.hoverIdx !== null ? "pointer" : "grab";
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("dblclick", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const hit = findNodeAtScreen(ev.clientX - rect.left, ev.clientY - rect.top);
    const target = hit ? safeHref(hit.href) : "#";
    if (target !== "#") {
      window.location.assign(target);
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (state.settingsOpen) {
        state.settingsOpen = false;
        settingsPop.hidden = true;
      } else if (state.expanded) {
        toggleExpanded(false);
      } else if (state.selectedIdx !== null) {
        state.selectedIdx = null;
        renderInspector();
      }
    } else if ((ev.key === "f" || ev.key === "F") && document.activeElement !== searchInput && !ev.ctrlKey && !ev.metaKey) {
      toggleExpanded();
    }
  });

  function renderInspector() {
    const node = state.selectedIdx !== null ? nodeByIdx.get(state.selectedIdx) : null;
    if (!node) {
      inspector.hidden = !state.expanded;
      if (state.expanded) {
        inspector.replaceChildren(
          el("div", "eg-insp-empty", "Clique em um neurônio para inspecionar conexões, navegar pelos vizinhos ou abrir a página correspondente.")
        );
      }
      return;
    }

    inspector.hidden = false;
    const head = el("div", "eg-insp-head");
    const badge = el("span", "eg-chip active");
    const dot = el("span", "eg-chip-dot");
    dot.style.background = node.color;
    badge.append(dot, document.createTextNode(node.kind));

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "eg-btn";
    closeBtn.textContent = "✕";
    closeBtn.title = "Fechar seleção";
    closeBtn.addEventListener("click", () => {
      state.selectedIdx = null;
      renderInspector();
    });
    head.append(badge, closeBtn);

    const titleEl = el("h3", "eg-insp-title", node.label);
    const detailEl = el("p", "eg-insp-desc", node.tooltip);
    const countEl = el("div", "eg-insp-meta", `${node.neighbors.size} sinapse(s) direta(s)`);

    const openLink = document.createElement("button");
    openLink.type = "button";
    openLink.className = "eg-btn eg-btn-primary eg-insp-open";
    openLink.textContent = "Abrir página / item ↗";
    const safeUrl = safeHref(node.href);
    openLink.disabled = safeUrl === "#";
    openLink.addEventListener("click", () => {
      if (safeUrl.startsWith("/")) {
        window.location.assign(safeUrl);
      }
    });

    const listWrap = el("div", "eg-insp-links");
    const listTitle = el("div", "eg-insp-subtitle", "Conexões diretas");
    listWrap.append(listTitle);

    const neighborNodes = Array.from(node.neighbors)
      .map((id) => nodeByIdx.get(id))
      .filter((nb) => nb && isNodeVisible(nb))
      .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));

    if (!neighborNodes.length) {
      listWrap.append(el("p", "eg-insp-desc", "Nenhuma conexão visível neste filtro."));
    } else {
      for (const nb of neighborNodes.slice(0, 40)) {
        const nbBtn = document.createElement("button");
        nbBtn.type = "button";
        nbBtn.className = "eg-insp-neighbor";
        const ndot = el("span", "eg-chip-dot");
        ndot.style.background = nb.color;
        const ntext = el("span", "eg-insp-neighbor-text", nb.label);
        const nkind = el("span", "eg-insp-neighbor-kind", nb.kind);
        nbBtn.append(ndot, ntext, nkind);
        nbBtn.addEventListener("click", () => {
          state.selectedIdx = nb.idx;
          state.camX = nb.x;
          state.camY = nb.y;
          state.zoom = Math.max(state.zoom, 1.15);
          renderInspector();
        });
        listWrap.append(nbBtn);
      }
    }

    inspector.replaceChildren(head, titleEl, detailEl, countEl, openLink, listWrap);
  }

  // Simulação Force-Directed Neural (repulsão + mola + gravidade central + anti-colisão)
  function stepPhysics(alphaOverride) {
    if (state.paused && alphaOverride === undefined) return;
    const vis = rawNodes.filter(isNodeVisible);
    const nCount = vis.length;
    if (!nCount) return;

    const alpha = alphaOverride !== undefined ? alphaOverride : state.energy;
    if (alpha < 0.015 && !state.draggingNode) return;

    const rep = state.repulsion;
    const len = state.linkDist;

    // 1. Repulsão entre nós (garante respiração no visual neural)
    for (let i = 0; i < nCount; i++) {
      const a = vis[i];
      for (let j = i + 1; j < nCount; j++) {
        const b = vis[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          d2 = dx * dx + dy * dy + 1;
        }
        const dist = Math.sqrt(d2);
        const minGap = (nodeRadius(a) + nodeRadius(b) + 26);
        let force = (rep / d2) * alpha;
        if (dist < minGap) {
          force += (minGap - dist) * 0.45 * alpha;
        }
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 2. Mola sináptica nas arestas visíveis
    for (const e of edges) {
      if (!isNodeVisible(e.from) || !isNodeVisible(e.to)) continue;
      const dx = e.to.x - e.from.x;
      const dy = e.to.y - e.from.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const stretch = dist - len;
      const k = 0.045 * alpha;
      const fx = (dx / dist) * stretch * k;
      const fy = (dy / dist) * stretch * k;
      e.from.vx += fx;
      e.from.vy += fy;
      e.to.vx -= fx;
      e.to.vy -= fy;
    }

    // 3. Gravidade central leve + atrito
    const gravity = 0.018 * alpha;
    for (const n of vis) {
      if (n.fx !== null && n.fy !== null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx -= n.x * gravity;
      n.vy -= n.y * gravity;
      n.vx *= 0.84;
      n.vy *= 0.84;
      const maxVel = 18;
      const vMag = Math.hypot(n.vx, n.vy);
      if (vMag > maxVel) {
        n.vx = (n.vx / vMag) * maxVel;
        n.vy = (n.vy / vMag) * maxVel;
      }
      n.x += n.vx;
      n.y += n.vy;
    }

    if (alphaOverride === undefined) {
      state.energy = Math.max(0.08, state.energy * 0.992);
    }
  }

  function boxesOverlap(a, b) {
    return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
  }

  function draw() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dark = isDarkMode();

    ctx.save();
    ctx.scale(state.dpr, state.dpr);

    // Fundo neural estilo Obsidian
    if (dark) {
      const bg = ctx.createRadialGradient(
        state.width * 0.5,
        state.height * 0.45,
        40,
        state.width * 0.5,
        state.height * 0.5,
        Math.max(state.width, state.height) * 0.78
      );
      bg.addColorStop(0, "#11182c");
      bg.addColorStop(1, "#070a12");
      ctx.fillStyle = bg;
    } else {
      const bg = ctx.createRadialGradient(
        state.width * 0.5,
        state.height * 0.45,
        40,
        state.width * 0.5,
        state.height * 0.5,
        Math.max(state.width, state.height) * 0.78
      );
      bg.addColorStop(0, "#ffffff");
      bg.addColorStop(1, "#eef2f8");
      ctx.fillStyle = bg;
    }
    ctx.fillRect(0, 0, state.width, state.height);

    // Grade pontilhada sutil que se move com pan/zoom
    drawDotGrid(ctx, dark);

    const focusIdx = state.hoverIdx !== null ? state.hoverIdx : state.selectedIdx;
    const focusNode = focusIdx !== null ? nodeByIdx.get(focusIdx) : null;
    const hasSearch = Boolean(state.query);

    // 1. Arestas / Sinapses
    for (const e of edges) {
      if (!isNodeVisible(e.from) || !isNodeVisible(e.to)) continue;
      const p1 = worldToScreen(e.from.x, e.from.y);
      const p2 = worldToScreen(e.to.x, e.to.y);

      const connectedToFocus =
        focusNode && (e.from.idx === focusNode.idx || e.to.idx === focusNode.idx);
      const queryMatch =
        !hasSearch || matchesQuery(e.from) || matchesQuery(e.to);

      let alpha = dark ? 0.24 : 0.22;
      let width = 1.15;
      if (focusNode) {
        alpha = connectedToFocus ? 0.85 : 0.06;
        width = connectedToFocus ? 2.1 : 0.9;
      } else if (hasSearch) {
        alpha = queryMatch ? 0.65 : 0.06;
        width = queryMatch ? 1.8 : 0.9;
      }

      ctx.beginPath();
      const mx = (p1.x + p2.x) * 0.5;
      const my = (p1.y + p2.y) * 0.5;
      const nx = -(p2.y - p1.y) * 0.06;
      const ny = (p2.x - p1.x) * 0.06;
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mx + nx, my + ny, p2.x, p2.y);

      if (connectedToFocus && focusNode) {
        const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        grad.addColorStop(0, e.from.color);
        grad.addColorStop(1, e.to.color);
        ctx.strokeStyle = grad;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();

        // Impulso sináptico percorrendo a ligação ativa
        const t = (state.pulsePhase + ((e.from.idx + e.to.idx) % 7) * 0.14) % 1;
        const it = 1 - t;
        const px = it * it * p1.x + 2 * it * t * (mx + nx) + t * t * p2.x;
        const py = it * it * p1.y + 2 * it * t * (my + ny) + t * t * p2.y;
        ctx.beginPath();
        ctx.arc(px, py, 2.3, 0, Math.PI * 2);
        ctx.fillStyle = dark ? "#e2e8f0" : "#1e293b";
        ctx.globalAlpha = 0.85;
        ctx.fill();
      } else {
        ctx.strokeStyle = dark ? "#94a3b8" : "#64748b";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;

    // 2. Neurônios (Nós)
    const visibleNodes = rawNodes.filter(isNodeVisible);
    for (const n of visibleNodes) {
      const p = worldToScreen(n.x, n.y);
      const r = nodeRadius(n) * Math.min(1.45, Math.max(0.65, Math.sqrt(state.zoom)));
      const isFocused = focusNode && n.idx === focusNode.idx;
      const isNeighbor = focusNode && focusNode.neighbors.has(n.idx);
      const isQueryHit = hasSearch && matchesQuery(n);

      let nodeAlpha = 1.0;
      if (focusNode && !isFocused && !isNeighbor) nodeAlpha = 0.16;
      else if (hasSearch && !isQueryHit && (!focusNode || (!isFocused && !isNeighbor))) nodeAlpha = 0.16;

      ctx.globalAlpha = nodeAlpha;

      // Halo neural (soma glow) para hubs, nó em foco ou resultado de busca
      if (isFocused || isNeighbor || isQueryHit || n.degree >= 3) {
        const haloR = r * (isFocused ? 2.8 : 2.1);
        const glow = ctx.createRadialGradient(p.x, p.y, r * 0.25, p.x, p.y, haloR);
        glow.addColorStop(0, n.color);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.globalAlpha = nodeAlpha * (isFocused ? 0.48 : 0.22);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Núcleo do neurônio
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();

      ctx.lineWidth = isFocused ? 2.5 : 1.4;
      ctx.strokeStyle = isFocused
        ? (dark ? "#ffffff" : "#0f172a")
        : (dark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.95)");
      ctx.stroke();
    }

    // 3. Rótulos inteligentes anti-colisão
    const labelPriority = visibleNodes.slice().sort((a, b) => {
      const score = (node) => {
        if (focusNode && node.idx === focusNode.idx) return 10000;
        if (hasSearch && matchesQuery(node)) return 5000 + node.degree;
        if (focusNode && focusNode.neighbors.has(node.idx)) return 3000 + node.degree;
        return node.degree * 10;
      };
      return score(b) - score(a);
    });

    const placedBoxes = [];
    const maxLabels = state.showAllLabels
      ? labelPriority.length
      : state.expanded
        ? 90
        : Math.max(12, Math.floor(28 * state.zoom));

    const fontPx = state.expanded ? 12 : 11;
    ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "middle";

    let drawnLabels = 0;
    for (const n of labelPriority) {
      if (drawnLabels >= maxLabels) break;
      const isFocused = focusNode && n.idx === focusNode.idx;
      const isNeighbor = focusNode && focusNode.neighbors.has(n.idx);
      const isQueryHit = hasSearch && matchesQuery(n);

      // No zoom distante, oculta folhas isoladas exceto foco/vizinhos/busca ou toggle explícito
      if (!state.showAllLabels && !isFocused && !isNeighbor && !isQueryHit && state.zoom < 0.7 && n.degree === 0) {
        continue;
      }

      let labelAlpha = 0.94;
      if (focusNode && !isFocused && !isNeighbor) labelAlpha = 0.14;
      else if (hasSearch && !isQueryHit && !isFocused && !isNeighbor) labelAlpha = 0.14;

      const p = worldToScreen(n.x, n.y);
      const r = nodeRadius(n) * Math.min(1.45, Math.max(0.65, Math.sqrt(state.zoom)));
      if (p.x < -80 || p.x > state.width + 80 || p.y < -40 || p.y > state.height + 40) continue;

      const text = n.label;
      const textW = ctx.measureText(text).width;
      const padX = 6;
      const boxW = textW + padX * 2;
      const boxH = fontPx + 7;
      const bx = p.x - boxW / 2;
      const by = p.y + r + 5;
      const rect = { x1: bx - 3, y1: by - 2, x2: bx + boxW + 3, y2: by + boxH + 2 };

      if (!isFocused && placedBoxes.some((prev) => boxesOverlap(rect, prev))) {
        continue;
      }
      placedBoxes.push(rect);
      drawnLabels += 1;

      ctx.save();
      ctx.globalAlpha = labelAlpha;
      roundRect(ctx, bx, by, boxW, boxH, 5);
      ctx.fillStyle = dark ? "rgba(9, 13, 22, 0.84)" : "rgba(255, 255, 255, 0.90)";
      ctx.fill();
      if (isFocused || isQueryHit) {
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = dark ? "#e2e8f0" : "#0f172a";
      ctx.fillText(text, bx + padX, by + boxH / 2 + 0.5);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawDotGrid(ctx, dark) {
    const step = 36 * Math.min(2, Math.max(0.5, state.zoom));
    const offsetX = ((-state.camX * state.zoom + state.width / 2) % step + step) % step;
    const offsetY = ((-state.camY * state.zoom + state.height / 2) % step + step) % step;
    ctx.fillStyle = dark ? "rgba(148, 163, 184, 0.14)" : "rgba(100, 116, 139, 0.16)";
    for (let x = offsetX; x < state.width; x += step) {
      for (let y = offsetY; y < state.height; y += step) {
        ctx.fillRect(x, y, 1.3, 1.3);
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loop() {
    state.pulsePhase = (state.pulsePhase + 0.012) % 1;
    stepPhysics();
    draw();
    state.rafId = requestAnimationFrame(loop);
  }

  // Pré-estabiliza a rede neural antes do primeiro quadro
  resizeCanvas();
  for (let i = 0; i < 65; i++) stepPhysics(0.85);
  fitView(true);
  updateVisibilityStats();
  loop();

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(canvasWrap);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function toolBtn(text, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "eg-btn";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function makeSlider(label, min, max, step, val, onInput) {
    const row = el("label", "eg-setting-row");
    const top = el("div", "eg-setting-top");
    const spanL = el("span", "", label);
    const spanV = el("span", "eg-setting-val", String(val));
    top.append(spanL, spanV);
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(val);
    inp.addEventListener("input", () => {
      const num = Number.parseFloat(inp.value);
      spanV.textContent = String(num);
      onInput(num);
    });
    row.append(top, inp);
    return row;
  }

  function makeToggle(label, checked, onChange) {
    const row = el("label", "eg-setting-check");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => onChange(cb.checked));
    row.append(cb, el("span", "", label));
    return row;
  }

  function injectStyles() {
    if (document.getElementById("estacao-grafo-styles")) return;
    const style = document.createElement("style");
    style.id = "estacao-grafo-styles";
    style.textContent = `
      body.eg-lock-scroll { overflow: hidden !important; }
      .eg-shell { display: flex; flex-direction: column; gap: 10px; }
      .eg-shell.eg-expanded {
        position: fixed; inset: 0; z-index: 90; padding: 14px 18px;
        background: var(--dash-bg, #090d16); height: 100vh; width: 100vw;
      }
      .eg-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
      .eg-tools-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .eg-search {
        min-width: 190px; padding: 6px 10px; border-radius: 8px; font-size: 13px;
        border: 1px solid rgba(148,163,184,0.35); background: transparent; color: inherit;
      }
      .eg-stats { font-size: 12px; opacity: 0.72; padding: 0 6px; }
      .eg-btn {
        display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 8px;
        border: 1px solid rgba(148,163,184,0.32); background: rgba(148,163,184,0.08);
        color: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: none;
      }
      .eg-btn:hover { background: rgba(148,163,184,0.18); }
      .eg-btn-primary {
        background: #2563eb; border-color: #2563eb; color: #ffffff;
      }
      .eg-btn-primary:hover { background: #1d4ed8; }
      .eg-legend { display: flex; flex-wrap: wrap; gap: 6px; }
      .eg-chip {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
        border: 1px solid rgba(148,163,184,0.3); font-size: 12px; cursor: pointer; opacity: 0.45;
        background: transparent; color: inherit; transition: opacity .15s, border-color .15s;
      }
      .eg-chip.active { opacity: 1; border-color: rgba(148,163,184,0.55); background: rgba(148,163,184,0.09); }
      .eg-chip-dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; flex-shrink: 0; }
      .eg-stage-wrap {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; min-height: 520px; align-items: stretch;
      }
      .eg-expanded .eg-stage-wrap { flex: 1; min-height: 0; height: 100%; }
      .eg-canvas-wrap {
        position: relative; min-height: 520px; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(148,163,184,0.25);
      }
      .eg-expanded .eg-canvas-wrap { min-height: 0; height: 100%; }
      .eg-canvas { display: block; width: 100%; height: 100%; touch-action: none; }
      .eg-hint {
        position: absolute; left: 12px; bottom: 10px; padding: 4px 10px; border-radius: 999px;
        font-size: 11px; pointer-events: none; background: rgba(15,23,42,0.68); color: #cbd5e1;
      }
      .eg-settings {
        position: absolute; top: 10px; right: 10px; width: 240px; padding: 12px; border-radius: 10px;
        border: 1px solid rgba(148,163,184,0.3); background: rgba(15,23,42,0.92); color: #f1f5f9;
        display: flex; flex-direction: column; gap: 10px; z-index: 5; backdrop-filter: blur(8px);
      }
      .eg-settings[hidden] { display: none; }
      .eg-setting-row { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
      .eg-setting-top { display: flex; justify-content: space-between; opacity: 0.9; }
      .eg-setting-val { font-variant-numeric: tabular-nums; opacity: 0.75; }
      .eg-setting-check { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
      .eg-inspector {
        width: 280px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.28);
        padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 600px;
        background: rgba(148,163,184,0.06);
      }
      .eg-expanded .eg-inspector { max-height: none; width: 320px; }
      .eg-inspector[hidden] { display: none; }
      .eg-insp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .eg-insp-title { font-size: 15px; font-weight: 700; line-height: 1.3; margin: 0; word-break: break-word; }
      .eg-insp-desc { font-size: 12.5px; opacity: 0.78; margin: 0; line-height: 1.4; word-break: break-word; }
      .eg-insp-meta { font-size: 12px; font-weight: 600; opacity: 0.85; }
      .eg-insp-open { justify-content: center; }
      .eg-insp-subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: 0.65; font-weight: 700; margin-top: 4px; }
      .eg-insp-links { display: flex; flex-direction: column; gap: 5px; }
      .eg-insp-neighbor {
        display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 8px; text-align: left;
        border: 1px solid rgba(148,163,184,0.22); background: transparent; color: inherit; cursor: pointer; font-size: 12.5px;
      }
      .eg-insp-neighbor:hover { border-color: #3b82f6; background: rgba(59,130,246,0.1); }
      .eg-insp-neighbor-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .eg-insp-neighbor-kind { font-size: 11px; opacity: 0.6; flex-shrink: 0; }
      .eg-insp-empty { font-size: 13px; opacity: 0.72; line-height: 1.5; }
      @media (max-width: 820px) {
        .eg-stage-wrap { grid-template-columns: 1fr; }
        .eg-inspector, .eg-expanded .eg-inspector { width: 100%; max-height: 240px; }
      }
    `;
    document.head.append(style);
  }
})();
