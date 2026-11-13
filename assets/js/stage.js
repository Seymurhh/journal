// The 3D scene: a lacquered piano with jewel-coloured notes travelling toward the keys they play.
// Everything is a pure function of the music time t, so a video export draws exactly what playback shows.
import * as THREE from '../vendor/three.min.js';
import { isBlack, noteName } from './midi.js';
import { buildFlight, voicesFromPiece } from './flight.js';

const THEMES = {
  noir: { bg: ['#020203', '#1a0d10'], fog: '#0a0608', runway: '#050507', trim: '#e2b659', felt: '#8a1228', white: '#f7f1e6', black: '#0a0a0c',
    notes: ['#ffc24d', '#ff4f86', '#2fe3b0', '#5b9bff'], label: '#170a05', glow: 1.0, bloom: [0.5, 0.5, 0.92], additive: true, mirror: 0.2 },
  jewel: { bg: ['#03061a', '#1c0a33'], fog: '#0a0820', runway: '#050818', trim: '#f0d07a', felt: '#5d1a78', white: '#f4f1fb', black: '#0a0b16',
    notes: ['#3fd8ff', '#ff62d0', '#ffd24d', '#7dffb0'], label: '#0b0620', glow: 1.0, bloom: [0.55, 0.55, 0.92], additive: true, mirror: 0.22 },
  emerald: { bg: ['#010806', '#0b2417'], fog: '#04100b', runway: '#030a07', trim: '#e8c56a', felt: '#0e6b45', white: '#f5f3e8', black: '#080b09',
    notes: ['#35f0a0', '#ffcf5a', '#ff6b9a', '#7fd0ff'], label: '#04140d', glow: 1.0, bloom: [0.55, 0.55, 0.92], additive: true, mirror: 0.22 },
};
const SPEED = 9; // runway units per second; one unit = one white key width
const A0 = 21, C8 = 108, DECK = 0.7; // DECK = height of the runway surface

