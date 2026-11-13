// The parent editor. Works only on your own computer, through "Start Editor".
import { $, h, icon, fetchJSON, b64, newRawKey, newId, importKey, wrapSection, sealVault, unwrapVault, readVault, sealBytes, openBytes,
  session, fmtDate, sortEntries, mediaURL, dropMediaCache, fmtSize, ICON_NAMES, COLORS, KIND_LABEL, KIND_ICON, sha256hex, sealHash, hasDate } from './core.js?v=6';

const main = $('#main');
const A = { vaults: {}, raw: {}, keys: {}, data: null };
const MIN_PASS = 12, MAX_FILE = 95 * 1048576;

const toast = (text) => { const t = $('#toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); };
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', null, label), control, hint && h('small', null, hint));
const select = (options, value, attrs = {}) => {
  const s = h('select', attrs, options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value;
  return s;
};

boot();

async function boot() {
  const ping = await fetchJSON('__editor/ping');
  if (!ping || !ping.editor) {
    return main.replaceChildren(h('section', { class: 'lockbox' }, h('h1', null, 'The editor runs on your computer'),
      h('p', null, 'For safety, entries can only be changed from the family computer. Open the journal folder and double-click "Start Editor".'),
      h('a', { class: 'btn', href: './' }, 'Go to the journal')));
  }
  A.vaults.fam = await fetchJSON('content/family.vault');
  A.vaults.par = await fetchJSON('content/parent.vault');
  if (!A.vaults.fam || !A.vaults.par) return setup();
  const saved = session.load();
  if (saved && saved.parent) { try { await open(b64.from(saved.parent)); return start(); } catch { session.clear(); } }
  unlock();
}

async function open(parentRaw) {
  A.data = await readVault(parentRaw, A.vaults.par);
  A.raw = { parent: parentRaw, family: b64.from(A.data.familyKey) };
  A.keys = { parent: await importKey(A.raw.parent), family: await importKey(A.raw.family) };
}

// ---------- first-time setup ----------
function passFields(prefix, label) {
  const a = h('input', { type: 'password', autocomplete: 'new-password', minlength: MIN_PASS, required: true, id: prefix + '1' });
  const b = h('input', { type: 'password', autocomplete: 'new-password', minlength: MIN_PASS, required: true, id: prefix + '2' });
  return { a, b, nodes: [field(label, a, `At least ${MIN_PASS} characters. Four unrelated words work well.`), field('Type it again', b)] };
}
function checkPass(p, name) {
  if (p.a.value !== p.b.value) return `The two ${name} passphrases do not match.`;
  if (p.a.value.length < MIN_PASS) return `The ${name} passphrase needs at least ${MIN_PASS} characters.`;
  return null;
}

async function setup() {
  const starter = await fetchJSON('content/starter.json');
  const title = h('input', { type: 'text', value: starter.site.title, required: true });
  const par = passFields('pp', 'Parent passphrase (for you: opens everything and the editor)');
  const fam = passFields('fp', 'Family passphrase (for her and anyone you invite: view only)');
  const note = h('p', { class: 'msg', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create the journal');
  main.replaceChildren(h('form', { class: 'panel narrow', onsubmit: async (ev) => {
    ev.preventDefault();
    const err = checkPass(par, 'parent') || checkPass(fam, 'family') || (par.a.value === fam.a.value && 'The parent and family passphrases must be different.');
    if (err) { note.textContent = err; return; }
    btn.disabled = true; btn.textContent = 'Creating…';
    A.raw = { parent: newRawKey(), family: newRawKey() };
    A.keys = { parent: await importKey(A.raw.parent), family: await importKey(A.raw.family) };
    A.vaults = { par: await wrapSection(par.a.value, A.raw.parent), fam: await wrapSection(fam.a.value, A.raw.family) };
    const now = new Date().toISOString();
    A.data = { familyKey: b64.to(A.raw.family), site: { ...starter.site, title: title.value.trim() }, categories: starter.categories,
      entries: starter.entries.map((e, i) => normalize({ ...e, id: newId(), sortOrder: i, createdAt: now, updatedAt: now })) };
    await save();
    session.save({ parent: b64.to(A.raw.parent) });
    start();
    toast('Journal created. The sample entries are placeholders to replace.');
  } },
    h('h1', null, 'Create the journal'),
    h('p', null, 'Everything you add is locked with these passphrases before it is saved. There is no reset: if both are lost, the content cannot be recovered. Write them down and keep them somewhere safe.'),
    field('Journal title (shown only after unlocking)', title), ...par.nodes, ...fam.nodes, btn, note));
}

function unlock() {
  const input = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const note = h('p', { class: 'msg', role: 'alert' });
  main.replaceChildren(h('form', { class: 'lockbox', onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      const raw = await unwrapVault(input.value, A.vaults.par);
      await open(raw);
      session.save({ parent: b64.to(raw) });
      start();
    } catch { note.textContent = 'That is not the parent passphrase.'; input.select(); }
  } }, h('h1', null, 'Journal editor'), field('Parent passphrase', input), h('button', { class: 'btn', type: 'submit' }, 'Unlock'), note));
  input.focus();
}

// ---------- saving ----------
function normalize(e) {
  return { title: '', category: A.data?.categories[0]?.id || 'music', subActivity: '', dateStart: '', dateEnd: '', datePrecision: 'day', description: '',
    reflection: '', parentNote: '', media: [], tags: [], visibility: 'private', childOk: 'not_asked', featured: false, relatedProject: '',
    status: 'draft', sortOrder: 0, placeholder: false, ...e };
}
// Who may see an entry / a file. Anything the child declined, drafts, and files showing other people without consent stay parent-only.
const audience = (e) => (e.status === 'published' && e.visibility === 'family' && e.childOk !== 'no' ? 'family' : 'parent');
const mediaAudience = (e, m) => (audience(e) === 'family' && !m.privateOnly && !(m.showsOthers && !m.consentOk) ? 'family' : 'parent');

async function put(path, bytes) {
  const r = await fetch(path, { method: 'PUT', body: bytes });
  if (!r.ok) throw new Error('save failed: ' + path);
}
const del = (path) => fetch(path, { method: 'DELETE' });

async function rekey(m, want) {
  for (const suffix of m.thumb ? ['', '.t'] : ['']) {
    const path = `media/${m.id}${suffix}.enc`;
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) continue;
    const plain = await openBytes(A.keys[m.key], new Uint8Array(await r.arrayBuffer()));
    await put(path, await sealBytes(A.keys[want], plain));
  }
  dropMediaCache(m.id);
  m.key = want;
}

async function save() {
  for (const e of A.data.entries) for (const m of e.media) {
    const want = mediaAudience(e, m);
    if (m.key !== want) await rekey(m, want);
  }
  const famEntries = A.data.entries.filter((e) => audience(e) === 'family')
    .map((e) => ({ ...e, media: e.media.filter((m) => m.key === 'family') }));
  const fam = await sealVault({ kdf: A.vaults.fam.kdf, wrap: A.vaults.fam.wrap }, A.raw.family,
    { site: A.data.site, categories: A.data.categories, entries: famEntries });
  const par = await sealVault({ kdf: A.vaults.par.kdf, wrap: A.vaults.par.wrap }, A.raw.parent, A.data);
  await put('content/parent.vault', new TextEncoder().encode(JSON.stringify(par)));
  await put('content/family.vault', new TextEncoder().encode(JSON.stringify(fam)));
  A.vaults = { fam, par };
}

// ---------- time stamps and seals ----------
// recordedAt = when the real entry was first written down. It is set once by the editor and cannot be typed.
// The seal is a fingerprint of the entry's words, dates and files. Only the fingerprint is published (content/seals.json),
// so anyone can later confirm that an entry existed in this exact form at that time, without the journal being public.
async function stamp(e, before) {
  const now = new Date().toISOString();
  if (!e.recordedAt || (before && before.placeholder && !e.placeholder)) e.recordedAt = now;
  if (e.placeholder) return;
  e.mediaDigest = e.media.length ? await sha256hex(e.media.map((m) => m.sha256 || m.id).join('|')) : '';
  e.seal = e.seal || { salt: newId() + newId(), log: [] };
  const hash = await sealHash(e);
  if (e.seal.hash === hash) return;
  e.seal.hash = hash; e.seal.log.push({ at: now, hash });
  const list = (await fetchJSON('content/seals.json')) || [];
  list.push({ at: now, hash });
  await put('content/seals.json', new TextEncoder().encode(JSON.stringify(list, null, 1)));
}

// The date a photo was taken, read from the photo itself (before that hidden data is removed).
async function photoDate(file) {
  try {
    const b = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (b.byteLength < 12 || b.getUint16(0) !== 0xffd8) return '';
    for (let p = 2; p + 10 < b.byteLength;) {
      const marker = b.getUint16(p), len = b.getUint16(p + 2);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffe1 && b.getUint32(p + 4) === 0x45786966) {
        const t = p + 10, le = b.getUint16(t) === 0x4949, u16 = (o) => b.getUint16(o, le), u32 = (o) => b.getUint32(o, le);
        const find = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12; return 0; };
        const text = (at) => { let v = ''; const o = t + u32(at + 8); for (let i = 0; i < 10; i++) v += String.fromCharCode(b.getUint8(o + i)); return /^\d{4}:\d{2}:\d{2}$/.test(v) ? v.replace(/:/g, '-') : ''; };
        const ifd0 = t + u32(t + 4), sub = find(ifd0, 0x8769), inner = sub && t + u32(sub + 8);
        const at = (inner && (find(inner, 0x9003) || find(inner, 0x9004))) || find(ifd0, 0x0132);
        return at ? text(at) : '';
      }
      p += 2 + len;
    }
  } catch {}
  return '';
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const activities = () => [...new Set(['Piano', 'Cello', 'Chess', 'Tennis', 'Karate', ...A.data.entries.map((e) => e.subActivity).filter(Boolean)])];

// ---------- shell ----------
function start() {
  addEventListener('hashchange', route);
  route();
}
function route() {
  const [, page = '', arg = ''] = location.hash.split('/');
  const tabs = [['', 'Entries'], ['areas', 'Areas'], ['settings', 'Settings'], ['publish', 'Publish']];
  $('#nav').replaceChildren(...tabs.map(([p, t]) => h('a', { href: `#/${p}`, 'aria-current': p === page ? 'page' : null }, t)),
    h('a', { href: './' }, 'View journal'));
  ({ '': list, quick, new: () => edit(null), edit: () => edit(arg), areas, settings, publish }[page] || list)();
  scrollTo(0, 0);
}
const catName = (id) => (A.data.categories.find((c) => c.id === id) || { name: 'Other' }).name;

function list() {
  const rows = sortEntries(A.data.entries);
  main.replaceChildren(h('div', { class: 'panel' },
    h('div', { class: 'row between' }, h('h1', null, 'Entries'), h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/quick' }, icon('plus', 16), ' Quick entry'), h('a', { class: 'btn ghost', href: '#/new' }, 'Full entry'))),
    h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Title', 'Date', 'Area', 'Who can see it', 'Files'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map((e) => h('tr', { class: e.status === 'archived' ? 'archived' : null },
        h('td', null, h('a', { href: `#/edit/${e.id}` }, e.title || '(untitled)'), e.placeholder && h('span', { class: 'badge sample' }, 'Sample')),
        h('td', null, fmtDate(e)), h('td', null, catName(e.category)),
        h('td', null, e.status === 'archived' ? 'Archived' : e.status === 'draft' ? 'Draft: parents only' : audience(e) === 'family' ? 'Family' : 'Parents only'),
        h('td', null, String(e.media.length)))))))));
}

