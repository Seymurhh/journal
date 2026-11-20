// "Sheet music in light": the written music lies on a dark glass floor, engraved in warm ivory, and the camera glides
// along it. Each note catches fire in its hand's colour the moment it is played and keeps a soft glow afterwards. For
// each hand a path of light hops from note to note, landing on every note exactly as it sounds, with a small lantern
// that lights the music around it. Everything depends only on the music time t, so a video export draws exactly
// what playback shows.
//
// The notation is worked out from the MIDI file: written lengths from how long each note is held and when the next
// one comes, eighths and shorter beamed by the beat, stems up or down by position (two voices on one staff get one
// each), dots, ledger lines, accidentals in the key, and bar lines from the time signature. Rests and ties are not
// drawn: a tied note shows as one longer note. Spacing follows the rhythm, wider for long notes, as in print.
import * as THREE from '../vendor/three.min.js?v=7';
import { barTimes, guessKey, speller, SIG } from './score.js?v=19';

const TB = 11;                                 // page height of the treble staff's bottom line (the bass staff's is 0)
const MID = [TB + 2, 2];                       // the middle line of each staff
const TOP = [TB + 4, 4], BOTTOM = [TB, 0];
const pageY = (step, staff) => (staff ? (step - 18) / 2 : TB + (step - 30) / 2); // step = octave * 7 + letter; E4 = 30, G2 = 18
const VALUES = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4]; // written lengths in beats
const INK = 0.03;                              // how far the printing stands above the glass
const TRAIL = 2.4, N = 170;                    // seconds of light path behind each hand, and its number of points
const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const W = (x, y, h = INK) => new THREE.Vector3(x, h, -y); // page (x, y) to the world: the page lies flat, its top away from the viewer

