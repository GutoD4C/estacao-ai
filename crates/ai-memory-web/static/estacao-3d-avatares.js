// Modelos 3D estilizados de Cachorros (10 raças com cores naturais originais!)
// Aparência de cachorro, comportamento/pensamento humano + xícara de café na pata + estado dormindo (zzz).

const BREED_ORDER = [
  "caramelo", "salsicha", "bulldog", "shiitsu", "poodle",
  "husky", "golden", "dalmata", "corgi", "shiba"
];

const NATURAL_BREED_COLORS = {
  caramelo: { coat: "#c9833b", accent: "#f0d3a8", ear: "#9b5e24", nose: "#1f1814", collar: "#dc2626", iris: "#5c3b28" },
  salsicha: { coat: "#6e3d24", accent: "#b87a4b", ear: "#4a2715", nose: "#181210", collar: "#16a34a", iris: "#4b2e1e" },
  bulldog:  { coat: "#ba916e", accent: "#f2e5d5", ear: "#7d5b42", nose: "#1b1614", collar: "#2563eb", iris: "#563b2a" },
  shiitsu:  { coat: "#d9cdb9", accent: "#f7f3eb", ear: "#7d6450", nose: "#1d1816", collar: "#e11d48", iris: "#4f3628" },
  poodle:   { coat: "#ece6dc", accent: "#ffffff", ear: "#d7cec0", nose: "#1e1a18", collar: "#0d9488", iris: "#503728" },
  husky:    { coat: "#6d7885", accent: "#f5f7fa", ear: "#3f4752", nose: "#18181b", collar: "#0284c7", iris: "#38bdf8" },
  golden:   { coat: "#d9a24c", accent: "#f5dfb5", ear: "#b57c2d", nose: "#211915", collar: "#15803d", iris: "#633f24" },
  dalmata:  { coat: "#f4f4f5", accent: "#ffffff", ear: "#1c1c21", nose: "#18181b", collar: "#dc2626", iris: "#5b412e" },
  corgi:    { coat: "#d47f39", accent: "#faf6f0", ear: "#a3571e", nose: "#1b1613", collar: "#7c3aed", iris: "#5a3a26" },
  shiba:    { coat: "#c96a2b", accent: "#f7ead6", ear: "#934416", nose: "#1a1512", collar: "#b91c1c", iris: "#4c2f1d" }
};

function mixHex(T, hexA, hexB, ratio) {
  var a = new T.Color(hexA);
  var b = new T.Color(hexB);
  return "#" + a.lerp(b, ratio).getHexString();
}