// ---------- entry editor ----------
async function toJpeg(source, max, quality) {
  const w = source.videoWidth || source.width, ht = source.videoHeight || source.height;
  const s = Math.min(1, max / Math.max(w, ht));
  const c = h('canvas', { width: Math.round(w * s), height: Math.round(ht * s) });
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}
function videoFrame(file) {
  return new Promise((res) => {
    const v = h('video', { muted: true, playsinline: true, preload: 'auto' });
    const done = (val) => { URL.revokeObjectURL(v.src); res(val); };
    const timer = setTimeout(() => done(null), 8000);
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); });
    v.addEventListener('seeked', async () => { clearTimeout(timer); try { done(await toJpeg(v, 480, 0.8)); } catch { done(null); } });
    v.addEventListener('error', () => { clearTimeout(timer); done(null); });
    v.src = URL.createObjectURL(file);
  });
}
const kindOf = (f) => f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') && !/mid/.test(f.type) ? 'audio'
  : f.type === 'application/pdf' ? 'pdf' : /\.midi?$/i.test(f.name) ? 'midi' : 'file';

// New files are always saved parent-only first; saving the entry moves them to the family key if allowed.
async function addFile(file) {
  if (file.size > MAX_FILE) throw new Error(`"${file.name}" is ${fmtSize(file.size)}. Files must be under 95 MB; shorten or compress the video first.`);
  const m = { id: newId(), kind: kindOf(file), name: file.name, mime: file.type || 'application/octet-stream', size: file.size, caption: '', alt: '',
    privateOnly: false, showsOthers: false, consentOk: false, thumb: false, key: 'parent' };
  if (m.kind === 'image') m.taken = await photoDate(file);
  let bytes, thumb = null;
  if (m.kind === 'image') {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { throw new Error(`"${file.name}" could not be read. If it is an iPhone HEIC photo, export it as JPEG first.`); }
    bytes = await toJpeg(bmp, 1800, 0.86); // re-encoding also removes location data stored in the photo
    thumb = await toJpeg(bmp, 480, 0.8);
    m.mime = 'image/jpeg'; m.size = bytes.length;
  } else {
    bytes = new Uint8Array(await file.arrayBuffer());
    if (m.kind === 'video') thumb = await videoFrame(file);
  }
  m.sha256 = await sha256hex(bytes);
  await put(`media/${m.id}.enc`, await sealBytes(A.keys.parent, bytes));
  if (thumb) { await put(`media/${m.id}.t.enc`, await sealBytes(A.keys.parent, thumb)); m.thumb = true; }
  return m;
}