// ---------- reading the music ----------
function engrave(piece) {
  const sf = piece.key ? piece.key.sf : guessKey(piece.notes), spell = speller(sf), two = piece.tracks === 2;
  const mean = [0, 1].map((k) => { const l = piece.notes.filter((n) => n.track === k); return l.reduce((s, n) => s + n.pitch, 0) / (l.length || 1); }), upper = mean[0] >= mean[1] ? 0 : 1;
  const tempo = piece.tempoMap.length ? piece.tempoMap : [{ time: 0, bpm: 100 }];
  const beatAt = (t) => { let bpm = tempo[0].bpm; for (const m of tempo) if (m.time <= t + 0.01) bpm = m.bpm; return 60 / bpm; };
  const bars = barTimes(piece);
  const meters = piece.meterMap && piece.meterMap.length ? piece.meterMap : [{ time: 0, meter: piece.meter || [4, 4] }];
  const meterAt = (t) => { let m = meters[0].meter; for (const k of meters) if (k.time <= t + 0.01) m = k.meter; return m; };
  const barStart = (t) => { let b = 0; for (const x of bars) { if (x <= t + 0.01) b = x; else break; } return b; };
  const staffOf = (n) => (two ? (n.track === upper ? 0 : 1) : n.pitch < 60 ? 1 : 0);

  // notes struck together on one staff
  const events = [[], []];
  for (const n of piece.notes) {
    const list = events[staffOf(n)], last = list[list.length - 1];
    if (last && Math.abs(last.t - n.onset) < 0.03) last.notes.push(n); else list.push({ t: n.onset, notes: [n] });
  }
  // chords with a written length and a voice: 1 = upper (stems up), 2 = lower (stems down), 0 = alone (stem by position)
  const chords = [];
  for (const staff of [0, 1]) {
    const list = events[staff];
    let held = [];
    list.forEach((e, i) => {
      const beat = beatAt(e.t), gap = list[i + 1] ? (list[i + 1].t - e.t) / beat : Infinity, groups = new Map();
      for (const n of e.notes) {
        const d = n.dur / beat;
        let v = d >= 0.7 * gap && d <= 1.45 * gap ? gap : d; // held until the next note: it lasts until then; much longer: another voice
        v = VALUES.reduce((a, b) => (Math.abs(Math.log(b / v)) < Math.abs(Math.log(a / v)) ? b : a));
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(n);
      }
      held = held.filter((h) => h.end > e.t + 0.03);
      const gs = [...groups].map(([v, ns]) => ({ v, ns, top: Math.max(...ns.map((n) => n.pitch)), low: Math.min(...ns.map((n) => n.pitch)) })).sort((a, b) => b.top - a.top);
      const made = gs.map((g, k) => {
        let voice = 0;
        if (gs.length > 1) voice = k === 0 ? 1 : 2;
        else if (held.length) voice = g.top <= Math.min(...held.map((h) => h.low)) ? 2 : g.low >= Math.max(...held.map((h) => h.top)) ? 1 : 0;
        const heads = g.ns.map((n) => { const s = spell(n.pitch); return { pitch: n.pitch, step: s.step, acc: s.acc, y: pageY(s.step, staff) }; }).sort((a, b) => a.y - b.y);
        return { t: e.t, staff, v: g.v, voice, heads, beat, end: e.t + g.v * beat, vel: Math.max(...g.ns.map((n) => n.vel)), top: g.top, low: g.low, pos: (e.t - barStart(e.t)) / beat, meter: meterAt(e.t) };
      });
      chords.push(...made); held.push(...made);
    });
  }
  chords.sort((a, b) => a.t - b.t || a.staff - b.staff);

  // horizontal places: one per moment something is struck, spaced by the rhythm
  const keyW = Math.abs(sf) * 0.85, START = 5.2 + keyW + 2.4 + 2.2; // after the clefs, key signature and time signature
  const times = [], accAt = [];
  for (const c of chords) {
    if (!times.length || c.t - times[times.length - 1] > 0.03) { times.push(c.t); accAt.push(false); }
    c.ti = times.length - 1;
    if (c.heads.some((h) => h.acc)) accAt[c.ti] = true;
  }
  const X = new Float64Array(times.length);
  let x = START, b = 0;
  const inner = bars.filter((t) => t > times[0] + 0.03);
  for (let i = 0; i < times.length; i++) {
    if (i) {
      const beats = (times[i] - times[i - 1]) / beatAt(times[i - 1]);
      let w = Math.max(accAt[i] ? 2.7 : 2.0, 3.9 * Math.pow(Math.max(beats, 0.125), 0.62));
      if (accAt[i]) w += 0.6;
      while (b < inner.length && inner[b] <= times[i] + 0.03) { if (inner[b] > times[i - 1] + 0.03) w += 1.7; b++; }
      x += w;
    }
    X[i] = x;
  }
  const last = times.length - 1;
  const rateA = 3.9 / beatAt(times[0]), rateB = 3.9 / beatAt(times[last]);
  const xOf = (t) => {
    if (t <= times[0]) return X[0] - (times[0] - t) * rateA;
    if (t >= times[last]) return X[last] + (t - times[last]) * rateB;
    let lo = 0, hi = last;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; }
    return X[lo] + (X[lo + 1] - X[lo]) * (t - times[lo]) / (times[lo + 1] - times[lo]);
  };
  for (const c of chords) c.x = X[c.ti];
  // bar lines: just before the first note of a bar, or where the bar begins inside a held note
  const barX = [];
  let finalX = null;
  for (const t of inner) {
    if (t > times[last] + 0.03) { finalX = xOf(t) - 1; break; }
    const j = times.findIndex((s) => s >= t - 0.03);
    barX.push(Math.abs(times[j] - t) < 0.03 ? X[j] - (accAt[j] ? 2.3 : 1.5) : xOf(t));
  }
  if (finalX == null) { const c = chords.filter((k) => k.ti === last); finalX = X[last] + Math.max(4, Math.max(...c.map((k) => k.v)) * 3.9 * 0.8); }

  // beams: eighths and shorter that follow one another in the same voice, grouped by the beat
  // (eighths by the half bar in 2/4 and 4/4, by the dotted beat in 6/8, 9/8 and 12/8)
  const level = (v) => (v <= 0.125 ? 3 : v <= 0.25 || v === 0.375 ? 2 : 1);
  const windowOf = (c) => { const [n, d] = c.meter; if (d === 8 && n % 3 === 0) return 1.5; return d === 4 && n % 2 === 0 && c.v >= 0.5 ? 2 : 1; };
  const groups = [];
  for (const staff of [0, 1]) for (const voice of [0, 1, 2]) {
    const list = chords.filter((c) => c.staff === staff && c.voice === voice);
    let cur = null;
    for (const c of list) {
      const short = c.v < 1;
      if (cur && short) {
        const p = cur[cur.length - 1], win = windowOf(cur[0]);
        if (Math.abs(p.end - c.t) < 0.04 && Math.floor(c.pos / win + 1e-6) === Math.floor(cur[0].pos / win + 1e-6) && c.pos >= cur[0].pos) { cur.push(c); continue; }
      }
      if (cur) groups.push(cur);
      cur = short ? [c] : null;
      if (!short) groups.push([c]);
    }
    if (cur) groups.push(cur);
  }
  // landing places for the paths of light: per hand, the top note (right hand) or the bottom note (left hand) of each moment
  const landings = [0, 1].map((staff) => {
    const out = [];
    for (const c of chords) {
      if (c.staff !== staff) continue;
      const y = staff ? c.heads[0].y : c.heads[c.heads.length - 1].y, l = out[out.length - 1];
      if (l && l.t === c.t) l.y = staff ? Math.min(l.y, y) : Math.max(l.y, y);
      else out.push({ t: c.t, x: c.x, y });
    }
    return out;
  });
  const shown = meters.length > 1 && meters[1].time < 4 * beatAt(0) + 0.01 ? meters[1].meter : meters[0].meter; // a pickup bar does not change the printed time signature
  return { sf, chords, groups, barX, finalX, xOf, level, start: START, keyW, meter: shown, landings, end: X[last] };
}

