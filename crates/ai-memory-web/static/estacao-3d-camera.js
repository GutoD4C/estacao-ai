export function criarCamera(T, mode, ui, cena, acoes) {
  var { host, root, canvasEl, sceneArea, hudTopRef, renderer, btnExitTv, btnFullscreen, btnFollow, btnWalk, btnZoomIn, btnZoomOut, hintEl } = ui;
  var { tvMeshes, gridBounds, blocked, interactables } = cena;
  var { getAgents, selectAgent, editorAtivo, editorClick, fecharEditor, updateNextBtn, syncHudTop, isUiBlocking, onInteract, onPointerLockChange, onDialogueScroll } = acoes;
  var isChalet = mode === "juri";
  var camera = new T.PerspectiveCamera(isChalet ? 60 : 43, 1, 0.1, 340);
  var ray = new T.Raycaster(), pointer = new T.Vector2();
  var tvCloseup = false, prevCamState = null;

  // Chalé: inicia em Primeira Pessoa (WASD + Mouse Look); Dev: inicia em órbita
  var follow = false;
  var walk = isChalet;
  var thirdPerson = false;
  var sensitivity = 0.0024;
  var pointerLocked = false;
  var speakerFocusAgent = null;
  var focusLookCurrent = new T.Vector3(0, 1.4, 0);
  var focusLookInit = false;

  var theta = isChalet ? 0.18 : 0.72, phi = isChalet ? 0.94 : 0.91, dist = isChalet ? 42 : 60;
  var target = new T.Vector3(0, 0.4, isChalet ? -1.0 : 0);
  var playerPos = new T.Vector3(0, 0.12, isChalet ? 6.4 : 6.0);
  var eyeHeight = 1.58;
  var yaw = 0, pitch = -0.05;
  var velY = 0, bobPhase = 0, moveSpeed = 0;
  var sitting = false, savedStandPos = null;
  var keys = new Set();

  function setPointerLock(want) {
    if (!isChalet) return;
    if (want) {
      if (document.pointerLockElement !== canvasEl && canvasEl.requestPointerLock) {
        try {
          var p = canvasEl.requestPointerLock();
          if (p && p.catch) p.catch(function () {});
        } catch (_) {}
      }
    } else if (document.pointerLockElement === canvasEl && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (_) {}
    }
  }

  function onLockChange() {
    pointerLocked = document.pointerLockElement === canvasEl;
    if (onPointerLockChange) onPointerLockChange(pointerLocked);
  }
  document.addEventListener("pointerlockchange", onLockChange);

  function enterTvCloseup() {
    if (isChalet) setPointerLock(false);
    if (!tvCloseup) {
      prevCamState = {
        tx: target.x, ty: target.y, tz: target.z, dist: dist, theta: theta, phi: phi,
        walk: walk, px: playerPos.x, py: playerPos.y, pz: playerPos.z, yaw: yaw, pitch: pitch
      };
    }
    walk = false;
    follow = false;
    if (btnWalk) { btnWalk.setAttribute("aria-pressed", "false"); btnWalk.textContent = "Entrar no espaço"; }
    if (btnFollow) btnFollow.setAttribute("aria-pressed", "false");
    if (fecharEditor) fecharEditor();
    tvCloseup = true;
    if (btnExitTv) btnExitTv.hidden = false;
    if (updateNextBtn) updateNextBtn();
    if (isChalet) {
      target.set(11.35, 2.75, -2.0);
      dist = 4.6;
      theta = -Math.PI / 2;
      phi = Math.PI / 2;
    } else {
      target.set(-23.24, 3.5, -4.0);
      dist = 6.8;
      theta = Math.PI / 2;
      phi = Math.PI / 2;
    }
    if (hintEl) hintEl.textContent = "Smart TV · Pesquise no YouTube ou escolha música ambiente";
  }

  function exitTvCloseup(skipRestore) {
    if (!tvCloseup) return;
    tvCloseup = false;
    if (btnExitTv) btnExitTv.hidden = true;
    if (updateNextBtn) updateNextBtn();
    if (!skipRestore && prevCamState) {
      target.set(prevCamState.tx, prevCamState.ty, prevCamState.tz);
      dist = prevCamState.dist;
      theta = prevCamState.theta;
      phi = prevCamState.phi;
      walk = isChalet ? true : Boolean(prevCamState.walk);
    } else if (isChalet) {
      walk = true;
    }
    prevCamState = null;
  }

  if (btnExitTv) btnExitTv.onclick = function () { exitTvCloseup(false); };

  if (btnFullscreen) {
    btnFullscreen.onclick = function () {
      var targetEl = host.closest(".juri-fs-stage") || root;
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        if (targetEl.requestFullscreen) targetEl.requestFullscreen();
        else if (targetEl.webkitRequestFullscreen) targetEl.webkitRequestFullscreen();
      }
    };
  }
  function onFsChange() {
    var on = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (btnFullscreen) {
      btnFullscreen.textContent = on ? "⛶ Sair" : "⛶ Tela cheia";
      btnFullscreen.setAttribute("aria-pressed", String(on));
    }
    setTimeout(resize, 60);
  }
  document.addEventListener("fullscreenchange", onFsChange);

  if (btnFollow) btnFollow.onclick = function () { exitTvCloseup(true); follow = !follow; btnFollow.setAttribute("aria-pressed", String(follow)); };
  if (btnZoomIn) btnZoomIn.onclick = function () { dist = Math.max(3.2, dist * 0.85); };
  if (btnZoomOut) btnZoomOut.onclick = function () {
    dist = Math.min(85, dist / 0.85);
    if (tvCloseup && dist > 13.5) exitTvCloseup(true);
  };
  if (btnWalk) {
    btnWalk.onclick = function () {
      exitTvCloseup(true);
      walk = !walk;
      follow = false;
      if (btnFollow) btnFollow.setAttribute("aria-pressed", "false");
      btnWalk.setAttribute("aria-pressed", String(walk));
      btnWalk.textContent = walk ? "Sair do espaço" : "Entrar no espaço";
      if (hintEl) hintEl.textContent = walk ? "WASD / setas para andar · mouse para olhar" : "Arraste para girar · roda para aproximar · clique em um agente ou na TV 3D";
      if (walk) {
        if (fecharEditor) fecharEditor();
        playerPos.set(0, isChalet ? 0.12 : 0, isChalet ? 6.4 : 6.0);
        yaw = 0;
        pitch = -0.05;
      }
    };
  }

  var camPresets = isChalet
    ? { all: [0, 4.0, 32, 0.12, 0.96] }
    : { all: [0, 0, 60, 0.72, 0.91], coord: [-12, -9, 28, 0.65, 0.92], devs: [12, -9, 28, -0.55, 0.9], qa: [-12, 9, 28, 0.65, 0.92], docs: [12, 9, 28, -0.65, 0.92] };

  root.querySelectorAll("[data-view]").forEach(function (b) {
    b.onclick = function () {
      if (b.dataset.view === "tv") { enterTvCloseup(); return; }
      exitTvCloseup(true);
      walk = false;
      follow = false;
      if (btnWalk) { btnWalk.setAttribute("aria-pressed", "false"); btnWalk.textContent = "Entrar no espaço"; }
      if (btnFollow) btnFollow.setAttribute("aria-pressed", "false");
      var ps = camPresets[b.dataset.view] || camPresets.all;
      target.set(ps[0], 0.5, ps[1]);
      dist = ps[2];
      theta = ps[3];
      phi = ps[4];
    };
  });

  function onKeyDown(e) {
    if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || "")) return;
    if (isUiBlocking && isUiBlocking()) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (["w", "a", "s", "d", "shift", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(k) >= 0) {
      e.preventDefault();
      keys.add(k);
      if (k === " " && walk && !sitting && Math.abs(velY) < 0.01) {
        velY = 4.2;
      }
      if (sitting && ["w", "a", "s", "d", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(k) >= 0) {
        standUp();
      }
    }
  }
  function onKeyUp(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(k);
  }
  function onBlur() { keys.clear(); }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  function onMouseMoveDoc(e) {
    if (!pointerLocked || !walk) return;
    if (isUiBlocking && isUiBlocking()) return;
    yaw -= (e.movementX || 0) * sensitivity;
    pitch = Math.max(-1.25, Math.min(1.15, pitch - (e.movementY || 0) * sensitivity));
  }
  document.addEventListener("mousemove", onMouseMoveDoc);

  var drag = null, walkGoal = null;
  canvasEl.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    if (isUiBlocking && isUiBlocking()) return;
    if (isChalet && walk && !tvCloseup) {
      if (pointerLocked) {
        // Clique esquerdo com cursor travado interage com o alvo na mira
        if (onInteract) onInteract();
        return;
      }
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvasEl.setPointerCapture(e.pointerId);
      return;
    }
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvasEl.setPointerCapture(e.pointerId);
  });

  canvasEl.addEventListener("pointermove", function (e) {
    if (!drag || pointerLocked) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (walk) {
      yaw -= dx * 0.0052;
      pitch = Math.max(-1.25, Math.min(1.15, pitch - dy * 0.0052));
    } else {
      theta -= dx * 0.006;
      phi = Math.max(0.28, Math.min(1.65, phi + dy * 0.005));
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });

  canvasEl.addEventListener("pointerup", function (e) {
    if (drag && !drag.moved) {
      if (isChalet && walk && !tvCloseup) {
        // Primeiro clique no canvas engaja o modo mouse-look (Pointer Lock) em 1ª pessoa
        setPointerLock(true);
        drag = null;
        return;
      }
      var rect = canvasEl.getBoundingClientRect();
      pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      var tvHits = ray.intersectObjects(tvMeshes, true);
      if (tvHits.length) {
        enterTvCloseup();
        drag = null;
        return;
      }
      if (editorAtivo && editorAtivo()) { editorClick(ray); drag = null; return; }
      var hits = ray.intersectObjects(getAgents().map(function (a) { return a.g; }), true);
      if (hits.length) { selectAgent(hits[0].object.userData.agentIndex || 0); }
    }
    drag = null;
  });
  canvasEl.addEventListener("pointercancel", function () { drag = null; });
  canvasEl.addEventListener("wheel", function (e) {
    if (speakerFocusAgent && onDialogueScroll) {
      e.preventDefault();
      onDialogueScroll(e.deltaY);
      return;
    }
    if (isUiBlocking && isUiBlocking()) return;
    e.preventDefault();
    if (!walk) {
      dist = Math.max(3.2, Math.min(85, dist + e.deltaY * 0.035));
      if (tvCloseup && dist > 13.5) exitTvCloseup(true);
    }
  }, { passive: false });

  function sitAt(seatPos, seatYaw) {
    if (!sitting) savedStandPos = playerPos.clone();
    sitting = true;
    playerPos.set(seatPos.x, Math.max(0, seatPos.y - 1.15), seatPos.z);
    if (seatYaw != null) yaw = seatYaw;
    velY = 0;
  }

  function standUp() {
    if (!sitting) return;
    sitting = false;
    if (savedStandPos && !blocked(savedStandPos.x, savedStandPos.z, null, true)) {
      playerPos.copy(savedStandPos);
    } else {
      var sx = playerPos.x - Math.sin(yaw) * 0.9, sz = playerPos.z - Math.cos(yaw) * 0.9;
      if (!blocked(sx, sz, null, true)) { playerPos.x = sx; playerPos.z = sz; }
    }
    playerPos.y = playerPos.z <= 10.2 ? 0.12 : 0;
    savedStandPos = null;
  }

  function getAimTarget(agents) {
    if (!isChalet || !walk || tvCloseup) return null;
    // Raycast a partir do centro da tela (mira em 1ª/3ª pessoa)
    ray.setFromCamera(new T.Vector2(0, 0), camera);
    var best = null, bestScore = Infinity;

    // 1. Verifica agentes sob a mira ou muito próximos na direção do olhar
    var forward = new T.Vector3();
    camera.getWorldDirection(forward);
    (agents || []).forEach(function (a, idx) {
      var center = new T.Vector3(a.g.position.x, a.g.position.y + 1.25, a.g.position.z);
      var toObj = center.clone().sub(camera.position);
      var d = toObj.length();
      if (d > 5.0 || d < 0.35) return;
      var dot = toObj.normalize().dot(forward);
      if (dot > 0.92 && d < bestScore) {
        bestScore = d;
        best = { kind: "agent", agent: a, index: idx, label: "Conversar com @" + a.name };
      }
    });

    // 2. Verifica objetos interativos do Chalé e Área Externa
    (interactables || []).forEach(function (it) {
      var toObj = it.pos.clone().sub(camera.position);
      var d = toObj.length();
      var maxR = it.radius || 3.6;
      if (d > maxR + (thirdPerson ? 2.4 : 0.4)) return;
      var dot = toObj.normalize().dot(forward);
      if (dot > 0.84 && d * 0.95 < bestScore) {
        bestScore = d * 0.95;
        best = { kind: "object", item: it, label: typeof it.label === "function" ? it.label() : it.label };
      }
    });
    return best;
  }

  function resize() {
    var w = sceneArea.clientWidth || 800, h = sceneArea.clientHeight || 540;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (syncHudTop) syncHudTop();
  }
  var ro = new ResizeObserver(resize);
  ro.observe(sceneArea);
  if (hudTopRef) ro.observe(hudTopRef);
  resize();

  var jumpOffset = 0;
  function update(dt, selectedAgent, localOperator) {
    if (isChalet && speakerFocusAgent && !tvCloseup) {
      if (localOperator) localOperator.setFirstPersonMode(true);
      var sp = speakerFocusAgent.g.position;
      var syaw = speakerFocusAgent.g.rotation.y || 0;
      // Vetor frontal do agente (rosto aponta para +Z em yaw=0 -> (sin(yaw), cos(yaw)))
      var fx = Math.sin(syaw), fz = Math.cos(syaw);
      // Vetor lateral (+direita da câmera olhando para o agente: (-F) x Up = (fz, 0, -fx))
      // Deslocando câmera + alvo para +R, o agente fica em destaque à esquerda e o painel lateral à direita!
      var rx = fz, rz = -fx;
      var headY = (sp.y || 0) + (speakerFocusAgent.seat ? 1.12 : 1.32);
      var camDist = 2.38;
      var sideShift = 0.58;
      var desiredPos = new T.Vector3(
        sp.x + fx * camDist + rx * sideShift,
        headY + 0.1,
        sp.z + fz * camDist + rz * sideShift
      );
      // Evita atravessar paredes do chalé quando o orador está próximo de uma borda
      if (sp.z < 9.8 && sp.z > -9.8 && Math.abs(sp.x) < 12.6) {
        desiredPos.x = Math.max(-12.2, Math.min(12.2, desiredPos.x));
        desiredPos.z = Math.max(-9.4, Math.min(9.4, desiredPos.z));
      }
      var desiredLook = new T.Vector3(
        sp.x + rx * sideShift,
        headY - 0.14,
        sp.z + rz * sideShift
      );
      if (!focusLookInit) {
        focusLookCurrent.copy(desiredLook);
        focusLookInit = true;
      }
      camera.position.lerp(desiredPos, Math.min(1, dt * 5.2));
      focusLookCurrent.lerp(desiredLook, Math.min(1, dt * 6.2));
      camera.lookAt(focusLookCurrent);
      camera.updateMatrixWorld();
      return;
    }
    focusLookInit = false;

    if (walk) {
      var blocking = isUiBlocking && isUiBlocking();
      var mx = blocking ? 0 : ((keys.has("d") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("a") || keys.has("ArrowLeft") ? 1 : 0));
      var mz = blocking ? 0 : ((keys.has("w") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("s") || keys.has("ArrowDown") ? 1 : 0));
      var len = Math.hypot(mx, mz);
      var baseSpd = keys.has("shift") ? 7.2 : 4.4;
      moveSpeed = 0;
      if (len > 0 && !sitting) {
        mx /= len;
        mz /= len;
        var vx = (Math.cos(yaw) * mx - Math.sin(yaw) * mz) * dt * baseSpd;
        var vz = (-Math.sin(yaw) * mx - Math.cos(yaw) * mz) * dt * baseSpd;
        var moved = false;
        if (!blocked(playerPos.x + vx, playerPos.z, null, true)) { playerPos.x += vx; moved = true; }
        if (!blocked(playerPos.x, playerPos.z + vz, null, true)) { playerPos.z += vz; moved = true; }
        if (moved) {
          moveSpeed = baseSpd;
          bobPhase += dt * (keys.has("shift") ? 12.5 : 8.5);
        }
      }
      // Altura do piso (dentro do chalé/varanda vs grama externa)
      var groundY = (isChalet && playerPos.z <= 15.5) ? 0.12 : 0;
      if (!sitting) {
        if (jumpOffset > 0 || velY > 0) {
          jumpOffset += velY * dt;
          velY -= 12.5 * dt;
          if (jumpOffset <= 0) { jumpOffset = 0; velY = 0; }
        }
        playerPos.y = groundY + jumpOffset;
      }

      if (localOperator) {
        localOperator.setFirstPersonMode(!thirdPerson);
        localOperator.updatePose(dt, performance.now() / 1000, playerPos, yaw, moveSpeed, sitting);
      }

      var curEyeY = playerPos.y + (sitting ? 1.18 : eyeHeight) + (moveSpeed > 0.1 && !thirdPerson ? Math.sin(bobPhase) * 0.045 : 0);
      if (thirdPerson) {
        var camDist = 3.6;
        var lookTarget = new T.Vector3(playerPos.x, playerPos.y + 1.45, playerPos.z);
        var desiredCam = new T.Vector3(
          lookTarget.x + Math.sin(yaw) * Math.cos(pitch) * camDist,
          Math.max(0.6, lookTarget.y - Math.sin(pitch) * camDist + 0.55),
          lookTarget.z + Math.cos(yaw) * Math.cos(pitch) * camDist
        );
        camera.position.lerp(desiredCam, Math.min(1, dt * 12));
        camera.lookAt(lookTarget);
      } else {
        camera.position.set(playerPos.x, curEyeY, playerPos.z);
        camera.lookAt(
          playerPos.x - Math.sin(yaw) * Math.cos(pitch),
          curEyeY + Math.sin(pitch),
          playerPos.z - Math.cos(yaw) * Math.cos(pitch)
        );
      }
    } else {
      if (localOperator) localOperator.setFirstPersonMode(false);
      if (follow && selectedAgent) {
        var sp = selectedAgent.g.position;
        target.lerp(new T.Vector3(sp.x, sp.y + 0.7, sp.z), 0.06);
      }
      var fit = dist * Math.max(1, 1.35 / camera.aspect);
      var wanted = new T.Vector3(
        target.x + fit * Math.sin(phi) * Math.sin(theta),
        target.y + fit * Math.cos(phi),
        target.z + fit * Math.sin(phi) * Math.cos(theta)
      );
      camera.position.lerp(wanted, 0.14);
      camera.lookAt(target);
    }
    camera.updateMatrixWorld();
  }

  function pararPercurso() {
    if (isChalet) return;
    walk = false;
    follow = false;
    if (btnWalk) { btnWalk.setAttribute("aria-pressed", "false"); btnWalk.textContent = "Entrar no espaço"; }
    if (btnFollow) btnFollow.setAttribute("aria-pressed", "false");
  }

  function focarSala(sala) {
    target.set(sala.x, 0.4, sala.z);
    dist = 30;
  }

  if (!isChalet) camera.position.set(38, 44, 48);

  return {
    camera, update, enterTvCloseup, exitTvCloseup, pararPercurso, focarSala,
    setPointerLock, sitAt, standUp, getAimTarget,
    setSpeakerFocus: function (ag) {
      speakerFocusAgent = ag || null;
      if (speakerFocusAgent) setPointerLock(false);
    },
    get speakerFocusAgent() { return speakerFocusAgent; },
    setThirdPerson: function (val) { thirdPerson = Boolean(val); },
    get thirdPerson() { return thirdPerson; },
    setSensitivity: function (v) { sensitivity = Math.max(0.0008, Math.min(0.007, Number(v) || 0.0024)); },
    get sensitivity() { return sensitivity; },
    get pointerLocked() { return pointerLocked; },
    get tvCloseup() { return tvCloseup; },
    get sitting() { return sitting; },
    get walkPos() { return walk ? playerPos : null; },
    get yaw() { return yaw; },
    setPose: function (x, z, newYaw, newPitch) {
      playerPos.set(x, z <= 15.5 ? 0.12 : 0, z);
      if (newYaw != null) yaw = newYaw;
      if (newPitch != null) pitch = Math.max(-1.25, Math.min(1.15, newPitch));
    },
    disconnect: function () {
      ro.disconnect();
      setPointerLock(false);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("mousemove", onMouseMoveDoc);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    }
  };
}
