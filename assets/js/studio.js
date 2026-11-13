// Piano studio: load or record a performance, watch it in 3D, and make a video. Everything runs in the browser.
import { $, fetchJSON, session, b64, importKey, readVault, openBytes } from './core.js';
import { parseMidi, fromRecording, writeMidi, demoPiece } from './midi.js';
import { createStage } from './stage.js';
import { makeOutput, voice, renderPiece } from './synth.js';

const LEAD = 1.5, TAIL = 2; // seconds of runway before the first note and after the last
const canvas = $('#stage'), stage = createStage(canvas);
const P = { piece: null, name: '', playing: false, pos: -LEAD, rate: 1, ctx: null, bus: null, t0: 0, p0: 0, next: 0, busy: false };
const V = { rec: null, chunks: [], dest: null }; // live screen recording
const R = { on: false, inputs: [], events: [], held: new Map(), start: 0 };
const ui = Object.fromEntries(['play', 'seek', 'clock', 'speed', 'midifile', 'demo', 'record', 'savemidi', 'labels', 'effects', 'motion', 'view', 'mic', 'capture', 'theme', 'vtitle', 'size', 'fps',
  'export', 'prog', 'download', 'overlay'].map((id) => [id, $('#' + id)]));
const say = (id, text) => { $('#' + id).textContent = text; };
const mmss = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const safeName = () => (P.name || 'piano').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'piano';

function fit() { if (P.busy) return; const w = Math.floor((canvas.clientWidth || 960) / 2) * 2; stage.resize(w, Math.round((w * 9) / 32) * 2); } // even sizes keep video encoders happy
new ResizeObserver(fit).observe(canvas.parentElement);

function load(piece, name) {
  pause();
  P.piece = piece; P.name = name; P.pos = -LEAD;
  stage.setPiece(piece);
  say('piece-title', name);
  const pedals = piece.pedal.filter((p) => p.down).length;
  say('piece-info', `${piece.notes.length} notes, ${mmss(piece.duration)} long${pedals ? `, ${pedals} pedal presses` : ''}.`);
  ui.seek.min = -LEAD; ui.seek.max = piece.duration + TAIL; ui.seek.value = P.pos;
  for (const k of ['play', 'seek', 'export', 'savemidi']) ui[k].disabled = false;
  ui.download.hidden = true;
  say('exp-msg', 'The sound in the video is a synthesized piano, not the room recording.');
}

// ---------- playback ----------
const now = () => (P.playing ? P.p0 + (P.ctx.currentTime - P.t0) * P.rate : P.pos);
async function play() {
  if (!P.piece || P.busy) return;
  P.ctx = P.ctx || new AudioContext();
  await P.ctx.resume();
  if (P.pos >= P.piece.duration + TAIL - 0.05) P.pos = -LEAD;
  P.bus = makeOutput(P.ctx);
  if (V.dest) P.bus.connect(V.dest);
  P.p0 = P.pos; P.t0 = P.ctx.currentTime + 0.06;
  P.next = P.piece.notes.findIndex((n) => n.onset >= P.pos);
  if (P.next < 0) P.next = P.piece.notes.length;
  P.playing = true; ui.play.textContent = 'Pause';
}
function pause() {
  if (P.playing) P.pos = now();
  P.playing = false; ui.play.textContent = 'Play';
  if (P.bus) { P.bus.gain.value = 0; P.bus.disconnect(); P.bus = null; }
}
function schedule() {
  const t = now(), notes = P.piece.notes;
  while (P.next < notes.length && notes[P.next].onset < t + 0.25) {
    const n = notes[P.next++];
    voice(P.ctx, P.bus, n.pitch, n.vel, Math.max(P.ctx.currentTime, P.t0 + (n.onset - P.p0) / P.rate), (n.end - n.onset) / P.rate);
  }
}
function frame() {
  requestAnimationFrame(frame);
  if (P.busy) return;
  if (M.on) { listen(); return; }
  if (R.on) { stage.setLive(R.held); stage.render(0); return; }
  if (P.playing) {
    schedule(); P.pos = now();
    if (P.pos >= P.piece.duration + TAIL) pause();
    ui.seek.value = P.pos;
  }
  stage.render(P.pos);
  if (P.piece) ui.clock.textContent = `${mmss(P.pos)} / ${mmss(P.piece.duration)}`;
}
ui.play.addEventListener('click', () => (P.playing ? pause() : play()));
ui.seek.addEventListener('input', () => { const was = P.playing; pause(); P.pos = Number(ui.seek.value); if (was) play(); });
ui.speed.addEventListener('change', () => { const was = P.playing; pause(); P.rate = Number(ui.speed.value); if (was) play(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/^(INPUT|SELECT|BUTTON|TEXTAREA|A)$/.test(e.target.tagName)) { e.preventDefault(); ui.play.click(); }
});