function edit(id) {
  const isNew = !id;
  const orig = isNew ? null : A.data.entries.find((e) => e.id === id);
  if (!isNew && !orig) return list();
  const e = structuredClone(orig || normalize({ id: newId(), datePrecision: 'day' }));
  const removed = [], added = [];
  const bind = (key, el, ev = 'input') => { el.addEventListener(ev, () => { e[key] = el.type === 'checkbox' ? el.checked : el.value; refresh(); }); return el; };
  const text = (key, attrs = {}) => bind(key, h('input', { type: 'text', value: e[key] || '', ...attrs }));
  const area = (key, rows = 3) => { const t = bind(key, h('textarea', { rows })); t.value = e[key] || ''; return t; };

  const mediaList = h('div', { class: 'media-edit' });
  const who = h('p', { class: 'who', role: 'status' });
  const refresh = () => {
    const fam = audience(e) === 'family';
    who.replaceChildren(icon(fam ? 'community' : 'lock', 18), fam ? ' After saving: visible to anyone with the family passphrase.'
      : e.childOk === 'no' ? ' Kept to parents only because she said no to sharing it.'
      : e.status !== 'published' ? ' Parents only until the status is Published.' : ' Parents only.');
  };
  const drawMedia = () => mediaList.replaceChildren(...e.media.map((m, i) => {
    const prev = h('div', { class: 'thumb c-pending' }, icon(KIND_ICON[m.kind], 26));
    if (m.thumb) mediaURL(m, A.keys, true).then((u) => prev.replaceChildren(h('img', { src: u, alt: '' }))).catch(() => {});
    const mb = (key, label) => { const c = h('input', { type: 'checkbox', checked: !!m[key] }); c.addEventListener('change', () => { m[key] = c.checked; drawMedia(); }); return h('label', { class: 'check' }, c, label); };
    const mt = (key, ph) => { const t = h('input', { type: 'text', value: m[key] || '', placeholder: ph, 'aria-label': ph }); t.addEventListener('input', () => { m[key] = t.value; }); return t; };
    return h('div', { class: 'media-row' }, prev, h('div', { class: 'grow' },
      h('strong', null, `${KIND_LABEL[m.kind]}: ${m.name}`), h('small', null, ` ${fmtSize(m.size)}`),
      mt('caption', 'Caption'), m.kind === 'image' && mt('alt', 'Describe the photo for someone who cannot see it'),
      mb('privateOnly', 'Keep this file to parents only'), mb('showsOthers', 'Shows other children or people'),
      m.showsOthers && mb('consentOk', 'Their families have agreed to it being shared'),
      m.showsOthers && !m.consentOk && h('small', { class: 'msg' }, 'Stays parents-only until consent is ticked.')),
      h('button', { type: 'button', class: 'plain', 'aria-label': `Remove ${m.name}`, onclick: () => { removed.push(...e.media.splice(i, 1)); drawMedia(); } }, icon('x', 20)));
  }));

  const drop = h('input', { type: 'file', multiple: true, id: 'files', accept: 'image/*,video/*,audio/*,application/pdf,.mid,.midi' });
  const upNote = h('p', { class: 'msg', role: 'alert' });
  drop.addEventListener('change', async () => {
    upNote.textContent = '';
    for (const f of drop.files) {
      upNote.textContent = `Locking and saving ${f.name}…`;
      try {
        const m = await addFile(f); e.media.push(m); added.push(m); upNote.textContent = '';
        if (m.taken && !e.dateStart) { e.dateStart = m.taken; e.datePrecision = 'day'; dateInput.value = m.taken; upNote.textContent = 'Date filled in from the photo. Change it if it is wrong.'; }
      }
      catch (err) { upNote.textContent = err.message; break; }
      drawMedia();
    }
    drop.value = '';
  });

  const dateInput = bind('dateStart', h('input', { type: 'date', value: e.dateStart || '' }));
  const tags = h('input', { type: 'text', value: (e.tags || []).join(', ') });
  const others = A.data.entries.filter((x) => x.id !== e.id).map((x) => [x.id, x.title]);
  const dropFiles = async (keep) => { for (const m of keep) { await del(`media/${m.id}.enc`); if (m.thumb) await del(`media/${m.id}.t.enc`); } };

  const form = h('form', { class: 'panel', onsubmit: async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; btn.disabled = true;
    e.tags = tags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    if (e.datePrecision === 'unknown') { e.dateStart = ''; e.dateEnd = ''; }
    e.sortOrder = Number(e.sortOrder) || 0;
    e.updatedAt = new Date().toISOString();
    try {
      await stamp(e, orig);
      if (isNew) { e.createdAt = e.updatedAt; A.data.entries.push(e); } else Object.assign(orig, e);
      await save(); await dropFiles(removed); toast('Saved, locked and sealed.'); location.hash = '#/';
    } catch (err) { btn.disabled = false; toast('Could not save. Is the editor window still running?'); }
  } },
    h('a', { class: 'backlink', href: '#/', onclick: () => dropFiles(added) }, icon('back', 16), ' All entries (discard changes)'),
    h('h1', null, isNew ? 'New entry' : 'Edit entry'),
    field('Title', text('title', { required: true })),
    h('div', { class: 'grid2' },
      field('Area', bind('category', select(A.data.categories.map((c) => [c.id, c.name]), e.category), 'change')),
      field('Activity within the area (optional)', text('subActivity', { list: 'acts' }), 'For example Piano, Cello, Tennis'), h('datalist', { id: 'acts' }, activities().map((a) => h('option', { value: a })))),
    h('div', { class: 'grid3' },
      field('How exact is the date?', bind('datePrecision', select([['day', 'Exact day'], ['month', 'Month and year'], ['season', 'Season and year'], ['year', 'Year only'], ['unknown', 'Not known yet']], e.datePrecision), 'change')),
      field('Date', dateInput, 'For a month, season or year, pick any day inside it'),
      field('End date (optional)', bind('dateEnd', h('input', { type: 'date', value: e.dateEnd || '' })))),
    field('What happened', area('description', 4), 'Effort and process count as much as awards.'),
    field('In her own words (optional)', area('reflection', 4), 'What I learned or how I felt. Only if she wants to add it.'),
    field('Parent note (optional, shown with the entry)', area('parentNote', 2)),
    h('fieldset', null, h('legend', null, 'Photos, videos, recordings, certificates, MIDI'),
      mediaList, h('label', { class: 'btn ghost', for: 'files' }, icon('plus', 16), ' Add files'), drop, upNote,
      h('small', null, 'Photos are resized and their hidden location data is removed. Each file must be under 95 MB.')),
    h('fieldset', null, h('legend', null, 'Sharing'),
      h('div', { class: 'grid3' },
        field('Status', bind('status', select([['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived']], e.status), 'change')),
        field('Who can see it', bind('visibility', select([['private', 'Parents only'], ['family', 'Family (passphrase)']], e.visibility), 'change'),
          'Public sharing is switched off for this journal.'),
        field('Is she happy to share this?', bind('childOk', select([['not_asked', 'Not asked yet'], ['yes', 'Yes'], ['no', 'No']], e.childOk), 'change'))),
      who),
    h('fieldset', null, h('legend', null, 'More'),
      h('div', { class: 'grid2' }, field('Tags, separated by commas', tags),
        field('Related entry (optional)', bind('relatedProject', select([['', 'None'], ...others], e.relatedProject || ''), 'change'))),
      h('div', { class: 'grid2' },
        field('Order among entries with the same date', bind('sortOrder', h('input', { type: 'number', value: e.sortOrder || 0 })), 'Lower numbers come first'),
        h('div', null,
          h('label', { class: 'check' }, bind('featured', h('input', { type: 'checkbox', checked: !!e.featured }), 'change'), 'Feature on the home page'),
          h('label', { class: 'check' }, bind('placeholder', h('input', { type: 'checkbox', checked: !!e.placeholder }), 'change'), 'This is still a sample or has details to confirm')))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save entry'),
      !isNew && h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!form.dataset.sure) { form.dataset.sure = '1'; toast('Press Delete again to remove this entry and its files for good.'); return; }
        A.data.entries = A.data.entries.filter((x) => x.id !== orig.id);
        await save(); await dropFiles([...orig.media, ...added]);
        toast('Entry deleted.'); location.hash = '#/';
      } }, 'Delete')));
  main.replaceChildren(form);
  drawMedia(); refresh();
}

