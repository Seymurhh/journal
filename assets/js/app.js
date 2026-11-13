// The journal viewer. Loads the encrypted vaults, asks for the passphrase, and draws the pages.
import { $, h, icon, fetchJSON, unwrapVault, readVault, importKey, b64, session, fmtDate, sortEntries, yearOf, hasDate,
  mediaURL, fmtSize, KIND_LABEL, KIND_ICON } from './core.js';

const main = $('#main');
const S = { mode: null, data: null, keys: {}, local: false };
const lily = () => $('#lily').content.firstElementChild.cloneNode(true);

boot();

async function boot() {
  const [fam, par, ping] = await Promise.all([fetchJSON('content/family.vault'), fetchJSON('content/parent.vault'), fetchJSON('__editor/ping')]);
  S.local = !!(ping && ping.editor);
  if (!fam || !par) return notSetUp();
  S.vaults = { fam, par };
  const saved = session.load();
  if (saved) {
    try { await openWith(saved); return start(); } catch { session.clear(); }
  }
  lockScreen();
}

function notSetUp() {
  main.replaceChildren(h('section', { class: 'lockbox' }, lily(), h('h1', null, 'This journal is not set up yet'),
    h('p', null, S.local ? 'Open the editor to create it.' : 'Start the editor on your computer to create it.'),
    S.local && h('a', { class: 'btn', href: 'admin.html' }, 'Open the editor')));
}

async function openWith(raw) {
  // raw = { parent?: base64 key, family: base64 key }
  if (raw.parent) {
    const pk = b64.from(raw.parent);
    S.data = await readVault(pk, S.vaults.par);
    S.keys = { parent: await importKey(pk), family: await importKey(b64.from(S.data.familyKey)) };
    S.mode = 'parent';
  } else {
    const fk = b64.from(raw.family);
    S.data = await readVault(fk, S.vaults.fam);
    S.keys = { family: await importKey(fk) };
    S.mode = 'family';
  }
}

function lockScreen(msg) {
  const input = h('input', { type: 'password', id: 'pass', autocomplete: 'current-password', required: true, 'aria-describedby': 'lock-msg' });
  const note = h('p', { id: 'lock-msg', class: 'msg', role: 'alert' }, msg || '');
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Open the journal');
  const form = h('form', { class: 'lockform', onsubmit: async (ev) => {
    ev.preventDefault();
    btn.disabled = true; btn.textContent = 'Opening…'; note.textContent = '';
    const pass = input.value;
    let raw = null;
    try { raw = { parent: b64.to(await unwrapVault(pass, S.vaults.par)) }; } catch {}
    if (!raw) { try { raw = { family: b64.to(await unwrapVault(pass, S.vaults.fam)) }; } catch {} }
    if (!raw) {
      btn.disabled = false; btn.textContent = 'Open the journal';
      note.textContent = 'That passphrase did not open the journal. Check it and try again.';
      input.select();
      return;
    }
    await openWith(raw);
    session.save(raw);
    start();
  } }, h('label', { for: 'pass' }, 'Family passphrase'), input, btn, note);
  $('#top').hidden = true; $('#foot').hidden = true;
  document.title = 'A private family journal';
  main.replaceChildren(h('section', { class: 'lockbox' }, lily(), h('h1', null, 'A private family journal'),
    h('p', null, 'This journal belongs to a family. Enter the passphrase they gave you to open it.'), form));
  input.focus();
}

function start() {
  $('#top').hidden = false; $('#foot').hidden = false;
  $('#brand-title').textContent = S.data.site.title;
  $('#foot').replaceChildren(...[
    h('span', null, S.mode === 'parent' ? 'Parent view: you can see private entries and drafts.' : 'Private family journal. Please do not share the passphrase.'),
    S.mode === 'parent' && S.local && h('a', { href: 'admin.html' }, 'Open the editor'),
    h('button', { class: 'linkbtn', onclick: () => { session.clear(); location.hash = ''; location.reload(); } }, icon('lock', 16), ' Lock')].filter(Boolean));
  addEventListener('hashchange', route);
  route();
}

// ---------- data helpers ----------
const cat = (id) => S.data.categories.find((c) => c.id === id) || { id, name: 'Other', icon: 'star', color: 'slate' };
const visible = () => sortEntries(S.data.entries.filter((e) => S.mode === 'parent' ? e.status !== 'archived' : true));
const areas = () => S.data.categories.filter((c) => visible().some((e) => e.category === c.id));