// ---------- look ----------
const showTitle = () => { ui.overlay.textContent = ui.vtitle.value; ui.overlay.classList.toggle('dark', stage.isLight()); };
ui.labels.addEventListener('change', () => stage.setLabels(ui.labels.checked));
ui.effects.addEventListener('change', () => stage.setEffects(ui.effects.checked));
ui.motion.addEventListener('change', () => stage.setMotion(ui.motion.checked));
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { ui.motion.checked = false; stage.setMotion(false); }
ui.theme.addEventListener('change', () => { stage.setTheme(ui.theme.value); showTitle(); });
ui.vtitle.addEventListener('input', showTitle);
ui.view.addEventListener('change', () => stage.setView(ui.view.value));
$('#full').addEventListener('click', () => { const box = canvas.parentElement; if (document.fullscreenElement) document.exitFullscreen(); else (box.requestFullscreen || box.webkitRequestFullscreen).call(box); });
document.addEventListener('fullscreenchange', () => setTimeout(fit, 60));

// ---------- sources ----------
ui.midifile.addEventListener('change', async () => {
  const f = ui.midifile.files[0];
  if (!f) return;
  try { load(parseMidi(await f.arrayBuffer()), f.name.replace(/\.midi?$/i, '')); }
  catch (err) { say('piece-info', err.message || 'That file could not be read.'); }
  ui.midifile.value = '';
});
ui.demo.addEventListener('click', () => load(demoPiece(), 'Demo pattern'));

function onMidi(e) {
  const [s, a, b] = e.data, hi = s & 0xf0, t = (e.timeStamp - R.start) / 1000;
  if (hi === 0x90 && b > 0) { R.events.push({ t, on: a, vel: b / 127 }); R.held.set(a, { vel: b / 127 }); }
  else if (hi === 0x80 || hi === 0x90) { R.events.push({ t, off: a }); R.held.delete(a); }
  else if (hi === 0xb0 && a === 64) R.events.push({ t, pedal: b >= 64 });
  say('rec-msg', `Recording… ${R.events.filter((x) => x.on != null).length} notes so far. Press Stop when she has finished.`);
}
ui.record.addEventListener('click', async () => {
  if (R.on) {
    for (const i of R.inputs) i.onmidimessage = null;
    R.on = false; R.held = new Map(); stage.setLive(R.held);
    ui.record.textContent = 'Record from the piano'; ui.record.classList.remove('rec');
    try {
      load(fromRecording(R.events), `Recording ${new Date().toLocaleDateString()}`);
      say('rec-msg', 'Recorded. Press Play to watch it, and "Save as MIDI file" to keep it.');
    } catch (err) { say('rec-msg', err.message); }
    return;
  }
  if (!navigator.requestMIDIAccess) return say('rec-msg', 'This browser cannot talk to the piano. Use Chrome or Edge on a computer.');
  try {
    const access = await navigator.requestMIDIAccess();
    R.inputs = [...access.inputs.values()];
  } catch { return say('rec-msg', 'Permission to use the piano was not given. Allow MIDI devices for this page and try again.'); }
  if (!R.inputs.length) return say('rec-msg', 'No piano found. Check the USB cable from the USB TO HOST port, switch the piano on, then press Record again.');
  pause();
  P.piece = null; stage.setPiece(null);
  for (const k of ['play', 'seek', 'export', 'savemidi']) ui[k].disabled = true;
  R.events = []; R.held = new Map(); R.start = performance.now(); R.on = true;
  for (const i of R.inputs) i.onmidimessage = onMidi;
  ui.record.textContent = 'Stop recording'; ui.record.classList.add('rec');
  say('piece-title', 'Recording');
  say('rec-msg', `Listening to ${R.inputs.map((i) => i.name).join(', ')}. Start playing; keys light up as she plays.`);
});