// ---------- quick entry: one photo, one or two sentences, done in a minute ----------
function quick() {
  let photo = null;
  const title = h('input', { type: 'text', required: true, maxlength: 90, placeholder: 'For example: Played at the winter recital' });
  const more = h('textarea', { rows: 3, placeholder: 'One or two sentences. What was hard? What is she proud of?' });
  const cat = select(A.data.categories.map((c) => [c.id, c.name]), A.data.categories[0].id);
  const act = h('input', { type: 'text', list: 'acts', placeholder: 'Piano, Cello, Chess…' });
  const date = h('input', { type: 'date', value: today(), required: true });
  const file = h('input', { type: 'file', id: 'files', accept: 'image/*,video/*,audio/*,application/pdf,.mid,.midi' });
  const share = h('input', { type: 'checkbox' });
  const note = h('p', { class: 'msg', role: 'alert' }), preview = h('div', { class: 'media-edit' });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    note.textContent = 'Locking the file…';
    try {
      if (photo) { await del(`media/${photo.id}.enc`); if (photo.thumb) await del(`media/${photo.id}.t.enc`); }
      photo = await addFile(file.files[0]);
      if (photo.taken) date.value = photo.taken;
      note.textContent = photo.taken ? 'Date filled in from the photo. Change it if it is wrong.' : '';
      const box = h('div', { class: 'thumb c-pending' }, icon(KIND_ICON[photo.kind], 26));
      if (photo.thumb) mediaURL(photo, A.keys, true).then((u) => box.replaceChildren(h('img', { src: u, alt: '' }))).catch(() => {});
      preview.replaceChildren(h('div', { class: 'media-row' }, box, h('div', { class: 'grow' }, h('strong', null, photo.name))));
    } catch (err) { note.textContent = err.message; }
    file.value = '';
  });
  main.replaceChildren(h('form', { class: 'panel narrow', onsubmit: async (ev) => {
    ev.preventDefault();
    ev.submitter.disabled = true;
    const now = new Date().toISOString();
    const e = normalize({ id: newId(), title: title.value.trim(), description: more.value.trim(), category: cat.value, subActivity: act.value.trim(),
      dateStart: date.value, datePrecision: 'day', media: photo ? [photo] : [], status: 'published',
      visibility: share.checked ? 'family' : 'private', childOk: share.checked ? 'yes' : 'not_asked', createdAt: now, updatedAt: now });
    try { await stamp(e, null); A.data.entries.push(e); await save(); toast('Saved, locked and sealed.'); location.hash = '#/'; }
    catch { ev.submitter.disabled = false; toast('Could not save. Is the editor window still running?'); }
  } },
    h('a', { class: 'backlink', href: '#/' }, icon('back', 16), ' All entries'),
    h('h1', null, 'Quick entry'),
    field('What happened?', title),
    field('A little more (optional)', more),
    h('div', { class: 'grid2' }, field('Area', cat), field('Activity (optional)', act)),
    h('datalist', { id: 'acts' }, activities().map((a) => h('option', { value: a }))),
    preview, h('label', { class: 'btn ghost', for: 'files' }, icon('plus', 16), ' Add a photo or file'), file,
    field('When did it happen?', date, 'Today unless you change it. A photo fills this in by itself.'),
    h('label', { class: 'check' }, share, 'She is happy to share this with family'),
    h('small', null, 'Left unticked, the entry is kept to parents only. The time you save it is recorded automatically and cannot be changed.'),
    h('button', { class: 'btn', type: 'submit' }, 'Save'), note));
  title.focus();
}

