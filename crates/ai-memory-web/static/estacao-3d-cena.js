export const CHALET_ZONES = {
  lareira: {
    id: "lareira",
    label: "Roda da Lareira",
    area: "Chalé",
    state: "seat",
    lookAt: { x: 0, z: -2.4 },
    slots: [
      { x: 0, z: -6.1, yaw: 0, seat: true },
      { x: 2.7, z: -5.5, yaw: -0.48, seat: true },
      { x: -2.7, z: -5.5, yaw: 0.48, seat: true },
      { x: 4.5, z: -3.7, yaw: -1.14, seat: true },
      { x: -4.5, z: -3.7, yaw: 1.14, seat: true },
      { x: 5.1, z: -1.2, yaw: -1.68, seat: true },
      { x: -5.1, z: -1.2, yaw: 1.68, seat: true },
      { x: 4.1, z: 1.2, yaw: -2.3, seat: true },
      { x: -4.1, z: 1.2, yaw: 2.3, seat: true },
      { x: 2.3, z: 2.5, yaw: -2.7, seat: true },
      { x: -2.3, z: 2.5, yaw: 2.7, seat: true },
      { x: 6.2, z: -2.6, yaw: -1.5, seat: false }
    ]
  },
  cafe: {
    id: "cafe",
    label: "Balcão de Café",
    area: "Chalé",
    state: "coffee",
    lookAt: { x: -10.4, z: -1.8 },
    slots: [
      { x: -8.35, z: -4.0, yaw: -Math.PI / 2, seat: true },
      { x: -8.35, z: -2.5, yaw: -Math.PI / 2, seat: true },
      { x: -8.35, z: -1.0, yaw: -Math.PI / 2, seat: true },
      { x: -8.35, z: 0.5, yaw: -Math.PI / 2, seat: true },
      { x: -6.8, z: -3.4, yaw: -Math.PI / 2, seat: false },
      { x: -6.8, z: -1.8, yaw: -Math.PI / 2, seat: false },
      { x: -6.8, z: -0.2, yaw: -Math.PI / 2, seat: false },
      { x: -6.8, z: 1.4, yaw: -Math.PI / 2, seat: false },
      { x: -5.6, z: -2.6, yaw: -Math.PI / 2, seat: false },
      { x: -5.6, z: -0.8, yaw: -Math.PI / 2, seat: false },
      { x: -5.6, z: 0.8, yaw: -Math.PI / 2, seat: false },
      { x: -7.5, z: 2.2, yaw: -2.2, seat: false }
    ]
  },
  tv: {
    id: "tv",
    label: "Cantinho da TV",
    area: "Chalé",
    state: "tv",
    lookAt: { x: 11.4, z: -1.6 },
    slots: [
      { x: 7.45, z: -2.8, yaw: Math.PI / 2, seat: true },
      { x: 7.45, z: -1.6, yaw: Math.PI / 2, seat: true },
      { x: 7.45, z: -0.4, yaw: Math.PI / 2, seat: true },
      { x: 8.5, z: -4.2, yaw: 0.72, seat: true },
      { x: 8.5, z: 1.0, yaw: 2.42, seat: true },
      { x: 6.2, z: -3.6, yaw: 1.2, seat: false },
      { x: 6.2, z: -1.6, yaw: Math.PI / 2, seat: false },
      { x: 6.2, z: 0.4, yaw: 1.9, seat: false },
      { x: 7.4, z: 2.0, yaw: 2.2, seat: false },
      { x: 7.4, z: -5.2, yaw: 0.9, seat: false },
      { x: 5.4, z: -2.6, yaw: 1.4, seat: false },
      { x: 5.4, z: -0.6, yaw: 1.7, seat: false }
    ]
  },
  mesa: {
    id: "mesa",
    label: "Mesa de Trabalho",
    area: "Chalé",
    state: "work",
    lookAt: { x: -6.8, z: 5.8 },
    slots: [
      { x: -8.2, z: 4.35, yaw: 0, seat: true },
      { x: -6.8, z: 4.35, yaw: 0, seat: true },
      { x: -5.4, z: 4.35, yaw: 0, seat: true },
      { x: -8.2, z: 7.25, yaw: Math.PI, seat: true },
      { x: -6.8, z: 7.25, yaw: Math.PI, seat: true },
      { x: -5.4, z: 7.25, yaw: Math.PI, seat: true },
      { x: -9.6, z: 5.8, yaw: Math.PI / 2, seat: true },
      { x: -4.0, z: 5.8, yaw: -Math.PI / 2, seat: true },
      { x: -4.5, z: 4.0, yaw: -0.7, seat: false },
      { x: -4.5, z: 7.6, yaw: -2.4, seat: false },
      { x: -9.2, z: 4.0, yaw: 0.7, seat: false },
      { x: -9.2, z: 7.6, yaw: 2.4, seat: false }
    ]
  },
  biblioteca: {
    id: "biblioteca",
    label: "Biblioteca",
    area: "Chalé",
    state: "stand",
    lookAt: { x: 8.2, z: -9.0 },
    slots: [
      { x: 7.2, z: -6.8, yaw: 2.4, seat: true },
      { x: 9.0, z: -6.8, yaw: 2.9, seat: true },
      { x: 6.2, z: -8.0, yaw: 1.8, seat: false },
      { x: 8.2, z: -7.8, yaw: Math.PI, seat: false },
      { x: 9.8, z: -7.6, yaw: -2.6, seat: false },
      { x: 5.6, z: -6.6, yaw: 2.2, seat: false },
      { x: 7.4, z: -5.5, yaw: 2.8, seat: false },
      { x: 9.4, z: -5.6, yaw: -2.9, seat: false },
      { x: 6.4, z: -5.2, yaw: 2.5, seat: false },
      { x: 8.4, z: -5.0, yaw: Math.PI, seat: false },
      { x: 10.2, z: -6.4, yaw: -2.4, seat: false },
      { x: 5.0, z: -7.6, yaw: 1.9, seat: false }
    ]
  },
  varanda: {
    id: "varanda",
    label: "Varanda do Chalé",
    area: "Área Externa",
    state: "seat",
    lookAt: { x: 0, z: 22.0 },
    slots: [
      { x: -6.2, z: 12.6, yaw: 0.25, seat: true },
      { x: -4.4, z: 12.6, yaw: -0.25, seat: true },
      { x: 4.4, z: 12.6, yaw: 0.25, seat: true },
      { x: 6.2, z: 12.6, yaw: -0.25, seat: true },
      { x: -8.2, z: 13.0, yaw: 0.15, seat: false },
      { x: 8.2, z: 13.0, yaw: -0.15, seat: false },
      { x: -3.0, z: 13.4, yaw: 0, seat: false },
      { x: 3.0, z: 13.4, yaw: 0, seat: false },
      { x: -7.2, z: 11.4, yaw: 0.1, seat: false },
      { x: 7.2, z: 11.4, yaw: -0.1, seat: false },
      { x: -5.3, z: 14.0, yaw: 0, seat: false },
      { x: 5.3, z: 14.0, yaw: 0, seat: false }
    ]
  },
  fogueira: {
    id: "fogueira",
    label: "Fogueira Externa",
    area: "Área Externa",
    state: "campfire",
    lookAt: { x: 0, z: 22.5 },
    slots: [
      { x: 0, z: 18.6, yaw: 0, seat: true },
      { x: 2.75, z: 19.75, yaw: -0.78, seat: true },
      { x: 3.9, z: 22.5, yaw: -Math.PI / 2, seat: true },
      { x: 2.75, z: 25.25, yaw: -2.36, seat: true },
      { x: 0, z: 26.4, yaw: Math.PI, seat: true },
      { x: -2.75, z: 25.25, yaw: 2.36, seat: true },
      { x: -3.9, z: 22.5, yaw: Math.PI / 2, seat: true },
      { x: -2.75, z: 19.75, yaw: 0.78, seat: true },
      { x: 5.1, z: 20.8, yaw: -1.2, seat: false },
      { x: -5.1, z: 20.8, yaw: 1.2, seat: false },
      { x: 5.1, z: 24.2, yaw: -1.9, seat: false },
      { x: -5.1, z: 24.2, yaw: 1.9, seat: false }
    ]
  },
  gazebo: {
    id: "gazebo",
    label: "Gazebo do Jardim",
    area: "Área Externa",
    state: "seat",
    lookAt: { x: -11.5, z: 22.5 },
    slots: [
      { x: -11.5, z: 20.5, yaw: 0, seat: true },
      { x: -11.5, z: 24.5, yaw: Math.PI, seat: true },
      { x: -13.5, z: 22.5, yaw: Math.PI / 2, seat: true },
      { x: -9.5, z: 22.5, yaw: -Math.PI / 2, seat: true },
      { x: -10.1, z: 21.1, yaw: -0.75, seat: false },
      { x: -12.9, z: 21.1, yaw: 0.75, seat: false },
      { x: -10.1, z: 23.9, yaw: -2.35, seat: false },
      { x: -12.9, z: 23.9, yaw: 2.35, seat: false },
      { x: -8.6, z: 21.2, yaw: -1.1, seat: false },
      { x: -8.6, z: 23.8, yaw: -2.0, seat: false },
      { x: -14.4, z: 21.2, yaw: 1.1, seat: false },
      { x: -14.4, z: 23.8, yaw: 2.0, seat: false }
    ]
  },
  jardim: {
    id: "jardim",
    label: "Jardim & Mirante do Lago",
    area: "Área Externa",
    state: "seat",
    lookAt: { x: 11.5, z: 22.0 },
    slots: [
      { x: 10.2, z: 20.6, yaw: 0, seat: true },
      { x: 11.5, z: 20.6, yaw: 0, seat: true },
      { x: 12.8, z: 20.6, yaw: 0, seat: true },
      { x: 10.2, z: 23.4, yaw: Math.PI, seat: true },
      { x: 11.5, z: 23.4, yaw: Math.PI, seat: true },
      { x: 12.8, z: 23.4, yaw: Math.PI, seat: true },
      { x: 8.6, z: 22.0, yaw: Math.PI / 2, seat: false },
      { x: 14.4, z: 22.0, yaw: -Math.PI / 2, seat: false },
      { x: 10.8, z: 25.4, yaw: 0.4, seat: false },
      { x: 12.4, z: 25.4, yaw: -0.3, seat: false },
      { x: 9.2, z: 24.4, yaw: 1.2, seat: false },
      { x: 13.8, z: 24.4, yaw: -1.2, seat: false }
    ]
  }
};

/* ---------------- Texturas Procedurais (CanvasTexture, 100% offline) ---------------- */
function makeProceduralTextures(T) {
  function repeatTex(cv, rx, ry) {
    var tex = new T.CanvasTexture(cv);
    tex.wrapS = T.RepeatWrapping;
    tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(rx || 1, ry || 1);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  // Tábuas de madeira nobre (piso & forro)
  function woodPlank(base, dark, line, rx, ry) {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var c = cv.getContext("2d");
    c.fillStyle = base;
    c.fillRect(0, 0, 512, 512);
    var rows = 8, rh = 512 / rows;
    for (var r = 0; r < rows; r++) {
      var y = r * rh;
      c.fillStyle = r % 2 === 0 ? base : dark;
      c.fillRect(0, y, 512, rh);
      for (var g = 0; g < 18; g++) {
        c.fillStyle = g % 2 === 0 ? "rgba(0,0,0,0.05)" : "rgba(255,235,205,0.04)";
        c.fillRect(0, y + (g * rh) / 18, 512, 2);
      }
      c.fillStyle = line;
      c.fillRect(0, y, 512, 3);
      var joint = ((r * 173 + 90) % 420) + 40;
      c.fillRect(joint, y, 3, rh);
    }
    return repeatTex(cv, rx, ry);
  }

  // Pedra alpina natural (lareira, chaminé e base do chalé)
  function stoneWall(rx, ry) {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var c = cv.getContext("2d");
    c.fillStyle = "#3c3935";
    c.fillRect(0, 0, 512, 512);
    var tones = ["#6d6861", "#5e5953", "#7a746c", "#524e49", "#69635c", "#746e66"];
    var rows = 8, rh = 512 / rows;
    for (var r = 0; r < rows; r++) {
      var x = (r % 2) * -42;
      var i = 0;
      while (x < 512) {
        var bw = 72 + ((r * 31 + i * 47) % 58);
        c.fillStyle = tones[(r * 5 + i * 3) % tones.length];
        c.fillRect(x + 3, r * rh + 3, bw - 6, rh - 6);
        c.fillStyle = "rgba(255,255,255,0.07)";
        c.fillRect(x + 3, r * rh + 3, bw - 6, 4);
        c.fillStyle = "rgba(0,0,0,0.14)";
        c.fillRect(x + 3, (r + 1) * rh - 7, bw - 6, 4);
        x += bw;
        i++;
      }
    }
    return repeatTex(cv, rx, ry);
  }

  // Tapete trançado aconchegante
  function wovenRug() {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var c = cv.getContext("2d");
    c.fillStyle = "#4b433b";
    c.fillRect(0, 0, 512, 512);
    var cx = 256, cy = 256;
    [245, 224, 195, 165, 120, 74].forEach(function (rad, idx) {
      c.beginPath();
      c.arc(cx, cy, rad, 0, Math.PI * 2);
      c.fillStyle = ["#3d3732", "#756555", "#5a4f44", "#8c7762", "#4b433b", "#6b5c4d"][idx];
      c.fill();
    });
    c.strokeStyle = "rgba(255,245,230,0.14)";
    c.lineWidth = 4;
    for (var r = 40; r < 240; r += 26) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    }
    return repeatTex(cv, 1, 1);
  }

  // Grama alpina variada
  function alpineGrass(rx, ry) {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var c = cv.getContext("2d");
    c.fillStyle = "#354d32";
    c.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 1600; i++) {
      var x = (i * 97) % 512, y = (i * 193) % 512;
      c.fillStyle = i % 3 === 0 ? "#2d432b" : (i % 3 === 1 ? "#3e5939" : "#46633e");
      c.fillRect(x, y, 4 + (i % 5), 4 + (i % 4));
    }
    return repeatTex(cv, rx, ry);
  }

  // Telhas de cedro escuro
  function roofShingles(rx, ry) {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var c = cv.getContext("2d");
    c.fillStyle = "#26211e";
    c.fillRect(0, 0, 512, 512);
    for (var r = 0; r < 12; r++) {
      var y = r * (512 / 12);
      for (var k = 0; k < 10; k++) {
        var x = k * 52 + (r % 2) * 26 - 26;
        c.fillStyle = (r + k) % 3 === 0 ? "#2f2925" : ((r + k) % 3 === 1 ? "#241f1c" : "#362f2a");
        c.fillRect(x + 2, y + 2, 48, 38);
      }
      c.fillStyle = "#171412";
      c.fillRect(0, y, 512, 3);
    }
    return repeatTex(cv, rx, ry);
  }

  return {
    floorWood: woodPlank("#966a45", "#865d3b", "#593b23", 6, 5),
    wallTimber: woodPlank("#7f5838", "#724e31", "#4b321e", 3, 2),
    ceilTimber: woodPlank("#785436", "#6a492e", "#462f1c", 4, 4),
    deckWood: woodPlank("#6e4e34", "#61442d", "#3d291a", 5, 2),
    stone: stoneWall(2, 2),
    rug: wovenRug(),
    grass: alpineGrass(18, 18),
    roof: roofShingles(6, 4)
  };
}