// ---------- live microphone: any sound (voice, a bird, an acoustic piano) drawn as one flying line ----------
const M = { on: false, stream: null, node: null, buf: new Float32Array(2048), pts: [], start: 0, x: 0, last: null };
function detectPitch(buf, rate) {
  let c0 = 0;
  for (let i = 0; i < buf.length; i++) c0 += buf[i] * buf[i];
  c0 /= buf.length;
  const rms = Math.sqrt(c0);
  if (rms < 0.012) return { rms, hz: 0 };
  const min = Math.floor(rate / 1600), max = Math.min(Math.floor(rate / 70), buf.length - 2), c = new Float32Array(max + 2);
  for (let lag = min - 1; lag <= max + 1; lag++) { let s = 0; for (let i = 0; i < buf.length - lag; i++) s += buf[i] * buf[i + lag]; c[lag] = s / (buf.length - lag); }
  const peak = (l) => c[l] > c[l - 1] && c[l] >= c[l + 1];
  let top = 0;
  for (let l = min; l <= max; l++) if (peak(l) && c[l] > top) top = c[l];
  if (top < 0.5 * c0) return { rms, hz: 0 }; // noise, not a clear tone
  for (let l = min; l <= max; l++) if (peak(l) && c[l] >= 0.9 * top) {
    const d = c[l - 1] - 2 * c[l] + c[l + 1], shift = d ? (0.5 * (c[l - 1] - c[l + 1])) / d : 0;
    return { rms, hz: rate / (l + shift) };
  }
  return { rms, hz: 0 };
}
function listen() {
  const t = (performance.now() - M.start) / 1000;
  M.node.getFloatTimeDomainData(M.buf);
  const { rms, hz } = detectPitch(M.buf, P.ctx.sampleRate);
  if (hz) {
    let pitch = 69 + 12 * Math.log2(hz / 440);
    if (M.last != null && Math.abs(pitch - M.last) < 2.5) pitch = M.last + (pitch - M.last) * 0.3; // steady small wobbles
    M.x = Math.max(-8, Math.min(8, M.x * 0.985 + (M.last == null ? 0 : pitch - M.last) * 0.45));
    M.pts.push({ t, off: t + 0.08, pitch, x: M.x, vel: Math.min(1, Math.max(0.2, rms * 9)) });
    M.last = pitch;
  } else M.last = null;
  while (M.pts.length && M.pts[0].t < t - 9) M.pts.shift();
  stage.render(t);
}
ui.mic.addEventListener('click', async () => {
  if (M.on) {
    M.on = false; M.stream.getTracks().forEach((tr) => tr.stop()); M.node.disconnect();
    stage.setMic(null); ui.mic.textContent = 'Listen with the microphone'; ui.mic.classList.remove('rec');
    for (const k of ['play', 'seek', 'export', 'savemidi']) ui[k].disabled = !P.piece;
    return say('rec-msg', 'Stopped listening.');
  }
  if (R.on || P.busy) return;
  try { M.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch { return say('rec-msg', 'The microphone was not allowed. Allow it for this page and try again.'); }
  pause();
  P.ctx = P.ctx || new AudioContext(); await P.ctx.resume();
  M.node = P.ctx.createAnalyser(); M.node.fftSize = 2048;
  M.src = P.ctx.createMediaStreamSource(M.stream); M.src.connect(M.node);
  if (V.dest) M.src.connect(V.dest);
  M.pts = []; M.x = 0; M.last = null; M.start = performance.now(); M.on = true;
  stage.setMic(M.pts); ui.view.value = 'flight'; stage.setView('flight');
  for (const k of ['play', 'seek', 'export', 'savemidi']) ui[k].disabled = true;
  ui.mic.textContent = 'Stop listening'; ui.mic.classList.add('rec');
  say('rec-msg', 'Listening. Sing, whistle or play one note at a time and watch the line fly. Nothing is recorded or sent anywhere.');
});

function download(bytes, type, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove();
}
ui.savemidi.addEventListener('click', () => P.piece && download(writeMidi(P.piece), 'audio/midi', safeName() + '.mid'));

// ---------- live screen recording: press Start, do anything (play, microphone, record from the piano), press Stop to save ----------
ui.capture.addEventListener('click', async () => {
  if (V.rec) return V.rec.stop();
  if (P.busy) return;
  if (!canvas.captureStream || !window.MediaRecorder) return say('cap-msg', 'This browser cannot record the screen. Use Chrome or Edge on a computer.');
  const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return say('cap-msg', 'This browser has no video format the studio can record.');
  P.ctx = P.ctx || new AudioContext(); await P.ctx.resume();
  V.dest = P.ctx.createMediaStreamDestination();
  if (P.bus) P.bus.connect(V.dest);
  if (M.on) M.src.connect(V.dest);
  const stream = new MediaStream([...canvas.captureStream(60).getVideoTracks(), ...V.dest.stream.getAudioTracks()]);
  V.chunks = []; V.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6, audioBitsPerSecond: 160000 });
  const began = performance.now(), ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  V.rec.ondataavailable = (e) => { if (e.data.size) V.chunks.push(e.data); };
  V.rec.onstop = () => {
    const blob = new Blob(V.chunks, { type: type.split(';')[0] });
    stream.getTracks().forEach((tr) => tr.stop());
    V.rec = null; V.dest = null; V.chunks = [];
    ui.capture.textContent = 'Start recording'; ui.capture.classList.remove('rec'); ui.export.disabled = !P.piece;
    if (!blob.size) return say('cap-msg', 'Nothing was recorded.');
    download(blob, blob.type, `${safeName()}-live.${ext}`);
    say('cap-msg', `Saved ${mmss((performance.now() - began) / 1000)} of video (${(blob.size / 1048576).toFixed(1)} MB, .${ext}) to your Downloads folder.`);
  };
  V.rec.start(500);
  ui.capture.textContent = 'Stop and save'; ui.capture.classList.add('rec'); ui.export.disabled = true;
  say('cap-msg', 'Recording the screen… press Play, or use the microphone, then press "Stop and save".');
});

