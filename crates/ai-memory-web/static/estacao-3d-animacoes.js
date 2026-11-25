function smoothstep(value) {
  var t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function animarAgentes(agentList, selectedIdx, dt, elapsed, simTime, renderBubbleText, updateNextBtn, operatorPos, activeSpeakerId) {
  agentList.forEach(function (a, i) {
    var isHibernating = Boolean(a.hibernando);
    var isWalking = !isHibernating && a.path && a.path.length > 0;
    var isSpeaking = !isHibernating && Boolean(a.bubbleFull && !a.bubbleClosed && a.id === activeSpeakerId);

    var atCoffeeBar = a.state === "coffee" || a.zoneId === "cafe";
    var coffeeWindow = (elapsed + i * 5.7) % 22 < 7;
    var sippingLounge = Boolean(a.coffeeMug) && !isHibernating && !isWalking &&
      !isSpeaking && !a.busy && a.state !== "work" && simTime >= (a.waveUntil || 0) &&
      (atCoffeeBar || coffeeWindow);
    if (sippingLounge) {
      if (a.coffeeStartedAt == null) a.coffeeStartedAt = elapsed;
    } else {
      a.coffeeStartedAt = null;
    }
    var coffeeAge = sippingLounge ? elapsed - a.coffeeStartedAt : 0;
    var coffeePhase = coffeeAge % 6.5;
    // Aproximação, gole, retorno e pausa com a xícara apoiada na pata.
    var sip = sippingLounge ? smoothstep((coffeePhase - 0.75) / 0.95) *
      (1 - smoothstep((coffeePhase - 2.35) / 1.15)) : 0;
    if (a.coffeeMug) a.coffeeMug.visible = sippingLounge;

    // Olhos: fechados dormindo (zzz) quando hibernando, piscar natural quando acordado!
    if (a.eyeGroups && a.eyeGroups.length) {
      var eyeScaleY = 1.0;
      if (isHibernating) {
        eyeScaleY = 0.08;
      } else {
        var blinkCycle = (elapsed + i * 1.37) % 4.2;
        var blinkOpen = 0.09 + 0.91 * smoothstep(Math.abs(blinkCycle - 4.05) / 0.11);
        eyeScaleY = blinkOpen * (1.0 - sip * 0.54);
      }
      a.eyeGroups.forEach(function (eg) { eg.scale.y = eyeScaleY; });
    }

    // Abanar o rabo (rápido falando/andando, suave relaxado, quietinho dormindo!)
    if (a.tail) {
      if (isHibernating) {
        a.tail.rotation.y *= 0.88;
      } else {
        var wagSpd = isSpeaking ? 13 : (isWalking ? 11 : (a.busy ? 8 : 4.2));
        var wagAmp = isSpeaking ? 0.55 : (isWalking ? 0.42 : 0.25);
        a.tail.rotation.y = Math.sin(elapsed * wagSpd + i * 1.7) * wagAmp;
      }
    }

    // Orelhas expressivas
    if (a.ears && a.ears.length) {
      var earRate = isWalking ? 10.2 : (isSpeaking ? 7 : 2);
      var earBob = isHibernating ? -0.18 : Math.sin(elapsed * earRate + i) * (isWalking || isSpeaking ? 0.09 : 0.03);
      a.ears.forEach(function (ep, ei) {
        ep.rotation.x = earBob * (ei === 0 ? 1 : 0.85);
      });
    }

    // Movimento de boca enquanto fala
    if (a.mouth) {
      var typingNow = isSpeaking && ((a.bubblePos || 0) < (a.bubbleFull || "").length || a.busy);
      if (typingNow && !a.busy) {
        a.mouth.scale.y = 0.75 + Math.abs(Math.sin(elapsed * 16 + i)) * 2.2;
        a.mouth.scale.x = 0.92 + Math.cos(elapsed * 11 + i) * 0.14;
      } else {
        a.mouth.scale.set(1, 1, 1);
      }
    }

    var bodyTargetY = 0, bodyTargetTilt = 0;
    var elL = a.elbows && a.elbows[0], elR = a.elbows && a.elbows[1];
    var knL = a.knees && a.knees[0], knR = a.knees && a.knees[1];

    if (isHibernating) {
      // Pose dormindo enroladinho na almofada/banco com respiração calma + zzz!
      bodyTargetY = -0.22 + Math.sin(elapsed * 1.6 + i) * 0.016;
      bodyTargetTilt = 0.24;
      a.legs[0].rotation.x = -1.48;
      a.legs[1].rotation.x = -1.48;
      if (knL && knR) { knL.rotation.x = 1.48; knR.rotation.x = 1.48; }
      a.arms[0].rotation.x = -0.45;
      a.arms[1].rotation.x = -0.45;
      if (elL && elR) { elL.rotation.x = -0.65; elR.rotation.x = -0.65; }
      a.head.rotation.x += (0.42 - a.head.rotation.x) * Math.min(1, dt * 4);
      a.head.rotation.z += (0.16 - a.head.rotation.z) * Math.min(1, dt * 4);
      a.head.rotation.y *= 0.9;
    } else if (isWalking) {
      var p = a.path[0], dx = p[0] - a.g.position.x, dz = p[1] - a.g.position.z, d = Math.hypot(dx, dz), speed = 3.15 * dt;
      if (d < speed) {
        a.g.position.x = p[0];
        a.g.position.z = p[1];
        a.path.shift();
      } else {
        a.g.position.x += dx / d * speed;
        a.g.position.z += dz / d * speed;
        var walkYaw = Math.atan2(dx, dz);
        var wDiff = ((walkYaw - a.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        a.g.rotation.y += wDiff * Math.min(1, dt * 10);
      }
      var sw = Math.sin(elapsed * 10.2 + i) * 0.52;
      bodyTargetY = Math.abs(Math.sin(elapsed * 10.2 + i)) * 0.045;
      a.legs[0].rotation.x = sw;
      a.legs[1].rotation.x = -sw;
      if (knL && knR) {
        knL.rotation.x = Math.max(0, -sw * 0.72);
        knR.rotation.x = Math.max(0, sw * 0.72);
      }
      a.arms[0].rotation.x = -sw * 0.6;
      a.arms[1].rotation.x = sw * 0.6;
      if (elL && elR) { elL.rotation.x = -0.22; elR.rotation.x = -0.22; }
      a.head.rotation.y *= 0.85;
      a.head.rotation.x *= 0.85;
      a.head.rotation.z *= 0.85;
    } else {
      var sitting = Boolean(a.seat) && (a.state === "seat" || a.state === "work" || a.state === "campfire" || a.state === "tv" || a.state === "coffee" || a.state === "speak");
      var onCampfireBench = a.zoneId === "fogueira";
      if (sitting) {
        // Sobre as almofadas internas (y ~ 0.36) ou bancos da fogueira (y ~ 0.52)
        bodyTargetY = onCampfireBench ? 0.04 : -0.02;
        a.legs[0].rotation.x = -1.4;
        a.legs[1].rotation.x = -1.4;
        if (knL && knR) { knL.rotation.x = 1.4; knR.rotation.x = 1.4; }
      } else {
        a.legs[0].rotation.x = 0;
        a.legs[1].rotation.x = 0;
        if (knL && knR) { knL.rotation.x = 0; knR.rotation.x = 0; }
      }

      if (isSpeaking && !a.busy) {
        bodyTargetTilt = 0.05;
        a.arms[0].rotation.x = -0.52 + Math.sin(elapsed * 4.2 + i) * 0.24;
        a.arms[1].rotation.x = -0.56 + Math.cos(elapsed * 3.8 + i) * 0.26;
        if (elL && elR) {
          elL.rotation.x = -0.68 + Math.sin(elapsed * 4.6 + i) * 0.22;
          elR.rotation.x = -0.72 + Math.cos(elapsed * 4.3 + i) * 0.24;
        }
      } else if (a.busy || a.state === "work") {
        bodyTargetTilt = 0.07;
        a.arms[0].rotation.x = -0.6 + Math.sin(elapsed * 9.5 + i) * 0.09;
        a.arms[1].rotation.x = -0.6 + Math.cos(elapsed * 9.5 + i) * 0.09;
        if (elL && elR) { elL.rotation.x = -0.62; elR.rotation.x = -0.62; }
      } else if (sippingLounge) {
        var grip = smoothstep(coffeeAge / 0.55);
        var restArm = sitting ? -0.32 : 0;
        var restElbow = sitting ? -0.48 : -0.14;
        a.arms[0].rotation.x = restArm;
        a.arms[1].rotation.x = restArm + (-0.57 - restArm) * grip - 0.67 * sip;
        if (elL) elL.rotation.x = restElbow;
        if (elR) elR.rotation.x = restElbow + (-0.85 - restElbow) * grip + 0.42 * sip;
      } else if (a.state === "campfire") {
        a.arms[0].rotation.x = -0.58 + Math.sin(elapsed * 2.2 + i) * 0.07;
        a.arms[1].rotation.x = -0.58 + Math.cos(elapsed * 2.2 + i) * 0.07;
        if (elL && elR) { elL.rotation.x = -0.48; elR.rotation.x = -0.48; }
      } else if (simTime < (a.waveUntil || 0)) {
        a.arms[1].rotation.x = -2.0 + Math.sin(elapsed * 11) * 0.3;
        if (elR) elR.rotation.x = -0.45;
        a.arms[0].rotation.x = sitting ? -0.3 : 0.04;
        if (elL) elL.rotation.x = -0.25;
      } else {
        a.arms[0].rotation.x = sitting ? -0.32 : Math.sin(elapsed * 1.5 + i) * 0.04;
        a.arms[1].rotation.x = sitting ? -0.32 : -Math.sin(elapsed * 1.5 + i) * 0.04;
        if (elL && elR) {
          elL.rotation.x = sitting ? -0.48 : -0.14;
          elR.rotation.x = sitting ? -0.48 : -0.14;
        }
      }

      if (!a.busy && !isSpeaking) bodyTargetY += Math.sin(elapsed * 1.85 + i) * 0.009;

      var desiredYaw = a.targetYaw;
      if (desiredYaw != null) {
        var diff = ((desiredYaw - a.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        a.g.rotation.y += diff * Math.min(1, dt * 5.5);
      }

      // Expressive head-tracking & cute dog head tilt when listening!
      var headYawTarget = Math.sin(elapsed * 0.9 + i) * 0.08;
      var headPitchTarget = isSpeaking ? Math.sin(elapsed * 3.4 + i) * 0.07 : (sip * 0.17);
      var headTiltTarget = isSpeaking ? Math.sin(elapsed * 2.1 + i) * 0.06 : -0.09 * sip;
      if (!isSpeaking && operatorPos && !sippingLounge) {
        var hdx = operatorPos.x - a.g.position.x, hdz = operatorPos.z - a.g.position.z;
        var hDist = Math.hypot(hdx, hdz);
        if (hDist < 9.5 && hDist > 0.3) {
          var worldAngle = Math.atan2(hdx, hdz);
          var rel = ((worldAngle - a.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          if (Math.abs(rel) < 1.15) {
            headYawTarget = Math.max(-0.72, Math.min(0.72, rel));
            if (hDist < 4.5) headTiltTarget = 0.09; // tombadinha curiosa de cachorro!
          }
        }
      }
      a.head.rotation.y += (headYawTarget - a.head.rotation.y) * Math.min(1, dt * 6);
      a.head.rotation.x += (headPitchTarget - a.head.rotation.x) * Math.min(1, dt * 6);
      a.head.rotation.z += (headTiltTarget - a.head.rotation.z) * Math.min(1, dt * 5);
    }

    a.arms[1].rotation.z = -(0.45 + (a.arms[1].position.x - 0.19) * 3) * sip;
    if (elR) elR.rotation.z = -0.20 * sip;
    if (sippingLounge && elR) {
      var mug = a.coffeeMug;
      var parentRotation = mug.userData.parentRotation;
      // Compensa a articulação da pata para manter a xícara em pé até o gole.
      parentRotation.copy(a.arms[1].quaternion).multiply(elR.quaternion).invert();
      mug.rotation.set(0.38 * sip, 0, 0);
      mug.quaternion.premultiply(parentRotation);
      mug.userData.steam.forEach(function (puff, index) {
        var rise = (coffeeAge * 0.83 + index / 3) % 1;
        var size = 0.014 + rise * 0.026;
        puff.position.set(Math.sin(rise * 4 + index) * rise * 0.047, 0.073 + rise * 0.19, 0);
        puff.scale.set(size, size * 0.75, size);
        puff.material.opacity = Math.sin(rise * Math.PI) * 0.24 * (1 - sip);
      });
    }

    if (a.bodyGroup) {
      a.bodyGroup.position.y += (bodyTargetY - a.bodyGroup.position.y) * Math.min(1, dt * 8);
      a.bodyGroup.rotation.x += (bodyTargetTilt - a.bodyGroup.rotation.x) * Math.min(1, dt * 8);
    }
    a.g.position.y += ((a.targetY || 0) - a.g.position.y) * Math.min(1, dt * 6);

    // Separação suave agente-agente
    for (var j = i + 1; j < agentList.length; j++) {
      var b = agentList[j];
      var cdx = a.g.position.x - b.g.position.x, cdz = a.g.position.z - b.g.position.z;
      var cd = Math.hypot(cdx, cdz);
      if (cd > 0.001 && cd < 0.88) {
        var push = (0.88 - cd) * 0.45;
        var nxPush = cdx / cd * push, nzPush = cdz / cd * push;
        if (a.path.length || !a.seat) { a.g.position.x += nxPush; a.g.position.z += nzPush; }
        if (b.path.length || !b.seat) { b.g.position.x -= nxPush; b.g.position.z -= nzPush; }
      }
    }

    // Digitação progressiva da fala
    if (a.bubbleFull && !a.bubbleClosed) {
      if ((a.bubblePos || 0) < a.bubbleFull.length) {
        var antes = Math.floor(a.bubblePos || 0);
        a.bubblePos = Math.min(a.bubbleFull.length, (a.bubblePos || 0) + dt * (a.busy ? 34 : 52));
        if (Math.floor(a.bubblePos) !== antes) renderBubbleText(a);
        if (a.bubblePos >= a.bubbleFull.length) {
          renderBubbleText(a);
          if (!a.busy && a.bubbleDoneAt == null) a.bubbleDoneAt = simTime;
          updateNextBtn();
        }
      } else if (!a.busy && a.bubbleDoneAt == null) {
        a.bubbleDoneAt = simTime;
        updateNextBtn();
      }
    }

    if (isHibernating) {
      a.ringMat.color.set("#71717a");
      a.ringMat.emissive.set("#52525b");
      a.ringMat.emissiveIntensity = 0.45;
      a.ring.visible = false;
    } else if (a.busy) {
      a.ringMat.color.set("#f59e0b");
      a.ringMat.emissive.set("#f59e0b");
      a.ringMat.emissiveIntensity = 1.1 + Math.sin(elapsed * 6) * 0.6;
      a.ring.visible = true;
    } else if (a.ausente) {
      a.ringMat.color.set("#ef4444");
      a.ringMat.emissive.set("#dc2626");
      a.ringMat.emissiveIntensity = 0.8;
      a.ring.visible = i === selectedIdx;
    } else {
      a.ringMat.color.set("#34d399");
      a.ringMat.emissive.set("#10b981");
      a.ringMat.emissiveIntensity = 1.25;
      a.ring.visible = i === selectedIdx || isSpeaking;
    }
  });
}

export function posicionarRotulos(T, agentList, selectedIdx, camera, aw, ah, tvCloseup, pulpitSpeakerId, simTime, el, isChaletFp, aimedAgentId, remoteOperators, speakerFocusActive) {
  agentList.forEach(function (a, i) {
    var headH = a.hibernando ? 1.05 : (a.seat ? 1.52 : 1.72);
    var headWorld = a.g.position.clone().add(new T.Vector3(0, headH, 0));
    var dist = camera.position.distanceTo(headWorld);
    var p = headWorld.project(camera);
    var sx = (p.x * 0.5 + 0.5) * aw, sy = (-p.y * 0.5 + 0.5) * ah;
    var fora = p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05;
    var isSpeaker = a.id === pulpitSpeakerId && Boolean(a.bubbleFull) && !a.bubbleClosed;
    var isAimed = aimedAgentId && aimedAgentId === a.id;

    var ocultarPorDist = isChaletFp && !isSpeaker && !a.busy && !isAimed && (speakerFocusActive || dist > 14.5);
    a.label.hidden = fora || ocultarPorDist || tvCloseup || (speakerFocusActive && isSpeaker);
    if (!a.label.hidden) {
      a.label.style.left = sx + "px";
      a.label.style.top = sy + "px";
      var alpha = isChaletFp ? (isAimed || isSpeaker || a.busy ? 1 : Math.max(0.38, 1 - Math.max(0, dist - 7) / 10)) : 1;
      a.label.style.opacity = String(alpha.toFixed(2));
      a.label.classList.toggle("selected", i === selectedIdx || Boolean(isAimed));
      a.label.classList.toggle("busy", a.busy);
      a.label.classList.toggle("sleeping", Boolean(a.hibernando));
      var sub = a.hibernando ? "💤 Hibernando (dono offline)" : (a.busy ? "● Pensando…" : (a.path.length ? "Indo até " + a.zona : a.zona));
      a.label.innerHTML = "";
      a.label.append(document.createTextNode(a.name + (a.funcao === "mediador" ? " ★" : "")));
      a.label.append(el("small", { text: sub }));
    }

    // Efeito visual animado Zzz flutuando sobre agentes dormindo (hibernação)
    if (a.zzzEl) {
      var showZzz = Boolean(a.hibernando) && !tvCloseup && !fora && dist < 18 && !speakerFocusActive;
      a.zzzEl.hidden = !showZzz;
      if (showZzz) {
        a.zzzEl.style.left = (sx + 18) + "px";
        a.zzzEl.style.top = Math.max(24, sy - 26) + "px";
      }
    }

    var mostrarBalao = !isChaletFp && !tvCloseup && !fora && isSpeaker && dist < 34;
    a.bubble.hidden = !mostrarBalao;
    if (mostrarBalao) {
      a.bubble.style.left = Math.max(170, Math.min(aw - 170, sx)) + "px";
      a.bubble.style.top = Math.max(140, sy - 44) + "px";
      a.bubble.classList.toggle("thinking", a.busy);
    }

    if (a.emoteEl) {
      var showEmote = !tvCloseup && !fora && simTime < (a.emoteUntil || 0) && dist < 24 && !speakerFocusActive;
      a.emoteEl.hidden = !showEmote;
      if (showEmote) {
        a.emoteEl.style.left = sx + "px";
        a.emoteEl.style.top = Math.max(36, sy - 40) + "px";
      }
    }
  });

  (remoteOperators || []).forEach(function (op) {
    if (!op || !op.label || !op.g.visible) return;
    var wp = op.g.position.clone().add(new T.Vector3(0, 1.75, 0));
    var pr = wp.project(camera);
    var out = pr.z > 1 || pr.z < -1 || Math.abs(pr.x) > 1.05 || Math.abs(pr.y) > 1.05;
    op.label.hidden = out || tvCloseup || speakerFocusActive;
    if (!op.label.hidden) {
      op.label.style.left = ((pr.x * 0.5 + 0.5) * aw) + "px";
      op.label.style.top = ((-pr.y * 0.5 + 0.5) * ah) + "px";
    }
  });
}
