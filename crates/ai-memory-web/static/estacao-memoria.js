import { cookie } from "./estacao-cookie.js";

(function () {
  "use strict";
  var mount = document.getElementById("estacao-memoria-painel");
  if (!mount) return;
  var escopoPadrao = mount.dataset.escopo || "";

  function h(tag, attrs, filhos) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "texto") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    var lista = Array.isArray(filhos) ? filhos : filhos != null ? [filhos] : [];
    lista.forEach(function (f) {
      if (f != null) el.append(f);
    });
    return el;
  }

  function hdrs(isPost) {
    var out = { "X-Estacao-Sessao": "dispositivo" };
    if (isPost) {
      out["Content-Type"] = "application/json";
      out["X-Estacao-UI"] = "1";
      out["X-CSRF-Token"] = decodeURIComponent(cookie("ai_memory_csrf") || "");
    }
    return out;
  }

  function reqJson(url, opts) {
    return fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, opts || {})).then(function (r) {
      if (r.status === 401 || r.headers.has("x-estacao-login")) {
        throw new Error("Conecte sua conta Nostr em Chats ou Projetos para exportar/importar memórias.");
      }
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error(t || "Erro HTTP " + r.status);
        });
      }
      return r.text().then(function (t) {
        if (!t) return null;
        try {
          return JSON.parse(t);
        } catch (_) {
          return t;
        }
      });
    });
  }

  function baixarJson(nome, dados) {
    var blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function formatarData(micros) {
    if (!micros) return "";
    var ms = micros > 1e14 ? Math.floor(micros / 1000) : micros < 1e11 ? micros * 1000 : micros;
    var d = new Date(ms);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
  }

  var resumo = null;
  var selecionadosExport = new Set();
  var statusMsg = null;
  var statusOk = true;
  var ocupado = false;

  function definirStatus(ok, texto) {
    statusOk = ok;
    statusMsg = texto;
    renderPainel();
  }

  function exportar(reqBody, nomeBase) {
    if (ocupado) return;
    ocupado = true;
    definirStatus(true, "Preparando pacote portátil de memória (grafo de conhecimento e revisão de aprendizado)…");
    reqJson("estacao/api/memorias/exportar", {
      method: "POST",
      headers: hdrs(true),
      body: JSON.stringify(reqBody)
    })
      .then(function (pacote) {
        var hoje = new Date().toISOString().slice(0, 10);
        baixarJson(nomeBase + "-" + hoje + ".json", pacote);
        var r = pacote.resumo || {};
        definirStatus(
          true,
          "Backup exportado: " +
            (r.total_projetos || (pacote.projetos || []).length) +
            " escopo(s), " +
            (r.total_paginas || 0) +
            " página(s), " +
            (r.total_entidades || 0) +
            " entidade(s), " +
            (r.total_relacoes || 0) +
            " relação(ões) do grafo e " +
            (r.total_revisoes_aprendizado || 0) +
            " revisão(ões) de aprendizado."
        );
      })
      .catch(function (e) {
        definirStatus(false, e.message);
      })
      .finally(function () {
        ocupado = false;
        renderPainel();
      });
  }

  function abrirDialogo(titulo, renderConteudo) {
    var prev = document.getElementById("estacao-mem-modal");
    if (prev) prev.remove();
    function fechar() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(ev) {
      if (ev.key === "Escape") fechar();
    }
    document.addEventListener("keydown", onKey);
    var card = h(
      "div",
      {
        class: "max-w-3xl w-full max-h-[88vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-sm text-slate-800 dark:text-slate-100",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": titulo,
        onclick: function (ev) {
          ev.stopPropagation();
        }
      },
      [
        h("div", { class: "flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3" }, [
          h("h2", { class: "text-base font-semibold", texto: titulo }),
          h("button", {
            type: "button",
            class: "rounded-md px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800",
            "aria-label": "Fechar",
            texto: "✕",
            onclick: fechar
          })
        ])
      ]
    );
    var overlay = h(
      "div",
      {
        id: "estacao-mem-modal",
        class: "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4",
        onclick: fechar
      },
      [card]
    );
    renderConteudo(card, fechar);
    document.body.appendChild(overlay);
  }

  function abrirModalInspecionar(escopo) {
    abrirDialogo("Inspecionar memória · " + escopo, function (card) {
      var corpo = h("div", { class: "space-y-3" }, [
        h("p", { class: "text-slate-500", texto: "Carregando grafo de conhecimento, páginas e revisões…" })
      ]);
      card.append(corpo);
      reqJson("estacao/api/memorias/inspecionar?escopo=" + encodeURIComponent(escopo), {
        headers: hdrs(false)
      })
        .then(function (info) {
          corpo.replaceChildren();
          corpo.append(
            h("div", { class: "flex flex-wrap items-center justify-between gap-2" }, [
              h("div", { class: "flex flex-wrap gap-2 text-xs" }, [
                h("span", { class: "rounded-full bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 font-medium text-blue-700 dark:text-blue-300", texto: info.total_paginas + " página(s)" }),
                h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: info.total_entidades + " entidade(s) no grafo" }),
                h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: info.total_relacoes + " relação(ões)" }),
                h("span", { class: "rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-amber-800 dark:text-amber-300", texto: info.revisoes_pendentes + " revisão(ões) pendente(s)" }),
                h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: info.total_sessoes + " sessão(ões)" })
              ]),
              h("button", {
                type: "button",
                class: "rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800",
                texto: "⬆ Exportar este escopo",
                onclick: function () {
                  var slug = escopo.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
                  exportar({ escopos: [escopo] }, "estacao-memoria-" + slug);
                }
              })
            ])
          );
          if (info.total_paginas > (info.paginas || []).length) {
            corpo.append(
              h("p", {
                class: "rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200",
                texto: "Exibindo as " + info.paginas.length + " páginas principais de " + info.total_paginas + ". A exportação inclui todas sem cortes."
              })
            );
          }
          var filtro = h("input", {
            type: "search",
            placeholder: "Filtrar páginas por título, caminho ou tipo…",
            class: "w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
          });
          var lista = h("div", { class: "space-y-2 max-h-80 overflow-y-auto pr-1" });
          function renderLista() {
            var q = filtro.value.trim().toLowerCase();
            lista.replaceChildren();
            var itens = (info.paginas || []).filter(function (pg) {
              return !q || pg.title.toLowerCase().indexOf(q) >= 0 || pg.path.toLowerCase().indexOf(q) >= 0 || pg.kind.toLowerCase().indexOf(q) >= 0;
            });
            if (!itens.length) {
              lista.append(h("p", { class: "text-xs text-slate-500", texto: q ? "Nenhuma página corresponde ao filtro." : "Nenhuma página compilada neste escopo." }));
              return;
            }
            itens.forEach(function (pg) {
              lista.append(
                h("div", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1" }, [
                  h("div", { class: "flex items-center justify-between gap-2" }, [
                    h("strong", { class: "text-xs", texto: pg.title || pg.path }),
                    h("span", { class: "text-[11px] text-slate-500", texto: (pg.pinned ? "Fixada · " : "") + pg.kind + " · " + pg.tier })
                  ]),
                  h("div", { class: "flex items-center justify-between text-[11px] text-slate-500 font-mono" }, [
                    h("span", { texto: pg.path }),
                    pg.updated_at ? h("span", { texto: formatarData(pg.updated_at) }) : null
                  ]),
                  pg.body
                    ? h("details", { class: "pt-1" }, [
                        h("summary", { class: "cursor-pointer text-xs text-blue-600 dark:text-blue-400", texto: "Ver conteúdo completo" }),
                        h("pre", { class: "mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 dark:bg-slate-950 p-2 text-xs", texto: pg.body })
                      ])
                    : null
                ])
              );
            });
          }
          filtro.addEventListener("input", renderLista);
          renderLista();
          corpo.append(filtro, lista);
        })
        .catch(function (e) {
          corpo.replaceChildren(h("p", { class: "text-red-600 dark:text-red-400 text-xs", texto: e.message }));
        });
    });
  }

  function abrirModalImportar() {
    abrirDialogo("Importar memória de outro computador", function (card, fechar) {
      var pacote = null;
      var selecionados = new Set();
      var erroEl = h("p", { class: "hidden rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300" });
      var previewEl = h("div", { class: "space-y-3" });
      var modoSel = h("select", { class: "w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" }, [
        h("option", { value: "mesclar", texto: "Mesclar (mantém a memória atual e adiciona/atualiza páginas, grafo e revisões do arquivo)" }),
        h("option", { value: "substituir", texto: "Substituir (recria do zero cada projeto selecionado; default/_global sempre mescla)" })
      ]);
      var btnImp = h("button", {
        type: "button",
        disabled: true,
        class: "rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50",
        texto: "Importar selecionadas (0)"
      });

      function mostrarErro(msg) {
        if (!msg) {
          erroEl.classList.add("hidden");
          erroEl.textContent = "";
        } else {
          erroEl.textContent = msg;
          erroEl.classList.remove("hidden");
        }
      }

      function atualizarBotao() {
        btnImp.disabled = !pacote || selecionados.size === 0;
        btnImp.textContent = "Importar selecionadas (" + selecionados.size + ")";
      }

      function renderPreview() {
        previewEl.replaceChildren();
        if (!pacote) return;
        var existSet = new Set(((resumo && resumo.escopos) || []).map(function (s) { return s.escopo; }));
        var totPags = 0, totEnt = 0, totRel = 0, totRev = 0;
        pacote.projetos.forEach(function (pr) {
          totPags += (pr.paginas || []).length;
          totEnt += (pr.grafo && pr.grafo.entidades ? pr.grafo.entidades.length : 0);
          totRel += (pr.grafo && pr.grafo.relacoes ? pr.grafo.relacoes.length : 0);
          totRev += (pr.revisoes_aprendizado || []).filter(function (r) { return !r.status || r.status === "pending"; }).length;
        });

        var master = h("input", { type: "checkbox", class: "rounded" });
        master.checked = selecionados.size === pacote.projetos.length && pacote.projetos.length > 0;
        master.addEventListener("change", function () {
          selecionados.clear();
          if (master.checked) pacote.projetos.forEach(function (p) { selecionados.add(p.escopo); });
          renderPreview();
          atualizarBotao();
        });

        var lista = h("div", { class: "space-y-2 max-h-64 overflow-y-auto pr-1" });
        pacote.projetos.forEach(function (pr) {
          var chk = h("input", { type: "checkbox", class: "rounded" });
          chk.checked = selecionados.has(pr.escopo);
          chk.addEventListener("change", function () {
            if (chk.checked) selecionados.add(pr.escopo);
            else selecionados.delete(pr.escopo);
            master.checked = selecionados.size === pacote.projetos.length;
            atualizarBotao();
          });
          var pags = pr.paginas || [];
          var revs = (pr.revisoes_aprendizado || []).filter(function (r) { return !r.status || r.status === "pending"; });
          var entN = pr.grafo && pr.grafo.entidades ? pr.grafo.entidades.length : 0;
          var relN = pr.grafo && pr.grafo.relacoes ? pr.grafo.relacoes.length : 0;
          lista.append(
            h("div", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1.5" }, [
              h("div", { class: "flex flex-wrap items-center justify-between gap-2" }, [
                h("label", { class: "inline-flex items-center gap-2 font-medium text-xs cursor-pointer" }, [
                  chk,
                  h("span", { class: "font-mono", texto: pr.escopo })
                ]),
                h("div", { class: "flex flex-wrap gap-1.5 text-[11px]" }, [
                  h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5", texto: pags.length + " pág." }),
                  entN || relN ? h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5", texto: entN + " ent. · " + relN + " rel." }) : null,
                  revs.length ? h("span", { class: "rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-amber-800 dark:text-amber-300", texto: revs.length + " rev. pendentes" }) : null,
                  existSet.has(pr.escopo)
                    ? h("span", { class: "rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-amber-800 dark:text-amber-300", texto: "Já existe aqui" })
                    : h("span", { class: "rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-emerald-800 dark:text-emerald-300", texto: "Novo" })
                ])
              ]),
              pags.length
                ? h("details", { class: "text-xs" }, [
                    h("summary", { class: "cursor-pointer text-slate-500", texto: "Ver páginas (" + pags.length + ")" + (revs.length ? " e revisões (" + revs.length + ")" : "") }),
                    h("div", { class: "mt-1.5 space-y-1 max-h-36 overflow-y-auto" }, pags.slice(0, 60).map(function (pg) {
                      return h("div", { class: "flex justify-between gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300" }, [
                        h("span", { class: "truncate", texto: pg.title || pg.path }),
                        h("span", { class: "text-slate-400 shrink-0", texto: pg.path })
                      ]);
                    }))
                  ])
                : null
            ])
          );
        });

        previewEl.append(
          h("div", { class: "flex flex-wrap gap-2 text-xs" }, [
            h("span", { class: "rounded-full bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 font-medium text-blue-700 dark:text-blue-300", texto: pacote.projetos.length + " escopo(s)" }),
            h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: totPags + " página(s)" }),
            h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: totEnt + " ent. · " + totRel + " rel." }),
            h("span", { class: "rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-amber-800 dark:text-amber-300", texto: totRev + " revisão(ões) pendente(s)" }),
            pacote.versao_app ? h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: "Estação " + pacote.versao_app }) : null
          ]),
          h("label", { class: "block space-y-1 text-xs" }, [
            h("span", { class: "font-medium", texto: "Modo de importação" }),
            modoSel
          ]),
          h("label", { class: "inline-flex items-center gap-2 text-xs font-medium cursor-pointer" }, [
            master,
            h("span", { texto: "Selecionar todos (" + selecionados.size + "/" + pacote.projetos.length + ")" })
          ]),
          lista
        );
        atualizarBotao();
      }

      var input = h("input", {
        type: "file",
        accept: ".json,application/json",
        class: "block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium"
      });
      input.addEventListener("change", function () {
        mostrarErro("");
        var arq = input.files && input.files[0];
        if (!arq) return;
        arq.text().then(function (txt) {
          var parsed = JSON.parse(txt);
          if (!parsed || parsed.formato !== "estacao-ai-memoria-v1" || !Array.isArray(parsed.projetos)) {
            throw new Error("Arquivo inválido: selecione um backup .json gerado pela Estação I.A.");
          }
          if (!parsed.projetos.length) {
            throw new Error("O arquivo selecionado não contém nenhuma memória.");
          }
          pacote = parsed;
          selecionados = new Set(parsed.projetos.map(function (p) { return p.escopo; }));
          renderPreview();
          atualizarBotao();
        }).catch(function (e) {
          pacote = null;
          selecionados.clear();
          previewEl.replaceChildren();
          atualizarBotao();
          mostrarErro(e.message || "Não foi possível ler o arquivo JSON.");
        });
      });

      btnImp.addEventListener("click", async function () {
        if (!pacote || !selecionados.size) return;
        mostrarErro("");
        btnImp.disabled = true;
        try {
          var escolhidos = pacote.projetos.filter(function (p) { return selecionados.has(p.escopo); });
          var modo = modoSel.value;
          var pacoteFiltrado = Object.assign({}, pacote, { projetos: escolhidos });
          var payloadJson = JSON.stringify({ pacote: pacoteFiltrado, selecionar: Array.from(selecionados), modo: modo });
          var totalProjs = 0, totalPags = 0, totalRevs = 0;

          if (payloadJson.length > 8 * 1024 * 1024 && escolhidos.length > 1) {
            for (var i = 0; i < escolhidos.length; i++) {
              btnImp.textContent = "Importando " + (i + 1) + "/" + escolhidos.length + "…";
              var fatia = Object.assign({}, pacote, {
                projetos: [escolhidos[i]],
                aprendizado_estacao: i === 0 ? pacote.aprendizado_estacao : undefined
              });
              var res = await reqJson("estacao/api/memorias/importar", {
                method: "POST",
                headers: hdrs(true),
                body: JSON.stringify({ pacote: fatia, selecionar: [escolhidos[i].escopo], modo: modo })
              });
              totalProjs += res.projetos_importados || 0;
              totalPags += res.paginas_importadas || 0;
              totalRevs += res.revisoes_importadas || 0;
            }
          } else {
            btnImp.textContent = "Importando…";
            var resUnico = await reqJson("estacao/api/memorias/importar", {
              method: "POST",
              headers: hdrs(true),
              body: payloadJson
            });
            totalProjs = resUnico.projetos_importados || 0;
            totalPags = resUnico.paginas_importadas || 0;
            totalRevs = resUnico.revisoes_importadas || 0;
          }

          fechar();
          definirStatus(
            true,
            "Importação concluída: " +
              totalProjs +
              " escopo(s), " +
              totalPags +
              " página(s) (grafo reconstruído) e " +
              totalRevs +
              " revisão(ões) de aprendizado restauradas."
          );
          carregarResumo();
        } catch (e) {
          atualizarBotao();
          mostrarErro(e.message);
        }
      });

      card.append(
        h("p", {
          class: "text-xs text-slate-500 dark:text-slate-400",
          texto: "Restaure backup ou traga a memória completa de outro computador: páginas, entidades, conexões do grafo de conhecimento e fila de revisão de aprendizado."
        }),
        input,
        erroEl,
        previewEl,
        h("div", { class: "flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800" }, [
          h("button", { type: "button", class: "rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs", texto: "Cancelar", onclick: fechar }),
          btnImp
        ])
      );
    });
  }

  function excluirEscopo(escopo) {
    if (escopo === "default/_global") {
      definirStatus(false, "A memória global (default/_global) é protegida e não pode ser excluída.");
      return;
    }
    if (!window.confirm("Excluir permanentemente a memória \"" + escopo + "\" (páginas, grafo, revisões e sessões)?")) {
      return;
    }
    reqJson("estacao/api/acao", {
      method: "POST",
      headers: hdrs(true),
      body: JSON.stringify({ tipo: "excluir_memoria", escopo: escopo })
    })
      .then(function () {
        selecionadosExport.delete(escopo);
        definirStatus(true, "Memória \"" + escopo + "\" excluída.");
        carregarResumo();
      })
      .catch(function (e) {
        definirStatus(false, e.message);
      });
  }

  function renderPainel() {
    mount.replaceChildren();
    var box = h("div", {
      class: "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 shadow-sm space-y-3"
    });

    var chips = resumo
      ? h("div", { class: "flex flex-wrap gap-2 text-xs" }, [
          h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: resumo.total_escopos + " escopo(s) no computador" }),
          h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: resumo.total_paginas + " página(s)" }),
          h("span", { class: "rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1", texto: resumo.total_entidades + " entidade(s) · " + resumo.total_relacoes + " relação(ões) no grafo" }),
          h("span", { class: "rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-amber-800 dark:text-amber-300", texto: resumo.total_revisoes_pendentes + " revisão(ões) pendente(s)" })
        ])
      : h("p", { class: "text-xs text-slate-500", texto: "Carregando resumo da memória do computador…" });

    box.append(
      h("div", { class: "flex flex-wrap items-start justify-between gap-3" }, [
        h("div", { class: "space-y-1" }, [
          h("h2", { class: "text-sm font-semibold text-slate-900 dark:text-slate-100", texto: "Backup portátil da memória (Grafo de conhecimento + Revisão de aprendizado)" }),
          h("p", { class: "text-xs text-slate-500 dark:text-slate-400", texto: "Exporte toda a memória deste computador ou importe de outro computador mantendo páginas, entidades, conexões do grafo e revisões de aprendizado." })
        ]),
        h("div", { class: "flex flex-wrap gap-2" }, [
          h("button", {
            type: "button",
            disabled: ocupado || !resumo || resumo.total_escopos === 0,
            class: "rounded-md bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50",
            texto: "⬆ Exportar toda a memória do computador",
            onclick: function () {
              exportar({ tudo: true }, "estacao-memoria-completa");
            }
          }),
          h("button", {
            type: "button",
            disabled: ocupado,
            class: "rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50",
            texto: "⬇ Importar memória…",
            onclick: abrirModalImportar
          })
        ])
      ]),
      chips
    );

    if (statusMsg) {
      box.append(
        h("p", {
          role: "status",
          class:
            "rounded-md px-3 py-2 text-xs " +
            (statusOk
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
              : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"),
          texto: statusMsg
        })
      );
    }

    if (resumo && resumo.escopos && resumo.escopos.length) {
      var escoposValidos = new Set(resumo.escopos.map(function (s) { return s.escopo; }));
      Array.from(selecionadosExport).forEach(function (es) {
        if (!escoposValidos.has(es)) selecionadosExport.delete(es);
      });
      if (escopoPadrao && escoposValidos.has(escopoPadrao) && selecionadosExport.size === 0) {
        selecionadosExport.add(escopoPadrao);
      }

      var chkAll = h("input", { type: "checkbox", class: "rounded" });
      chkAll.checked = selecionadosExport.size === resumo.escopos.length;
      chkAll.addEventListener("change", function () {
        selecionadosExport.clear();
        if (chkAll.checked) resumo.escopos.forEach(function (s) { selecionadosExport.add(s.escopo); });
        renderPainel();
      });

      var detalhes = h("details", { class: "pt-1" }, [
        h("summary", { class: "cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300", texto: "Selecionar, verificar ou exportar escopos individualmente (" + resumo.escopos.length + ")" }),
        h("div", { class: "mt-3 space-y-2" }, [
          h("div", { class: "flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800" }, [
            h("label", { class: "inline-flex items-center gap-2 text-xs font-medium cursor-pointer" }, [
              chkAll,
              h("span", { texto: "Selecionar todos (" + selecionadosExport.size + "/" + resumo.escopos.length + ")" })
            ]),
            h("button", {
              type: "button",
              disabled: ocupado || selecionadosExport.size === 0,
              class: "rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50",
              texto: "⬆ Exportar selecionados (" + selecionadosExport.size + ")",
              onclick: function () {
                exportar({ escopos: Array.from(selecionadosExport) }, "estacao-memorias-selecionadas");
              }
            })
          ])
        ].concat(
          resumo.escopos.map(function (s) {
            var chk = h("input", { type: "checkbox", class: "rounded" });
            chk.checked = selecionadosExport.has(s.escopo);
            chk.addEventListener("change", function () {
              if (chk.checked) selecionadosExport.add(s.escopo);
              else selecionadosExport.delete(s.escopo);
              renderPainel();
            });
            return h("div", { class: "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs" }, [
              h("div", { class: "flex flex-wrap items-center gap-2 min-w-0" }, [
                chk,
                h("strong", { class: "font-mono", texto: s.escopo }),
                h("span", { class: "text-slate-500", texto: s.paginas + " pág. · " + s.entidades + " ent. · " + s.relacoes + " rel. · " + s.revisoes_pendentes + " rev." }),
                s.global ? h("span", { class: "rounded-full bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[11px] text-blue-700 dark:text-blue-300", texto: "Global" }) : null
              ]),
              h("div", { class: "flex flex-wrap gap-1.5" }, [
                h("button", {
                  type: "button",
                  class: "rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800",
                  texto: "Verificar",
                  onclick: function () { abrirModalInspecionar(s.escopo); }
                }),
                h("button", {
                  type: "button",
                  class: "rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800",
                  texto: "Exportar",
                  onclick: function () {
                    var slug = s.escopo.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
                    exportar({ escopos: [s.escopo] }, "estacao-memoria-" + slug);
                  }
                }),
                !s.global
                  ? h("button", {
                      type: "button",
                      class: "rounded border border-red-200 dark:border-red-900/60 px-2.5 py-1 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30",
                      texto: "Excluir",
                      onclick: function () { excluirEscopo(s.escopo); }
                    })
                  : null
              ])
            ]);
          })
        ))
      ]);
      box.append(detalhes);
    }

    mount.append(box);
  }

  function carregarResumo() {
    reqJson("estacao/api/memorias/resumo", { headers: hdrs(false) })
      .then(function (data) {
        resumo = data;
        renderPainel();
      })
      .catch(function (e) {
        definirStatus(false, e.message);
      });
  }

  renderPainel();
  carregarResumo();
})();