// ---------- video export: every frame is drawn and encoded one by one, so the result is exact however slow the computer ----------
async function pick(list, test) { for (const c of list) { try { if ((await test(c)).supported) return c; } catch {} } return null; }

async function makeVideo() {
  if (!P.piece || P.busy) return;
  if (!('VideoEncoder' in window)) return say('exp-msg', 'This browser cannot make videos. Use Chrome or Edge on a computer.');
  pause();
  const [w, h] = ui.size.value.split('x').map(Number), fps = Number(ui.fps.value);
  const bitrate = w >= 1920 ? 9e6 : 5e6;
  const vc = await pick([{ mux: 'avc', codec: 'avc1.640028' }, { mux: 'avc', codec: 'avc1.4d0028' }, { mux: 'vp9', codec: 'vp09.00.40.08' }],
    (c) => VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate, framerate: fps }));
  if (!vc) return say('exp-msg', 'This browser has no video encoder the studio can use.');
  const ac = 'AudioEncoder' in window ? await pick([{ mux: 'aac', codec: 'mp4a.40.2' }, { mux: 'opus', codec: 'opus' }],
    (c) => AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })) : null;

  P.busy = true;
  for (const k of ['play', 'seek', 'export', 'record', 'demo']) ui[k].disabled = true;
  ui.prog.hidden = false; ui.prog.value = 0; ui.download.hidden = true;
  say('exp-msg', 'Making the video. Keep this tab open and in front.');
  try {
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.js');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: vc.mux, width: w, height: h, frameRate: fps },
      ...(ac ? { audio: { codec: ac.mux, sampleRate: 48000, numberOfChannels: 2 } } : {}) });
    let failed = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
    venc.configure({ codec: vc.codec, width: w, height: h, bitrate, framerate: fps });

    stage.resize(w, h, 1);
    const comp = document.createElement('canvas'); comp.width = w; comp.height = h;
    const g = comp.getContext('2d'), title = ui.vtitle.value.trim(), total = Math.ceil((LEAD + P.piece.duration + TAIL) * fps);
    for (let i = 0; i < total && !failed; i++) {
      stage.render(i / fps - LEAD);
      g.drawImage(canvas, 0, 0, w, h);
      if (title) {
        g.font = `600 ${Math.round(h * 0.045)}px Georgia, serif`; g.textBaseline = 'top';
        g.fillStyle = stage.isLight() ? '#2a1418' : '#fff6e0';
        g.fillText(title, w * 0.03, h * 0.045);
      }
      const vf = new VideoFrame(comp, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 10 === 0) { ui.prog.value = (i / total) * 0.9; await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush(); venc.close();
    if (failed) throw failed;

    if (ac) {
      const buf = await renderPiece(P.piece, LEAD, TAIL);
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e; } });
      aenc.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
      const L = buf.getChannelData(0), Rr = buf.getChannelData(1), step = 4800;
      for (let o = 0; o < buf.length; o += step) {
        const n = Math.min(step, buf.length - o), data = new Float32Array(n * 2);
        data.set(L.subarray(o, o + n), 0); data.set(Rr.subarray(o, o + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / 48000) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      if (failed) throw failed;
    }
    muxer.finalize();
    ui.prog.value = 1;
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    ui.download.href = URL.createObjectURL(blob); ui.download.download = safeName() + '.mp4'; ui.download.hidden = false;
    const notes = [vc.mux === 'vp9' && 'It uses VP9 video, which some players (QuickTime, iPhone Photos) may not open; Chrome on a Mac normally makes the more compatible H.264 kind.',
      !ac && 'This browser could not add sound.', ac && ac.mux === 'opus' && 'Its sound is Opus, which some players do not support.'].filter(Boolean);
    say('exp-msg', `Video ready: ${mmss(total / fps)}, ${w}×${h}, ${(blob.size / 1048576).toFixed(1)} MB. ${notes.join(' ')}`);
  } catch (err) {
    say('exp-msg', 'The video could not be made: ' + (err.message || err));
  }
  P.busy = false; ui.prog.hidden = true;
  for (const k of ['play', 'seek', 'export', 'record', 'demo']) ui[k].disabled = false;
  fit();
}
ui.export.addEventListener('click', makeVideo);

// ---------- opened from a journal entry: studio.html#m=<file id>&k=<family|parent>&n=<name> ----------
async function fromJournal() {
  const q = new URLSearchParams(location.hash.slice(1)), id = q.get('m');
  if (!id || !/^[a-f0-9]{16}$/.test(id)) return;
  const raw = session.load();
  if (!raw) return say('piece-info', 'Open the journal with your passphrase first, then come back to this recording.');
  try {
    let key;
    if (q.get('k') === 'parent' || !raw.parent) key = b64.from(q.get('k') === 'parent' ? raw.parent : raw.family);
    else key = b64.from((await readVault(b64.from(raw.parent), await fetchJSON('content/parent.vault'))).familyKey);
    const r = await fetch(`media/${id}.enc`, { cache: 'no-store' });
    const plain = await openBytes(await importKey(key), new Uint8Array(await r.arrayBuffer()));
    load(parseMidi(plain.buffer), q.get('n') || 'From the journal');
  } catch { say('piece-info', 'That recording could not be opened.'); }
}

fit();
requestAnimationFrame(frame);
fromJournal();