function keyX(p) {
  let n = 0;
  for (let i = A0; i < p; i++) if (!isBlack(i)) n++;
  return (isBlack(p) ? n - 0.5 : n) - 25.5;
}
const KX = Array.from({ length: 128 }, (_, p) => (p >= A0 && p <= C8 ? keyX(p) : 0));
const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }; // repeatable "random"
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 600);
  const env = new THREE.PMREMGenerator(renderer).fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  const composer = new THREE.EffectComposer(renderer);
  const renderPass = new THREE.RenderPass(new THREE.Scene(), camera);
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(960, 540), 0.6, 0.5, 0.8);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new THREE.OutputPass());

  const clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)]; // hide the part of a note that has passed the keys
  const dot = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const beamTex = canvasTex(32, 128, (g, w, h) => { const r = g.createLinearGradient(0, h, 0, 0); r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(0.25, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const S = { theme: 'noir', labels: true, effects: true, motion: true, piece: null, view: 'piano', voices: [], mic: null, flight: null, scene: null, keys: [], items: [], beams: [], live: new Map(), far: 60, cam: null };
  const labelMats = new Map();

  function labelMaterial(pitch, T) {
    const k = S.theme + pitch;
    if (!labelMats.has(k)) {
      const tex = canvasTex(128, 64, (g) => { g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.label; g.fillText(noteName(pitch), 64, 34); });
      labelMats.set(k, new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    }
    return labelMats.get(k);
  }

  function build() {
    if (S.old) S.old.traverse((o) => { if (o.isSprite) return; o.geometry?.dispose(); if (o.material && !o.material.map) o.material.dispose(); });
    if (S.view === 'flight') {
      S.flight = buildFlight(THEMES[S.theme], { canvasTex, dot });
      [bloom.strength, bloom.radius, bloom.threshold] = [0.55, 0.55, 0.5];
      renderPass.scene = S.scene = S.old = S.flight.scene;
      return;
    }
    const T = THEMES[S.theme], scene = new THREE.Scene();
    scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
    scene.environment = env; scene.environmentIntensity = T.additive ? 0.22 : 0.6;
    [bloom.strength, bloom.radius, bloom.threshold] = T.bloom;

    // Frame the part of the keyboard the piece uses (at least three octaves), so the notes are large.
    let lo = 36, hi = 96;
    if (S.piece) { lo = Math.min(...S.piece.notes.map((n) => n.pitch)); hi = Math.max(...S.piece.notes.map((n) => n.pitch)); }
    lo = Math.max(A0, Math.floor(lo / 12) * 12); hi = Math.min(C8, Math.ceil((hi + 1) / 12) * 12);
    while (hi - lo < 36) { if (lo > A0 + 5) lo = Math.max(A0, lo - 12); if (hi - lo < 36) hi = Math.min(C8, hi + 12); }
    const x0 = KX[lo] - 1, x1 = KX[hi] + 1, width = x1 - x0, cx = (x0 + x1) / 2;
    const half = Math.atan(Math.tan((camera.fov / 2) * Math.PI / 180) * camera.aspect);
    const dist = (width / 2) / Math.tan(half) * 1.03;
    S.cam = { cx, dist, width };
    S.far = dist * 2.3;
    scene.fog = new THREE.Fog(T.fog, dist * 1.1, dist * 3.2);

    scene.add(new THREE.AmbientLight('#ffffff', T.additive ? 0.12 : 0.7));
    const key = new THREE.DirectionalLight('#fff1dc', T.additive ? 1.15 : 1.3);
    key.position.set(cx - 12, 38, 22); key.target.position.set(cx, 0, -6);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.radius = 4;
    Object.assign(key.shadow.camera, { left: -width / 2 - 6, right: width / 2 + 6, top: 30, bottom: -30, near: 1, far: 140 });
    scene.add(key, key.target);
    const rim = new THREE.PointLight(T.trim, T.additive ? 2 : 1, 0, 1.2); rim.position.set(cx, 12, -34); scene.add(rim);

    // The lacquered deck the notes travel over. It is slightly see-through so dim mirror copies below read as reflections.
    const lacquer = new THREE.MeshPhysicalMaterial({ color: T.runway, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3, transparent: true, opacity: 1 - T.mirror, envMapIntensity: T.additive ? 0.5 : 1 });
    const deckLen = S.far * 0.62;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(60, 0.1, deckLen), lacquer);
    deck.position.set(0, DECK - 0.05, -deckLen / 2); deck.receiveShadow = true; deck.renderOrder = 1; scene.add(deck);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 0.25), new THREE.MeshStandardMaterial({ color: T.trim, metalness: 1, roughness: 0.3, emissive: T.trim, emissiveIntensity: 0.35 * T.glow }));
    edge.position.set(0, DECK - 0.2, -deckLen); scene.add(edge);

    // The hall around the piano: a polished floor far below, a back wall of light columns, and haze. These give the eye real distances to read.
    const hall = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshPhysicalMaterial({ color: T.additive ? '#07060a' : '#e9dcd2', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 }));
    hall.rotation.x = -Math.PI / 2; hall.position.set(cx, -14, -120); hall.receiveShadow = true; scene.add(hall);
    S.columns = [];
    for (let i = -6; i <= 6; i++) {
      const c = new THREE.Color(i % 2 ? T.trim : T.notes[Math.abs(i) % T.notes.length]);
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, 70, 0.6), new THREE.MeshBasicMaterial({ color: c, fog: false, transparent: true, opacity: 0.2, toneMapped: false }));
      col.position.set(cx + i * width * 0.42, 20, -S.far * 1.9 - Math.abs(i) * 6);
      scene.add(col); S.columns.push(col);
    }
    // Coloured light thrown by the notes being played, and ripples on the lacquer where they land.
    S.flash = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#ffffff', 0, 26, 1.8); scene.add(l); return l; });
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
    S.rings = Array.from({ length: 28 }, () => { const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false })); r.visible = false; r.renderOrder = 3; scene.add(r); return r; });
    const gold = new THREE.MeshStandardMaterial({ color: T.trim, metalness: 1, roughness: 0.25, emissive: T.trim, emissiveIntensity: 0.12 * T.glow });
    for (let p = 24; p <= C8; p += 12) { // a fine inlay line at every C
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, deckLen), gold); l.position.set(KX[p] - 0.5, DECK + 0.01, -deckLen / 2); l.renderOrder = 2; scene.add(l);
    }
    S.strike = new THREE.Mesh(new THREE.BoxGeometry(60, 0.07, 0.1), new THREE.MeshStandardMaterial({ color: T.trim, emissive: T.trim, emissiveIntensity: 1.6 * T.glow, metalness: 1, roughness: 0.3 }));
    S.strike.position.set(0, DECK + 0.05, -0.12); S.strike.renderOrder = 2; scene.add(S.strike);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: T.felt, roughness: 1 }));
    felt.position.set(0, DECK + 0.1, 0.02); scene.add(felt);
    const body = new THREE.MeshPhysicalMaterial({ color: T.additive ? '#060607' : '#2a1d20', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 });
    const rail = new THREE.Mesh(new THREE.RoundedBoxGeometry(60, 1.5, 1.4, 3, 0.25), body); rail.position.set(0, 0.1, 7.15); rail.castShadow = true; rail.receiveShadow = true; scene.add(rail);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 7), body); bed.position.set(0, -0.2, 3.3); scene.add(bed);
    const railTrim = new THREE.Mesh(new THREE.BoxGeometry(60, 0.05, 0.06), gold); railTrim.position.set(0, 0.86, 6.5); scene.add(railTrim);

    // Keys pivot at the back like real ones.
    const whiteGeo = new THREE.RoundedBoxGeometry(0.93, 1, 6.2, 2, 0.07).translate(0, -0.5, 3.1);
    const blackGeo = new THREE.RoundedBoxGeometry(0.56, 0.78, 3.9, 2, 0.1).translate(0, -0.39, 1.95);
    S.keys = [];
    for (let p = A0; p <= C8; p++) {
      const black = isBlack(p);
      const mat = new THREE.MeshPhysicalMaterial({ color: black ? T.black : T.white, roughness: black ? 0.22 : 0.3, clearcoat: black ? 1 : 0.5, clearcoatRoughness: 0.15, emissive: '#000000' });
      const m = new THREE.Mesh(black ? blackGeo : whiteGeo, mat);
      m.position.set(KX[p], black ? 1.62 : 1, 0.14);
      m.castShadow = true; m.receiveShadow = true;
      m.userData = { base: new THREE.Color(black ? T.black : T.white), max: black ? 0.05 : 0.034 };
      scene.add(m); S.keys[p] = m;
    }

    // Light beams that rise from a key while it sounds.
    S.beams = [];
    const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    for (let p = A0; p <= C8; p++) {
      const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, opacity: 0, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false }));
      b.position.set(KX[p], DECK + 0.05, -0.2); b.rotation.x = -0.35; b.visible = false; b.renderOrder = 4;
      scene.add(b); S.beams[p] = b;
    }

    // Notes: glossy jewel bars, with a dim mirror copy under the deck.
    S.items = [];
    const mats = new Map(), geos = new Map();
    const noteMat = (track, level, mirror) => {
      const k = `${track}|${level}|${mirror}`;
      if (!mats.has(k)) {
        const c = new THREE.Color(T.notes[track % T.notes.length]);
        mats.set(k, mirror
          ? new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(T.additive ? 0.5 : 0.85), clippingPlanes: clip, fog: true })
          : new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: T.glow * (0.7 + 0.33 * level), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, clippingPlanes: clip }));
      }
      return mats.get(k);
    };
    const noteGeo = (w, len) => {
      const k = `${w.toFixed(2)}|${len.toFixed(1)}`;
      if (!geos.has(k)) geos.set(k, new THREE.RoundedBoxGeometry(w, 0.5, Number(len.toFixed(1)), 2, Math.min(0.16, w / 2.5, len / 2.5)));
      return geos.get(k);
    };
    (S.piece ? S.piece.notes : []).forEach((n, idx) => {
      if (n.pitch < A0 || n.pitch > C8) return;
      const level = Math.min(3, Math.floor(n.vel * 4)), black = isBlack(n.pitch);
      const len = Math.max(0.4, n.dur * SPEED - 0.1);
      // Louder notes are wider and brighter, so loudness never depends on colour alone.
      const w = (black ? 0.5 : 0.8) * (0.6 + 0.4 * n.vel), geo = noteGeo(w, len), y = black ? 1.75 : 1.2;
      const mesh = new THREE.Mesh(geo, noteMat(n.track, level, false)); mesh.castShadow = true;
      const twin = new THREE.Mesh(geo, noteMat(n.track, level, true));
      const sprite = new THREE.Sprite(labelMaterial(n.pitch, T)); sprite.scale.set(1.9, 0.95, 1); sprite.renderOrder = 6;
      scene.add(mesh, twin, sprite);
      S.items.push({ n, idx, mesh, twin, sprite, len, y, color: new THREE.Color(T.notes[n.track % T.notes.length]) });
    });

    // Sparks thrown up when a note lands, and slow dust in the light.
    const mkPoints = (count, size, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false }));
      pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
      return pts;
    };
    S.sparks = mkPoints(2400, 0.34, 1);
    S.dust = mkPoints(140, 0.22, T.additive ? 0.5 : 0.35);
    S.defaultColor = new THREE.Color(T.notes[0]);
    S.trimColor = new THREE.Color(T.trim);
    renderPass.scene = scene;
    S.scene = S.old = scene;
  }

  function render(t) {
    if (!S.scene) build();
    if (S.view === 'flight') {
      const src = S.mic ? S.mic.slice(-400) : S.piece ? S.piece.notes : [];
      let lo = 48, hi = 84;
      if (src.length) { lo = Math.min(...src.map((n) => n.pitch)); hi = Math.max(...src.map((n) => n.pitch)); }
      if (hi - lo < 24) { const m = (lo + hi) / 2; lo = m - 12; hi = m + 12; }
      S.flight.render(t, camera, { voices: S.mic ? [S.mic] : S.voices, notes: S.mic || !S.piece ? [] : S.piece.notes, range: [lo, hi], labels: S.labels, effects: S.effects, motion: S.motion });
      composer.render();
      return;
    }
    const T = THEMES[S.theme], { cx, dist, width } = S.cam;
    const sway = S.motion ? 1 : 0;
    // how much is sounding right now (0..1): drives the room lights and a slight push of the camera toward the keys
    let pulse = 0;
    for (const it of S.items) { const age = t - it.n.onset; if (age >= 0 && age < 2.5) pulse += it.n.vel * Math.exp(-age / 0.55); }
    pulse = Math.min(1, pulse * 0.3);
    const push = 1 - 0.035 * pulse * sway;
    camera.position.set(cx + Math.sin(t * 0.19) * width * 0.05 * sway, (dist * 0.47 + Math.sin(t * 0.13 + 1) * dist * 0.02 * sway) * push, (dist * 0.86 + 2) * push);
    camera.lookAt(cx + Math.sin(t * 0.19) * width * 0.015 * sway, 0.3, -dist * 0.3);
    S.columns.forEach((c, i) => { c.material.opacity = (T.additive ? 0.07 : 0.04) + (T.additive ? 0.45 : 0.2) * pulse * (0.55 + 0.45 * Math.sin(i * 1.7 + t * 0.9)); });

    // press[pitch] = how far down the key is (0..1), with its colour and loudness
    const press = new Map();
    for (const [p, v] of S.live) press.set(p, { a: 1, vel: v.vel, color: S.defaultColor });
    const span = S.far / SPEED, sp = S.sparks.geometry.attributes;
    let used = 0, energy = 0;
    for (const it of S.items) {
      const { n, mesh, twin, sprite, len, y } = it, ahead = n.onset - t, off = n.onset + n.dur;
      const show = ahead < span && off > t - 0.05;
      mesh.visible = twin.visible = show;
      sprite.visible = show && S.labels && ahead > 0.02;
      if (show) {
        const z = -(ahead * SPEED + len / 2 + 0.05);
        mesh.position.set(KX[n.pitch], y, z);
        twin.position.set(KX[n.pitch], 2 * DECK - y, z);
        if (sprite.visible) sprite.position.set(KX[n.pitch], y + 0.95, -(ahead * SPEED + 0.6));
      }
      if (ahead <= 0 && t < off + 0.1) {
        const a = clamp01(-ahead / 0.035) * (1 - clamp01((t - off) / 0.1)), old = press.get(n.pitch);
        if (!old || a > old.a) press.set(n.pitch, { a, vel: n.vel, color: it.color });
        energy += n.vel * a;
      }
      const age = -ahead;
      if (S.effects && age >= 0 && age < 0.9) { // sparks: same arc every time for the same note
        const count = Math.round(5 + 12 * n.vel), fade = (1 - age / 0.9) ** 1.5;
        for (let j = 0; j < count && used < 2400; j++, used++) {
          const vx = (rnd(it.idx, j) - 0.5) * 3.2, vy = (2.2 + 4.5 * rnd(it.idx, j + 50)) * (0.5 + n.vel), vz = -rnd(it.idx, j + 99) * 2.4;
          sp.position.setXYZ(used, KX[n.pitch] + vx * age, DECK + 0.4 + vy * age - 4.2 * age * age, -0.2 + vz * age);
          const warm = j % 3 === 0 ? S.trimColor : it.color;
          sp.color.setXYZ(used, warm.r * fade, warm.g * fade, warm.b * fade);
        }
      }
    }
    S.sparks.geometry.setDrawRange(0, used); sp.position.needsUpdate = true; sp.color.needsUpdate = true;
    S.sparks.visible = used > 0;

    const dp = S.dust.geometry.attributes;
    S.dust.visible = S.effects;
    for (let i = 0; i < 140 && S.effects; i++) {
      const d = 0.25 + 0.2 * rnd(i, 7);
      dp.position.setXYZ(i, cx + (rnd(i, 1) - 0.5) * width * 1.3 + Math.sin(t * 0.11 + i) * 0.8,
        1.5 + rnd(i, 2) * dist * 0.35 + Math.sin(t * 0.17 + i * 2.1) * 0.5, -rnd(i, 3) * S.far * 0.75);
      dp.color.setXYZ(i, S.trimColor.r * d, S.trimColor.g * d, S.trimColor.b * d);
    }
    dp.position.needsUpdate = true; dp.color.needsUpdate = true;

    for (let p = A0; p <= C8; p++) {
      const k = S.keys[p], b = S.beams[p], a = press.get(p);
      k.rotation.x = a ? k.userData.max * a.a : 0;
      if (a) {
        k.material.emissive.copy(a.color); k.material.emissiveIntensity = T.glow * (0.7 + 1.1 * a.vel) * a.a + (T.additive ? 0 : 0.25 * a.a);
        k.material.color.copy(k.userData.base).lerp(a.color, 0.55 * a.a);
      } else { k.material.emissiveIntensity = 0; k.material.color.copy(k.userData.base); }
      b.visible = !!a && S.effects;
      if (b.visible) { b.material.color.copy(a.color); b.material.opacity = (T.additive ? 0.75 : 0.5) * a.a * (0.45 + 0.55 * a.vel); b.scale.set(isBlack(p) ? 0.9 : 1.3, 2.5 + 6 * a.vel, 1); }
    }
    let ri = 0;
    for (const it of S.effects ? S.items : []) {
      const age = t - it.n.onset;
      if (age < 0 || age > 0.8 || ri >= S.rings.length) continue;
      const r = S.rings[ri++], k = age / 0.8, size = 1 + k * (5 + 7 * it.n.vel);
      r.visible = true; r.position.set(KX[it.n.pitch], DECK + 0.02, -0.9 - k * 1.5); r.scale.set(size, 1, size * 1.5);
      r.material.color.copy(it.color); r.material.opacity = (1 - k) ** 1.5 * (0.25 + 0.6 * it.n.vel);
    }
    for (; ri < S.rings.length; ri++) S.rings[ri].visible = false;
    const lit = [...press].map(([p, a]) => ({ p, a, s: a.a * a.vel })).sort((x, y) => y.s - x.s);
    S.flash.forEach((l, i) => {
      const h = lit[i];
      l.intensity = h ? (T.additive ? 26 : 10) * h.s : 0;
      if (h) { l.color.copy(h.a.color); l.position.set(KX[h.p], 2.6, -1.2); }
    });
    S.strike.material.emissiveIntensity = T.glow * (1.5 + Math.min(2, energy * 0.6));
    composer.render();
  }

  return {
    render,
    resize(w, h, ratio = Math.min(devicePixelRatio || 1, 2)) {
      renderer.setPixelRatio(ratio); renderer.setSize(w, h, false);
      composer.setPixelRatio(ratio); composer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix(); S.scene = null;
    },
    setPiece(piece) { S.piece = piece; S.voices = piece ? voicesFromPiece(piece) : []; S.scene = null; },
    setView(v) { S.view = v === 'flight' ? 'flight' : 'piano'; S.scene = null; },
    setMic(points) { S.mic = points; },
    setLabels(on) { S.labels = on; },
    setEffects(on) { S.effects = on; },
    setMotion(on) { S.motion = on; },
    setTheme(name) { S.theme = THEMES[name] ? name : 'noir'; S.scene = null; },
    setLive(map) { S.live = map; },
    isLight: () => !THEMES[S.theme].additive,
  };
}