export function criarCena(T, mode, getTvStatus) {
  var scene = new T.Scene();
  var isChalet = mode === "juri";
  scene.background = new T.Color(isChalet ? "#b8d0e4" : "#c9d8d5");
  scene.fog = new T.Fog(isChalet ? "#b8d0e4" : "#c9d8d5", isChalet ? 62 : 125, isChalet ? 185 : 290);

  var hemiLight = new T.HemisphereLight(isChalet ? "#edf6ff" : "#f4f9ff", isChalet ? "#4f5c42" : "#5e5c4d", isChalet ? 1.25 : 2.05);
  scene.add(hemiLight);
  var sun = new T.DirectionalLight(isChalet ? "#fff2d6" : "#fff2d6", isChalet ? 2.3 : 3.15);
  sun.position.set(isChalet ? 28 : -22, isChalet ? 40 : 46, isChalet ? 34 : 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, isChalet
    ? { left: -36, right: 36, top: 40, bottom: -28, near: 2, far: 130 }
    : { left: -42, right: 42, top: 42, bottom: -42 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  var texPack = isChalet ? makeProceduralTextures(T) : null;
  var mats = {};
  function mat(c, metal, rough) {
    metal = metal || 0;
    rough = rough == null ? 0.74 : rough;
    var key = c + "|" + metal + "|" + rough;
    return mats[key] || (mats[key] = new T.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough }));
  }
  function texMat(tex, rough, metal) {
    return new T.MeshStandardMaterial({ map: tex, roughness: rough == null ? 0.8 : rough, metalness: metal || 0 });
  }

  var constructionRoot = scene;
  function box(w, h, d, x, y, z, c, parent) {
    parent = parent || constructionRoot;
    var m = new T.Mesh(new T.BoxGeometry(w, h, d), typeof c === "string" ? mat(c) : c);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(r, h, x, y, z, c, parent, r2, segs) {
    parent = parent || constructionRoot;
    r2 = r2 == null ? r : r2;
    var m = new T.Mesh(new T.CylinderGeometry(r2, r, h, segs || 22), typeof c === "string" ? mat(c) : c);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function sphere(r, x, y, z, c, parent) {
    parent = parent || constructionRoot;
    var m = new T.Mesh(new T.SphereGeometry(r, 16, 12), typeof c === "string" ? mat(c) : c);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function cone(r, h, x, y, z, c, parent, segs) {
    parent = parent || constructionRoot;
    var m = new T.Mesh(new T.ConeGeometry(r, h, segs || 10), typeof c === "string" ? mat(c) : c);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function beam(a, b, r, c, parent) {
    var A = new T.Vector3(a[0], a[1], a[2]), B = new T.Vector3(b[0], b[1], b[2]);
    var m = cyl(r, A.distanceTo(B), 0, 0, 0, c, parent);
    m.position.copy(A.clone().add(B).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), B.sub(A).normalize());
    return m;
  }
  function textSprite(s, x, y, z, size, color) {
    size = size || 1.2;
    color = color || "#2c4a43";
    var cv = document.createElement("canvas");
    cv.width = 640; cv.height = 128;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = color;
    ctx.font = "700 32px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(s, 320, 76);
    var tex = new T.CanvasTexture(cv);
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: true }));
    sp.position.set(x, y, z);
    sp.scale.set(size * 4.4, size, 1);
    scene.add(sp);
    return sp;
  }

  var glow = new T.MeshStandardMaterial({ color: "#6ee7b7", emissive: "#10b981", emissiveIntensity: 1.2, roughness: 0.32 });
  var warmGlow = new T.MeshStandardMaterial({ color: "#fde68a", emissive: "#f59e0b", emissiveIntensity: 1.4, roughness: 0.28 });
  var goldMat = new T.MeshStandardMaterial({ color: "#e5c158", emissive: "#a16207", emissiveIntensity: 0.4, metalness: 0.65, roughness: 0.28 });
  var chromeMat = new T.MeshStandardMaterial({ color: "#d4d4d8", metalness: 0.85, roughness: 0.18 });
  var glass = new T.MeshPhysicalMaterial({
    color: "#d4ecfa",
    transparent: true,
    opacity: 0.3,
    roughness: 0.06,
    metalness: 0.14,
    side: T.DoubleSide,
    depthWrite: false
  });
  var speakerGlowMat = new T.MeshStandardMaterial({ color: "#34d399", emissive: "#059669", emissiveIntensity: 0.35, roughness: 0.35 });

  // Smart TV 3D interativa + Caixas de som
  var tvMeshes = [], speakerRings = [], tvScreenMesh = null;
  var redrawTv = function () {};
  function criarSmartTV3D(x, y, z, rotY, scaleW) {
    var sc = scaleW || 1;
    var g = new T.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    g.scale.setScalar(sc);
    scene.add(g);
    var frame1 = box(5.4, 3.2, 0.18, 0, 0, 0, "#141418", g);
    var frame2 = box(5.12, 2.94, 0.06, 0, 0, 0.09, "#09090b", g);
    frame1.userData.tv = true;
    frame2.userData.tv = true;
    tvMeshes.push(frame1, frame2);
    var cv = document.createElement("canvas");
    cv.width = 768; cv.height = 432;
    var ctx = cv.getContext("2d");
    var tex = new T.CanvasTexture(cv);
    function desenharTela() {
      ctx.fillStyle = "#0b0b0e";
      ctx.fillRect(0, 0, 768, 432);
      var grd = ctx.createLinearGradient(0, 0, 768, 432);
      grd.addColorStop(0, "#16161b");
      grd.addColorStop(1, "#0a0a0d");
      ctx.fillStyle = grd;
      ctx.fillRect(14, 14, 740, 404);
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(318, 118, 132, 88, 20);
      else ctx.fillRect(318, 118, 132, 88);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(370, 144); ctx.lineTo(370, 182); ctx.lineTo(406, 163);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f4f4f5";
      ctx.font = "700 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(getTvStatus(), 384, 266);
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "500 20px sans-serif";
      ctx.fillText("Pressione [E] para abrir YouTube & Música", 384, 318);
      tex.needsUpdate = true;
    }
    desenharTela();
    redrawTv = desenharTela;
    var screen = new T.Mesh(new T.PlaneGeometry(4.95, 2.78), new T.MeshBasicMaterial({ map: tex }));
    screen.position.set(0, 0, 0.13);
    screen.userData.tv = true;
    g.add(screen);
    tvScreenMesh = screen;
    tvMeshes.push(screen);
    // Soundbar e torres acústicas de madeira e metal
    box(3.8, 0.22, 0.28, 0, -1.85, 0.12, "#1f1f24", g);
    [-3.1, 3.1].forEach(function (sx) {
      box(0.58, 2.2, 0.56, sx, -1.05, 0.14, "#30251e", g);
      var woofer = new T.Mesh(new T.TorusGeometry(0.18, 0.032, 8, 24), speakerGlowMat);
      woofer.position.set(sx, -0.68, 0.43);
      g.add(woofer);
      speakerRings.push(woofer);
      var woofer2 = new T.Mesh(new T.TorusGeometry(0.13, 0.026, 8, 24), speakerGlowMat);
      woofer2.position.set(sx, -1.3, 0.43);
      g.add(woofer2);
      speakerRings.push(woofer2);
    });
    return g;
  }

  /* ---------------- Sistema Complexo de Fogo Volumétrico (Lareira + Fogueira) ---------------- */
  var fireSystems = [];
  function makeRadialParticleTex(stops) {
    var cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext("2d");
    var g = ctx.createRadialGradient(64, 72, 4, 64, 64, 62);
    stops.forEach(function (st) { g.addColorStop(st[0], st[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }
  var fireCoreTex = makeRadialParticleTex([
    [0.0, "rgba(255,255,235,1.0)"],
    [0.25, "rgba(255,230,120,0.95)"],
    [0.55, "rgba(255,140,28,0.55)"],
    [1.0, "rgba(220,40,0,0.0)"]
  ]);
  var fireMidTex = makeRadialParticleTex([
    [0.0, "rgba(255,215,90,0.95)"],
    [0.35, "rgba(255,115,20,0.85)"],
    [0.7, "rgba(210,38,8,0.38)"],
    [1.0, "rgba(120,10,0,0.0)"]
  ]);
  var fireOuterTex = makeRadialParticleTex([
    [0.0, "rgba(255,120,25,0.75)"],
    [0.45, "rgba(215,45,10,0.48)"],
    [0.8, "rgba(130,15,5,0.14)"],
    [1.0, "rgba(60,5,0,0.0)"]
  ]);
  var smokePuffTex = makeRadialParticleTex([
    [0.0, "rgba(180,175,170,0.42)"],
    [0.45, "rgba(140,136,132,0.22)"],
    [1.0, "rgba(90,88,86,0.0)"]
  ]);
  var sparkGlowTex = makeRadialParticleTex([
    [0.0, "rgba(255,252,210,1.0)"],
    [0.4, "rgba(255,205,70,0.85)"],
    [1.0, "rgba(255,110,20,0.0)"]
  ]);

  function criarSistemaFogo(opts) {
    var g = new T.Group();
    g.position.set(opts.x, opts.y, opts.z);
    scene.add(g);
    var scale = opts.scale || 1;
    var active = true;

    // Leito de brasas incandescentes
    var coalMat = new T.MeshStandardMaterial({
      color: "#2a120a",
      emissive: "#ff4d0a",
      emissiveIntensity: 1.85,
      roughness: 0.88
    });
    var coalBed = cyl(0.74 * scale, 0.12 * scale, 0, 0.06 * scale, 0, coalMat, g, 0.62 * scale, 16);
    coalBed.castShadow = false;
    for (var ci = 0; ci < 14; ci++) {
      var ca = ci * 2.39996;
      var cr = (0.1 + (ci % 4) * 0.15) * scale;
      var cm = sphere((0.085 + (ci % 3) * 0.028) * scale, Math.cos(ca) * cr, 0.11 * scale, Math.sin(ca) * cr, coalMat, g);
      cm.castShadow = false;
    }

    // Lenha carbonizada em fogueira/pirâmide ou empilhada na lareira
    var logMat = mat("#3b2517", 0, 0.92);
    var tipMat = new T.MeshStandardMaterial({ color: "#4a1c0c", emissive: "#f97316", emissiveIntensity: 1.4, roughness: 0.82 });
    var logCount = opts.style === "fireplace" ? 4 : 6;
    for (var lk = 0; lk < logCount; lk++) {
      var lg = new T.Group();
      if (opts.style === "fireplace") {
        var lz = (lk - 1.5) * 0.12 * scale;
        var lMesh = cyl(0.095 * scale, 1.38 * scale, 0, 0, 0, logMat, lg, 0.082 * scale, 10);
        lMesh.rotation.z = Math.PI / 2;
        lg.position.set(0, (0.16 + (lk % 2) * 0.12) * scale, lz);
        lg.rotation.y = (lk % 2 === 0 ? 0.14 : -0.18);
      } else {
        var la = (lk / logCount) * Math.PI * 2 + 0.2;
        var lMesh2 = cyl(0.115 * scale, 1.38 * scale, 0, 0.36 * scale, 0, logMat, lg, 0.085 * scale, 10);
        lMesh2.castShadow = true;
        cyl(0.084 * scale, 0.24 * scale, 0, 0.98 * scale, 0, tipMat, lg, 0.065 * scale, 8).castShadow = false;
        lg.position.set(Math.cos(la) * 0.44 * scale, 0.05 * scale, Math.sin(la) * 0.44 * scale);
        lg.rotation.z = Math.cos(la) * 0.56;
        lg.rotation.x = -Math.sin(la) * 0.56;
      }
      g.add(lg);
    }

    // 32 sprites volumétricos aditivos de fogo (núcleo incandescente + chamas médias + halo externo dinâmico)
    var layers = [
      { count: 8, w: 0.56 * scale, h: 0.78 * scale, spread: 0.18 * scale, rise: 0.44 * scale, speed: 1.85, tex: fireCoreTex },
      { count: 14, w: 0.74 * scale, h: 1.12 * scale, spread: 0.34 * scale, rise: 0.82 * scale, speed: 1.45, tex: fireMidTex },
      { count: 10, w: 0.92 * scale, h: 1.36 * scale, spread: 0.42 * scale, rise: 1.08 * scale, speed: 1.15, tex: fireOuterTex }
    ];
    var tongues = [];
    layers.forEach(function (ly, lIdx) {
      for (var t = 0; t < ly.count; t++) {
        var sMat = new T.SpriteMaterial({
          map: ly.tex,
          transparent: true,
          opacity: 0.9,
          blending: T.AdditiveBlending,
          depthWrite: false
        });
        var sp = new T.Sprite(sMat);
        g.add(sp);
        var ang = (t / ly.count) * Math.PI * 2 + lIdx * 0.85;
        tongues.push({
          mesh: sp,
          mat: sMat,
          ang: ang,
          dist: ly.spread * (0.25 + ((t * 37) % 10) / 12),
          baseW: ly.w,
          baseH: ly.h,
          riseH: ly.rise,
          phase: t / ly.count + lIdx * 0.31,
          speed: ly.speed,
          layer: lIdx
        });
      }
    });

    // 24 fagulhas luminosas subindo em espiral
    var sparks = [];
    for (var s = 0; s < 24; s++) {
      var spMat = new T.SpriteMaterial({
        map: sparkGlowTex,
        transparent: true,
        opacity: 0.95,
        blending: T.AdditiveBlending,
        depthWrite: false
      });
      var sm = new T.Sprite(spMat);
      var sSize = (0.095 + (s % 3) * 0.035) * scale;
      sm.scale.set(sSize, sSize, 1);
      g.add(sm);
      sparks.push({
        mesh: sm,
        mat: spMat,
        phase: s / 24,
        speed: 0.28 + (s % 5) * 0.07,
        rad: (0.16 + (s % 6) * 0.11) * scale,
        angle0: s * 1.9
      });
    }

    // Fumaça volumétrica suave (somente na fogueira externa)
    var smokes = [];
    if (opts.smoke) {
      for (var smk = 0; smk < 9; smk++) {
        var smokeMat = new T.SpriteMaterial({
          map: smokePuffTex,
          transparent: true,
          opacity: 0.22,
          depthWrite: false
        });
        var smMesh = new T.Sprite(smokeMat);
        g.add(smMesh);
        smokes.push({ mesh: smMesh, mat: smokeMat, phase: smk / 9, speed: 0.15 + (smk % 3) * 0.025 });
      }
    }

    // Halo quente sutil no chão
    var glowDisc = new T.Mesh(
      new T.CircleGeometry(2.6 * scale, 24),
      new T.MeshBasicMaterial({ map: fireOuterTex, transparent: true, opacity: 0.34, blending: T.AdditiveBlending, depthWrite: false })
    );
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.03;
    g.add(glowDisc);

    // Luz dinâmica quente
    var light = new T.PointLight("#ff9642", opts.intensity || 3.4, opts.distance || 24, 1.25);
    light.position.set(opts.x + (opts.lightOffsetX || 0), opts.y + 1.35 * scale, opts.z + (opts.lightOffsetZ || 0));
    scene.add(light);

    var sys = {
      group: g,
      light: light,
      coalMat: coalMat,
      tipMat: tipMat,
      glowDisc: glowDisc,
      tongues: tongues,
      sparks: sparks,
      smokes: smokes,
      baseIntensity: opts.intensity || 3.4,
      scale: scale,
      get active() { return active; },
      setActive: function (val) {
        active = Boolean(val);
        tongues.forEach(function (t) { t.mesh.visible = active; });
        sparks.forEach(function (s) { s.mesh.visible = active; });
        smokes.forEach(function (s) { s.mesh.visible = active; });
        glowDisc.visible = active;
        coalMat.emissiveIntensity = active ? 1.85 : 0.05;
        tipMat.emissiveIntensity = active ? 1.4 : 0;
        light.intensity = active ? sys.baseIntensity : 0;
      },
      update: function (elapsed) {
        if (!active) return;
        coalMat.emissiveIntensity = 1.65 + Math.sin(elapsed * 4.5) * 0.38;
        glowDisc.material.opacity = 0.28 + Math.sin(elapsed * 6.5) * 0.06;
        light.intensity = sys.baseIntensity * (0.9 + Math.sin(elapsed * 10.3) * 0.09 + Math.cos(elapsed * 16.7) * 0.05);
        tongues.forEach(function (t) {
          var cyc = (elapsed * t.speed + t.phase) % 1;
          var env = Math.sin(cyc * Math.PI);
          var wobbleX = Math.sin(elapsed * 7.5 + t.phase * 9) * 0.1 * scale * (0.4 + cyc);
          var wobbleZ = Math.cos(elapsed * 6.8 + t.phase * 7) * 0.1 * scale * (0.4 + cyc);
          t.mesh.position.set(
            Math.cos(t.ang) * t.dist * (1 - cyc * 0.65) + wobbleX,
            (0.28 + cyc * t.riseH) * scale + t.baseH * 0.18,
            Math.sin(t.ang) * t.dist * (1 - cyc * 0.65) + wobbleZ
          );
          var sw = t.baseW * (1.15 - cyc * 0.65) * (0.88 + Math.sin(elapsed * 11 + t.phase * 12) * 0.14);
          var sh = t.baseH * (0.72 + env * 0.52);
          t.mesh.scale.set(sw, sh, 1);
          t.mat.opacity = Math.max(0.02, env * (t.layer === 0 ? 0.95 : (t.layer === 1 ? 0.78 : 0.48)));
        });
        sparks.forEach(function (s) {
          var p = (elapsed * s.speed + s.phase) % 1;
          var ang = s.angle0 + p * 5.2;
          var r = s.rad * (0.55 + p * 0.9);
          s.mesh.position.set(Math.cos(ang) * r, (0.35 + p * 2.55) * scale, Math.sin(ang) * r);
          var fade = Math.sin(p * Math.PI);
          s.mat.opacity = fade * 0.95;
        });
        smokes.forEach(function (sk) {
          var p = (elapsed * sk.speed + sk.phase) % 1;
          sk.mesh.position.set(
            Math.sin(elapsed * 0.7 + sk.phase * 6) * 0.42 * scale * p,
            (1.35 + p * 3.8) * scale,
            Math.cos(elapsed * 0.6 + sk.phase * 6) * 0.42 * scale * p
          );
          var sc = (0.75 + p * 2.1) * scale;
          sk.mesh.scale.set(sc, sc, 1);
          sk.mat.opacity = Math.sin(p * Math.PI) * 0.24;
        });
      }
    };
    fireSystems.push(sys);
    return sys;
  }

  /* ---------------- Mobiliário Detalhado ---------------- */
  function chair(x, z, angle, parent, color) {
    angle = angle || 0;
    parent = parent || constructionRoot;
    color = color || "#4a4e52";
    var g = new T.Group();
    g.position.set(x, 0, z);
    g.rotation.y = angle;
    parent.add(g);
    // 4 pés torneados de madeira
    [[-0.28, -0.26], [0.28, -0.26], [-0.28, 0.26], [0.28, 0.26]].forEach(function (p) {
      cyl(0.032, 0.56, p[0], 0.28, p[1], "#3f2b1d", g, 0.024, 10);
    });
    // Assento estofado com moldura de madeira
    box(0.68, 0.08, 0.64, 0, 0.54, 0, "#5c3f28", g);
    box(0.62, 0.1, 0.58, 0, 0.62, 0.02, color, g);
    // Encosto ergonômico
    box(0.64, 0.68, 0.11, 0, 0.98, -0.28, color, g);
    box(0.68, 0.06, 0.13, 0, 1.33, -0.28, "#3f2b1d", g);
    // Braços curvos
    [-0.33, 0.33].forEach(function (dx) {
      box(0.07, 0.24, 0.5, dx, 0.72, -0.03, "#3f2b1d", g);
    });
    g.userData.isChair = true;
    return g;
  }

  function almofadaDetalhada(x, z, ang, cor, trimCor, sc) {
    sc = sc || 1;
    var g = new T.Group();
    g.position.set(x, 0.155, z);
    g.rotation.y = ang || 0;
    scene.add(g);
    var fabricMat = mat(cor || "#6b5444", 0, 0.92);
    var pipeMat = mat(trimCor || "#a89279", 0, 0.85);
    // Base fofa arredondada da almofada
    var body = new T.Mesh(new T.SphereGeometry(0.68 * sc, 24, 14), fabricMat);
    body.scale.set(1.06, 0.32, 1.06);
    body.position.y = 0.17 * sc;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // Borda costurada (piping) ao redor da almofada
    var rim = new T.Mesh(new T.TorusGeometry(0.69 * sc, 0.045 * sc, 10, 28), pipeMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.16 * sc;
    g.add(rim);
    // Centro acolchoado + botão decorativo
    var centerPad = new T.Mesh(new T.CylinderGeometry(0.46 * sc, 0.54 * sc, 0.06 * sc, 20), mat(trimCor || "#8c7662", 0, 0.9));
    centerPad.position.y = 0.34 * sc;
    centerPad.receiveShadow = true;
    g.add(centerPad);
    var btn = new T.Mesh(new T.CylinderGeometry(0.065 * sc, 0.065 * sc, 0.04 * sc, 12), mat("#2b211b", 0, 0.7));
    btn.position.y = 0.37 * sc;
    g.add(btn);
    return g;
  }

  function camaAlmofadaTV(x, z, ang, cor, trimCor) {
    var g = new T.Group();
    g.position.set(x, 0.155, z);
    g.rotation.y = ang || 0;
    scene.add(g);
    var baseMat = mat(cor || "#3f4650", 0, 0.92);
    var innerMat = mat(trimCor || "#737b86", 0, 0.9);
    // Colchonete grande e macio com bordas fofas tipo caminha/futon de lounge
    box(3.1, 0.24, 1.38, 0, 0.12, 0, baseMat, g);
    box(2.74, 0.12, 1.06, 0, 0.26, 0.06, innerMat, g);
    // Rolos laterais e traseiro acolchoados
    var bk = cyl(0.2, 3.08, 0, 0.34, -0.52, baseMat, g, 0.2, 14);
    bk.rotation.z = Math.PI / 2;
    [-1.44, 1.44].forEach(function (dx) {
      var sd = cyl(0.18, 1.24, dx, 0.32, 0.02, baseMat, g, 0.18, 12);
      sd.rotation.x = Math.PI / 2;
    });
    // Almofadinhas soltas
    [-0.9, 0.85].forEach(function (px, idx) {
      var pw = new T.Mesh(new T.SphereGeometry(0.32, 14, 10), mat(idx === 0 ? "#9a7b56" : "#5e6f64", 0, 0.9));
      pw.scale.set(1.1, 0.48, 0.9);
      pw.position.set(px, 0.4, -0.22);
      pw.rotation.y = idx === 0 ? 0.3 : -0.35;
      g.add(pw);
    });
    return g;
  }

  function poltronaDetalhada(x, z, ang, cor, almofadaCor) {
    var g = new T.Group();
    g.position.set(x, 0.14, z);
    g.rotation.y = ang;
    scene.add(g);
    // Pés de carvalho escuro
    [[-0.52, -0.45], [0.52, -0.45], [-0.52, 0.45], [0.52, 0.45]].forEach(function (p) {
      cyl(0.042, 0.22, p[0], 0.11, p[1], "#362417", g, 0.03, 10);
    });
    // Base estrutural e assento profundo fofo
    box(1.24, 0.24, 1.08, 0, 0.3, 0, cor, g);
    box(1.02, 0.16, 0.88, 0, 0.48, 0.06, almofadaCor || "#78716c", g);
    // Encosto levemente inclinado com detalhe superior
    var back = box(1.22, 0.88, 0.22, 0, 0.78, -0.46, cor, g);
    back.rotation.x = -0.14;
    var backCush = box(0.98, 0.66, 0.14, 0, 0.78, -0.34, almofadaCor || "#78716c", g);
    backCush.rotation.x = -0.14;
    // Braços acolchoados com topo arredondado
    [-0.56, 0.56].forEach(function (dx) {
      box(0.18, 0.46, 1.04, dx, 0.52, -0.02, cor, g);
      var roll = cyl(0.095, 1.04, dx, 0.74, -0.02, cor, g, 0.095, 12);
      roll.rotation.x = Math.PI / 2;
    });
    // Almofada decorativa lateral
    var pillow = box(0.32, 0.3, 0.12, 0.3, 0.64, -0.18, "#a89279", g);
    pillow.rotation.y = -0.35;
    pillow.rotation.z = 0.18;
    return g;
  }

  function sofa(x, z, a, col) {
    var c = col || "#3f4249";
    var c2 = "#2e3138";
    var g = new T.Group();
    g.position.set(x, 0.14, z);
    g.rotation.y = a || 0;
    constructionRoot.add(g);
    [[-1.5, -0.48], [1.5, -0.48], [-1.5, 0.48], [1.5, 0.48]].forEach(function (p) {
      cyl(0.04, 0.18, p[0], 0.09, p[1], "#2b1d13", g, 0.03, 10);
    });
    box(3.4, 0.32, 1.2, 0, 0.32, 0, c2, g);
    var bk = box(3.4, 0.76, 0.24, 0, 0.82, -0.48, c2, g);
    bk.rotation.x = -0.1;
    [-1.58, 1.58].forEach(function (dx) {
      box(0.24, 0.52, 1.24, dx, 0.62, 0, c2, g);
      var rl = cyl(0.12, 1.24, dx, 0.88, 0, c2, g, 0.12, 12);
      rl.rotation.x = Math.PI / 2;
    });
    [-1.0, 0, 1.0].forEach(function (dx) {
      box(0.96, 0.16, 0.96, dx, 0.54, 0.06, c, g);
      var bc = box(0.94, 0.56, 0.16, dx, 0.84, -0.32, c, g);
      bc.rotation.x = -0.1;
    });
    return g;
  }

  function desk(x, z) {
    box(3.4, 0.16, 1.3, x, 1.55, z, "#bb9264");
    [-1.3, 1.3].forEach(function (dx) { box(0.16, 1.4, 1.1, x + dx, 0.8, z, "#2c3035"); });
    box(0.42, 0.72, 0.86, x + 1.18, 0.48, z, "#18181b");
    box(0.04, 0.58, 0.06, x + 1.39, 0.5, z + 0.36, glow);
    box(0.68, 1.25, 1.0, x - 1.02, 0.72, z, "#d4d4d8");
    [-0.58, 0.58].forEach(function (dx) {
      box(1.02, 0.68, 0.08, x + dx, 2.08, z - 0.28, "#18181b");
      box(0.92, 0.57, 0.03, x + dx, 2.08, z - 0.22, "#0f172a");
      box(0.72, 0.06, 0.02, x + dx - 0.06, 2.2, z - 0.2, glow);
      box(0.56, 0.05, 0.02, x + dx - 0.12, 2.08, z - 0.2, "#94a3b8");
      box(0.64, 0.05, 0.02, x + dx - 0.08, 1.96, z - 0.2, warmGlow);
      box(0.09, 0.28, 0.09, x + dx, 1.76, z - 0.28, "#27272a");
    });
    box(0.96, 0.035, 0.32, x - 0.12, 1.65, z + 0.28, "#27272a");
    box(0.32, 0.02, 0.28, x + 0.64, 1.645, z + 0.28, "#18181b");
    box(0.1, 0.04, 0.16, x + 0.64, 1.665, z + 0.28, "#94a3b8");
    cyl(0.09, 0.18, x - 0.96, 1.72, z + 0.26, "#e4e4e7");
    cyl(0.04, 0.42, x + 1.34, 1.84, z - 0.32, "#27272a");
    sphere(0.11, x + 1.26, 2.06, z - 0.26, warmGlow);
    chair(x, z + 1.2, Math.PI);
  }

  function plant(x, z, s, parent) {
    s = s || 1;
    parent = parent || constructionRoot;
    var g = new T.Group();
    g.position.set(x, 0.14, z);
    parent.add(g);
    cyl(0.32 * s, 0.56 * s, 0, 0.28 * s, 0, "#8c5c3c", g, 0.42 * s, 16);
    cyl(0.36 * s, 0.06 * s, 0, 0.56 * s, 0, "#3b2c20", g, 0.36 * s, 16);
    beam([0, 0.54 * s, 0], [0, 1.95 * s, 0], 0.05 * s, "#5a4634", g);
    for (var i = 0; i < 11; i++) {
      var a = i * 2.15;
      var r = (0.28 + (i % 3) * 0.12) * s;
      var lf = sphere(0.32 * s, Math.cos(a) * r, (1.35 + (i % 4) * 0.26) * s, Math.sin(a) * r, ["#2d4a2d", "#3a5c36", "#4b7042"][i % 3], g);
      lf.scale.set(1.15, 0.72, 1.15);
    }
    return g;
  }

  function pineTree(x, z, scale) {
    var s = scale || 1;
    var g = new T.Group();
    g.position.set(x, 0, z);
    scene.add(g);
    cyl(0.34 * s, 2.6 * s, 0, 1.3 * s, 0, "#463122", g, 0.18 * s, 10);
    // 5 camadas densas de galhos de pinheiro alpino
    var tiers = [
      [2.5, 2.8, 2.8, "#1e3322"],
      [2.15, 2.7, 4.3, "#253e29"],
      [1.75, 2.5, 5.7, "#2c4830"],
      [1.3, 2.3, 6.9, "#335437"],
      [0.82, 1.9, 8.0, "#3b613f"]
    ];
    tiers.forEach(function (tr, ti) {
      var m = cone(tr[0] * s, tr[1] * s, 0, tr[2] * s, 0, tr[3], g, 9);
      m.rotation.y = ti * 0.45;
    });
    return g;
  }

  // ---------------------------------------------------------------- Construtor Matemático de Paredes Sem Frestas
  var furniture = [], rooms = [], palettes = [], dims = {}, itemNames = {};
  var blockedAreas = [];
  var interactables = [];
  var steamParticles = [];
  var indoorLights = [];
  var outdoorLights = [];
  var starField = null, skyOrb = null, pondWaterMesh = null;
  var pondRipples = [], pondRippleStart = -Infinity;
  var doorState = { open: false, angle: 0, targetAngle: 0, leftPivot: null, rightPivot: null, autoCloseAt: 0 };
  var fireStates = { fireplace: true, campfire: true, indoorLights: true, outdoorLights: true, coffeeSteamUntil: 0 };
  var fireplaceSys = null, campfireSys = null;
  var pulpitSpotMesh = null;

  var gridBounds = isChalet
    ? { minX: -23.5, maxX: 23.5, minZ: -9.3, maxZ: 32.5, hx: 23.5, hz: 32.5 }
    : { minX: -23.2, maxX: 23.2, minZ: -17.2, maxZ: 17.2, hx: 23.2, hz: 17.2 };
  var step = isChalet ? 0.72 : 0.65;
  var nx = isChalet ? Math.ceil((gridBounds.maxX - gridBounds.minX) / step) + 1 : 73;
  var nz = isChalet ? Math.ceil((gridBounds.maxZ - gridBounds.minZ) / step) + 1 : 54;
  var blockedCells = new Set();

  var uid = 0;
  function addFurniture(type, room, x, z, angle) {
    angle = angle || 0;
    var g = new T.Group();
    scene.add(g);
    constructionRoot = g;
    if (type === "desk") desk(0, 0);
    if (type === "sofa") sofa(0, 0);
    if (type === "plant") plant(0, 0, 1);
    if (type === "coffee") { box(2.8, 0.15, 1.3, 0, 0.8, 0, "#bb9264"); [-1.1, 1.1].forEach(function (dx) { box(0.14, 0.6, 1, dx, 0.45, 0, "#455651"); }); }
    if (type === "meeting") {
      cyl(1.9, 0.18, 0, 1.4, 0, "#bb9264"); cyl(1.1, 1.3, 0, 0.69, 0, "#3b5350"); cyl(1.25, 0.04, 0, 1.52, 0, glow);
      for (var a = 0; a < 4; a++) { var ang = a * Math.PI / 2; chair(Math.cos(ang) * 2.35, Math.sin(ang) * 2.35, -ang - Math.PI / 2); }
    }
    if (type === "shelf") {
      box(3.3, 3.2, 0.6, 0, 1.7, 0, "#bb9264");
      for (var y = 0.55; y < 3.3; y += 0.75) {
        box(3.2, 0.08, 0.65, 0, y, 0.05, "#a38862");
        for (var k = 0; k < 10; k++) box(0.18, 0.45 + (k % 3) * 0.07, 0.34, -1.3 + k * 0.26, y + 0.28, 0.15, ["#7c583c", "#52525b", "#a18a68", "#475569"][k % 4]);
      }
    }
    if (type === "lab") {
      box(4.4, 0.2, 2, 0, 1.52, 0, "#bb9264");
      [-1.9, 1.9].forEach(function (dx) { [-0.8, 0.8].forEach(function (dz) { box(0.12, 1.4, 0.12, dx, 0.8, dz, "#486466"); }); });
      box(1.8, 0.12, 1.3, 0.5, 1.68, 0, "#344950");
      box(1.8, 0.12, 0.12, 0.5, 2.9, -0.5, "#668e8a");
      sphere(0.3, 0.5, 1.99, 0, "#dbe0c7");
    }
    if (type === "server") {
      box(1.2, 2.7, 1, 0, 1.5, 0, "#455b5b");
      for (var sy = 0.5; sy < 2.6; sy += 0.3) box(0.95, 0.06, 0.02, 0, sy, 0.51, glow);
    }
    if (type === "reception") {
      box(4.7, 1.6, 1.3, 0, 0.9, 0, "#bb9264"); box(4.9, 0.13, 1.55, 0, 1.75, 0, "#e3dfcd");
      box(1.4, 0.9, 0.1, 0, 2.24, -0.2, "#293d3d"); box(1.28, 0.77, 0.02, 0, 2.24, -0.13, glow);
      chair(0, -1.4, 0);
    }
    constructionRoot = scene;
    g.position.set(x, 0, z);
    g.rotation.y = angle;
    var item = { id: ++uid, type: type, room: room, g: g };
    g.traverse(function (o) {
      o.userData.furniture = item.id;
      if (o.isMesh) { o.material = o.material.clone(); o.userData.baseColor = "#" + o.material.color.getHexString(); }
    });
    furniture.push(item);
    applyItemPalette(item);
    return item;
  }
  function applyItemPalette(item) {
    var p = palettes[rooms[item.room].palette];
    item.g.traverse(function (o) {
      if (!o.isMesh) return;
      var c = o.userData.baseColor;
      if (["#bb9264", "#a38862"].indexOf(c) >= 0) o.material.color.set(p.wood);
      if (["#526d61", "#4a4e52", "#52525b", "#3f4249"].indexOf(c) >= 0) o.material.color.set(p.fabric);
    });
  }
  function applyPalette(room, index) {
    rooms[room].palette = index;
    rooms[room].floor.children[0].material = mat(palettes[index].floor);
    furniture.filter(function (f) { return f.room === room; }).forEach(applyItemPalette);
  }
  function registerInteractable(item) {
    interactables.push(item);
    if (item.mesh) item.mesh.traverse(function (o) { o.userData.interactId = item.id; });
    return item;
  }

  if (isChalet) {
    // =========================================================================
    // CHALÉ ALPINO ARQUITETÔNICO 100% FECHADO (ZERO FRESTAS / ZERO BUGS)
    // + ÁREA EXTERNA INTERATIVA COM FOGUEIRA VOLUMÉTRICA, GAZEBO & LAGO
    // =========================================================================
    var wallMat = texMat(texPack.wallTimber, 0.82);
    var floorMat = texMat(texPack.floorWood, 0.74);
    var ceilMat = texMat(texPack.ceilTimber, 0.82);
    var deckMat = texMat(texPack.deckWood, 0.84);
    var stoneMat = texMat(texPack.stone, 0.92);
    var roofMat = texMat(texPack.roof, 0.88);
    var grassMat = texMat(texPack.grass, 0.95);
    var rugMat = texMat(texPack.rug, 0.95);
    var timberDark = "#3f2b1c";
    var timberMid = "#63432b";
    var timberLight = "#8f6542";

    // Terreno alpino texturizado
    var grassFloor = box(180, 0.4, 180, 0, -0.22, 12, grassMat);
    grassFloor.castShadow = false;

    // Astro (sol/lua) e campo de estrelas (visível à noite)
    skyOrb = sphere(3.6, 38, 42, -55, new T.MeshBasicMaterial({ color: "#fff7d6" }), scene);
    skyOrb.castShadow = false;
    var starGeo = new T.BufferGeometry();
    var starVerts = [];
    for (var st = 0; st < 260; st++) {
      var sa = (st * 2.3999) % (Math.PI * 2);
      var sd = 70 + (st % 40) * 1.4;
      starVerts.push(Math.cos(sa) * sd, 26 + (st % 30) * 1.8, Math.sin(sa) * sd);
    }
    starGeo.setAttribute("position", new T.Float32BufferAttribute(starVerts, 3));
    starField = new T.Points(starGeo, new T.PointsMaterial({ color: "#e4e4e7", size: 0.55, transparent: true, opacity: 0.85 }));
    starField.visible = false;
    scene.add(starField);

    // Cadeia de montanhas alpinas com picos nevados
    var mountains = [
      [-56, -46, 30, 32, "#3c4a54"], [-22, -56, 36, 40, "#455561"], [20, -52, 34, 36, "#3b4953"], [58, -42, 32, 34, "#43515b"],
      [-62, 6, 26, 26, "#38464f"], [62, 12, 28, 28, "#3e4d56"],
      [-48, 68, 30, 26, "#3a4852"], [2, 74, 38, 32, "#44535d"], [50, 64, 30, 26, "#3b4851"]
    ];
    mountains.forEach(function (mt) {
      var mMesh = cone(mt[2], mt[3], mt[0], mt[3] * 0.46, mt[1], mt[4], scene, 7);
      mMesh.castShadow = false;
      var cap = cone(mt[2] * 0.34, mt[3] * 0.34, mt[0], mt[3] * 0.79, mt[1], "#d6dfe6", scene, 7);
      cap.castShadow = false;
    });

    // Fundação de pedra (abaixo do piso para ZERO sobreposição / Z-fighting!) + Piso de madeira nobre do Chalé
    var stoneBase = box(25.0, 0.22, 21.0, 0, -0.1, 0, stoneMat);
    stoneBase.castShadow = false;
    var interiorFloor = box(24.1, 0.14, 20.0, 0, 0.08, 0, floorMat);
    interiorFloor.castShadow = false;

    // Tapete redondo trançado na roda da lareira (elevado limpo sobre o piso)
    var rugMesh = cyl(5.5, 0.022, 0, 0.166, -2.3, rugMat, scene, 5.5, 40);
    rugMesh.castShadow = false;

    // Construtor matemático de paredes fechadas com esquadrias e vidros perfeitos (0 frestas!)
    function buildWall({ axis, fixed, from, to, wallH, thick, openings }) {
      var sorted = (openings || []).slice().sort(function (a, b) { return a.a - b.a; });
      function putSeg(a, b, y0, y1, material, extraThick) {
        var len = b - a, h = y1 - y0;
        if (len <= 0.01 || h <= 0.01) return;
        var mid = (a + b) * 0.5, my = (y0 + y1) * 0.5, t = extraThick || thick;
        if (axis === "x") box(len, h, t, mid, my, fixed, material || wallMat);
        else box(t, h, len, fixed, my, mid, material || wallMat);
      }

      var cur = from;
      sorted.forEach(function (op) {
        // Trecho sólido antes da abertura
        if (op.a > cur + 0.01) putSeg(cur, op.a, 0, wallH, wallMat);
        // Trecho sólido abaixo e acima da abertura
        if (op.bottom > 0.01) putSeg(op.a, op.b, 0, op.bottom, wallMat);
        if (op.top < wallH - 0.01) putSeg(op.a, op.b, op.top, wallH, wallMat);

        if (op.kind === "window") {
          var w = op.b - op.a, h = op.top - op.bottom, mid = (op.a + op.b) * 0.5, my = (op.bottom + op.top) * 0.5;
          // Vidro duplo translúcido com brilho
          if (axis === "x") {
            var paneX = new T.Mesh(new T.PlaneGeometry(w - 0.12, h - 0.12), glass);
            paneX.position.set(mid, my, fixed);
            scene.add(paneX);
          } else {
            var paneZ = new T.Mesh(new T.PlaneGeometry(w - 0.12, h - 0.12), glass);
            paneZ.position.set(fixed, my, mid);
            paneZ.rotation.y = Math.PI / 2;
            scene.add(paneZ);
          }
          // Esquadria 4 lados + peitoril + travessas (mullions)
          var fT = thick + 0.12;
          putSeg(op.a - 0.06, op.b + 0.06, op.bottom - 0.04, op.bottom + 0.1, timberDark, fT + 0.08); // peitoril
          putSeg(op.a - 0.06, op.b + 0.06, op.top - 0.09, op.top + 0.04, timberDark, fT); // topo
          putSeg(op.a - 0.02, op.a + 0.11, op.bottom, op.top, timberDark, fT); // lateral A
          putSeg(op.b - 0.11, op.b + 0.02, op.bottom, op.top, timberDark, fT); // lateral B
          var divs = op.divs || 2;
          for (var d = 1; d < divs; d++) {
            var mp = op.a + (w * d) / divs;
            putSeg(mp - 0.045, mp + 0.045, op.bottom + 0.08, op.top - 0.08, timberDark, thick * 0.72);
          }
          putSeg(op.a + 0.08, op.b - 0.08, my + h * 0.12, my + h * 0.12 + 0.07, timberDark, thick * 0.65);
        }
        cur = Math.max(cur, op.b);
      });
      if (to > cur + 0.01) putSeg(cur, to, 0, wallH, wallMat);
    }

    var WALL_H = 4.65;
    // PAREDE NORTE (z = -10) — 100% fechada!
    buildWall({
      axis: "x", fixed: -10, from: -12.18, to: 12.18, wallH: WALL_H, thick: 0.36,
      openings: [
        { a: -9.8, b: -5.6, bottom: 1.2, top: 3.7, kind: "window", divs: 2 },
        { a: 5.6, b: 9.8, bottom: 1.2, top: 3.7, kind: "window", divs: 2 }
      ]
    });
    // PAREDE OESTE (x = -12) — 100% fechada!
    buildWall({
      axis: "z", fixed: -12, from: -10.18, to: 10.18, wallH: WALL_H, thick: 0.36,
      openings: [
        { a: -7.4, b: -3.6, bottom: 1.35, top: 3.7, kind: "window", divs: 2 },
        { a: 2.6, b: 7.4, bottom: 1.15, top: 3.7, kind: "window", divs: 3 }
      ]
    });
    // PAREDE LESTE (x = +12) — 100% fechada!
    buildWall({
      axis: "z", fixed: 12, from: -10.18, to: 10.18, wallH: WALL_H, thick: 0.36,
      openings: [
        { a: -8.0, b: -5.2, bottom: 1.2, top: 3.7, kind: "window", divs: 2 },
        { a: 2.6, b: 7.4, bottom: 1.15, top: 3.7, kind: "window", divs: 3 }
      ]
    });
    // PAREDE SUL (z = +10) — 100% fechada com vão exato para a porta dupla!
    buildWall({
      axis: "x", fixed: 10, from: -12.18, to: 12.18, wallH: WALL_H, thick: 0.36,
      openings: [
        { a: -9.8, b: -3.2, bottom: 1.1, top: 3.65, kind: "window", divs: 3 },
        { a: -1.65, b: 1.65, bottom: 0, top: 3.55, kind: "door" },
        { a: 3.2, b: 9.8, bottom: 1.1, top: 3.65, kind: "window", divs: 3 }
      ]
    });

    // Pilares de madeira maciça nos cantos e encontros + rodapé de pedra externo
    [[-12, -10], [12, -10], [-12, 10], [12, 10], [-12, 0], [12, 0], [-5.2, -10], [5.2, -10], [-2.8, 10], [2.8, 10]].forEach(function (pt) {
      box(0.46, WALL_H + 0.15, 0.46, pt[0], WALL_H * 0.5, pt[1], timberDark);
    });

    // EMPENAS TRIANGULARES VERDADEIRAS (ExtrudeGeometry) sob o telhado inclinado — ZERO frestas!
    function buildGable(zPos, withTriWindow) {
      var shape = new T.Shape();
      shape.moveTo(-12.25, 4.55);
      shape.lineTo(0, 9.35);
      shape.lineTo(12.25, 4.55);
      shape.closePath();
      if (withTriWindow) {
        var hole = new T.Path();
        hole.moveTo(-3.4, 5.15);
        hole.lineTo(0, 7.65);
        hole.lineTo(3.4, 5.15);
        hole.closePath();
        shape.holes.push(hole);
      }
      var geo = new T.ExtrudeGeometry(shape, { depth: 0.36, bevelEnabled: false });
      var mesh = new T.Mesh(geo, wallMat);
      mesh.position.set(0, 0, zPos - 0.18);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      if (withTriWindow) {
        // Vidro triangular + molduras
        var winShape = new T.Shape();
        winShape.moveTo(-3.4, 5.15);
        winShape.lineTo(0, 7.65);
        winShape.lineTo(3.4, 5.15);
        winShape.closePath();
        var winMesh = new T.Mesh(new T.ShapeGeometry(winShape), glass);
        winMesh.position.set(0, 0, zPos);
        scene.add(winMesh);
        beam([-3.5, 5.15, zPos], [3.5, 5.15, zPos], 0.08, timberDark);
        beam([-3.5, 5.15, zPos], [0, 7.72, zPos], 0.08, timberDark);
        beam([3.5, 5.15, zPos], [0, 7.72, zPos], 0.08, timberDark);
        beam([0, 5.15, zPos], [0, 7.65, zPos], 0.06, timberDark);
      }
    }
    buildGable(-10, false);
    buildGable(10, true);

    // TELHADO INCLINADO EM A COM BEIRAIS, FORRO DE MADEIRA E TESOURAS ESTRUTURAIS
    var roofSlope = Math.atan2(4.75, 12.25);
    var slopeLen = Math.hypot(13.8, 5.35);
    var roofL = box(slopeLen, 0.28, 23.8, -6.55, 7.05, 0.3, roofMat);
    roofL.rotation.z = roofSlope;
    var roofR = box(slopeLen, 0.28, 23.8, 6.55, 7.05, 0.3, roofMat);
    roofR.rotation.z = -roofSlope;
    var ceilL = box(slopeLen - 0.8, 0.1, 20.1, -6.35, 6.86, 0, ceilMat);
    ceilL.rotation.z = roofSlope;
    var ceilR = box(slopeLen - 0.8, 0.1, 20.1, 6.35, 6.86, 0, ceilMat);
    ceilR.rotation.z = -roofSlope;
    box(0.46, 0.56, 23.4, 0, 9.45, 0.3, timberDark);
    [-6.5, -2.2, 2.2, 6.5].forEach(function (tz) {
      box(23.8, 0.3, 0.28, 0, 4.72, tz, timberDark);
      box(0.26, 4.4, 0.26, 0, 7.0, tz, timberDark);
      beam([-5.8, 4.72, tz], [0, 7.9, tz], 0.12, timberDark);
      beam([5.8, 4.72, tz], [0, 7.9, tz], 0.12, timberDark);
    });

    // PORTA DUPLA INTERATIVA DO CHALÉ (x ∈ [-1.65, 1.65], z = 10)
    box(0.2, 3.6, 0.48, -1.68, 1.85, 10, timberDark);
    box(0.2, 3.6, 0.48, 1.68, 1.85, 10, timberDark);
    box(3.6, 0.24, 0.5, 0, 3.62, 10, timberDark);
    function criarFolhaPorta(pivotX, dir) {
      var pv = new T.Group();
      pv.position.set(pivotX, 0.14, 10.0);
      scene.add(pv);
      var w = 1.54;
      var cx = dir * (w * 0.5);
      // Moldura sólida + painel inferior + janela com grade + maçaneta dourada
      box(w, 1.25, 0.12, cx, 0.63, 0, "#573923", pv);
      box(w, 0.26, 0.12, cx, 3.25, 0, "#573923", pv);
      box(0.24, 1.9, 0.12, dir * 0.12, 2.2, 0, "#573923", pv);
      box(0.24, 1.9, 0.12, dir * (w - 0.12), 2.2, 0, "#573923", pv);
      var gp = new T.Mesh(new T.PlaneGeometry(w - 0.42, 1.86), glass);
      gp.position.set(cx, 2.2, 0);
      pv.add(gp);
      box(w - 0.4, 0.06, 0.14, cx, 2.2, 0, timberDark, pv);
      box(0.06, 1.86, 0.14, cx, 2.2, 0, timberDark, pv);
      // Maçaneta metálica dupla face
      box(0.06, 0.36, 0.24, dir * (w - 0.18), 1.45, 0, goldMat, pv);
      return pv;
    }
    doorState.leftPivot = criarFolhaPorta(-1.56, 1);
    doorState.rightPivot = criarFolhaPorta(1.56, -1);
    var doorHitProxy = new T.Group();
    doorHitProxy.position.set(0, 1.7, 10.0);
    scene.add(doorHitProxy);
    registerInteractable({
      id: "door",
      type: "door",
      label: function () { return doorState.open ? "Fechar porta do chalé" : "Abrir porta do chalé"; },
      pos: new T.Vector3(0, 1.6, 10.0),
      radius: 3.5,
      mesh: doorHitProxy,
      onInteract: function () {
        doorState.open = !doorState.open;
        doorState.targetAngle = doorState.open ? Math.PI * 0.48 : 0;
        doorState.autoCloseAt = 0;
        return doorState.open ? "Porta do chalé aberta" : "Porta do chalé fechada";
      }
    });

    // LUSTRES & ILUMINAÇÃO INTERNA ACOLHEDORA
    var lampGroup = new T.Group();
    scene.add(lampGroup);
    [[-4.2, -3.0], [4.2, -3.0], [0, 3.0]].forEach(function (lp) {
      cyl(0.024, 2.2, lp[0], 5.6, lp[1], "#1f1f24", lampGroup, 0.024, 8);
      var shade = new T.Mesh(new T.ConeGeometry(0.62, 0.42, 20, 1, true), new T.MeshStandardMaterial({ color: "#27272a", roughness: 0.55, side: T.DoubleSide }));
      shade.position.set(lp[0], 4.48, lp[1]);
      lampGroup.add(shade);
      var bulb = sphere(0.15, lp[0], 4.34, lp[1], warmGlow, lampGroup);
      var pl = new T.PointLight("#ffe5be", 2.45, 28, 1.3);
      pl.position.set(lp[0], 4.05, lp[1]);
      scene.add(pl);
      indoorLights.push({ light: pl, bulb: bulb, baseIntensity: 2.45 });
    });
    var roofFill = new T.PointLight("#fff2db", 1.9, 32, 1.2);
    roofFill.position.set(0, 6.5, 0.5);
    scene.add(roofFill);
    indoorLights.push({ light: roofFill, bulb: null, baseIntensity: 1.9 });

    var lightSwitch = box(0.22, 0.34, 0.08, 2.2, 1.5, 9.78, "#d4d4d8");
    registerInteractable({
      id: "lamps",
      type: "lamps",
      label: function () { return fireStates.indoorLights ? "Apagar luzes do chalé" : "Acender luzes do chalé"; },
      pos: new T.Vector3(2.2, 1.5, 9.7),
      radius: 3.0,
      mesh: lightSwitch,
      onInteract: function () {
        fireStates.indoorLights = !fireStates.indoorLights;
        indoorLights.forEach(function (il) {
          il.light.intensity = fireStates.indoorLights ? il.baseIntensity : 0;
          if (il.bulb) il.bulb.visible = fireStates.indoorLights;
        });
        return fireStates.indoorLights ? "Luzes internas acesas" : "Luzes internas apagadas";
      }
    });

    // 1. LAREIRA DE PEDRA DETALHADA + CHAMINÉ + QUADRO + VELAS + FOGO VOLUMÉTRICO
    var fireplaceGroup = new T.Group();
    scene.add(fireplaceGroup);
    // Base/soleira da lareira
    box(5.6, 0.42, 1.95, 0, 0.32, -8.98, stoneMat, fireplaceGroup);
    // Pilares laterais da lareira (deixam o nicho frontal oco e aberto para o fogo!)
    box(1.12, 2.02, 1.45, -1.78, 1.48, -9.28, stoneMat, fireplaceGroup);
    box(1.12, 2.02, 1.45, 1.78, 1.48, -9.28, stoneMat, fireplaceGroup);
    // Chaminé de pedra acima do mantel até o telhado
    box(4.65, 8.35, 1.38, 0, 6.62, -9.32, stoneMat, fireplaceGroup);
    // Fundo e laterais internas da fornalha refratária escura (nicho oco!)
    box(2.5, 1.96, 0.22, 0, 1.44, -9.62, "#191412", fireplaceGroup);
    box(0.14, 1.96, 1.1, -1.2, 1.44, -9.12, "#1c1614", fireplaceGroup);
    box(0.14, 1.96, 1.1, 1.2, 1.44, -9.12, "#1c1614", fireplaceGroup);
    box(2.5, 0.14, 1.1, 0, 2.38, -9.12, "#141110", fireplaceGroup);
    // Grade de ferro fundido
    for (var gr = -0.9; gr <= 0.9; gr += 0.3) {
      box(0.05, 0.22, 0.65, gr, 0.62, -8.92, "#1c1c20", fireplaceGroup);
    }
    // Prateleira de madeira maciça (mantel) + velas + quadro alpino
    box(5.1, 0.24, 1.12, 0, 2.48, -8.78, timberDark, fireplaceGroup);
    [-1.7, -1.45, 1.6].forEach(function (cx2, ci) {
      var ch = 0.28 + (ci % 2) * 0.12;
      cyl(0.06, ch, cx2, 2.6 + ch * 0.5, -8.52, "#f4f0e6", fireplaceGroup, 0.06, 10);
      sphere(0.035, cx2, 2.62 + ch, -8.52, warmGlow, fireplaceGroup);
    });
    // Quadro emoldurado sobre a lareira
    box(2.3, 1.45, 0.1, 0, 3.65, -8.62, timberDark, fireplaceGroup);
    var artCv = document.createElement("canvas");
    artCv.width = 256; artCv.height = 160;
    var ac = artCv.getContext("2d");
    var ag = ac.createLinearGradient(0, 0, 0, 160);
    ag.addColorStop(0, "#1e293b"); ag.addColorStop(0.55, "#c27848"); ag.addColorStop(1, "#2a3b2c");
    ac.fillStyle = ag; ac.fillRect(0, 0, 256, 160);
    ac.fillStyle = "#1f2933";
    ac.beginPath(); ac.moveTo(0, 140); ac.lineTo(70, 52); ac.lineTo(138, 120); ac.lineTo(192, 42); ac.lineTo(256, 140); ac.closePath(); ac.fill();
    ac.fillStyle = "#e4e4e7";
    ac.beginPath(); ac.moveTo(56, 72); ac.lineTo(70, 52); ac.lineTo(84, 72); ac.closePath(); ac.fill();
    ac.beginPath(); ac.moveTo(176, 66); ac.lineTo(192, 42); ac.lineTo(208, 66); ac.closePath(); ac.fill();
    var artMesh = new T.Mesh(new T.PlaneGeometry(2.06, 1.22), new T.MeshBasicMaterial({ map: new T.CanvasTexture(artCv) }));
    artMesh.position.set(0, 3.65, -8.56);
    fireplaceGroup.add(artMesh);

    fireplaceSys = criarSistemaFogo({ x: 0, y: 0.54, z: -8.92, scale: 0.96, style: "fireplace", smoke: false, intensity: 3.4, distance: 24, lightOffsetZ: 1.5 });
    registerInteractable({
      id: "fireplace",
      type: "fireplace",
      label: function () { return fireStates.fireplace ? "Apagar lareira" : "Acender lareira"; },
      pos: new T.Vector3(0, 1.3, -8.6),
      radius: 3.8,
      mesh: fireplaceGroup,
      onInteract: function () {
        fireStates.fireplace = !fireStates.fireplace;
        fireplaceSys.setActive(fireStates.fireplace);
        return fireStates.fireplace ? "Lareira acesa" : "Lareira apagada";
      }
    });

    // RODA DE ALMOFADAS FOFAS EM FERRADURA (confortável para os cachorros e visão livre da lareira!)
    var cushionPalettes = [
      ["#6a4a35", "#9e8169"], ["#3f554c", "#6f8a7d"], ["#464e5c", "#747e91"],
      ["#6d4f43", "#a28475"], ["#435059", "#72828e"], ["#5c4c3f", "#8f7d6c"]
    ];
    CHALET_ZONES.lareira.slots.forEach(function (sl, idx) {
      if (!sl.seat) return;
      var pal = cushionPalettes[idx % cushionPalettes.length];
      var cushMesh = almofadaDetalhada(sl.x, sl.z, sl.yaw, pal[0], pal[1], 1.05);
      registerInteractable({
        id: "seat_lareira_" + idx,
        type: "seat",
        label: function () { return "Sentar na almofada"; },
        pos: new T.Vector3(sl.x, 0.45, sl.z),
        seatPos: new T.Vector3(sl.x, 1.05, sl.z),
        seatYaw: sl.yaw + Math.PI,
        radius: 2.6,
        mesh: cushMesh
      });
    });
    // Mesinha de centro redonda com xícaras, livro e vela
    cyl(1.18, 0.08, 0, 0.62, -2.3, timberLight);
    cyl(1.12, 0.04, 0, 0.56, -2.3, timberDark);
    cyl(0.22, 0.44, 0, 0.36, -2.3, timberDark);
    cyl(0.075, 0.14, 0.36, 0.73, -2.1, "#f4f4f5");
    cyl(0.075, 0.14, -0.32, 0.73, -2.42, "#e4e4e7");
    box(0.42, 0.06, 0.3, -0.05, 0.69, -2.02, "#4b5563").rotation.y = 0.28;

    // 2. BALCÃO DE CAFÉ DETALHADO (Parede Oeste)
    var coffeeGroup = new T.Group();
    scene.add(coffeeGroup);
    box(1.45, 1.06, 6.2, -10.2, 0.67, -1.8, stoneMat, coffeeGroup);
    box(1.72, 0.12, 6.5, -10.2, 1.24, -1.8, floorMat, coffeeGroup);
    box(0.54, 2.35, 5.4, -11.48, 2.45, -1.8, timberDark, coffeeGroup);
    [1.75, 2.6, 3.35].forEach(function (sy) { box(0.62, 0.08, 5.2, -11.36, sy, -1.8, timberLight, coffeeGroup); });
    // Máquina de espresso profissional em aço inox
    box(0.76, 0.66, 0.92, -10.3, 1.62, -3.1, "#27272a", coffeeGroup);
    box(0.08, 0.42, 0.84, -9.9, 1.56, -3.1, chromeMat, coffeeGroup);
    cyl(0.06, 0.08, -9.85, 1.68, -3.3, chromeMat, coffeeGroup);
    cyl(0.06, 0.08, -9.85, 1.68, -2.9, chromeMat, coffeeGroup);
    box(0.42, 0.07, 0.04, -9.88, 1.85, -3.1, glow, coffeeGroup);
    // Cloche de vidro para bolos + xícaras empilhadas
    cyl(0.28, 0.04, -10.05, 1.32, -1.65, timberLight, coffeeGroup);
    sphere(0.24, -10.05, 1.44, -1.65, glass, coffeeGroup);
    for (var cx = 0; cx < 4; cx++) {
      cyl(0.072, 0.13, -9.92, 1.36, -0.8 + cx * 0.44, "#f4f4f5", coffeeGroup);
    }
    for (var sp = 0; sp < 6; sp++) {
      var stMesh = sphere(0.055 + sp * 0.015, -9.95, 1.95 + sp * 0.18, -3.1, new T.MeshBasicMaterial({ color: "#e4e4e7", transparent: true, opacity: 0.42 }), scene);
      stMesh.castShadow = false; stMesh.visible = false;
      steamParticles.push({ mesh: stMesh, phase: sp * 0.6 });
    }
    [-4.0, -2.5, -1.0, 0.5].forEach(function (bz, bi) {
      var puf = almofadaDetalhada(-8.55, bz, -Math.PI / 2, "#594333", "#8c725e", 0.86);
      registerInteractable({
        id: "seat_cafe_" + bi,
        type: "seat",
        label: function () { return "Sentar na almofada do café"; },
        pos: new T.Vector3(-8.55, 0.45, bz),
        seatPos: new T.Vector3(-8.45, 1.05, bz),
        seatYaw: Math.PI / 2,
        radius: 2.4,
        mesh: puf
      });
    });
    registerInteractable({
      id: "coffee",
      type: "coffee",
      label: function () { return "Pegar xícara de café expresso"; },
      pos: new T.Vector3(-10.1, 1.5, -3.1),
      radius: 3.4,
      mesh: coffeeGroup,
      onInteract: function (simNow) {
        fireStates.coffeeSteamUntil = (simNow || 0) + 12;
        return "Café expresso quentinho preparado no balcão!";
      }
    });

    var coffeeTray = new T.Group();
    coffeeTray.position.set(-9.65, 1.30, 0.86);
    coffeeGroup.add(coffeeTray);
    box(0.45, 0.045, 0.63, 0, 0.022, 0, timberDark, coffeeTray);
    [-0.14, 0.14].forEach(function (z) {
      cyl(0.096, 0.022, 0, 0.058, z, "#e3ddce", coffeeTray, 0.084, 14);
      cyl(0.062, 0.09, 0, 0.10, z, "#7e9c90", coffeeTray, 0.049, 14);
    });
    registerInteractable({
      id: "coffee_break",
      type: "gather",
      zoneId: "cafe",
      label: function () { return "Convidar agentes para uma pausa no café"; },
      pos: new T.Vector3(-9.65, 1.42, 0.86),
      radius: 2.7,
      mesh: coffeeTray
    });

    // 3. CANTINHO DA SMART TV COM PAINEL RIPADO E ALMOFADÃO LOUNGE (Parede Leste)
    for (var rz = -4.3; rz <= 1.3; rz += 0.36) {
      box(0.08, 3.6, 0.14, 11.78, 2.55, rz, "#4b3423");
    }
    criarSmartTV3D(11.42, 2.75, -1.6, -Math.PI / 2, 1.0);
    var tvBed = camaAlmofadaTV(7.45, -1.6, Math.PI / 2, "#404652", "#6d7584");
    box(0.95, 0.4, 1.85, 9.25, 0.34, -1.6, timberDark);
    registerInteractable({
      id: "tv",
      type: "tv",
      label: function () { return "Abrir Smart TV (YouTube & Música)"; },
      pos: new T.Vector3(11.2, 2.4, -1.6),
      radius: 5.2,
      mesh: tvScreenMesh
    });
    registerInteractable({
      id: "seat_tv",
      type: "seat",
      label: function () { return "Deitar/sentar na almofada da TV"; },
      pos: new T.Vector3(7.45, 0.5, -1.6),
      seatPos: new T.Vector3(7.5, 1.05, -1.6),
      seatYaw: -Math.PI / 2,
      radius: 2.8,
      mesh: tvBed
    });

    // 4. MESA BAIXA DE REUNIÃO COM ALMOFADAS (Sudoeste interno)
    var workTable = new T.Group();
    workTable.position.set(-6.8, 0.15, 5.8);
    scene.add(workTable);
    box(4.2, 0.12, 1.72, 0, 0.68, 0, floorMat, workTable);
    box(4.28, 0.05, 1.78, 0, 0.62, 0, timberDark, workTable);
    [[-1.82, -0.68], [1.82, -0.68], [-1.82, 0.68], [1.82, 0.68]].forEach(function (leg) {
      box(0.14, 0.62, 0.14, leg[0], 0.31, leg[1], "#27272a", workTable);
    });
    [-1.1, 0.9].forEach(function (lx, li) {
      box(0.54, 0.03, 0.38, lx, 0.76, li === 0 ? -0.25 : 0.25, "#27272a", workTable);
      var scr = box(0.54, 0.34, 0.03, lx, 0.92, li === 0 ? -0.43 : 0.43, "#18181b", workTable);
      scr.rotation.x = li === 0 ? -0.22 : 0.22;
      var glowScr = box(0.48, 0.28, 0.015, lx, 0.92, li === 0 ? -0.41 : 0.41, glow, workTable);
      glowScr.rotation.x = li === 0 ? -0.22 : 0.22;
    });
    var notebook = new T.Group();
    notebook.position.set(-0.18, 0.755, -0.27);
    notebook.rotation.y = -0.18;
    workTable.add(notebook);
    box(0.67, 0.04, 0.43, 0, 0, 0, "#445d50", notebook);
    [-1, 1].forEach(function (side) {
      box(0.30, 0.022, 0.39, side * 0.154, 0.026, 0, "#eee3cd", notebook);
      for (var line = 0; line < 4; line++) {
        box(0.23, 0.002, 0.007, side * 0.154, 0.038, line * 0.066 - 0.11, "#9b8d78", notebook).castShadow = false;
      }
    });
    var meetingBell = new T.Group();
    meetingBell.position.set(0.02, 0.75, 0.51);
    workTable.add(meetingBell);
    cyl(0.23, 0.07, 0, 0.035, 0, timberDark, meetingBell);
    sphere(0.20, 0, 0.075, 0, goldMat, meetingBell).scale.y = 0.62;
    cyl(0.045, 0.072, 0, 0.228, 0, goldMat, meetingBell);
    registerInteractable({
      id: "meeting_bell",
      type: "gather",
      zoneId: "mesa",
      label: function () { return "Chamar agentes para a mesa"; },
      pos: new T.Vector3(-6.78, 1.05, 6.31),
      radius: 2.8,
      mesh: meetingBell
    });
    CHALET_ZONES.mesa.slots.slice(0, 6).forEach(function (sl, mi) {
      almofadaDetalhada(sl.x, sl.z, sl.yaw, mi % 2 === 0 ? "#464d59" : "#5a493c", "#828a99", 0.82);
    });

    // 5. BIBLIOTECA / ESTANTE (Nordeste interno)
    var shelfGroup = new T.Group();
    shelfGroup.position.set(8.2, 0.14, -9.2);
    scene.add(shelfGroup);
    box(3.8, 3.2, 0.58, 0, 1.6, 0, timberDark, shelfGroup);
    [0.5, 1.25, 2.0, 2.75].forEach(function (sy, rowIdx) {
      box(3.6, 0.07, 0.6, 0, sy, 0.04, timberLight, shelfGroup);
      var bookPalette = ["#7c583c", "#3d6b59", "#9a7b56", "#335c7d", "#6b3e3e", "#5b4b7a", "#8a5a36", "#2d6a6a"];
      for (var bk = 0; bk < 12; bk++) {
        var bm = box(0.18, 0.42 + ((bk + rowIdx) % 3) * 0.08, 0.34, -1.55 + bk * 0.28, sy + 0.25, 0.06, bookPalette[(bk + rowIdx * 3) % bookPalette.length], shelfGroup);
        if (bk === 11) bm.rotation.z = -0.18;
      }
    });
    registerInteractable({
      id: "bookshelf",
      type: "bookshelf",
      label: function () { return "Abrir Estante de Conhecimento (Livros)"; },
      pos: new T.Vector3(8.2, 1.6, -9.0),
      radius: 3.6,
      mesh: shelfGroup,
      onInteract: function () {
        return "Abrindo a Estante de Conhecimento do Chalé…";
      }
    });

    plant(-10.5, -8.5, 0.95);
    plant(-10.5, 8.5, 0.9);
    plant(10.5, 8.5, 0.95);

    // =========================================================================
    // ÁREA EXTERNA COMPLETA (Varanda sem sobreposição de piso, Fogueira com bancos, Gazebo & Lago)
    // =========================================================================
    var porchDeck = box(22.8, 0.26, 5.7, 0, 0.01, 12.92, deckMat);
    porchDeck.castShadow = false;
    // Degraus de madeira saindo da varanda para o jardim
    box(4.6, 0.12, 0.55, 0, 0.03, 16.05, deckMat);
    [-10.9, -5.45, -2.25, 2.25, 5.45, 10.9].forEach(function (vx) {
      box(0.28, 3.85, 0.28, vx, 2.02, 15.5, timberDark);
    });
    box(22.8, 0.24, 0.32, 0, 3.92, 15.5, timberDark);
    var porchRoof = box(23.2, 0.18, 6.4, 0, 4.38, 13.1, roofMat);
    porchRoof.rotation.x = 0.16;
    // Guarda-corpos da varanda
    box(8.65, 0.11, 0.14, -6.58, 1.12, 15.5, timberDark);
    box(8.65, 0.11, 0.14, 6.58, 1.12, 15.5, timberDark);
    box(0.14, 0.11, 5.5, -10.9, 1.12, 12.85, timberDark);
    box(0.14, 0.11, 5.5, 10.9, 1.12, 12.85, timberDark);
    for (var bx = -10.4; bx <= -2.6; bx += 0.8) {
      box(0.06, 0.96, 0.06, bx, 0.62, 15.5, timberMid);
      box(0.06, 0.96, 0.06, -bx, 0.62, 15.5, timberMid);
    }
    // Mesinhas baixas e almofadas da varanda
    [-5.3, 5.3].forEach(function (vx, vi) {
      cyl(0.7, 0.08, vx, 0.66, 13.4, floorMat);
      cyl(0.08, 0.54, vx, 0.38, 13.4, "#27272a");
      [-0.96, 0.96].forEach(function (ox, oi) {
        var pMesh = almofadaDetalhada(vx + ox, 12.6, oi === 0 ? 0.25 : -0.25, "#5c4d42", "#8e7b6b", 0.85);
        registerInteractable({
          id: "seat_varanda_" + vi + "_" + oi,
          type: "seat",
          label: function () { return "Sentar na almofada da varanda"; },
          pos: new T.Vector3(vx + ox, 0.45, 12.6),
          seatPos: new T.Vector3(vx + ox, 1.05, 12.6),
          seatYaw: oi === 0 ? 0.25 : -0.25,
          radius: 2.5,
          mesh: pMesh
        });
      });
    });

    // Cordão de luzes quentes na varanda + interruptor
    var outdoorLampSwitch = box(0.22, 0.34, 0.08, -2.2, 1.5, 10.22, "#d4d4d8");
    [-9.2, -6.4, -3.6, -1.2, 1.2, 3.6, 6.4, 9.2].forEach(function (lx, li) {
      var sag = Math.abs(Math.sin(li * 0.9)) * 0.16;
      var bulb = sphere(0.1, lx, 3.68 - sag, 15.32, warmGlow);
      if (li === 1 || li === 6) {
        var pl = new T.PointLight("#ffd699", 1.25, 16);
        pl.position.set(lx, 3.35, 15.1);
        scene.add(pl);
        outdoorLights.push({ light: pl, bulb: bulb, baseIntensity: 1.25 });
      } else {
        outdoorLights.push({ light: null, bulb: bulb, baseIntensity: 0 });
      }
    });
    registerInteractable({
      id: "porch_lights",
      type: "porch_lights",
      label: function () { return fireStates.outdoorLights ? "Apagar luzes da área externa" : "Acender luzes da área externa"; },
      pos: new T.Vector3(-2.2, 1.5, 10.3),
      radius: 3.0,
      mesh: outdoorLampSwitch,
      onInteract: function () {
        fireStates.outdoorLights = !fireStates.outdoorLights;
        outdoorLights.forEach(function (ol) {
          if (ol.light) ol.light.intensity = fireStates.outdoorLights ? ol.baseIntensity : 0;
          if (ol.bulb) ol.bulb.visible = fireStates.outdoorLights;
        });
        return fireStates.outdoorLights ? "Luzes externas acesas" : "Luzes externas apagadas";
      }
    });

    // Caminhos de pedra
    for (var stz = 16.7; stz <= 19.2; stz += 0.9) {
      cyl(0.58, 0.06, (stz % 1.8 < 0.9 ? -0.14 : 0.14), 0.02, stz, "#78716c");
    }
    for (var px = -8.5; px <= 8.5; px += 1.35) {
      if (Math.abs(px) < 4.7) continue;
      cyl(0.5, 0.06, px, 0.02, 22.5 + Math.sin(px) * 0.25, "#78716c");
    }

    // FOGUEIRA EXTERNA VOLUMÉTRICA (0, 0, 22.5) + ANEL DE PEDRAS + 8 BANCOS + PILHA DE LENHA
    var campfireGroup = new T.Group();
    campfireGroup.position.set(0, 0, 22.5);
    scene.add(campfireGroup);
    // Anel duplo de pedras naturais
    for (var rk = 0; rk < 16; rk++) {
      var ra = rk * Math.PI * 2 / 16;
      var rock = sphere(0.32 + (rk % 3) * 0.05, Math.cos(ra) * 1.25, 0.2, Math.sin(ra) * 1.25, rk % 2 === 0 ? "#57534e" : "#716b63", campfireGroup);
      rock.scale.set(1.15, 0.72, 1.05);
    }
    // Pátio de cascalho ao redor da fogueira
    var gravel = cyl(4.8, 0.03, 0, 0.015, 0, "#524c44", campfireGroup, 4.8, 32);
    gravel.castShadow = false;

    campfireSys = criarSistemaFogo({ x: 0, y: 0.04, z: 22.5, scale: 1.25, style: "campfire", smoke: true, intensity: 3.6, distance: 26 });
    registerInteractable({
      id: "campfire",
      type: "campfire",
      label: function () { return fireStates.campfire ? "Apagar fogueira" : "Acender fogueira"; },
      pos: new T.Vector3(0, 0.9, 22.5),
      radius: 4.2,
      mesh: campfireGroup,
      onInteract: function () {
        fireStates.campfire = !fireStates.campfire;
        campfireSys.setActive(fireStates.campfire);
        return fireStates.campfire ? "Fogueira acesa!" : "Fogueira apagada";
      }
    });

    // 8 Bancos rústicos de tronco maciço
    CHALET_ZONES.fogueira.slots.forEach(function (sl, si) {
      if (!sl.seat) return;
      var bg = new T.Group();
      bg.position.set(sl.x, 0, sl.z);
      bg.rotation.y = sl.yaw;
      scene.add(bg);
      var logTop = cyl(0.24, 1.65, 0, 0.42, 0, "#5c3f28", bg, 0.24, 12);
      logTop.rotation.z = Math.PI / 2;
      box(1.62, 0.08, 0.44, 0, 0.52, 0, floorMat, bg);
      cyl(0.14, 0.34, -0.55, 0.17, 0, "#3b271a", bg, 0.16, 10);
      cyl(0.14, 0.34, 0.55, 0.17, 0, "#3b271a", bg, 0.16, 10);
      registerInteractable({
        id: "seat_fogueira_" + si,
        type: "seat",
        label: function () { return "Sentar no banco da fogueira"; },
        pos: new T.Vector3(sl.x, 0.6, sl.z),
        seatPos: new T.Vector3(sl.x, 1.24, sl.z),
        seatYaw: sl.yaw + Math.PI,
        radius: 2.6,
        mesh: bg
      });
    });

    // Pilha de lenha decorativa perto da fogueira
    for (var fw = 0; fw < 6; fw++) {
      var row = fw < 3 ? 0 : (fw < 5 ? 1 : 2);
      var colIdx = fw < 3 ? fw - 1 : (fw < 5 ? fw - 3.5 : 0);
      var fwLog = cyl(0.12, 1.2, 5.2 + colIdx * 0.24, 0.14 + row * 0.2, 19.2, "#4a301f", scene, 0.12, 10);
      fwLog.rotation.x = Math.PI / 2;
    }

    // GAZEBO DO JARDIM (-11.5, 0, 22.5)
    var gazeboGroup = new T.Group();
    gazeboGroup.position.set(-11.5, 0, 22.5);
    scene.add(gazeboGroup);
    box(6.4, 0.22, 6.4, 0, 0.11, 0, deckMat, gazeboGroup);
    [[-2.9, -2.9], [2.9, -2.9], [-2.9, 2.9], [2.9, 2.9]].forEach(function (gp) {
      box(0.24, 3.25, 0.24, gp[0], 1.72, gp[1], timberDark, gazeboGroup);
    });
    box(6.4, 0.22, 6.4, 0, 3.4, 0, timberDark, gazeboGroup);
    cone(4.75, 1.75, 0, 4.35, 0, roofMat, gazeboGroup, 4).rotation.y = Math.PI / 4;
    var gazBulb = sphere(0.14, 0, 3.05, 0, warmGlow, gazeboGroup);
    var gazLight = new T.PointLight("#ffd699", 1.15, 14);
    gazLight.position.set(-11.5, 2.9, 22.5);
    scene.add(gazLight);
    outdoorLights.push({ light: gazLight, bulb: gazBulb, baseIntensity: 1.15 });
    [[0, -2.1, 0], [0, 2.1, Math.PI], [-2.1, 0, Math.PI / 2]].forEach(function (gb, index) {
      var bench = new T.Group();
      bench.position.set(gb[0], 0, gb[1]);
      bench.rotation.y = gb[2];
      gazeboGroup.add(bench);
      box(2.5, 0.11, 0.68, 0, 0.56, 0, timberMid, bench);
      box(2.5, 0.30, 0.085, 0, 0.88, -0.30, timberMid, bench);
      [-0.93, 0.93].forEach(function (x) {
        box(0.14, 0.86, 0.14, x, 0.65, -0.29, timberDark, bench);
        box(0.14, 0.34, 0.14, x, 0.38, 0.22, timberDark, bench);
      });
      registerInteractable({
        id: "seat_gazebo_" + index,
        type: "seat",
        label: function () { return "Sentar no banco do gazebo"; },
        pos: new T.Vector3(-11.5 + gb[0], 0.66, 22.5 + gb[1]),
        seatPos: new T.Vector3(-11.5 + gb[0], 1.30, 22.5 + gb[1]),
        seatYaw: gb[2] + Math.PI,
        radius: 2.6,
        mesh: bench
      });
    });

    var gardenRadio = new T.Group();
    gardenRadio.position.set(2.20, 0.22, 0.15);
    gardenRadio.rotation.y = -Math.PI / 2;
    gazeboGroup.add(gardenRadio);
    box(0.85, 0.68, 0.59, 0, 0.34, 0, timberDark, gardenRadio);
    box(0.75, 0.41, 0.31, 0, 0.88, 0, "#6a482d", gardenRadio);
    box(0.64, 0.29, 0.026, 0, 0.88, 0.166, "#c4a06d", gardenRadio);
    for (var grille = 0; grille < 5; grille++) {
      box(0.32, 0.018, 0.018, -0.10, 0.80 + grille * 0.039, 0.183, "#45382c", gardenRadio).castShadow = false;
    }
    var dial = cyl(0.069, 0.041, 0.21, 0.87, 0.182, "#5b4e42", gardenRadio);
    dial.rotation.x = Math.PI / 2;
    var antenna = cyl(0.014, 0.47, -0.25, 1.24, -0.07, chromeMat, gardenRadio);
    antenna.rotation.z = 0.35;
    registerInteractable({
      id: "gazebo_radio",
      type: "radio",
      label: function () { return "Mudar o som ambiente no rádio"; },
      pos: new T.Vector3(-9.30, 1.10, 22.65),
      radius: 2.8,
      mesh: gardenRadio
    });

    // ÁREA DE PIQUENIQUE & LAGO ALPINO REFLETIVO (11.5, 0, 22.0)
    var picGroup = new T.Group();
    picGroup.position.set(11.5, 0, 22.0);
    scene.add(picGroup);
    box(3.8, 0.12, 1.24, 0, 0.86, 0, floorMat, picGroup);
    [-1, 1].forEach(function (side) {
      var z = side * 1.28;
      var bench = box(3.8, 0.1, 0.52, 0, 0.46, z, timberMid, picGroup);
      registerInteractable({
        id: "seat_picnic_" + side,
        type: "seat",
        label: function () { return "Sentar à mesa de piquenique"; },
        pos: new T.Vector3(11.5, 0.53, 22 + z),
        seatPos: new T.Vector3(11.5, 1.19, 22 + z),
        seatYaw: side < 0 ? Math.PI : 0,
        radius: 2.5,
        mesh: bench
      });
    });
    box(1.14, 0.024, 1.17, 0.04, 0.935, 0, "#526c63", picGroup);
    [-0.40, -0.20, 0, 0.20, 0.40].forEach(function (x) {
      box(0.039, 0.007, 1.17, 0.04 + x, 0.951, 0, "#849b8e", picGroup).castShadow = false;
    });
    cyl(0.21, 0.038, -0.44, 0.966, 0.09, "#d5c9ae", picGroup, 0.18, 16);
    [-0.09, 0, 0.09].forEach(function (x, index) {
      sphere(0.073, -0.44 + x, 1.04, index === 1 ? 0.15 : 0.05,
        index === 1 ? "#be7650" : "#a44f3b", picGroup).scale.y = 0.90;
    });
    [-1.4, 1.4].forEach(function (px2) { box(0.14, 0.84, 2.74, px2, 0.42, 0, timberDark, picGroup); });

    var pondMat = new T.MeshStandardMaterial({ color: "#285568", metalness: 0.48, roughness: 0.08 });
    pondWaterMesh = cyl(4.3, 0.08, 15.5, 0.02, 28.0, pondMat, scene, 4.3, 36);
    pondWaterMesh.castShadow = false;
    for (var pr = 0; pr < 15; pr++) {
      var pa = pr * Math.PI * 2 / 15;
      var rr = sphere(0.42 + (pr % 3) * 0.16, 15.5 + Math.cos(pa) * 4.25, 0.15, 28.0 + Math.sin(pa) * 4.25, pr % 2 === 0 ? "#6b6660" : "#57534e");
      rr.scale.set(1.2, 0.65, 1.1);
    }
    // Vitórias-régias / folhas no lago
    [[14.2, 27.2], [16.4, 28.6], [15.1, 29.5]].forEach(function (lp) {
      cyl(0.32, 0.02, lp[0], 0.07, lp[1], "#2f5e39", scene, 0.32, 14).castShadow = false;
    });

    var skippingStones = new T.Group();
    skippingStones.position.set(13.2, 0, 24.0);
    scene.add(skippingStones);
    [[-0.20, 0.09], [0.02, -0.06], [0.25, 0.10]].forEach(function (offset) {
      sphere(0.17, offset[0], 0.09, offset[1], "#8a8070", skippingStones).scale.set(1, 0.43, 0.79);
    });
    var rippleGeometry = new T.RingGeometry(0.94, 1, 36);
    for (var ringIndex = 0; ringIndex < 3; ringIndex++) {
      var ripple = new T.Mesh(rippleGeometry, new T.MeshBasicMaterial({
        color: "#b8e1ea", transparent: true, depthWrite: false
      }));
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(14.7, 0.09 + ringIndex * 0.002, 27.0);
      ripple.visible = false;
      scene.add(ripple);
      pondRipples.push(ripple);
    }
    registerInteractable({
      id: "pond_stones",
      type: "pond",
      label: function () { return "Jogar uma pedrinha no lago"; },
      pos: new T.Vector3(13.2, 0.12, 24.0),
      radius: 2.5,
      mesh: skippingStones,
      onInteract: function (now) {
        pondRippleStart = now;
        return "A pedrinha fez ondas no lago";
      }
    });

    [[8.0, 23.5], [8.9, 24.3], [9.9, 24.8], [11.0, 25.0], [12.2, 24.8]].forEach(function (point, index) {
      var paver = cyl(0.43, 0.052, point[0], 0.029, point[1], index % 2 ? "#77746a" : "#68665c", scene, 0.48, 7);
      paver.scale.z = 0.74;
      paver.rotation.y = index * 0.57;
      paver.castShadow = false;
    });

    // Postes de lanterna no jardim
    [[-3.8, 17.5], [3.8, 17.5], [-6.8, 22.5], [6.8, 22.5]].forEach(function (lp) {
      cyl(0.08, 2.55, lp[0], 1.28, lp[1], "#27272a");
      box(0.32, 0.06, 0.32, lp[0], 2.75, lp[1], "#27272a");
      var lb = sphere(0.15, lp[0], 2.56, lp[1], warmGlow);
      var lpl = new T.PointLight("#ffd699", 0.9, 13);
      lpl.position.set(lp[0], 2.5, lp[1]);
      scene.add(lpl);
      outdoorLights.push({ light: lpl, bulb: lb, baseIntensity: 0.9 });
    });

    // Floresta alpina densa ao redor
    var treeCoords = [
      [-18, -14, 1.25], [-14, -18, 1.45], [-6, -19, 1.15], [5, -18, 1.35], [14, -16, 1.3], [20, -12, 1.2],
      [-21, -4, 1.38], [-20, 6, 1.2], [-22, 16, 1.32], [-21, 26, 1.42], [-15, 32, 1.22],
      [21, -3, 1.28], [20, 8, 1.38], [23, 18, 1.24], [23, 28, 1.38], [16, 35, 1.28],
      [-7, 34, 1.32], [3, 35, 1.18], [-26, 22, 1.52], [27, 22, 1.48], [-25, -10, 1.42], [26, -8, 1.5]
    ];
    treeCoords.forEach(function (tc) { pineTree(tc[0], tc[1], tc[2]); });

    blockedAreas = [
      { x: 0, z: -10.0, hw: 12.5, hd: 0.45 },
      { x: -12.0, z: 0, hw: 0.45, hd: 10.4 },
      { x: 12.0, z: 0, hw: 0.45, hd: 10.4 },
      { x: -7.0, z: 10.0, hw: 5.3, hd: 0.45 },
      { x: 7.0, z: 10.0, hw: 5.3, hd: 0.45 },
      { x: -6.58, z: 15.5, hw: 4.35, hd: 0.35 },
      { x: 6.58, z: 15.5, hw: 4.35, hd: 0.35 },
      { x: -10.9, z: 12.85, hw: 0.35, hd: 2.75 },
      { x: 10.9, z: 12.85, hw: 0.35, hd: 2.75 },
      { x: 0, z: -9.1, hw: 2.9, hd: 1.05 },
      { x: 0, z: -2.3, hw: 1.2, hd: 1.2 },
      { x: -10.3, z: -1.8, hw: 1.25, hd: 3.35 },
      { x: 9.25, z: -1.6, hw: 0.65, hd: 1.05 },
      { x: -6.8, z: 5.8, hw: 2.2, hd: 0.95 },
      { x: 8.2, z: -9.2, hw: 2.0, hd: 0.5 },
      { x: 0, z: 22.5, hw: 1.55, hd: 1.55 },
      { x: -5.3, z: 13.4, hw: 0.78, hd: 0.78 },
      { x: 5.3, z: 13.4, hw: 0.78, hd: 0.78 },
      { x: 11.5, z: 22.0, hw: 2.0, hd: 0.78 },
      { x: 15.5, z: 28.0, hw: 4.4, hd: 4.4 }
    ];
  } else {
    // ESCRITÓRIO 3D DE ENGENHARIA (Projetos)
    rooms = [
      { name: "Coordenação & Lounge", x: -12, z: -9, palette: 2 },
      { name: "Desenvolvimento (Baias Separadas)", x: 12, z: -9, palette: 0 },
      { name: "Testes & QA/Segurança", x: -12, z: 9, palette: 3 },
      { name: "Docs & Publicação Git", x: 12, z: 9, palette: 1 }
    ];
    palettes = [
      { name: "Natural · carvalho e sálvia", wood: "#bb9264", fabric: "#52525b", floor: "#c1ad8c", accent: "#34d399" },
      { name: "Criativo · terracota e ardósia", wood: "#c6a981", fabric: "#7c584c", floor: "#d1c2a5", accent: "#7f9ec7" },
      { name: "Executivo · nogueira e grafite", wood: "#866346", fabric: "#3f3f46", floor: "#a8957c", accent: "#bca677" },
      { name: "Contemporâneo · pedra e verde", wood: "#b4aa93", fabric: "#52655e", floor: "#c8ccc1", accent: "#34d399" }
    ];
    box(49, 0.55, 37, 0, -0.3, 0, "#3f4448");
    box(48, 0.12, 36, 0, 0.02, 0, "#d4d4d8");
    rooms.forEach(function (r) {
      var g = new T.Group();
      scene.add(g);
      r.floor = g;
      box(23.6, 0.045, 17.6, r.x, 0.12, r.z, palettes[r.palette].floor, g);
      for (var k = 0; k < 24; k++) box(0.025, 0.006, 17.3, r.x - 11.3 + k * 0.96, 0.147, r.z, "#a9a38b", g);
      textSprite(r.name.toUpperCase(), r.x, 4.9, r.z - 7.2, 0.8, "#27272a");
    });
    box(48, 0.04, 3.2, 0, 0.18, 0, "#a1a1aa");
    box(3.2, 0.04, 36, 0, 0.18, 0, "#a1a1aa");
    box(48, 1.4, 0.22, 0, 0.75, -18, "#c8c9b9");
    box(0.22, 5.4, 36, -24, 2.7, 0, "#c8c9b9");
    for (var gx = -22; gx < 24; gx += 4) { box(3.8, 3, 0.09, gx, 3, -17.85, glass); box(0.075, 3.3, 0.13, gx - 1.95, 3, -17.75, "#71717a"); }
    for (var lx = -22; lx < 24; lx += 1) box(0.32, 0.016, 0.045, lx, 0.21, -1.55, glow);
    for (var lz = -16; lz < 18; lz += 1) box(0.045, 0.016, 0.32, 1.55, 0.21, lz, glow);
    criarSmartTV3D(-23.4, 3.5, -4.0, Math.PI / 2, 1.25);
    box(0.16, 2.1, 13.6, 10.2, 1.15, -9.5, "#3f3f46");
    box(0.08, 1.1, 13.4, 10.2, 2.75, -9.5, glass);
    box(16.0, 2.1, 0.16, 10.2, 1.15, -9.2, "#3f3f46");
    box(15.8, 1.1, 0.08, 10.2, 2.75, -9.2, glass);
    textSprite("BAIA DEV 1", 6.0, 3.2, -14.4, 0.58, "#18181b");
    textSprite("BAIA DEV 2", 14.5, 3.2, -14.4, 0.58, "#18181b");
    textSprite("BAIA DEV 3", 6.0, 3.2, -4.0, 0.58, "#18181b");
    textSprite("BAIA DEV 4", 14.5, 3.2, -4.0, 0.58, "#18181b");
    itemNames = { desk: "Mesa de trabalho", sofa: "Sofá", meeting: "Mesa de reunião", plant: "Planta", shelf: "Estante", lab: "Bancada de testes", server: "Servidor", coffee: "Mesa de centro", reception: "Balcão release/PR" };
    dims = { desk: [4.0, 3.2], sofa: [3.8, 1.8], meeting: [5.4, 5.4], plant: [1.2, 1.2], shelf: [3.5, 0.9], lab: [4.7, 2.3], server: [1.5, 1.3], coffee: [3, 1.6], reception: [5, 1.5] };
    var layouts = [
      [["desk", -4, -4.5], ["meeting", 3.5, 1], ["shelf", -9.5, -3, Math.PI / 2], ["sofa", -5, 4.8], ["coffee", -5, 3.2], ["plant", 9, 5.5], ["plant", -9.5, -6]],
      [["desk", -6, -4.2], ["desk", 2.5, -4.2], ["desk", -6, 3.2], ["desk", 2.5, 3.2], ["server", 9.5, -5], ["server", 9.5, -3], ["plant", 9.5, 5.8]],
      [["lab", -6, -3.5], ["desk", 4, -3.5], ["server", -9.5, 4], ["desk", 4, 4.2], ["meeting", -3, 3.5], ["plant", -9.5, -6], ["plant", 9.5, 6]],
      [["desk", -5.5, -4], ["shelf", -9.5, 0, Math.PI / 2], ["shelf", -9.5, 4, Math.PI / 2], ["reception", 4.5, 3.8], ["meeting", 3.5, -3.2], ["plant", 9.5, -6]]
    ];
    layouts.forEach(function (items, r) { items.forEach(function (it) { addFurniture(it[0], r, rooms[r].x + it[1], rooms[r].z + it[2], it[3] || 0); }); });
    blockedAreas = [{ x: 10.2, z: -9.5, hw: 0.35, hd: 6.9 }, { x: 10.2, z: -9.2, hw: 8.1, hd: 0.35 }];
  }

  function setTimeOfDay(preset) {
    if (!isChalet) return;
    if (preset === "noite") {
      scene.background.set("#0c111b");
      scene.fog.color.set("#0c111b");
      hemiLight.color.set("#3a4b6e");
      hemiLight.groundColor.set("#151920");
      hemiLight.intensity = 0.5;
      sun.color.set("#99b2d6");
      sun.intensity = 0.48;
      sun.position.set(-20, 36, -24);
      if (starField) starField.visible = true;
      if (skyOrb) { skyOrb.position.set(-28, 42, -48); skyOrb.material.color.set("#dbeafe"); }
    } else if (preset === "entardecer") {
      scene.background.set("#c98666");
      scene.fog.color.set("#c98666");
      hemiLight.color.set("#ffd1a3");
      hemiLight.groundColor.set("#3f352e");
      hemiLight.intensity = 0.9;
      sun.color.set("#ff9852");
      sun.intensity = 1.75;
      sun.position.set(-36, 16, 26);
      if (starField) starField.visible = false;
      if (skyOrb) { skyOrb.position.set(-55, 22, 34); skyOrb.material.color.set("#ffb366"); }
    } else {
      scene.background.set("#b8d0e4");
      scene.fog.color.set("#b8d0e4");
      hemiLight.color.set("#edf6ff");
      hemiLight.groundColor.set("#4f5c42");
      hemiLight.intensity = 1.25;
      sun.color.set("#fff2d6");
      sun.intensity = 2.3;
      sun.position.set(28, 40, 34);
      if (starField) starField.visible = false;
      if (skyOrb) { skyOrb.position.set(38, 42, -55); skyOrb.material.color.set("#fff7d6"); }
    }
  }

  function updateEnvironment(dt, elapsed, simTime, agents) {
    if (!isChalet) return;
    fireSystems.forEach(function (fs) { fs.update(elapsed); });
    if (pondWaterMesh) {
      pondWaterMesh.position.y = 0.02 + Math.sin(elapsed * 1.4) * 0.008;
    }
    pondRipples.forEach(function (ripple, index) {
      var phase = (simTime - pondRippleStart - index * 0.24) / 1.65;
      ripple.visible = phase >= 0 && phase < 1;
      if (ripple.visible) {
        ripple.scale.setScalar(0.12 + phase * 1.30);
        ripple.material.opacity = 0.56 * (1 - phase);
      }
    });
    var steaming = simTime < (fireStates.coffeeSteamUntil || 0);
    steamParticles.forEach(function (sp) {
      sp.mesh.visible = steaming;
      if (steaming) {
        var c = (elapsed * 0.72 + sp.phase) % 1;
        sp.mesh.position.y = 1.92 + c * 0.9;
        sp.mesh.position.x = -9.95 + Math.sin(elapsed * 3.2 + sp.phase) * 0.06;
        sp.mesh.material.opacity = (1 - c) * 0.42;
      }
    });
    // Porta dupla abre automaticamente para agentes passando
    var agentNearDoor = (agents || []).some(function (a) {
      return Math.abs(a.g.position.x) < 2.5 && Math.abs(a.g.position.z - 10.0) < 2.7;
    });
    if (agentNearDoor && !doorState.open) {
      doorState.open = true;
      doorState.targetAngle = Math.PI * 0.48;
      doorState.autoCloseAt = simTime + 4.5;
    } else if (doorState.autoCloseAt > 0 && simTime > doorState.autoCloseAt && !agentNearDoor) {
      doorState.open = false;
      doorState.targetAngle = 0;
      doorState.autoCloseAt = 0;
    }
    doorState.angle += (doorState.targetAngle - doorState.angle) * Math.min(1, dt * 6.5);
    if (doorState.leftPivot) doorState.leftPivot.rotation.y = doorState.angle;
    if (doorState.rightPivot) doorState.rightPivot.rotation.y = -doorState.angle;
  }

  function itemContains(f, x, z, pad) {
    pad = pad || 0.24;
    var dx = x - f.g.position.x, dz = z - f.g.position.z, c = Math.cos(f.g.rotation.y), s = Math.sin(f.g.rotation.y);
    var lx = c * dx - s * dz, lz = s * dx + c * dz, wd = dims[f.type];
    return Math.abs(lx) < wd[0] / 2 + pad && Math.abs(lz) < wd[1] / 2 + pad;
  }

  function blocked(x, z, ignoreId, forPlayer) {
    if (x < gridBounds.minX || x > gridBounds.maxX || z < gridBounds.minZ || z > gridBounds.maxZ) return true;
    if (isChalet && forPlayer && !doorState.open && Math.abs(x) < 1.65 && Math.abs(z - 10.0) < 0.42) return true;
    if (blockedAreas.some(function (b) { return Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd; })) return true;
    return furniture.some(function (f) { return f.id !== ignoreId && itemContains(f, x, z, 0.24); });
  }

  function cell(x, z) {
    return [
      Math.max(0, Math.min(nx - 1, Math.round((x - gridBounds.minX) / step))),
      Math.max(0, Math.min(nz - 1, Math.round((z - gridBounds.minZ) / step)))
    ];
  }
  function pos(n) {
    return [(n % nx) * step + gridBounds.minX, Math.floor(n / nx) * step + gridBounds.minZ];
  }
  function rebuildGrid() {
    blockedCells = new Set();
    for (var j = 0; j < nz; j++) {
      for (var i = 0; i < nx; i++) {
        var n = j * nx + i, p = pos(n);
        if (blocked(p[0], p[1], null, false)) blockedCells.add(n);
      }
    }
  }
  rebuildGrid();

  function closestFree(p) {
    var best = null, distMin = Infinity;
    for (var n = 0; n < nx * nz; n++) {
      if (blockedCells.has(n)) continue;
      var v = pos(n), d = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (d < distMin) { distMin = d; best = v; }
    }
    return best || [p[0], p[1]];
  }

  function route(a, goalXZ) {
    var free = closestFree(goalXZ);
    var c = cell(a.g.position.x, a.g.position.z), t = cell(free[0], free[1]);
    var start = c[1] * nx + c[0], end = t[1] * nx + t[0];
    if (start === end) return [free];
    var open = [start], came = new Map(), cost = new Map([[start, 0]]), closed = new Set(), found = false;
    function hDist(n) { var pn = pos(n); return Math.abs(pn[0] - free[0]) + Math.abs(pn[1] - free[1]); }
    var guard = 0;
    while (open.length && guard++ < 4800) {
      open.sort(function (u, v) { return cost.get(u) + hDist(u) - (cost.get(v) + hDist(v)); });
      var u = open.shift();
      if (closed.has(u)) continue;
      closed.add(u);
      if (u === end) { found = true; break; }
      var ux = u % nx, uz = Math.floor(u / nx);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dir) {
        var ix = ux + dir[0], jz = uz + dir[1], v = jz * nx + ix;
        if (ix < 0 || ix >= nx || jz < 0 || jz >= nz || blockedCells.has(v) || closed.has(v)) return;
        var co = cost.get(u) + step;
        if (co < (cost.has(v) ? cost.get(v) : Infinity)) {
          cost.set(v, co); came.set(v, u);
          if (open.indexOf(v) < 0) open.push(v);
        }
      });
    }
    if (!found) return [free];
    var out = [], cur = end;
    while (cur !== start) {
      out.push(pos(cur)); cur = came.get(cur);
      if (cur === undefined) return [free];
    }
    return out.reverse();
  }

  function describeLocation(x, z) {
    if (!isChalet) return "Escritório 3D";
    if (z <= 10.0) {
      if (x < -5.8 && z > 2.5) return "Chalé · Mesa de Trabalho";
      if (x < -7.2 && z <= 2.5) return "Chalé · Balcão de Café";
      if (x > 5.8 && z < -4.8) return "Chalé · Biblioteca";
      if (x > 5.6 && z >= -4.8 && z <= 2.8) return "Chalé · Cantinho da TV";
      return "Chalé · Lareira";
    }
    if (z <= 15.8) return "Área Externa · Varanda";
    if (x < -6.5) return "Área Externa · Gazebo";
    if (x > 6.5) return "Área Externa · Jardim & Lago";
    return "Área Externa · Fogueira";
  }

  function destinoZonaChale(zoneId, slotIdx) {
    var zDef = CHALET_ZONES[zoneId] || CHALET_ZONES.lareira;
    var sl = zDef.slots[slotIdx % zDef.slots.length];
    return {
      x: sl.x,
      y: zDef.area === "Chalé" ? 0.14 : 0,
      z: sl.z,
      yaw: sl.yaw,
      state: sl.seat ? zDef.state : (zDef.state === "coffee" ? "coffee" : "stand"),
      seat: Boolean(sl.seat),
      zoneId: zDef.id,
      zona: zDef.label
    };
  }

  function destinoJuri(spec, idx, counters) {
    if ((spec.funcao || "") === "mediador") return destinoZonaChale("lareira", 0);
    var nextSlot = 1 + (counters.jury++ % (CHALET_ZONES.lareira.slots.length - 1));
    return destinoZonaChale("lareira", nextSlot);
  }

  function destinoDev(spec, idx, counters) {
    var fn = spec.funcao || "";
    if (fn === "pensador") {
      var pi = counters.coord++;
      return { x: -16.0 + (pi % 2) * 7.5, y: 0, z: -12.3, yaw: Math.PI, state: "think", zona: "Coordenação" };
    }
    if (fn === "desenvolvedor" || !fn) {
      var devBays = [[6.0, -12.0], [14.5, -12.0], [6.0, -4.6], [14.5, -4.6]];
      var di = counters.dev++;
      var b = devBays[di % devBays.length];
      return { x: b[0], y: 0, z: b[1], yaw: Math.PI, state: "work", zona: "Baia Dev " + ((di % devBays.length) + 1) };
    }
    if (fn === "testador" || fn === "qa_seguranca") {
      var qi = counters.qa++;
      var pts = fn === "testador" ? [[-18.0, 6.6], [-18.0, 11.8]] : [[-8.0, 6.6], [-8.0, 11.8]];
      var q = pts[qi % pts.length];
      return { x: q[0], y: 0, z: q[1], yaw: 0, state: "lab", zona: fn === "testador" ? "Lab de Testes" : "Auditoria QA" };
    }
    if (fn === "documentador" || fn === "publicador") {
      var doci = counters.docs++;
      var dp = fn === "publicador" ? [[16.5, 11.2], [15.5, 7.0]] : [[6.5, 6.4], [6.5, 11.8]];
      var d = dp[doci % dp.length];
      return { x: d[0], y: 0, z: d[1], yaw: 0, state: "work", zona: fn === "publicador" ? "Publicação Git/PR" : "Documentação" };
    }
    return { x: 6.0, y: 0, z: -11.6, yaw: 0, state: "work", zona: "Baia Geral" };
  }

  return {
    scene, mat, box, cyl, sphere, glow, warmGlow, goldMat,
    tvMeshes, tvScreenMesh, redrawTv, speakerGlowMat, speakerRings, pulpitSpotMesh,
    furniture, rooms, dims, itemNames, addFurniture, applyPalette,
    interactables, doorState, setTimeOfDay, updateEnvironment, describeLocation,
    CHALET_ZONES, destinoZonaChale,
    gridBounds, blocked, rebuildGrid, route, destinoJuri, destinoDev
  };
}