function chip(c, opts = {}) {
  return h(opts.href ? 'a' : 'span', { class: `chip c-${c.color}`, href: opts.href, 'aria-current': opts.current ? 'true' : null }, icon(c.icon, 16), c.name);
}
function badges(e) {
  return [
    e.placeholder && h('span', { class: 'badge sample' }, 'Sample: replace with a real moment'),
    S.mode === 'parent' && e.status === 'draft' && h('span', { class: 'badge' }, 'Draft'),
    S.mode === 'parent' && (e.visibility === 'private' || e.status === 'draft') && h('span', { class: 'badge' }, icon('lock', 13), ' Parents only'),
  ];
}
function lazyThumb(m, cls = 'thumb') {
  const box = h('div', { class: cls + ' c-pending' }, icon(KIND_ICON[m.kind] || 'file', 28));
  if (!m.thumb) return box;
  const io = new IntersectionObserver(async ([en]) => {
    if (!en.isIntersecting) return;
    io.disconnect();
    try { box.replaceChildren(h('img', { src: await mediaURL(m, S.keys, true), alt: m.alt || m.caption || '' }));
      if (m.kind === 'video') box.append(h('span', { class: 'playmark' }, icon('play', 18))); } catch {}
  }, { rootMargin: '200px' });
  io.observe(box);
  return box;
}
function card(e) {
  const c = cat(e.category), cover = (e.media || []).find((m) => m.thumb);
  return h('a', { class: `card c-${c.color}`, href: `#/entry/${e.id}` },
    cover && lazyThumb(cover),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-meta' }, chip(c), e.subActivity && h('span', { class: 'sub' }, e.subActivity)),
      h('h3', null, e.title), h('p', { class: 'date' }, fmtDate(e)),
      e.description && h('p', { class: 'desc' }, e.description),
      h('div', { class: 'badges' }, badges(e))));
}
const empty = (text) => h('p', { class: 'empty' }, text);

// ---------- routing ----------
function route() {
  const [, page = '', arg = ''] = location.hash.split('/');
  const nav = [['', 'Home'], ['journey', 'My Journey'], ...areas().map((c) => [`area/${c.id}`, c.name]), ['gallery', 'Gallery']];
  const here = page === 'area' ? `area/${arg}` : page === 'entry' ? 'journey' : page;
  $('#nav').replaceChildren(...nav.map(([p, label]) => h('a', { href: `#/${p}`, 'aria-current': p === here ? 'page' : null }, label)),
    h('a', { href: 'studio.html' }, 'Piano studio'));
  const view = { '': home, journey, area, entry, gallery }[page] || home;
  main.replaceChildren(view(decodeURIComponent(arg)));
  document.title = S.data.site.title;
  scrollTo(0, 0);
}

function home() {
  const list = visible(), site = S.data.site;
  const featured = list.filter((e) => e.featured).slice(0, 3);
  const latest = list.find(hasDate);
  return h('div', null,
    h('section', { class: 'hero' }, lily(),
      h('h1', null, site.title), h('p', { class: 'lead' }, site.intro),
      site.now && h('p', { class: 'now' }, h('strong', null, 'Right now: '), site.now),
      h('a', { class: 'btn', href: '#/journey' }, 'See the journey')),
    h('section', null, h('h2', null, 'What I explore'),
      h('div', { class: 'tiles' }, areas().map((c) => {
        const n = list.filter((e) => e.category === c.id).length;
        return h('a', { class: `tile c-${c.color}`, href: `#/area/${c.id}` }, h('span', { class: 'tile-icon' }, icon(c.icon, 26)),
          h('strong', null, c.name), h('span', null, `${n} ${n === 1 ? 'moment' : 'moments'}`));
      }))),
    featured.length > 0 && h('section', null, h('h2', null, 'Featured moments'), h('div', { class: 'cards' }, featured.map(card))),
    latest && h('section', null, h('h2', null, 'Latest on the timeline'), h('div', { class: 'cards one' }, card(latest))));
}

function timeline(list) {
  if (!list.length) return empty('Nothing here yet.');
  const groups = new Map();
  for (const e of list) { const y = yearOf(e); groups.set(y, [...(groups.get(y) || []), e]); }
  return h('ol', { class: 'timeline' }, [...groups].map(([year, items]) =>
    h('li', { class: 'year' }, h('h2', { class: 'year-mark' }, year), h('ol', { class: 'moments' }, items.map((e) => h('li', null, card(e)))))));
}

function journey(filter) {
  const list = visible(), f = filter || 'all';
  const shown = f === 'all' ? list : list.filter((e) => e.category === f);
  const all = { name: 'Everything', icon: 'star', color: 'slate' };
  return h('div', null, h('h1', null, 'My Journey'),
    h('p', { class: 'lead' }, 'Every moment in one line of time, newest first.'),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by area' },
      chip(all, { href: '#/journey', current: f === 'all' }),
      areas().map((c) => chip(c, { href: `#/journey/${c.id}`, current: f === c.id }))),
    timeline(shown));
}

function area(id) {
  const c = cat(id), list = visible().filter((e) => e.category === id);
  const subs = [...new Set(list.map((e) => e.subActivity).filter(Boolean))];
  return h('div', null,
    h('div', { class: `area-head c-${c.color}` }, h('span', { class: 'tile-icon' }, icon(c.icon, 30)), h('h1', null, c.name)),
    c.intro && h('p', { class: 'lead' }, c.intro),
    subs.length > 1 && h('p', { class: 'sub' }, 'Includes: ' + subs.join(', ')),
    timeline(list));
}