// ---------- areas ----------
function areas() {
  const rows = h('div', null);
  const draw = () => rows.replaceChildren(...A.data.categories.map((c, i) => {
    const t = (key, label) => { const el = h('input', { type: 'text', value: c[key] || '' }); el.addEventListener('input', () => { c[key] = el.value; }); return field(label, el); };
    const s = (key, label, opts) => { const el = select(opts.map((o) => [o, o]), c[key]); el.addEventListener('change', () => { c[key] = el.value; }); return field(label, el); };
    const used = A.data.entries.some((e) => e.category === c.id);
    return h('div', { class: 'area-row' }, h('div', { class: 'grid2' }, t('name', 'Name'), t('intro', 'Short introduction')),
      h('div', { class: 'grid3' }, s('icon', 'Icon', ICON_NAMES), s('color', 'Colour', COLORS),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn ghost', disabled: i === 0, onclick: () => { A.data.categories.splice(i - 1, 0, ...A.data.categories.splice(i, 1)); draw(); } }, 'Move up'),
          h('button', { type: 'button', class: 'btn ghost', disabled: used, title: used ? 'Move its entries to another area first' : null,
            onclick: () => { A.data.categories.splice(i, 1); draw(); } }, 'Remove'))));
  }));
  main.replaceChildren(h('form', { class: 'panel', onsubmit: async (ev) => { ev.preventDefault(); await save(); toast('Areas saved.'); route(); } },
    h('h1', null, 'Areas'), h('p', null, 'An area appears in the journal once it has at least one visible entry. Add new interests whenever they appear.'),
    rows, h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { A.data.categories.push({ id: 'a' + newId(), name: 'New area', icon: 'star', color: 'slate', intro: '' }); draw(); } }, icon('plus', 16), ' Add an area'),
      h('button', { class: 'btn', type: 'submit' }, 'Save areas'))));
  draw();
}

