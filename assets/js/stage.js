// The 3D scene: a lacquered piano with jewel-coloured notes travelling toward the keys they play.
// Everything is a pure function of the music time t, so a video export draws exactly what playback shows.
import * as THREE from '../vendor/three.min.js?v=7';
import { isBlack, noteName } from './midi.js?v=7';
import { buildFlight, voicesFromPiece } from './flight.js?v=7';
import { buildDancer } from './dancer.js?v=9';

const THEMES = {
  aurora: { bg: ['#000000', '#01030a'], fog: '#000103', runway: '#020304', trim: '#3dffa0', led: '#35ff8a', ledLight: 1.1, dim: 0.3, felt: '#06301c', white: '#eef5f1', black: '#050607',
    notes: ['#2f9bff', '#30f0d0', '#b57bff', '#ffd45a'], label: '#f2f9ff', glow: 0.72, bloom: [0.62, 0.6, 0.82], additive: true, mirror: 0.3, outline: true, env: 0.07 },
  ember: { bg: ['#000000', '#0a0204'], fog: '#030001', runway: '#040203', trim: '#ffb24a', led: '#ff8a2a', ledLight: 1.1, dim: 0.3, felt: '#3a0d10', white: '#f6efe8', black: '#070505',
    notes: ['#ff4fa3', '#ffc23d', '#8f7bff', '#4fe0ff'], label: '#fff6ee', glow: 0.72, bloom: [0.62, 0.6, 0.82], additive: true, mirror: 0.3, outline: true, env: 0.07 },
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
  const S = { theme: 'aurora', camera: 'front', trail: null, pool: [], labels: true, effects: true, motion: true, piece: null, view: 'piano', voices: [], mic: null, flight: null, scene: null, keys: [], items: [], beams: [], live: new Map(), far: 60, cam: null };
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
    if (S.view === 'dancer') {
      S.dancer = buildDancer(THEMES[S.theme], { canvasTex, dot });
      [bloom.strength, bloom.radius, bloom.threshold] = [0.7, 0.5, 0.3];
      renderPass.scene = S.scene = S.old = S.dancer.scene;
      return;
    }
    if (S.view === 'flight') {
      S.flight = buildFlight(THEMES[S.theme], { canvasTex, dot });
      [bloom.strength, bloom.radius, bloom.threshold] = [0.55, 0.55, 0.5];
      renderPass.scene = S.scene = S.old = S.flight.scene;
      return;
    }
    const T = THEMES[S.theme], scene = new THREE.Scene();
    scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
    scene.environment = env; scene.environmentIntensity = T.env ?? 0.22;
    [bloom.strength, bloom.radius, bloom.threshold] = T.bloom;

    // Frame the part of the keyboard the piece uses (at least three octaves), so the notes are large.
    let lo = 36, hi = 96;
    if (S.piece) { lo = Math.min(...S.piece.notes.map((n) => n.pitch)); hi = Math.max(...S.piece.notes.map((n) => n.pitch)); }
    lo = Math.max(A0, Math.floor(lo / 12) * 12); hi = Math.min(C8, Math.ceil((hi + 1) / 12) * 12);
    while (hi - lo < 36) { if (lo > A0 + 5) lo = Math.max(A0, lo - 12); if (hi - lo < 36) hi = Math.min(C8, hi + 12); }
    const x0 = KX[lo] - 1, x1 = KX[hi] + 1, width = x1 - x0, cx = (x0 + x1) / 2;
    const half = Math.atan(Math.tan((camera.fov / 2) * Math.PI / 180) * camera.aspect);
    const dist = (width / 2) / Math.tan(half) * 1.03;
    const ref = width * 0.77; // sizes of the runway and the haze do not depend on the picture shape or the camera
    S.cam = { cx, dist, width, x0, ref };
    S.far = ref * 2.3;
    scene.fog = new THREE.Fog(T.fog, ref * 1.1, ref * 3.4);
    const led = T.led || T.trim;

    scene.add(new THREE.AmbientLight('#ffffff', 0.12 * (T.dim || 1)));
    const key = new THREE.DirectionalLight('#fff1dc', 1.15 * (T.dim || 1));
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
    S.horizon = new THREE.Mesh(new THREE.PlaneGeometry(width * 3.2, width * 0.9), new THREE.MeshBasicMaterial({ map: dot, color: T.notes[0], fog: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    S.horizon.position.set(cx, 4, -S.far * 1.15); scene.add(S.horizon);
    // The light strip along the back of the keys, and the light it throws on them.
    for (const dx of [-0.36, 0, 0.36]) { const l = new THREE.PointLight(led, T.ledLight || 0.5, width * 0.5, 1.6); l.position.set(cx + dx * width, 2.2, -0.9); scene.add(l); }
    // Coloured light thrown by the notes being played, and ripples on the lacquer where they land.
    S.flash = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#ffffff', 0, 26, 1.8); scene.add(l); return l; });
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
    S.rings = Array.from({ length: 28 }, () => { const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false })); r.visible = false; r.renderOrder = 3; scene.add(r); return r; });
    const gold = new THREE.MeshStandardMaterial({ color: T.trim, metalness: 1, roughness: 0.25, emissive: T.trim, emissiveIntensity: 0.12 * T.glow });
    for (let p = 24; p <= C8; p += 12) { // a fine inlay line at every C
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, deckLen), gold); l.position.set(KX[p] - 0.5, DECK + 0.01, -deckLen / 2); l.renderOrder = 2; scene.add(l);
    }
    S.strike = new THREE.Mesh(new THREE.BoxGeometry(60, T.outline ? 0.16 : 0.07, T.outline ? 0.2 : 0.1), new THREE.MeshStandardMaterial({ color: led, emissive: led, emissiveIntensity: 1.6 * T.glow, metalness: 0.6, roughness: 0.3 }));
    S.strike.position.set(0, DECK + (T.outline ? 0.1 : 0.05), -0.14); S.strike.renderOrder = 2; scene.add(S.strike);
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
    const coreMats = new Map();
    const coreMat = (ci) => { if (!coreMats.has(ci)) coreMats.set(ci, new THREE.MeshBasicMaterial({ color: new THREE.Color(T.notes[ci % T.notes.length]).multiplyScalar(0.1), clippingPlanes: clip })); return coreMats.get(ci); };
    const oneTrack = !S.piece || S.piece.tracks === 1;
    const colorIndex = (n) => (oneTrack ? (n.pitch < 60 ? 1 : 0) : n.track); // one track (a recording): lower and upper halves get their own colour
    S.colorOf = (pitch) => new THREE.Color(T.notes[(pitch < 60 ? 1 : 0) % T.notes.length]);
    (S.piece ? S.piece.notes : []).forEach((n, idx) => {
      if (n.pitch < A0 || n.pitch > C8) return;
      const level = Math.min(3, Math.floor(n.vel * 4)), black = isBlack(n.pitch);
      const len = Math.max(0.4, n.dur * SPEED - 0.1);
      // Louder notes are wider and brighter, so loudness never depends on colour alone.
      const w = (black ? 0.5 : 0.8) * (0.6 + 0.4 * n.vel), geo = noteGeo(w, len), y = black ? 1.75 : 1.2;
      const ci = colorIndex(n);
      const mesh = new THREE.Mesh(geo, noteMat(ci, level, false)); mesh.castShadow = true;
      const twin = new THREE.Mesh(geo, noteMat(ci, level, true));
      if (T.outline && len > 0.55) { const core = new THREE.Mesh(noteGeo(w * 0.56, len - 0.3), coreMat(ci)); core.position.y = 0.035; mesh.add(core); }
      const sprite = new THREE.Sprite(labelMaterial(n.pitch, T)); sprite.scale.set(1.9, 0.95, 1); sprite.renderOrder = 6;
      scene.add(mesh, twin, sprite);
      S.items.push({ n, idx, mesh, twin, sprite, len, y, color: new THREE.Color(T.notes[ci % T.notes.length]) });
    });
    // Bars for notes played live: they leave the key when it is pressed and travel away over the deck.
    const unit = new THREE.RoundedBoxGeometry(1, 0.5, 1, 2, 0.12);
    S.pool = Array.from({ length: 140 }, () => {
      const mesh = new THREE.Mesh(unit, new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: T.glow, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, clippingPlanes: clip }));
      const twin = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: '#ffffff', clippingPlanes: clip }));
      const core = T.outline ? new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: '#000000', clippingPlanes: clip })) : null;
      if (core) { core.position.y = 0.035; mesh.add(core); }
      mesh.visible = twin.visible = false; scene.add(mesh, twin);
      return { mesh, twin, core };
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
    S.mist = mkPoints(1600, 0.7, 0.05);
    S.defaultColor = new THREE.Color(T.notes[0]);
    S.trimColor = new THREE.Color(T.trim);
    renderPass.scene = scene;
    S.scene = S.old = scene;
  }

  function render(t, live = false) {
    if (!S.scene) build();
    if (S.view === 'dancer') { S.dancer.render(camera, S.music, { effects: S.effects, motion: S.motion, style: S.dance }); composer.render(); return; }
    if (S.view === 'flight') {
      const src = S.mic ? S.mic.slice(-400) : S.piece ? S.piece.notes : [];
      let lo = 48, hi = 84;
      if (src.length) { lo = Math.min(...src.map((n) => n.pitch)); hi = Math.max(...src.map((n) => n.pitch)); }
      if (hi - lo < 24) { const m = (lo + hi) / 2; lo = m - 12; hi = m + 12; }
      S.flight.render(t, camera, { voices: S.mic ? [S.mic] : S.voices, notes: S.mic || !S.piece ? [] : S.piece.notes, range: [lo, hi], labels: S.labels, effects: S.effects, motion: S.motion });
      composer.render();
      return;
    }
    const T = THEMES[S.theme], { cx, dist, width, x0, ref } = S.cam;
    const sway = S.motion ? 1 : 0, trail = live ? S.trail || [] : [];
    // fx = every note that matters right now (from the piece, or played live), in one shape for the keys and the effects
    const fx = [];
    const span = S.far / SPEED;
    for (const it of S.items) {
      const { n, mesh, twin, sprite, len, y } = it, ahead = n.onset - t, off = n.onset + n.dur;
      const show = !live && ahead < span && off > t - 0.05;
      mesh.visible = twin.visible = show;
      sprite.visible = show && S.labels && ahead > 0.02;
      if (show) {
        const z = -(ahead * SPEED + len / 2 + 0.05);
        mesh.position.set(KX[n.pitch], y, z);
        twin.position.set(KX[n.pitch], 2 * DECK - y, z);
        if (sprite.visible) sprite.position.set(KX[n.pitch], y + 0.95, -(ahead * SPEED + 0.6));
      }
      if (!live && ahead <= 0 && t < off + 2.5) fx.push({ pitch: n.pitch, vel: n.vel, onset: n.onset, off, idx: it.idx, color: it.color });
    }
    let used = 0;
    for (let i = trail.length - 1; i >= 0; i--) {
      const n = trail[i];
      if (n.pitch < A0 || n.pitch > C8) continue;
      const end = n.t1 ?? t, near = (t - end) * SPEED, far = (t - n.t0) * SPEED, color = S.colorOf(n.pitch);
      if (t - end < 2.5 || n.t1 == null) fx.push({ pitch: n.pitch, vel: n.vel, onset: n.t0, off: n.t1 ?? Infinity, idx: i + (n.t0 * 100 | 0), color });
      if (near > S.far || used >= S.pool.length || far - near < 0.05) continue;
      const q = S.pool[used++], black = isBlack(n.pitch), len = far - near, w = (black ? 0.5 : 0.8) * (0.6 + 0.4 * n.vel), y = black ? 1.75 : 1.2, z = -(near + len / 2 + 0.3);
      q.mesh.visible = q.twin.visible = true;
      q.mesh.scale.set(w, 1, len); q.twin.scale.set(w, 1, len);
      q.mesh.position.set(KX[n.pitch], y, z); q.twin.position.set(KX[n.pitch], 2 * DECK - y, z);
      q.mesh.material.color.copy(color); q.mesh.material.emissive.copy(color); q.mesh.material.emissiveIntensity = T.glow * (0.7 + 0.5 * n.vel);
      q.twin.material.color.copy(color).multiplyScalar(0.5);
      if (q.core) { q.core.visible = len > 0.7; q.core.scale.set(0.56, 1, Math.max(0.05, (len - 0.34) / len)); q.core.material.color.copy(color).multiplyScalar(0.1); }
    }
    for (let i = used; i < S.pool.length; i++) S.pool[i].mesh.visible = S.pool[i].twin.visible = false;

    // how much is sounding right now (0..1): drives the room light and a slight push of the camera toward the keys
    let pulse = 0;
    for (const f of fx) { const age = t - f.onset; if (age >= 0 && age < 2.5) pulse += f.vel * Math.exp(-age / 0.55); }
    pulse = Math.min(1, pulse * 0.3);
    const push = 1 - 0.035 * pulse * sway, sx = Math.sin(t * 0.19) * sway, sy = Math.sin(t * 0.13 + 1) * sway;
    if (S.camera === 'side') { // from beyond the low notes, looking along the keyboard: the notes arrive from the left
      camera.position.set(x0 - width * (0.3 - 0.012 * sx), width * (0.36 + 0.008 * sy) * push, width * (0.2 + 0.01 * sx));
      camera.lookAt(cx - width * 0.08, 0, -width * 0.12);
    } else if (S.camera === 'top') { // straight down, like sheet music scrolling toward the player
      const h = dist * 1.02;
      camera.position.set(cx + sx * width * 0.01, h * push, 4.5);
      camera.lookAt(cx + sx * width * 0.01, 0, 4.5 - h * 0.42);
    } else {
      camera.position.set(cx + sx * width * 0.05, (dist * 0.66 + sy * dist * 0.02) * push, (dist * 0.72 + 2) * push);
      camera.lookAt(cx + sx * width * 0.015, 0.3, -dist * 0.24);
    }
    S.horizon.material.opacity = S.effects ? 0.02 + 0.1 * pulse : 0;

    // press[pitch] = how far down the key is (0..1), with its colour and loudness
    const press = new Map();
    for (const [p, v] of S.live) press.set(p, { a: 1, vel: v.vel, color: S.colorOf(p) });
    const sp = S.sparks.geometry.attributes, mp = S.mist.geometry.attributes;
    let energy = 0, mused = 0;
    used = 0;
    for (const f of fx) {
      const age = t - f.onset;
      if (t < f.off + 0.1) {
        const a = clamp01(age / 0.035) * (1 - clamp01((t - f.off) / 0.1)), old = press.get(f.pitch);
        if (!old || a > old.a) press.set(f.pitch, { a, vel: f.vel, color: f.color });
        energy += f.vel * a;
      }
      if (!S.effects) continue;
      if (age < 0.9) { // sparks: same arc every time for the same note
        const count = Math.round(5 + 12 * f.vel), fade = (1 - age / 0.9) ** 1.5;
        for (let j = 0; j < count && used < 2400; j++, used++) {
          const vx = (rnd(f.idx, j) - 0.5) * 3.2, vy = (2.2 + 4.5 * rnd(f.idx, j + 50)) * (0.5 + f.vel), vz = -rnd(f.idx, j + 99) * 2.4;
          sp.position.setXYZ(used, KX[f.pitch] + vx * age, DECK + 0.4 + vy * age - 4.2 * age * age, -0.2 + vz * age);
          const warm = j % 3 === 0 ? S.trimColor : f.color;
          sp.color.setXYZ(used, warm.r * fade, warm.g * fade, warm.b * fade);
        }
      }
      // mist: while a note is held, soft light keeps rising where it meets the keys
      const STEP = 0.07, LIFE = 1.5, last = Math.floor((Math.min(t, f.off) - f.onset) / STEP);
      for (let j = Math.max(0, Math.ceil((t - LIFE - f.onset) / STEP)); j <= last && mused < 1600; j++, mused++) {
        const a = t - (f.onset + j * STEP), k = a / LIFE, fade = (1 - k) ** 2 * Math.min(1, a / 0.08) * (0.35 + 0.65 * f.vel);
        mp.position.setXYZ(mused, KX[f.pitch] + (rnd(f.idx, j) - 0.5) * (0.7 + 2.4 * k), DECK + 0.5 + a * (0.9 + 1.6 * rnd(f.idx, j + 31)), -0.5 - rnd(f.idx, j + 77) * 1.4 - a * 1.1);
        mp.color.setXYZ(mused, f.color.r * fade, f.color.g * fade, f.color.b * fade);
      }
    }
    S.sparks.geometry.setDrawRange(0, used); sp.position.needsUpdate = true; sp.color.needsUpdate = true;
    S.sparks.visible = used > 0;
    S.mist.geometry.setDrawRange(0, mused); mp.position.needsUpdate = true; mp.color.needsUpdate = true;
    S.mist.visible = mused > 0;

    const dp = S.dust.geometry.attributes;
    S.dust.visible = S.effects;
    for (let i = 0; i < 140 && S.effects; i++) {
      const d = 0.25 + 0.2 * rnd(i, 7);
      dp.position.setXYZ(i, cx + (rnd(i, 1) - 0.5) * width * 1.3 + Math.sin(t * 0.11 + i) * 0.8,
        1.5 + rnd(i, 2) * ref * 0.35 + Math.sin(t * 0.17 + i * 2.1) * 0.5, -rnd(i, 3) * S.far * 0.75);
      dp.color.setXYZ(i, S.trimColor.r * d, S.trimColor.g * d, S.trimColor.b * d);
    }
    dp.position.needsUpdate = true; dp.color.needsUpdate = true;

    for (let p = A0; p <= C8; p++) {
      const k = S.keys[p], b = S.beams[p], a = press.get(p);
      k.rotation.x = a ? k.userData.max * a.a : 0;
      if (a) {
        k.material.emissive.copy(a.color); k.material.emissiveIntensity = T.glow * (0.7 + 1.1 * a.vel) * a.a;
        k.material.color.copy(k.userData.base).lerp(a.color, 0.55 * a.a);
      } else { k.material.emissiveIntensity = 0; k.material.color.copy(k.userData.base); }
      b.visible = !!a && S.effects;
      if (b.visible) { b.material.color.copy(a.color); b.material.opacity = (T.dim ? 0.3 : 0.75) * a.a * (0.45 + 0.55 * a.vel); b.scale.set(isBlack(p) ? 0.9 : 1.3, 2.5 + 6 * a.vel, 1); b.rotation.y = S.camera === 'side' ? -1.1 : 0; }
    }
    let ri = 0;
    for (const f of S.effects ? fx : []) {
      const age = t - f.onset;
      if (age < 0 || age > 0.8 || ri >= S.rings.length) continue;
      const r = S.rings[ri++], k = age / 0.8, size = 1 + k * (5 + 7 * f.vel);
      r.visible = true; r.position.set(KX[f.pitch], DECK + 0.02, -0.9 - k * 1.5); r.scale.set(size, 1, size * 1.5);
      r.material.color.copy(f.color); r.material.opacity = (1 - k) ** 1.5 * (0.25 + 0.6 * f.vel) * (T.dim ? 0.6 : 1);
    }
    for (; ri < S.rings.length; ri++) S.rings[ri].visible = false;
    const lit = [...press].map(([p, a]) => ({ p, a, s: a.a * a.vel })).sort((x, y) => y.s - x.s);
    S.flash.forEach((l, i) => {
      const h = lit[i];
      l.intensity = h ? (T.dim ? 9 : 26) * h.s : 0;
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
    setView(v) { S.view = ['flight', 'dancer'].includes(v) ? v : 'piano'; S.scene = null; },
    setMusic(features) { S.music = features; },
    dancer: () => S.dancer,
    setDance(style) { S.dance = style; },
    setMic(points) { S.mic = points; },
    setLabels(on) { S.labels = on; },
    setEffects(on) { S.effects = on; },
    setMotion(on) { S.motion = on; },
    setTheme(name) { S.theme = THEMES[name] ? name : 'aurora'; S.scene = null; },
    setLive(map) { S.live = map; },
    setTrail(list) { S.trail = list; },
    setCamera(c) { S.camera = ['side', 'top'].includes(c) ? c : 'front'; },
    isLight: () => false,
    themes: () => Object.fromEntries(Object.entries(THEMES).map(([k, T]) => [k, [T.led || T.trim, ...T.notes]])),
  };
}