function mediaBlock(m) {
  const fig = h('figure', { class: `media kind-${m.kind}` });
  const cap = (m.caption || m.kind !== 'image') && h('figcaption', null, m.caption || m.name);
  const load = async (make) => {
    fig.classList.add('busy');
    try { make(await mediaURL(m, S.keys)); } catch { fig.append(h('p', { class: 'msg' }, 'This file could not be opened.')); }
    fig.classList.remove('busy');
  };
  if (m.kind === 'image') {
    const t = lazyThumb(m, 'thumb big');
    fig.append(h('button', { class: 'plain', 'aria-label': 'View larger: ' + (m.alt || m.caption || 'photo'), onclick: () => lightbox(m) }, t), ...[cap].filter(Boolean));
  } else {
    const btn = h('button', { class: 'btn ghost', onclick: () => {
      btn.disabled = true; btn.textContent = 'Opening…';
      load((url) => {
        const player = m.kind === 'video' ? h('video', { src: url, controls: true, playsinline: true })
          : m.kind === 'audio' ? h('audio', { src: url, controls: true })
          : h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', download: m.kind === 'pdf' ? null : m.name }, m.kind === 'pdf' ? 'Open document' : 'Save file');
        btn.replaceWith(player);
      });
    } }, icon(KIND_ICON[m.kind] || 'file', 18), ` ${m.kind === 'video' ? 'Play video' : m.kind === 'audio' ? 'Play recording' : 'Open ' + KIND_LABEL[m.kind]} (${fmtSize(m.size)})`);
    const watch = m.kind === 'midi' && h('a', { class: 'btn', href: `studio.html#m=${m.id}&k=${m.key}&n=${encodeURIComponent(m.caption || m.name.replace(/\.midi?$/i, ''))}` },
      icon('play', 18), ' Watch in the piano studio');
    fig.append(...[m.thumb && lazyThumb(m, 'thumb big'), watch, btn, cap].filter(Boolean));
  }
  return fig;
}

function lightbox(m) {
  const dlg = h('dialog', { class: 'lightbox', onclick: (ev) => { if (ev.target === dlg) dlg.close(); }, onclose: () => dlg.remove() },
    h('button', { class: 'plain close', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x', 24)));
  document.body.append(dlg);
  dlg.showModal();
  mediaURL(m, S.keys).then((url) => dlg.append(h('img', { src: url, alt: m.alt || m.caption || '' }), m.caption ? h('p', null, m.caption) : ''))
    .catch(() => dlg.append(h('p', null, 'This photo could not be opened.')));
}

function entry(id) {
  const e = S.data.entries.find((x) => x.id === id);
  if (!e) return h('div', null, h('h1', null, 'Not found'), h('a', { href: '#/journey' }, 'Back to the journey'));
  const c = cat(e.category);
  const related = e.relatedProject && S.data.entries.find((x) => x.id === e.relatedProject);
  return h('article', { class: 'entry' },
    h('a', { class: 'backlink', href: '#/journey' }, icon('back', 16), ' My Journey'),
    h('div', { class: 'card-meta' }, chip(c, { href: `#/area/${c.id}` }), e.subActivity && h('span', { class: 'sub' }, e.subActivity)),
    h('h1', null, e.title), h('p', { class: 'date' }, fmtDate(e)),
    h('div', { class: 'badges' }, badges(e)),
    e.description && h('p', { class: 'lead' }, e.description),
    (e.media || []).length > 0 && h('div', { class: 'media-grid' }, e.media.map(mediaBlock)),
    e.reflection && h('blockquote', { class: 'reflection' }, h('h2', null, 'In my own words'), h('p', null, e.reflection)),
    e.parentNote && h('aside', { class: 'parent-note' }, h('h2', null, 'A note from a parent'), h('p', null, e.parentNote)),
    (e.tags || []).length > 0 && h('p', { class: 'tags' }, e.tags.map((t) => h('span', null, '#' + t))),
    related && h('p', null, 'Related: ', h('a', { href: `#/entry/${related.id}` }, related.title)),
    S.mode === 'parent' && S.local && h('p', null, h('a', { class: 'btn ghost', href: `admin.html#/edit/${e.id}` }, icon('edit', 16), ' Edit this entry')));
}

function gallery(kind) {
  const k = kind || 'all';
  const items = visible().flatMap((e) => (e.media || []).map((m) => ({ m, e })));
  const groups = [['all', 'Everything'], ['image', 'Photos'], ['video', 'Videos'], ['audio', 'Recordings'], ['docs', 'Certificates and files']];
  const match = ({ m }) => k === 'all' || (k === 'docs' ? !['image', 'video', 'audio'].includes(m.kind) : m.kind === k);
  const shown = items.filter(match);
  return h('div', null, h('h1', null, 'Gallery'),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by type' },
      groups.map(([id, label]) => h('a', { class: 'chip c-slate', href: `#/gallery/${id}`, 'aria-current': k === id ? 'true' : null }, label))),
    shown.length ? h('div', { class: 'gallery' }, shown.map(({ m, e }) =>
      h('a', { href: `#/entry/${e.id}`, class: 'gitem' }, lazyThumb(m), h('span', null, m.caption || e.title), h('small', null, KIND_LABEL[m.kind]))))
      : empty('No photos, videos or files have been added yet.'));
}