export function criarAvatares(T, cena, labelsEl, el) {
  var { scene, mat, glow } = cena;

  function escolherChassi(spec, usados) {
    if (spec && spec.raca_cachorro && BREED_ORDER.indexOf(spec.raca_cachorro) >= 0) {
      return spec.raca_cachorro;
    }
    var fn = String((spec && spec.funcao) || "").toLowerCase();
    var pref = "";
    if (fn === "mediador" || fn === "pensador") pref = "golden";
    else if (fn === "filosofo" || fn === "documentador") pref = "shiitsu";
    else if (fn === "cetico" || fn === "qa_seguranca") pref = "bulldog";
    else if (fn === "otimista" || fn === "testador") pref = "corgi";
    else if (fn === "pessoa" || fn === "desenvolvedor") pref = "caramelo";
    else if (fn === "estrategista" || fn === "arquiteto") pref = "husky";
    else if (fn === "criativo" || fn === "designer_ui") pref = "dalmata";
    else if (fn === "pragmatico" || fn === "devops") pref = "salsicha";
    else if (fn === "analitico" || fn === "analista_dados") pref = "shiba";
    else if (fn === "empatico" || fn === "produto") pref = "poodle";
    else if (fn === "advogado_diabo" || fn === "revisor_codigo") pref = "husky";
    else if (fn === "contador_historias") pref = "golden";
    if (!pref || (usados && (usados[pref] || 0) > 0)) {
      // Distribui entre as 10 raças sem repetir desnecessariamente
      var best = pref || BREED_ORDER[0], bestC = (pref && usados) ? (usados[pref] || 0) : Infinity;
      BREED_ORDER.forEach(function (b) {
        var c = (usados && usados[b]) || 0;
        if (c < bestC) { bestC = c; best = b; }
      });
      pref = best;
    }
    if (usados) usados[pref] = (usados[pref] || 0) + 1;
    return pref;
  }

  function buildDogRig(opts) {
    var breed = BREED_ORDER.indexOf(opts.breed) >= 0 ? opts.breed : "caramelo";
    var nat = NATURAL_BREED_COLORS[breed] || NATURAL_BREED_COLORS.caramelo;

    // Todos os cachorros mantêm sua cor base natural original da raça (sem tingimento artificial de IA)
    var coatColor = nat.coat;
    var accentColor = nat.accent;
    var earColor = nat.ear;
    var collarColor = nat.collar;

    var coatMat = new T.MeshStandardMaterial({ color: coatColor, roughness: breed === "poodle" || breed === "shiitsu" || breed === "golden" ? 0.9 : 0.78 });
    var accentMat = new T.MeshStandardMaterial({ color: accentColor, roughness: 0.86 });
    var earMat = new T.MeshStandardMaterial({ color: earColor, roughness: 0.82 });
    var noseMat = new T.MeshStandardMaterial({ color: nat.nose, roughness: 0.22, metalness: 0.12 });
    var collarMat = new T.MeshStandardMaterial({ color: collarColor, roughness: 0.48 });
    var tagMat = new T.MeshStandardMaterial({ color: "#f5c542", metalness: 0.75, roughness: 0.25 });
    var eyeWhiteMat = new T.MeshStandardMaterial({ color: "#fafaf9", roughness: 0.22 });
    var pupilMat = new T.MeshStandardMaterial({ color: "#111114", roughness: 0.12 });
    var mouthMat = new T.MeshStandardMaterial({ color: "#7f1d1d", roughness: 0.55 });
    var tongueMat = new T.MeshStandardMaterial({ color: "#f472b6", roughness: 0.55 });
    var spotMat = new T.MeshStandardMaterial({ color: "#18181c", roughness: 0.85 });

    var irisMat = new T.MeshStandardMaterial({ color: nat.iris || "#684332", roughness: 0.3 });
    var earLiningMat = new T.MeshStandardMaterial({ color: mixHex(T, earColor, "#c28579", 0.55), roughness: 0.88 });
    var softSphere = new T.SphereGeometry(1, 16, 12);

    function roundedPart(material, x, y, z, width, height, depth) {
      var mesh = new T.Mesh(softSphere, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(width, height, depth);
      mesh.castShadow = true;
      return mesh;
    }

    var markingMat = new T.MeshStandardMaterial({
      color: mixHex(T, coatColor, breed === "salsicha" || breed === "bulldog" || breed === "husky" ? earColor : accentColor, 0.65),
      roughness: 0.9
    });
    var padMat = new T.MeshStandardMaterial({ color: "#65463d", roughness: 0.96 });

    // Dimensões anatômicas específicas por raça (todos com partes firmemente encaixadas — zero cabelo/orelha flutuando!)
    var dims = {
      caramelo: { legLen: 0.38, torsoW: 0.38, torsoH: 0.48, torsoD: 0.32, headR: 0.23, snoutL: 0.19, snoutW: 0.14, yOff: 0.0 },
      salsicha: { legLen: 0.24, torsoW: 0.34, torsoH: 0.56, torsoD: 0.36, headR: 0.21, snoutL: 0.24, snoutW: 0.12, yOff: -0.06 },
      bulldog:  { legLen: 0.31, torsoW: 0.48, torsoH: 0.44, torsoD: 0.38, headR: 0.25, snoutL: 0.12, snoutW: 0.21, yOff: -0.03 },
      shiitsu:  { legLen: 0.29, torsoW: 0.39, torsoH: 0.42, torsoD: 0.34, headR: 0.23, snoutL: 0.10, snoutW: 0.14, yOff: -0.04 },
      poodle:   { legLen: 0.42, torsoW: 0.34, torsoH: 0.48, torsoD: 0.29, headR: 0.21, snoutL: 0.17, snoutW: 0.12, yOff: 0.03 },
      husky:    { legLen: 0.44, torsoW: 0.41, torsoH: 0.52, torsoD: 0.34, headR: 0.235, snoutL: 0.21, snoutW: 0.135, yOff: 0.04 },
      golden:   { legLen: 0.42, torsoW: 0.43, torsoH: 0.50, torsoD: 0.35, headR: 0.24, snoutL: 0.20, snoutW: 0.145, yOff: 0.03 },
      dalmata:  { legLen: 0.45, torsoW: 0.36, torsoH: 0.51, torsoD: 0.31, headR: 0.22, snoutL: 0.20, snoutW: 0.13, yOff: 0.04 },
      corgi:    { legLen: 0.23, torsoW: 0.41, torsoH: 0.49, torsoD: 0.36, headR: 0.225, snoutL: 0.17, snoutW: 0.13, yOff: -0.07 },
      shiba:    { legLen: 0.36, torsoW: 0.37, torsoH: 0.46, torsoD: 0.31, headR: 0.23, snoutL: 0.16, snoutW: 0.13, yOff: -0.01 }
    }[breed];

    var rootGroup = new T.Group();
    var bodyGroup = new T.Group();
    rootGroup.add(bodyGroup);

    var hipY = dims.legLen + 0.18;
    var torsoY = hipY + dims.torsoH * 0.52;
    var shoulderY = hipY + dims.torsoH - 0.06;
    var neckY = hipY + dims.torsoH + 0.06;
    var headY = neckY + dims.headR * 0.85;

    // 1. PATAS TRASEIRAS / PERNAS ARTICULADAS (sentam confortavelmente sobre almofadas e bancos!)
    var legs = [], knees = [];
    var legSpread = dims.torsoW * 0.32;
    [-legSpread, legSpread].forEach(function (dx) {
      var hip = new T.Group();
      hip.position.set(dx, hipY, 0.02);
      bodyGroup.add(hip);

      var upperH = dims.legLen * 0.54;
      var thigh = roundedPart(coatMat, 0, -upperH * 0.42, 0, 0.091, upperH * 0.76, 0.088);
      hip.add(thigh);

      var knee = new T.Group();
      knee.position.set(0, -upperH, 0);
      hip.add(knee);

      var lowerH = dims.legLen * 0.48;
      var shin = roundedPart(coatMat, 0, -lowerH * 0.48, 0, 0.069, lowerH * 0.78, 0.066);
      knee.add(shin);

      if (breed === "poodle") {
        var cuff = new T.Mesh(new T.SphereGeometry(0.088, 12, 10), accentMat);
        cuff.position.y = -lowerH * 0.65;
        knee.add(cuff);
      }

      // Patinha arredondada com dedinhos
      var paw = new T.Mesh(new T.SphereGeometry(0.078, 12, 10), accentMat);
      paw.scale.set(1.0, 0.62, 1.38);
      paw.position.set(0, -lowerH - 0.02, 0.055);
      paw.castShadow = true;
      knee.add(paw);
      [-0.034, 0, 0.034].forEach(function (toe) {
        knee.add(roundedPart(accentMat, toe, -lowerH - 0.033, 0.132, 0.025, 0.026, 0.037));
      });

      legs.push(hip);
      knees.push(knee);
    });

    // 2. CORPO / TORSO + BARRIGA + COLEIRA COM MEDALHA
    var torso = new T.Mesh(new T.SphereGeometry(0.5, 18, 14), coatMat);
    torso.scale.set(dims.torsoW, dims.torsoH * 0.96, dims.torsoD);
    torso.position.set(0, torsoY, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    bodyGroup.add(torso);
    bodyGroup.add(roundedPart(coatMat, 0, neckY - 0.03, 0.025,
      dims.torsoW * 0.39, 0.19, dims.torsoD * 0.43));

    // Extensão traseira charmosa para o Salsicha e o Corgi (corpinho compridinho!)
    if (breed === "salsicha" || breed === "corgi") {
      var backLong = new T.Mesh(new T.SphereGeometry(0.22, 14, 12), coatMat);
      backLong.scale.set(breed === "corgi" ? 1.04 : 0.95, 0.88, breed === "corgi" ? 1.32 : 1.45);
      backLong.position.set(0, hipY + 0.14, -0.17);
      backLong.castShadow = true;
      bodyGroup.add(backLong);
    }

    // Manchas pretas clássicas no torso do Dálmata
    if (breed === "dalmata") {
      [
        [0.14, torsoY + 0.08, 0.11, 0.048],
        [-0.15, torsoY - 0.04, 0.09, 0.042],
        [0.08, torsoY - 0.11, -0.13, 0.046],
        [-0.12, torsoY + 0.12, -0.11, 0.044],
        [0.16, torsoY - 0.07, -0.02, 0.036],
        [-0.04, torsoY + 0.03, -0.15, 0.038]
      ].forEach(function (sp) {
        bodyGroup.add(roundedPart(spotMat, sp[0], sp[1], sp[2], sp[3], sp[3] * 0.9, sp[3] * 0.72));
      });
    }

    // Gola peluda extra para Husky e Golden
    if (breed === "husky" || breed === "golden") {
      bodyGroup.add(roundedPart(accentMat, 0, shoulderY + 0.04, dims.torsoD * 0.28,
        dims.torsoW * 0.48, 0.15, dims.torsoD * 0.34));
    }

    // Mancha clara no peito / barriga
    var belly = new T.Mesh(new T.SphereGeometry(0.42, 14, 12), accentMat);
    belly.scale.set(dims.torsoW * 0.68, dims.torsoH * 0.72, dims.torsoD * 0.52);
    belly.position.set(0, torsoY - 0.02, dims.torsoD * 0.34);
    bodyGroup.add(belly);

    // Coleira estilosa + medalhinha dourada (e gravatinha no Mediador/Pensador)
    var collar = new T.Mesh(new T.TorusGeometry(dims.torsoW * 0.44, 0.036, 10, 22), collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, neckY - 0.04, 0.02);
    bodyGroup.add(collar);

    var tag = new T.Mesh(new T.CylinderGeometry(0.046, 0.046, 0.018, 14), tagMat);
    tag.rotation.x = Math.PI / 2;
    tag.position.set(0, neckY - 0.08, dims.torsoD * 0.44 + 0.04);
    bodyGroup.add(tag);

    if (opts.funcao === "mediador" || opts.funcao === "pensador") {
      var bowMat = mat("#dc2626", 0, 0.6);
      var bL = new T.Mesh(new T.ConeGeometry(0.055, 0.09, 6), bowMat);
      bL.rotation.z = -Math.PI / 2; bL.position.set(-0.045, neckY - 0.03, dims.torsoD * 0.46 + 0.03);
      var bR = new T.Mesh(new T.ConeGeometry(0.055, 0.09, 6), bowMat);
      bR.rotation.z = Math.PI / 2; bR.position.set(0.045, neckY - 0.03, dims.torsoD * 0.46 + 0.03);
      bodyGroup.add(bL, bR);
    }

    // 3. RABO ARTICULADO (abana quando fala/anda e descansa quando dorme!)
    var tailPivot = new T.Group();
    tailPivot.position.set(0, hipY + 0.08, -(breed === "salsicha" ? 0.38 : dims.torsoD * 0.46));
    bodyGroup.add(tailPivot);
    if (breed === "bulldog" || breed === "corgi") {
      var stub = new T.Mesh(new T.SphereGeometry(breed === "corgi" ? 0.095 : 0.075, 10, 8), breed === "corgi" ? accentMat : coatMat);
      stub.scale.set(0.92, 0.9, 1.25);
      stub.position.set(0, 0.05, -0.06);
      tailPivot.add(stub);
    } else if (breed === "shiba") {
      // Rabinho enrolado clássico do Shiba Inu
      var curlTail = new T.Mesh(new T.TorusGeometry(0.11, 0.042, 10, 18, Math.PI * 1.45), coatMat);
      curlTail.rotation.y = Math.PI / 2;
      curlTail.position.set(0, 0.15, -0.06);
      tailPivot.add(curlTail);
      tailPivot.add(roundedPart(accentMat, 0, 0.24, -0.02, 0.044, 0.044, 0.044));
    } else if (breed === "husky" || breed === "golden") {
      // Cauda felpuda e elegante
      var plumeLen = 0.42;
      var plume = roundedPart(breed === "husky" ? coatMat : coatMat, 0, 0.19, -0.15, 0.072, plumeLen * 0.56, 0.078);
      plume.rotation.x = -0.58;
      tailPivot.add(plume);
      tailPivot.add(roundedPart(accentMat, 0, 0.34, -0.26, 0.058, 0.088, 0.058));
    } else if (breed === "poodle") {
      var pStem = new T.Mesh(new T.CylinderGeometry(0.026, 0.034, 0.26, 8), coatMat);
      pStem.position.set(0, 0.12, -0.08);
      pStem.rotation.x = -0.6;
      tailPivot.add(pStem);
      var pPom = new T.Mesh(new T.SphereGeometry(0.095, 12, 10), accentMat);
      pPom.position.set(0, 0.24, -0.17);
      tailPivot.add(pPom);
    } else if (breed === "shiitsu") {
      var sPlume = new T.Mesh(new T.SphereGeometry(0.11, 12, 10), accentMat);
      sPlume.scale.set(0.82, 1.35, 1.15);
      sPlume.position.set(0, 0.16, -0.08);
      sPlume.rotation.x = 0.35;
      tailPivot.add(sPlume);
    } else {
      var tailLen = breed === "salsicha" ? 0.32 : 0.36;
      var tMesh = new T.Mesh(new T.CylinderGeometry(0.028, 0.048, tailLen, 10), coatMat);
      tMesh.position.set(0, tailLen * 0.42, -tailLen * 0.32);
      tMesh.rotation.x = -0.68;
      tailPivot.add(tMesh);
      if (breed === "caramelo") {
        var tTip = new T.Mesh(new T.SphereGeometry(0.036, 8, 8), accentMat);
        tTip.position.set(0, tailLen * 0.78, -tailLen * 0.6);
        tailPivot.add(tTip);
      }
    }

    // 4. PATAS DIANTEIRAS / BRAÇOS ARTICULADOS + XÍCARA DE CAFÉ NA PATA DIREITA!
    var arms = [], elbows = [];
    var coffeeMug = null;
    var armSpread = dims.torsoW * 0.56;
    [-armSpread, armSpread].forEach(function (dx, sideIdx) {
      var sh = new T.Group();
      sh.position.set(dx, shoulderY, 0.04);
      bodyGroup.add(sh);

      var uArm = roundedPart(coatMat, 0, -0.095, 0, 0.081, 0.147, 0.076);
      sh.add(uArm);

      var elb = new T.Group();
      elb.position.set(0, -0.21, 0);
      sh.add(elb);

      var fArm = roundedPart(coatMat, 0, -0.098, 0, 0.061, 0.13, 0.059);
      elb.add(fArm);

      if (breed === "poodle") {
        var wCuff = new T.Mesh(new T.SphereGeometry(0.074, 10, 8), accentMat);
        wCuff.position.y = -0.14;
        elb.add(wCuff);
      }

      var handPaw = new T.Mesh(new T.SphereGeometry(0.064, 10, 8), accentMat);
      handPaw.scale.set(0.95, 0.78, 1.15);
      handPaw.position.set(0, -0.21, 0.03);
      elb.add(handPaw);
      elb.add(roundedPart(padMat, 0, -0.256, 0.034, 0.031, 0.011, 0.033));
      [-0.031, 0, 0.031].forEach(function (toe) {
        elb.add(roundedPart(accentMat, toe, -0.223, 0.079, 0.020, 0.026, 0.027));
      });

      // Xícara de café quentinho na pata direita (engraçado e charmoso!)
      if (sideIdx === 1) {
        coffeeMug = new T.Group();
        coffeeMug.position.set(0, -0.21, 0.12);
        var cupMat = new T.MeshStandardMaterial({ color: "#e2ece4", roughness: 0.28 });
        var cupBody = new T.Mesh(new T.LatheGeometry([
          new T.Vector2(0, -0.062), new T.Vector2(0.045, -0.062),
          new T.Vector2(0.057, -0.046), new T.Vector2(0.07, 0.061),
          new T.Vector2(0.061, 0.061), new T.Vector2(0.052, -0.04),
          new T.Vector2(0, -0.04)
        ], 24), cupMat);
        var rim = new T.Mesh(new T.TorusGeometry(0.0655, 0.0048, 8, 24), cupMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.061;
        var coffeeTop = new T.Mesh(new T.CircleGeometry(0.059, 24), mat("#58321f", 0, 0.28));
        coffeeTop.rotation.x = -Math.PI / 2;
        coffeeTop.position.y = 0.043;
        var cupHandle = new T.Mesh(new T.TorusGeometry(0.033, 0.009, 8, 18), cupMat);
        cupHandle.rotation.y = Math.PI / 2;
        cupHandle.position.set(0, -0.004, -0.064);
        coffeeMug.add(cupBody, rim, coffeeTop, cupHandle);
        coffeeMug.userData.parentRotation = new T.Quaternion();
        coffeeMug.userData.steam = Array.from({ length: 3 }, function () {
          var puff = new T.Mesh(softSphere, new T.MeshBasicMaterial({
            color: "#fff4de", transparent: true, opacity: 0, depthWrite: false
          }));
          coffeeMug.add(puff);
          return puff;
        });
        coffeeMug.visible = false;
        elb.add(coffeeMug);
      }

      arms.push(sh);
      elbows.push(elb);
    });

    // 5. CABEÇA ESCULPIDA POR RAÇA (ZERO cabelo/orelha flutuando — tudo ancorado dentro do crânio!)
    var head = new T.Group();
    head.position.set(0, headY, 0.04);
    bodyGroup.add(head);

    var r = dims.headR;
    var cranium = new T.Mesh(new T.SphereGeometry(r, 20, 16), coatMat);
    if (breed === "bulldog") cranium.scale.set(1.12, 0.94, 1.02);
    else if (breed === "salsicha") cranium.scale.set(0.92, 0.96, 1.12);
    cranium.castShadow = true;
    head.add(cranium);
    if (breed === "caramelo" || breed === "shiitsu" || breed === "corgi" || breed === "husky") {
      var blaze = roundedPart(breed === "husky" || breed === "corgi" ? accentMat : markingMat, 0, r * 0.49, r * 0.82,
        r * (breed === "shiitsu" || breed === "husky" ? 0.26 : 0.18), r * 0.42, r * 0.19);
      blaze.rotation.x = -0.51;
      head.add(blaze);
    }
    if (breed === "dalmata") {
      head.add(roundedPart(spotMat, r * 0.44, r * 0.22, r * 0.72, 0.048, 0.044, 0.03));
      head.add(roundedPart(spotMat, -r * 0.52, r * 0.38, r * 0.56, 0.042, 0.036, 0.028));
      head.add(roundedPart(spotMat, r * 0.18, r * 0.62, r * 0.44, 0.036, 0.032, 0.026));
    }
    if (breed === "shiba" || breed === "husky") {
      // Bochechas claras estilo urajiro / máscara facial branca
      [-1, 1].forEach(function (side) {
        head.add(roundedPart(accentMat, side * r * 0.46, -r * 0.24, r * 0.66, 0.085, 0.072, 0.078));
      });
    }
    if (breed === "bulldog") {
      var fold = roundedPart(markingMat, 0, r * 0.30, r * 0.91, r * 0.53, 0.030, 0.036);
      head.add(fold);
    }

    // Focinho proporcional à raça
    var snout = new T.Mesh(new T.SphereGeometry(dims.snoutW, 14, 12), accentMat);
    snout.scale.set(1.0, 0.72, dims.snoutL / Math.max(0.08, dims.snoutW));
    snout.position.set(0, -r * 0.22, r * 0.72 + dims.snoutL * 0.22);
    snout.castShadow = true;
    head.add(snout);

    // Bochechas fofas extras no Bulldog e Shih-tzu
    if (breed === "bulldog" || breed === "shiitsu") {
      [-1, 1].forEach(function (side) {
        var jowl = new T.Mesh(new T.SphereGeometry(breed === "bulldog" ? 0.098 : 0.088, 12, 10), accentMat);
        jowl.position.set(side * r * 0.42, -r * 0.34, r * 0.68);
        head.add(jowl);
      });
    }

    // Trufa (nariz brilhante)
    [-1, 1].forEach(function (side) {
      head.add(roundedPart(accentMat, side * dims.snoutW * 0.45, -r * 0.25,
        snout.position.z + dims.snoutL * 0.55, dims.snoutW * 0.54, dims.snoutW * 0.48, dims.snoutL * 0.42));
    });
    var noseZ = r * 0.72 + dims.snoutL * 0.95;
    var nose = new T.Mesh(new T.SphereGeometry(breed === "bulldog" ? 0.054 : 0.046, 12, 10), noseMat);
    nose.scale.set(1.25, 0.85, 0.9);
    nose.position.set(0, -r * 0.1, noseZ);
    head.add(nose);
    head.add(roundedPart(pupilMat, 0, -r * 0.225, noseZ + 0.02, 0.012, 0.028, 0.009));

    // Boca articulada + linguinha (anima ao falar!)
    var mouth = new T.Group();
    mouth.position.set(0, -r * 0.42, r * 0.78 + dims.snoutL * 0.32);
    var mInner = new T.Mesh(new T.BoxGeometry(0.095, 0.026, 0.05), mouthMat);
    mouth.add(mInner);
    var tongue = new T.Mesh(new T.SphereGeometry(0.032, 8, 8), tongueMat);
    tongue.scale.set(0.9, 0.45, 1.3);
    tongue.position.set(0, -0.015, 0.028);
    mouth.add(tongue);
    if (breed === "bulldog") {
      // Dois dentinhos fofos característicos do Bulldog!
      [-0.038, 0.038].forEach(function (tx) {
        var tooth = new T.Mesh(new T.ConeGeometry(0.012, 0.032, 6), eyeWhiteMat);
        tooth.position.set(tx, 0.018, 0.03);
        mouth.add(tooth);
      });
    }
    head.add(mouth);

    // Olhos expressivos com brilho (piscam e fecham ao dormir zzz!)
    var eyeGroups = [];
    var eyeSep = r * 0.42;
    [-eyeSep, eyeSep].forEach(function (ex) {
      var eg = new T.Group();
      eg.position.set(ex, r * 0.14, r * 0.84);
      var sclera = new T.Mesh(new T.SphereGeometry(0.044, 12, 10), eyeWhiteMat);
      var pupil = new T.Mesh(new T.SphereGeometry(0.028, 10, 8), pupilMat);
      pupil.position.z = 0.026;
      var catchlight = new T.Mesh(new T.SphereGeometry(0.009, 6, 6), eyeWhiteMat);
      catchlight.position.set(0.01, 0.012, 0.046);
      var iris = roundedPart(irisMat, 0, 0, 0.026, 0.033, 0.035, 0.021);
      pupil.scale.set(0.79, 0.87, 0.65);
      pupil.position.z = 0.042;
      catchlight.position.z = 0.057;
      eg.add(sclera, iris, pupil, catchlight);
      head.add(eg);
      var brow = roundedPart(markingMat, ex, r * 0.14 + 0.061, r * 0.87,
        breed === "bulldog" ? 0.072 : 0.052, breed === "poodle" ? 0.035 : 0.022, 0.033);
      brow.rotation.z = Math.sign(ex) * (breed === "bulldog" ? 0.28 : -0.16);
      head.add(brow);
      eyeGroups.push(eg);
    });

    // Óculos redondos charmosos para Filósofo / Mediador (encaixados rente aos olhos!)
    if (opts.funcao === "filosofo" || opts.funcao === "mediador") {
      var frameMat = new T.MeshStandardMaterial({ color: "#d4af37", metalness: 0.72, roughness: 0.25 });
      [-eyeSep, eyeSep].forEach(function (gx) {
        var rim = new T.Mesh(new T.TorusGeometry(0.054, 0.008, 8, 18), frameMat);
        rim.position.set(gx, r * 0.14, r * 0.94);
        head.add(rim);
      });
      var bridge = new T.Mesh(new T.BoxGeometry(eyeSep * 0.75, 0.008, 0.008), frameMat);
      bridge.position.set(0, r * 0.14, r * 0.94);
      head.add(bridge);
    }

    // ORELHAS E TOPETES ANCORADOS DIRETAMENTE NA SUPERFÍCIE DO CRÂNIO (ZERO FLUTUAÇÃO!)
    var ears = [];
    if (breed === "caramelo") {
      // Orelhas triangulares espertas levemente inclinadas (base embutida no crânio!)
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.62, r * 0.58, -0.02);
        var earOuter = new T.Mesh(new T.ConeGeometry(0.088, 0.22, 8), earMat);
        earOuter.position.y = 0.07;
        earOuter.rotation.z = -side * 0.34;
        earOuter.rotation.x = 0.18;
        earOuter.scale.z = 0.62;
        var lining = roundedPart(earLiningMat, side * 0.022, 0.086, 0.042, 0.035, 0.066, 0.014);
        lining.rotation.z = earOuter.rotation.z;
        ep.add(earOuter, lining);
        head.add(ep);
        ears.push(ep);
      });
    } else if (breed === "salsicha") {
      // Orelhas longas e caídas coladas nas laterais da cabeça
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.82, r * 0.18, 0.0);
        var flap = new T.Mesh(new T.SphereGeometry(0.082, 12, 10), earMat);
        flap.scale.set(0.42, 1.95, 0.92);
        flap.position.set(side * 0.02, -0.11, 0.02);
        flap.rotation.z = side * 0.12;
        var fold = roundedPart(earLiningMat, -side * 0.004, -0.066, 0.073, 0.021, 0.094, 0.019);
        fold.rotation.z = flap.rotation.z;
        ep.add(flap, fold);
        head.add(ep);
        ears.push(ep);
      });
    } else if (breed === "bulldog") {
      // Orelhinhas dobradas tipo rosa coladas no alto-lateral da cabeça
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.85, r * 0.44, -0.02);
        var rose = new T.Mesh(new T.SphereGeometry(0.075, 10, 8), earMat);
        rose.scale.set(0.62, 0.9, 0.85);
        rose.position.set(side * 0.02, -0.02, 0);
        rose.rotation.z = side * 0.48;
        ep.add(rose, roundedPart(earLiningMat, side * 0.012, 0.001, 0.048, 0.034, 0.04, 0.02));
        head.add(ep);
        ears.push(ep);
      });
    } else if (breed === "shiitsu") {
      // Orelhas peludas caídas + topete fofo firmemente encaixado no topo do crânio com lacinho
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.84, r * 0.12, 0.0);
        var earFluff = new T.Mesh(new T.SphereGeometry(0.095, 12, 10), earMat);
        earFluff.scale.set(0.55, 1.62, 0.88);
        earFluff.position.set(side * 0.02, -0.09, 0);
        ep.add(earFluff,
          roundedPart(earMat, side * 0.025, -0.16, 0.066, 0.048, 0.082, 0.044),
          roundedPart(accentMat, -side * 0.018, -0.085, 0.063, 0.034, 0.079, 0.034));
        head.add(ep);
        ears.push(ep);
      });
      // Topete ancorado DENTRO do topo do crânio (y = r * 0.82 -> zero espaço vazio!)
      var tuft = new T.Mesh(new T.SphereGeometry(0.11, 12, 10), accentMat);
      tuft.scale.set(1.05, 0.78, 0.95);
      tuft.position.set(0, r * 0.82, 0.03);
      head.add(tuft);
      var miniBow = new T.Mesh(new T.BoxGeometry(0.09, 0.038, 0.032), collarMat);
      miniBow.position.set(0, r * 0.72, 0.1);
      head.add(miniBow);
    } else if (breed === "poodle") {
      // Coroa fofa cacheada firmemente embutida no topo do crânio + orelhas pompom coladas nas laterais
      var crown = new T.Mesh(new T.SphereGeometry(r * 0.82, 14, 12), coatMat);
      crown.scale.set(1.04, 0.74, 1.0);
      crown.position.set(0, r * 0.66, 0.0);
      head.add(crown);
      for (var curl = 0; curl < 7; curl++) {
        var angle = curl * Math.PI * 2 / 7;
        head.add(roundedPart(curl % 2 ? coatMat : accentMat, Math.cos(angle) * r * 0.57,
          r * 0.91, Math.sin(angle) * r * 0.49, 0.078, 0.072, 0.077));
      }
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.86, r * 0.15, -0.02);
        var eTop = new T.Mesh(new T.SphereGeometry(0.088, 12, 10), earMat);
        eTop.position.set(side * 0.02, -0.04, 0);
        var eBot = new T.Mesh(new T.SphereGeometry(0.096, 12, 10), coatMat);
        eBot.position.set(side * 0.03, -0.15, 0);
        ep.add(eTop, eBot);
        head.add(ep);
        ears.push(ep);
      });
    } else if (breed === "husky" || breed === "shiba") {
      // Orelhas triangulares eretas e pontudas (Husky / Shiba Inu)
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.56, r * 0.62, -0.02);
        var earH = breed === "husky" ? 0.25 : 0.21;
        var earCone = new T.Mesh(new T.ConeGeometry(0.088, earH, 8), earMat);
        earCone.position.y = earH * 0.38;
        earCone.rotation.z = -side * 0.18;
        earCone.rotation.x = 0.12;
        earCone.scale.z = 0.6;
        var inner = roundedPart(breed === "husky" ? accentMat : earLiningMat, side * 0.012, earH * 0.36, 0.036, 0.036, 0.068, 0.014);
        inner.rotation.z = earCone.rotation.z;
        ep.add(earCone, inner);
        head.add(ep);
        ears.push(ep);
      });
    } else if (breed === "corgi") {
      // Orelhonas grandes e arredondadas eretas típicas do Corgi!
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.62, r * 0.58, -0.02);
        var bigEar = roundedPart(coatMat, side * 0.05, 0.11, 0, 0.095, 0.155, 0.042);
        bigEar.rotation.z = -side * 0.32;
        var inner = roundedPart(earLiningMat, side * 0.052, 0.11, 0.024, 0.058, 0.105, 0.018);
        inner.rotation.z = bigEar.rotation.z;
        ep.add(bigEar, inner);
        head.add(ep);
        ears.push(ep);
      });
    } else if (breed === "golden" || breed === "dalmata") {
      // Orelhas médias caídas e macias nas laterais da cabeça
      [-1, 1].forEach(function (side) {
        var ep = new T.Group();
        ep.position.set(side * r * 0.82, r * 0.26, 0.01);
        var earMatUse = breed === "dalmata" ? spotMat : earMat;
        var flap = roundedPart(earMatUse, side * 0.03, -0.095, 0.02, 0.046, 0.145, 0.075);
        flap.rotation.z = side * 0.16;
        ep.add(flap);
        if (breed === "golden") {
          ep.add(roundedPart(coatMat, side * 0.035, -0.145, 0.03, 0.038, 0.08, 0.056));
        }
        head.add(ep);
        ears.push(ep);
      });
    }

    return {
      g: rootGroup,
      bodyGroup: bodyGroup,
      head: head,
      arms: arms,
      elbows: elbows,
      legs: legs,
      knees: knees,
      ears: ears,
      tail: tailPivot,
      eyeGroups: eyeGroups,
      mouth: mouth,
      coffeeMug: coffeeMug,
      breed: breed,
      yOff: dims.yOff
    };
  }

  function buildAgentMesh(spec, home, chassiId) {
    var rig = buildDogRig({
      breed: chassiId,
      isAgent: true,
      fornecedor: spec.fornecedor || "",
      funcao: spec.funcao || ""
    });

    rig.g.position.set(home.x, home.y || 0, home.z);
    rig.g.rotation.y = home.yaw || 0;
    scene.add(rig.g);

    var ringMat = new T.MeshStandardMaterial({ color: "#34d399", emissive: "#10b981", emissiveIntensity: 1.2, roughness: 0.35 });
    var ring = new T.Mesh(new T.TorusGeometry(0.68, 0.035, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    rig.g.add(ring);

    var label = el("div", { class: "agentlabel" });
    var emoteEl = el("div", { class: "aa-emote", hidden: true });
    var zzzEl = el("div", { class: "aa-zzz", hidden: true }, [
      el("span", { text: "Z" }),
      el("span", { text: "z" }),
      el("span", { text: "z" })
    ]);
    var bubbleTitle = el("strong", { text: spec.name });
    var bubbleReplay = el("button", { type: "button", class: "aa-bbl-btn", title: "Reler fala", text: "↺" });
    var bubbleFast = el("button", { type: "button", class: "aa-bbl-btn", title: "Mostrar tudo", text: "⏭" });
    var bubbleClose = el("button", { type: "button", class: "aa-bbl-btn", title: "Fechar balão", text: "✕" });
    var bubbleBodyText = document.createTextNode("");
    var bubbleCursor = el("span", { class: "aa-cursor", text: "▍" });
    var bubbleBody = el("div", { class: "aa-bubble-body" }, [bubbleBodyText, bubbleCursor]);
    var bubble = el("div", { class: "aa-bubble", hidden: true }, [
      el("div", { class: "aa-bubble-head" }, [bubbleTitle, el("div", { class: "row" }, [bubbleReplay, bubbleFast, bubbleClose])]),
      bubbleBody
    ]);
    labelsEl.append(label, emoteEl, zzzEl, bubble);

    return {
      chassis: rig.breed,
      hoverGroup: null,
      extraLegs: [],
      wheels: [],
      orbitRings: [],
      coffeeMug: rig.coffeeMug,
      g: rig.g,
      bodyGroup: rig.bodyGroup,
      head: rig.head,
      arms: rig.arms,
      elbows: rig.elbows,
      legs: rig.legs,
      knees: rig.knees,
      ears: rig.ears,
      tail: rig.tail,
      eyeGroups: rig.eyeGroups,
      mouth: rig.mouth,
      ring: ring,
      ringMat: ringMat,
      label: label,
      emoteEl: emoteEl,
      zzzEl: zzzEl,
      bubble: bubble,
      bubbleTitle: bubbleTitle,
      bubbleBody: bubbleBody,
      bubbleBodyText: bubbleBodyText,
      bubbleCursor: bubbleCursor,
      bubbleReplay: bubbleReplay,
      bubbleFast: bubbleFast,
      bubbleClose: bubbleClose
    };
  }

  /* ---------------- Modelo 3D do Operador (Cachorro escolhível pelo usuário + Multiplayer Nostr) ---------------- */
  function criarOperador(opts) {
    opts = opts || {};
    var curBreed = BREED_ORDER.indexOf(opts.breed) >= 0 ? opts.breed : "caramelo";
    var g = new T.Group();
    g.position.set(opts.x || 0, opts.y || 0.15, opts.z || 6.4);
    scene.add(g);

    var rig = null;
    function rebuildVisual(nextBreed) {
      if (rig && rig.g) g.remove(rig.g);
      curBreed = BREED_ORDER.indexOf(nextBreed) >= 0 ? nextBreed : "caramelo";
      rig = buildDogRig({ breed: curBreed, isAgent: false, funcao: "" });
      g.add(rig.g);
      // Pequeno anel identificador discreto sob as patinhas do operador
      var opRing = new T.Mesh(
        new T.TorusGeometry(0.46, 0.025, 8, 24),
        new T.MeshStandardMaterial({ color: opts.accent || "#34d399", emissive: opts.accent || "#10b981", emissiveIntensity: 0.9, roughness: 0.35 })
      );
      opRing.rotation.x = Math.PI / 2;
      opRing.position.y = 0.04;
      rig.g.add(opRing);
    }
    rebuildVisual(curBreed);

    var label = null;
    if (opts.showLabel) {
      label = el("div", { class: "agentlabel operator-label", text: opts.name || "Operador" });
      label.append(el("small", { text: (opts.role || "Operador") + " · " + curBreed }));
      labelsEl.append(label);
    }

    return {
      id: opts.id || "local",
      name: opts.name || "Você",
      get breed() { return curBreed; },
      setBreed: function (b) {
        if (b && b !== curBreed) {
          rebuildVisual(b);
          if (label) {
            label.textContent = opts.name || "Operador";
            label.append(el("small", { text: (opts.role || "Operador") + " · " + curBreed }));
          }
        }
      },
      g: g,
      get bodyGroup() { return rig.bodyGroup; },
      get head() { return rig.head; },
      get arms() { return rig.arms; },
      get legs() { return rig.legs; },
      label: label,
      setFirstPersonMode: function (isFp) { g.visible = !isFp; },
      updatePose: function (dt, elapsed, pos, yaw, speed, sitting) {
        g.position.set(pos.x, pos.y, pos.z);
        g.rotation.y = yaw + Math.PI;
        var moving = speed > 0.15;
        var blink = Math.abs((elapsed % 4.3) - 4.10);
        rig.eyeGroups.forEach(function (eye) {
          eye.scale.y = 0.09 + 0.91 * Math.min(1, blink / 0.11);
        });
        rig.ears.forEach(function (ear, index) {
          ear.rotation.x = Math.sin(elapsed * (moving ? 10 : 2.3) + index * 0.55) * (moving ? 0.10 : 0.025);
        });
        var pitch = moving && !sitting ? Math.sin(elapsed * 10) * 0.075 : Math.sin(elapsed * 1.7) * 0.024;
        rig.head.rotation.x += (pitch - rig.head.rotation.x) * Math.min(1, dt * 8);
        if (rig.tail) {
          rig.tail.rotation.y = Math.sin(elapsed * (moving ? 11 : 4.5)) * (moving ? 0.45 : 0.24);
        }
        if (sitting) {
          rig.bodyGroup.position.y = -0.14;
          rig.legs[0].rotation.x = -1.35; rig.legs[1].rotation.x = -1.35;
          rig.knees[0].rotation.x = 1.35; rig.knees[1].rotation.x = 1.35;
          rig.arms[0].rotation.x = -0.32; rig.arms[1].rotation.x = -0.32;
          rig.elbows[0].rotation.x = -0.4; rig.elbows[1].rotation.x = -0.4;
        } else if (moving) {
          var sw = Math.sin(elapsed * 10) * 0.55;
          rig.bodyGroup.position.y = Math.abs(Math.sin(elapsed * 10)) * 0.05;
          rig.legs[0].rotation.x = sw; rig.legs[1].rotation.x = -sw;
          rig.knees[0].rotation.x = Math.max(0, -sw * 0.7); rig.knees[1].rotation.x = Math.max(0, sw * 0.7);
          rig.arms[0].rotation.x = -sw * 0.58; rig.arms[1].rotation.x = sw * 0.58;
          rig.elbows[0].rotation.x = -0.2; rig.elbows[1].rotation.x = -0.2;
        } else {
          rig.bodyGroup.position.y = Math.sin(elapsed * 2.2) * 0.015;
          rig.legs[0].rotation.x *= 0.85; rig.legs[1].rotation.x *= 0.85;
          rig.knees[0].rotation.x *= 0.85; rig.knees[1].rotation.x *= 0.85;
          rig.arms[0].rotation.x *= 0.85; rig.arms[1].rotation.x *= 0.85;
          rig.elbows[0].rotation.x = -0.15; rig.elbows[1].rotation.x = -0.15;
        }
      },
      destroy: function () {
        scene.remove(g);
        if (label) label.remove();
      }
    };
  }

  function criarGerenciadorOperadores() {
    var local = null;
    var remotes = new Map();
    return {
      createLocal: function (opts) {
        if (local) local.destroy();
        local = criarOperador(Object.assign({ id: "local", name: "Você", role: "Operador", showLabel: false }, opts || {}));
        return local;
      },
      getLocal: function () { return local; },
      upsertRemote: function (id, state) {
        var op = remotes.get(id);
        if (!op) {
          op = criarOperador({
            id: id,
            name: state.name || ("Operador " + id),
            role: state.role || "Operador (Nostr)",
            breed: state.breed || "caramelo",
            accent: state.accent || "#38bdf8",
            showLabel: true
          });
          remotes.set(id, op);
        } else if (state.breed) {
          op.setBreed(state.breed);
        }
        if (state.pos) {
          op.updatePose(0.016, performance.now() / 1000, state.pos, state.yaw || 0, state.speed || 0, Boolean(state.sitting));
        }
        return op;
      },
      removeRemote: function (id) {
        var op = remotes.get(id);
        if (op) { op.destroy(); remotes.delete(id); }
      },
      listRemotes: function () { return Array.from(remotes.values()); },
      destroyAll: function () {
        if (local) { local.destroy(); local = null; }
        remotes.forEach(function (op) { op.destroy(); });
        remotes.clear();
      }
    };
  }

  return { escolherChassi, buildAgentMesh, criarOperador, criarGerenciadorOperadores };
}