// ---------- settings ----------
function settings() {
  const site = A.data.site;
  const t = (key, rows) => { const el = rows ? h('textarea', { rows }) : h('input', { type: 'text' }); el.value = site[key] || ''; el.addEventListener('input', () => { site[key] = el.value; }); return el; };
  const changer = (which, label) => {
    const p = passFields(which, `New ${label} passphrase`), note = h('p', { class: 'msg', role: 'alert' });
    return h('form', { class: 'panel', onsubmit: async (ev) => {
      ev.preventDefault();
      const err = checkPass(p, label);
      if (err) { note.textContent = err; return; }
      const sec = await wrapSection(p.a.value, A.raw[which]);
      Object.assign(A.vaults[which === 'parent' ? 'par' : 'fam'], sec);
      await save(); p.a.value = p.b.value = ''; note.textContent = ''; toast(`The ${label} passphrase was changed.`);
    } }, h('h2', null, `Change the ${label} passphrase`), ...p.nodes, h('button', { class: 'btn ghost', type: 'submit' }, 'Change passphrase'), note);
  };
  main.replaceChildren(
    h('form', { class: 'panel', onsubmit: async (ev) => { ev.preventDefault(); await save(); toast('Settings saved.'); } },
      h('h1', null, 'Settings'), field('Journal title', t('title')), field('Introduction on the home page', t('intro', 3)),
      field('"Right now" line (optional)', t('now', 2)), h('button', { class: 'btn', type: 'submit' }, 'Save settings')),
    changer('family', 'family'), changer('parent', 'parent'),
    h('div', { class: 'panel' }, h('p', null, 'Changing a passphrase protects the journal from now on. Copies already uploaded to GitHub stay readable with the old passphrase, so change it promptly if it leaks.'),
      h('button', { class: 'btn ghost', onclick: () => { session.clear(); location.reload(); } }, icon('lock', 16), ' Lock the editor')));
}