// ---------- the picture ----------
export function buildSheet(T, tools, piece) {
  const { canvasTex, dot, env } = tools, scene = new THREE.Scene();
  scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(T.fog, 34, 92);
  scene.environment = env; scene.environmentIntensity = 0.12;
  const hands = [new THREE.Color(T.notes[0]), new THREE.Color(T.notes[1 % T.notes.length])];
  const inkColor = new THREE.Color('#e9dcc0').lerp(new THREE.Color(T.trim), 0.12);
  const S = piece && piece.notes.length ? engrave(piece) : null;

  // the glass floor, and the light
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.5 }));
  floor.scale.set(4000, 1, 400); floor.position.set(0, 0, -60); scene.add(floor);
  scene.add(new THREE.AmbientLight('#ffffff', 0.18));
  const keyLight = new THREE.DirectionalLight('#fff1dc', 0.45); keyLight.position.set(-20, 30, 25); scene.add(keyLight, keyLight.target);
  const lamp = new THREE.PointLight('#fff4e2', 9, 26, 1.6); scene.add(lamp); // the reading lamp that travels with the music
  const lanterns = hands.map((c) => { const l = new THREE.PointLight(c, 0, 9, 1.6); scene.add(l); return l; });

  const ink = new THREE.MeshStandardMaterial({ color: inkColor, roughness: 0.38, metalness: 0.55, emissive: inkColor, emissiveIntensity: 0.32, side: THREE.DoubleSide });
  const bead = new THREE.MeshPhysicalMaterial({ color: inkColor, roughness: 0.2, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, emissive: inkColor, emissiveIntensity: 0.18 });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });

  // shapes, made in page coordinates and laid flat
  const flat = (geo) => geo.rotateX(-Math.PI / 2);
  const bar = flat(new THREE.PlaneGeometry(1, 1)); // a unit printed rectangle; scaled for stems, beams, lines
  const solidHead = new THREE.SphereGeometry(0.5, 28, 14).scale(1.24, 0.42, 0.96).rotateY(0.36).translate(0, 0.12, 0);
  const openHead = new THREE.TorusGeometry(0.4, 0.12, 10, 36).scale(1.32, 0.98, 0.9).rotateX(-Math.PI / 2).rotateY(0.36).translate(0, 0.1, 0);
  const wholeHead = new THREE.TorusGeometry(0.44, 0.15, 10, 36).scale(1.38, 0.9, 0.9).rotateX(-Math.PI / 2).translate(0, 0.1, 0);
  const dotGeo = new THREE.SphereGeometry(0.17, 12, 8).scale(1, 0.6, 1);
  const flagShape = (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(0.15, -0.9, 1.25, -1.2, 0.95, -2.6); s.bezierCurveTo(1.05, -1.7, 0.4, -1.25, 0, -1.1); s.lineTo(0, 0); return flat(new THREE.ShapeGeometry(s, 12)); })();

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const lists = { line: [], solid: [], open: [], whole: [], dot: [], flagUp: [], flagDown: [], sharp: [], flat: [], natural: [] };
  const rect = (x0, y0, x1, y1) => lists.line.push([(x0 + x1) / 2, (y0 + y1) / 2, Math.max(0.001, Math.abs(x1 - x0)), Math.max(0.001, Math.abs(y1 - y0)), 0]);
  const slab = (x0, y0, x1, y1, thick) => lists.line.push([(x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0), thick, Math.atan2(y1 - y0, x1 - x0)]); // a sloping beam
  const glowHeads = []; // [list name, index, chord]

  if (S) {
    const { chords, groups, level } = S;
    const stemX = (c, d) => c.x + d * 0.6;
    const dirOf = (cs) => {
      const v = cs[0].voice;
      if (v === 1) return 1;
      if (v === 2) return -1;
      const mid = MID[cs[0].staff], hi = Math.max(...cs.map((c) => c.heads[c.heads.length - 1].y)) - mid, lo = mid - Math.min(...cs.map((c) => c.heads[0].y));
      return hi > lo ? -1 : 1;
    };
    const drawHeads = (c, d) => {
      // heads a step apart sit on either side of the stem
      const order = d > 0 ? c.heads : [...c.heads].reverse();
      let prev = null;
      for (const h of order) { h.dx = prev && Math.abs(h.step - prev.step) === 1 && !prev.dx ? d * 1.18 : 0; prev = h; }
      const kind = c.v >= 4 ? 'whole' : c.v >= 2 ? 'open' : 'solid', dotted = [0.375, 0.75, 1.5, 3].includes(c.v);
      let accCol = 0, lastAccY = Infinity;
      for (const h of [...c.heads].reverse()) {
        const hx = c.x + h.dx;
        glowHeads.push([kind, lists[kind].length, c]); lists[kind].push([hx, h.y]);
        if (dotted) lists.dot.push([c.x + 1.05 + Math.max(0, ...c.heads.map((k) => k.dx)), Number.isInteger(h.y) ? h.y + 0.5 : h.y]);
        // ledger lines
        for (let ly = BOTTOM[c.staff] - 1; ly >= h.y - 0.01; ly--) rect(hx - 0.95, ly - 0.05, hx + 0.95, ly + 0.05);
        for (let ly = TOP[c.staff] + 1; ly <= h.y + 0.01; ly++) rect(hx - 0.95, ly - 0.05, hx + 0.95, ly + 0.05);
        if (h.acc) {
          accCol = lastAccY - h.y < 3 ? accCol + 1 : 0; lastAccY = h.y;
          lists[h.acc === '♯' ? 'sharp' : h.acc === '♭' ? 'flat' : 'natural'].push([c.x - 1.45 - accCol * 0.95 + Math.min(0, h.dx), h.y]);
        }
      }
    };
    for (const g of groups) {
      const d = dirOf(g), lv = g.map((c) => level(c.v));
      g.forEach((c) => drawHeads(c, d));
      if (g[0].v >= 4) continue; // whole notes have no stem
      const far = (c) => (d > 0 ? c.heads[0].y : c.heads[c.heads.length - 1].y), near = (c) => (d > 0 ? c.heads[c.heads.length - 1].y : c.heads[0].y);
      if (g.length === 1) {
        const c = g[0], extra = c.v < 1 ? (lv[0] - 1) * 0.6 : 0;
        let end = near(c) + d * (3.5 + extra);
        end = d > 0 ? Math.max(end, MID[c.staff]) : Math.min(end, MID[c.staff]);
        const sx = stemX(c, d);
        rect(sx - 0.065, Math.min(far(c), end), sx + 0.065, Math.max(far(c), end));
        if (c.v < 1) for (let k = 0; k < lv[0]; k++) lists[d > 0 ? 'flagUp' : 'flagDown'].push([sx, end - d * k * 0.8]);
        continue;
      }
      // a beam along the stem ends, sloping gently with the melody, far enough out for every stem
      const deep = Math.max(...lv), xs = g.map((c) => stemX(c, d)), f = g[0], l = g[g.length - 1];
      const y0 = near(f) + d * 3.5, y1 = near(l) + d * 3.5, slope = Math.max(-0.16, Math.min(0.16, (y1 - y0) / (xs[xs.length - 1] - xs[0]) * 0.5));
      let base = y0;
      g.forEach((c, i) => { const need = near(c) + d * (3.0 + (deep - 1) * 0.8), at = base + slope * (xs[i] - xs[0]); if ((need - at) * d > 0) base += need - at; });
      const at = (x) => base + slope * (x - xs[0]);
      g.forEach((c, i) => rect(xs[i] - 0.065, Math.min(far(c), at(xs[i])), xs[i] + 0.065, Math.max(far(c), at(xs[i]))));
      for (let L = 1; L <= deep; L++) {
        const off = -d * (L - 1) * 0.8, seg = (xa, xb) => slab(xa, at(xa) + off - d * 0.25, xb, at(xb) + off - d * 0.25, 0.5);
        if (L === 1) { seg(xs[0] - 0.065, xs[xs.length - 1] + 0.065); continue; }
        for (let i = 0; i < g.length; i++) {
          if (lv[i] < L) continue;
          if (i + 1 < g.length && lv[i + 1] >= L) seg(xs[i], xs[i + 1]);
          else if (!(i > 0 && lv[i - 1] >= L)) seg(i + 1 < g.length ? xs[i] : xs[i] - 1.1, i + 1 < g.length ? xs[i] + 1.1 : xs[i]);
        }
      }
    }
    for (const bx of S.barX) rect(bx - 0.07, 0, bx + 0.07, TOP[0]);
    rect(S.finalX - 0.75, 0, S.finalX - 0.6, TOP[0]); rect(S.finalX - 0.3, 0, S.finalX + 0.12, TOP[0]); // the closing double bar
    // key signature
    for (let i = 0; i < Math.abs(S.sf); i++) for (const staff of [0, 1]) lists[S.sf < 0 ? 'flat' : 'sharp'].push([5.6 + i * 0.85, pageY(SIG[S.sf < 0 ? 'flat' : 'sharp'][staff ? 'bass' : 'treble'][i], staff)]);
  }
  const left = 0.6, right = S ? S.finalX : 60;
  rect(left - 0.07, 0, left + 0.07, TOP[0]); // the line that joins the two staves at the start
  for (const b of [TB, 0]) for (let i = 0; i < 5; i++) rect(left, b + i - 0.045, right, b + i + 0.045);

  // turn the lists into instanced meshes
  const inst = (geo, mat, items, place) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    m.count = items.length;
    items.forEach((it, i) => { place(it); m.setMatrixAt(i, M); });
    m.frustumCulled = false; scene.add(m);
    return m;
  };
  inst(bar, ink, lists.line, ([x, y, w, h, a]) => M.compose(V.set(x, INK, -y), Q.setFromAxisAngle(UP, a), SC.set(w, 1, h)));
  const headPlace = ([x, y]) => M.compose(V.set(x, INK, -y), Q.identity(), SC.set(1, 1, 1));
  const heads = {}, glows = {};
  for (const [kind, geo] of [['solid', solidHead], ['open', openHead], ['whole', wholeHead]]) {
    heads[kind] = inst(geo, bead, lists[kind], headPlace);
    glows[kind] = inst(geo, glowMat, lists[kind], ([x, y]) => M.compose(V.set(x, INK + 0.02, -y), Q.identity(), SC.set(1.14, 1.3, 1.14)));
    glows[kind].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, lists[kind].length) * 3), 3);
    glows[kind].renderOrder = 3;
  }
  inst(dotGeo, bead, lists.dot, ([x, y]) => M.compose(V.set(x, INK + 0.05, -y), Q.identity(), SC.set(1, 1, 1)));
  inst(flagShape, ink, lists.flagUp, ([x, y]) => M.compose(V.set(x - 0.06, INK, -y), Q.identity(), SC.set(1, 1, 1)));
  inst(flagShape, ink, lists.flagDown, ([x, y]) => M.compose(V.set(x - 0.06, INK, -y), Q.identity(), SC.set(1, 1, -1)));
  // accidentals and the signs at the start of the staves are printed from a small sheet of letters
  const signs = canvasTex(384, 128, (g) => { g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '96px serif'; ['♯', '♭', '♮'].forEach((s, i) => g.fillText(s, 64 + i * 128, s === '♭' ? 50 : 64)); });
  const signMat = new THREE.MeshBasicMaterial({ map: signs, color: inkColor, transparent: true, depthWrite: false, alphaTest: 0.1 });
  ['sharp', 'flat', 'natural'].forEach((name, i) => {
    const geo = flat(new THREE.PlaneGeometry(1.5, 1.5)), uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
    inst(geo, signMat, lists[name], ([x, y]) => M.compose(V.set(x, INK + 0.01, -y), Q.identity(), SC.set(1.3, 1, 2.2)));
  });
  // clefs and time signature: drawn once onto a card at the start of the staves
  const PX = 48, cardW = 12, cardTop = TOP[0] + 3.5, cardBottom = -3.5;
  const clefOK = (() => { const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true }); const ink2 = (ch) => { x.clearRect(0, 0, 40, 40); x.font = '30px serif'; x.fillText(ch, 4, 32); return x.getImageData(0, 0, 40, 40).data.reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0); }; const a = ink2('\u{1D11E}'), b2 = ink2('\u{1D122}'), box = ink2('\u{10FFFE}'); return a > 2000 && b2 > 1500 && Math.abs(a - box) > 200 && Math.abs(a - b2) > 200; })();
  const card = canvasTex(cardW * PX, (cardTop - cardBottom) * PX, (g) => {
    const Y = (y) => (cardTop - y) * PX;
    g.fillStyle = '#fff';
    if (clefOK) { g.font = `${5.2 * PX}px serif`; g.fillText('\u{1D11E}', 1.2 * PX, Y(TB - 0.4)); g.font = `${4 * PX}px serif`; g.fillText('\u{1D122}', 1.3 * PX, Y(0.95)); }
    else { g.font = `italic 600 ${3.2 * PX}px Georgia, serif`; g.fillText('G', 1.4 * PX, Y(TB + 0.6)); g.fillText('F', 1.5 * PX, Y(1.2)); }
    if (S) {
      const [n, d] = S.meter, tx = (5.6 + S.keyW + 1.0) * PX;
      g.font = `700 ${2.6 * PX}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const b of [TB, 0]) { g.fillText(String(n), tx, Y(b + 3)); g.fillText(String(d), tx, Y(b + 1)); }
    }
  });
  const cardMesh = new THREE.Mesh(flat(new THREE.PlaneGeometry(cardW, cardTop - cardBottom)), new THREE.MeshBasicMaterial({ map: card, color: inkColor, transparent: true, depthWrite: false }));
  cardMesh.position.set(left + cardW / 2 - 0.2, INK + 0.01, -(cardTop + cardBottom) / 2); scene.add(cardMesh);

  // paths of light, their heads and lanterns, and sparks where they land
  const paths = hands.map((c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = []; for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    mesh.frustumCulled = false; mesh.renderOrder = 6;
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: c.clone().lerp(new THREE.Color('#ffffff'), 0.55).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    head.renderOrder = halo.renderOrder = 7;
    scene.add(mesh, head, halo);
    return { mesh, head, halo };
  });
  const sparks = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(900 * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.28, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    p.frustumCulled = false; scene.add(p); return p;
  })();
  // notes played live (no piece): heads that appear where and when they are played
  const LIVE = 400, spell0 = speller(0);
  const liveHeads = new THREE.InstancedMesh(solidHead, bead, LIVE), liveGlow = new THREE.InstancedMesh(solidHead, glowMat, LIVE);
  liveGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LIVE * 3), 3);
  liveHeads.count = liveGlow.count = 0; liveHeads.frustumCulled = liveGlow.frustumCulled = false; scene.add(liveHeads, liveGlow);
  const liveLines = Array.from({ length: 10 }, (_, i) => { const m = new THREE.Mesh(bar, ink); m.position.set(0, INK, -((i < 5 ? TB : 0) + (i % 5))); m.scale.set(200, 1, 0.09); m.visible = false; scene.add(m); return m; });

  // where the camera looks: the place of the music, smoothed so the glide is even when the rhythm is not
  const camAt = (() => {
    if (!S) return () => 14;
    const step = 0.05, t0 = -4, t1 = (piece.duration || 0) + 6, n = Math.ceil((t1 - t0) / step) + 1, a = new Float64Array(n), tmp = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = S.xOf(t0 + i * step);
    const R = Math.round(0.6 / step);
    for (let pass = 0; pass < 3; pass++) { for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { s += a[j]; k++; } tmp[i] = s / k; } a.set(tmp); }
    return (t) => { const u = Math.min(n - 1, Math.max(0, (t - t0) / step)), i = Math.floor(u), f = u - i; return i + 1 < n ? a[i] + (a[i + 1] - a[i]) * f : a[i]; };
  })();
  // a hand's path at time tau: [x, page y, height above the glass]
  function fly(list, tau) {
    if (!list.length) return null;
    if (tau < list[0].t) { const k = Math.min(1, (list[0].t - tau) / 1.2); return [S.xOf(tau), list[0].y, 0.35 + 2.5 * k * k]; }
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= tau) lo = m; else hi = m - 1; }
    const a = list[lo], b = list[lo + 1];
    if (!b) { const age = tau - a.t; return [a.x, a.y, 0.35 + 1.6 * Math.exp(-age * 2.5) * Math.abs(Math.sin(age * 6))]; }
    const gap = b.t - a.t, u = (tau - a.t) / gap, hop = Math.min(2.0, 0.3 + 1.5 * Math.sqrt(gap));
    return [S.xOf(tau), a.y + (b.y - a.y) * smooth(u), 0.35 + hop * 4 * u * (1 - u)];
  }

  const WHITE = new THREE.Color('#ffffff'), col = new THREE.Color(), P = new THREE.Vector3(), Pn = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3(), tang = new THREE.Vector3();
  const glowLevel = (c, t) => {
    const age = t - c.t;
    if (age < 0) return 0;
    const len = Math.max(0.15, c.end - c.t);
    let k = age < 0.1 ? 2.8 - 8 * age : age < len ? 1.1 + 0.7 * Math.exp(-(age - 0.1) / 0.5) : 0.3 + 0.8 * Math.exp(-(age - len) / 1.1);
    return k * (0.55 + 0.6 * c.vel);
  };

  function render(t, camera, { live, effects, motion, paths: showPaths }) {
    const tall = camera.aspect < 1, sway = motion ? 1 : 0;
    let xc;
    if (live) {
      const xl = (s) => s * 5; // when playing live, the music is spaced by time
      xc = xl(t) - 6; // the newest notes sit just left of the middle
      let k = 0;
      for (let i = live.length - 1; i >= 0 && k < LIVE; i--) {
        const n = live[i], x = xl(n.t0);
        if (x < xc - 40) break;
        if (n.pitch < 21 || n.pitch > 108) continue;
        const staff = n.pitch < 60 ? 1 : 0, y = pageY(spell0(n.pitch).step, staff), held = n.t1 == null, age = t - n.t0;
        M.compose(V.set(x, INK, -y), Q.identity(), SC.set(1, 1, 1)); liveHeads.setMatrixAt(k, M);
        M.compose(V.set(x, INK + 0.02, -y), Q.identity(), SC.set(1.14, 1.3, 1.14)); liveGlow.setMatrixAt(k, M);
        const lvl = (held ? Math.max(1.1, 2.6 - age * 4) : 0.3 + 0.8 * Math.exp(-(t - n.t1) / 1.1)) * (0.55 + 0.6 * n.vel);
        col.copy(hands[staff]).multiplyScalar(lvl); liveGlow.instanceColor.setXYZ(k, col.r, col.g, col.b);
        k++;
      }
      liveHeads.count = liveGlow.count = k;
      liveHeads.instanceMatrix.needsUpdate = liveGlow.instanceMatrix.needsUpdate = liveGlow.instanceColor.needsUpdate = true;
      for (const m of liveLines) { m.visible = true; m.position.x = xc + 20; }
      for (const p of paths) p.mesh.visible = p.head.visible = p.halo.visible = false;
      for (const l of lanterns) l.intensity = 0;
      sparks.visible = false;
      scene.traverse((o) => { if (o.isInstancedMesh && o !== liveHeads && o !== liveGlow) o.visible = false; });
      cardMesh.visible = false;
    } else {
      xc = camAt(t);
      liveHeads.count = liveGlow.count = 0;
      for (const m of liveLines) m.visible = false;
      scene.traverse((o) => { if (o.isInstancedMesh) o.visible = true; });
      cardMesh.visible = true;
      if (S) {
        // notes light up as they are played
        const counters = { solid: 0, open: 0, whole: 0 };
        for (const [kind, , c] of glowHeads) {
          const i = counters[kind]++, k = glowLevel(c, t);
          col.copy(hands[c.staff]).multiplyScalar(k);
          glows[kind].instanceColor.setXYZ(i, col.r, col.g, col.b);
        }
        for (const kind of ['solid', 'open', 'whole']) glows[kind].instanceColor.needsUpdate = true;
        // the paths of light
        S.landings.forEach((list, hand) => {
          const p = paths[hand], on = showPaths && list.length && t > list[0].t - 1.2;
          p.mesh.visible = p.head.visible = p.halo.visible = !!on;
          lanterns[hand].intensity = on ? 4 : 0;
          if (!on) return;
          const pos = p.mesh.geometry.attributes.position, color = p.mesh.geometry.attributes.color;
          for (let i = 0; i < N; i++) {
            const tau = t - (i / (N - 1)) * TRAIL, a = fly(list, tau), b = fly(list, tau + 0.01) || a;
            P.copy(W(a[0], a[1], a[2])); Pn.copy(W(b[0], b[1], b[2]));
            tang.subVectors(Pn, P); view.subVectors(camera.position, P);
            side.crossVectors(tang, view).normalize();
            const age = i / (N - 1), half = 0.02 + 0.11 * (1 - age) ** 0.7, fade = (1 - age) ** 1.4 * 2.2;
            pos.setXYZ(i * 2, P.x + side.x * half, P.y + side.y * half, P.z + side.z * half);
            pos.setXYZ(i * 2 + 1, P.x - side.x * half, P.y - side.y * half, P.z - side.z * half);
            col.copy(hands[hand]).lerp(WHITE, 0.25 * (1 - age) ** 3).multiplyScalar(fade);
            color.setXYZ(i * 2, col.r, col.g, col.b); color.setXYZ(i * 2 + 1, col.r, col.g, col.b);
          }
          pos.needsUpdate = color.needsUpdate = true;
          const h = fly(list, t);
          P.copy(W(h[0], h[1], h[2]));
          p.head.position.copy(P); p.head.scale.setScalar(0.7);
          p.halo.position.copy(P); p.halo.scale.setScalar(2.2);
          lanterns[hand].position.set(P.x, P.y + 1.6, P.z);
        });
        // sparks where a path lands
        const sp = sparks.geometry.attributes;
        let used = 0;
        if (effects) S.landings.forEach((list, hand) => {
          let lo = 0, hi = list.length - 1;
          while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t - 0.8) lo = m; else hi = m - 1; }
          for (let j = Math.max(0, lo - 2); j < list.length && list[j].t <= t; j++) {
            const L = list[j], age = t - L.t;
            if (age < 0 || age > 0.8) continue;
            const fade = (1 - age / 0.8) ** 1.5;
            for (let s = 0; s < 9 && used < 900; s++, used++) {
              const an = rnd(L.t * 10 + hand, s) * Math.PI * 2, v = 1.2 + 2.2 * rnd(s, L.t * 10 + hand);
              sp.position.setXYZ(used, L.x + Math.cos(an) * v * age, 0.3 + (1.5 + 2.5 * rnd(s + 9, L.t)) * age - 4 * age * age, -(L.y + Math.sin(an) * v * age * 0.7));
              col.copy(hands[hand]).multiplyScalar(fade * 1.6); sp.color.setXYZ(used, col.r, col.g, col.b);
            }
          }
        });
        sparks.geometry.setDrawRange(0, used); sp.position.needsUpdate = sp.color.needsUpdate = true; sparks.visible = used > 0;
      }
    }
    // the camera glides along beside the music, looking ahead along it
    const sx = Math.sin(t * 0.17) * sway, sy = Math.sin(t * 0.11 + 1) * sway;
    if (tall) { camera.position.set(xc - 21 + sx * 0.8, 31 + sy * 0.8, -7.5 + sx * 1.5); camera.lookAt(xc + 6, 0, -7.5); } // tall: from behind, the music runs up the picture into the distance
    else { camera.position.set(xc - 9 + sx * 1.2, 12 + sy * 0.7, 13 + sx * 0.5); camera.lookAt(xc + 6, 0, -7.5); }
    lamp.position.set(xc + 2, 6, -5);
    keyLight.position.set(xc - 20, 30, 25); keyLight.target.position.set(xc, 0, -7);
    floor.position.x = xc;
  }
  return { scene, render };
}