// ---------- publish ----------
function publish() {
  const fam = A.data.entries.filter((e) => audience(e) === 'family');
  const samples = fam.filter((e) => e.placeholder).length;
  const notAsked = fam.filter((e) => e.childOk === 'not_asked' && !e.placeholder).length;
  const files = A.data.entries.reduce((n, e) => n + e.media.reduce((s, m) => s + m.size, 0), 0);
  const li = (ok, text) => h('li', { class: ok ? 'ok' : 'warn' }, ok ? 'OK: ' : 'Check: ', text);
  main.replaceChildren(h('div', { class: 'panel' }, h('h1', null, 'Before you publish'),
    h('ul', { class: 'checks' },
      li(true, `${fam.length} entries will be visible with the family passphrase; ${A.data.entries.length - fam.length} stay parents-only.`),
      li(samples === 0, samples ? `${samples} visible entries are still samples.` : 'No sample entries are visible.'),
      li(notAsked === 0, notAsked ? `${notAsked} visible entries have not been checked with her yet.` : 'She has been asked about every visible entry.'),
      li(files < 800 * 1048576, `Files total ${fmtSize(files)}. GitHub Pages allows about 1 GB per site.`)),
    h('h2', null, 'Privacy reminders'),
    h('ul', null, ['No home address, school name, schedules or regular locations in any text or photo.',
      'Other children appear only with their family\'s agreement.', 'Share the family passphrase in person or by phone, never in a public post.'].map((t) => h('li', null, t))),
    h('h2', null, 'Publish'),
    h('p', null, 'Everything is already saved in this folder in locked form. To update the website, upload the folder to GitHub with GitHub Desktop or the commands in README.md.')));
}
