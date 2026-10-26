/* Commentify — searchable bank of "going well" (+) and "to improve" (−) comments.

   The bank lives in localStorage so the app opens instantly and works offline.
   If GitHub sync is configured (⚙), the bank is mirrored to comments.json in a
   private repo: pulled on open / when the window regains focus, pushed shortly
   after any change.  Merging is per comment, newest `t` wins; deletes are kept
   as tombstones so they propagate to other devices.

   Nothing is stored per student.  The checkout is scratch space that the
   "New student" action wipes (⌘Z undoes the wipe). */

const LS = { bank: 'cfy.bank', cfg: 'cfy.cfg', cart: 'cfy.cart' };
const $ = s => document.querySelector(s);

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let bank = load(LS.bank, []);          // [{id, kind:'+'|'-', tag, text, uses, t, del?}]
let cfg = { repo: '', path: 'comments.json', token: '', hplus: 'Strengths:', hminus: 'Areas for Growth:', bullet: '-', rich: true, ...load(LS.cfg, {}) };
let cart = load(LS.cart, []);          // [{id, kind, text, orig}]
let filter = 'all';
let hi = 0;                            // highlighted row index
let rows = [];                         // what's on screen, in order
let editing = null;                    // bank id being edited inline
let expanded = {};                     // {'+': true} once "Show all" is opened for a section
const TOP = 12;                        // rows per section when the search is empty
let lastWipe = null;
let copiedThisStudent = new Set();     // so re-copying doesn't inflate use counts

const live = () => bank.filter(c => !c.del);
const byId = id => bank.find(c => c.id === id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function normalize(list) {
  return list.map(c => ({ uses: 0, t: 0, tag: '', ...c, id: String(c.id), kind: c.kind === '+' ? '+' : '-' }));
}
bank = normalize(bank);

/* ---------------- search ---------------- */

function parseQuery(raw) {
  let s = raw.trim(), kind = null;
  const m = s.match(/^([+\-−])\s*/);
  if (m) { kind = m[1] === '+' ? '+' : '-'; s = s.slice(m[0].length); }
  const tags = [], words = [];
  for (const w of s.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (w.startsWith('#')) { if (w.length > 1) tags.push(w.slice(1).replace(/-/g, ' ')); }
    else words.push(w);
  }
  // the text for a brand-new comment: what was typed minus the prefix and #tags
  const body = s.replace(/(^|\s)#\S+/g, '').trim();
  const tagRaw = (s.match(/(?:^|\s)#(\S+)/) || [])[1];
  return { kind, tags, words, body, newTag: tagRaw ? tagRaw.replace(/-/g, ' ').toLowerCase() : '' };
}

function score(c, q) {
  const text = c.text.toLowerCase(), tag = c.tag.toLowerCase();
  for (const t of q.tags) if (!tag.startsWith(t) && !tag.includes(' ' + t)) return -1;
  let s = 0;
  for (const w of q.words) {
    if (tag.includes(w)) s += 3;
    else if (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text)) s += 2;
    else if (text.includes(w)) s += 1;
    else return -1;
  }
  return s;
}

function highlight(text, words) {
  let h = esc(text);
  for (const w of words) {
    if (w.length < 2) continue;
    h = h.replace(new RegExp('(' + esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
  }
  return h;
}

/* ---------------- render ---------------- */

function render() {
  const q = parseQuery($('#q').value);
  const kind = q.kind || (filter === 'all' ? null : filter);
  const inCart = new Set(cart.map(c => c.id));
  rows = [];
  let html = '';

  for (const k of ['+', '-']) {
    if (kind && kind !== k) continue;
    const hits = live().filter(c => c.kind === k)
      .map(c => [c, score(c, q)]).filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1] || b[0].uses - a[0].uses || (b[0].last || 0) - (a[0].last || 0) || a[0].text.localeCompare(b[0].text));
    if (!hits.length) continue;
    const browsing = !q.words.length && !q.tags.length;
    const shown = browsing && !expanded[k] ? hits.slice(0, TOP) : hits;
    html += `<div class="grp ${k === '+' ? 'plus' : 'minus'}">${k === '+' ? 'Going well' : 'To improve'} · ${browsing && !expanded[k] ? `top ${shown.length} of ` : ''}${hits.length}</div>`;
    for (const [c] of shown) {
      const i = rows.push({ type: 'item', c }) - 1;
      if (editing === c.id) { html += editHtml(c, i); continue; }
      html += `<div class="item ${k === '+' ? 'plus' : 'minus'}${inCart.has(c.id) ? ' sel' : ''}${i === hi ? ' hi' : ''}" data-i="${i}">
        <span class="chk">${inCart.has(c.id) ? '✓' : ''}</span>
        <span class="txt">${highlight(c.text, q.words)}</span>
        <span class="meta">${c.uses > 1 ? `<span class="uses" title="Used ${c.uses} times">×${c.uses}</span>` : ''}${c.tag ? `<span class="tag">${esc(c.tag)}</span>` : ''}<button class="act" data-edit="${c.id}" title="Edit (⌘E)">✎</button></span>
      </div>`;
    }
    if (shown.length < hits.length) {
      const i = rows.push({ type: 'more', kind: k }) - 1;
      html += `<div class="item more${i === hi ? ' hi' : ''}" data-i="${i}"><span class="chk">⋯</span><span class="txt">Show all ${hits.length} — or just type to search</span></div>`;
    }
  }

  // offer to add what was typed as a new comment (once it looks like a sentence, or nothing matched)
  if (q.body.length >= 3 && (!rows.length || q.body.split(/\s+/).length >= 4)) {
    for (const k of ['+', '-']) {
      if (kind && kind !== k) continue;
      const i = rows.push({ type: 'new', kind: k, text: q.body, tag: q.newTag }) - 1;
      html += `<div class="item new ${k === '+' ? 'plus' : 'minus'}${i === hi ? ' hi' : ''}" data-i="${i}">
        <span class="chk">＋</span>
        <span class="txt">Add new ${k === '+' ? 'going-well' : 'to-improve'}: “${esc(sentence(q.body))}”</span>
        <span class="meta">${q.newTag ? `<span class="tag">${esc(q.newTag)}</span>` : ''}</span>
      </div>`;
    }
  }

  if (!live().length && !rows.length) {
    html = `<div class="welcome">
      <h2>Welcome to Commentify</h2>
      <p>A quick-pick bank of report-card comments: <b class="p">+ going well</b> and <b class="m">− to improve</b>. Pick a few, copy, paste into your grade portal.</p>
      <ol>
        <li><b>Start your bank.</b> Type a comment in the search box and press ↵. Put <kbd>-</kbd> first to file it under “to improve”, and add a <kbd>#tag</kbd> like <kbd>#focus</kbd> to categorise it.</li>
        <li><b>Or import one</b> a colleague exported: <label class="filebtn">Import .json<input type="file" accept=".json,application/json" hidden onchange="document.querySelector('#import').files = this.files; document.querySelector('#import').dispatchEvent(new Event('change'))"></label></li>
        <li><b>Then every student:</b> search, ↵ to pick, edit any wording in place, <kbd>⌘↵</kbd> to copy, <kbd>Esc</kbd> for the next student.</li>
      </ol>
      <p class="muted">Your bank is saved in this browser only. Use ⚙ → Export JSON for a backup, or set up GitHub sync to share it across devices.</p>
    </div>`;
  } else if (!rows.length) {
    html = `<div class="empty">No matches.</div>`;
  }

  $('#list').innerHTML = html;
  renderChips(q, kind);
  if (hi >= rows.length) hi = Math.max(0, rows.length - 1);
  scrollHi();
  renderCart();
}

/* Tag chips for the current section, most-used first.  A chip just types #tag into the search. */
function renderChips(q, kind) {
  const counts = new Map();
  for (const c of live()) if (c.tag && (!kind || c.kind === kind)) counts.set(c.tag, (counts.get(c.tag) || 0) + c.uses);
  const active = q.tags[0];
  $('#chips').innerHTML = [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => {
    const n = live().filter(c => c.tag === t && (!kind || c.kind === kind)).length;
    return `<button class="chip${active && t.startsWith(active) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}<i>${n}</i></button>`;
  }).join('');
}

function editHtml(c, i) {
  return `<div class="edit" data-i="${i}">
    <textarea id="etext">${esc(c.text)}</textarea>
    <div class="row">
      <button class="danger" data-del="${c.id}">Delete</button>
      <input id="etag" value="${esc(c.tag)}" placeholder="tag">
      <button data-kind="${c.id}" title="Switch + / −">${c.kind === '+' ? '+ → −' : '− → +'}</button>
      <button class="primary" data-esave="${c.id}">Save</button>
    </div>
  </div>`;
}

function scrollHi() {
  const el = $('#list').querySelector(`[data-i="${hi}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function renderCart() {
  let html = '';
  for (const k of ['+', '-']) {
    const items = cart.map((c, i) => [c, i]).filter(([c]) => c.kind === k);
    if (!items.length) continue;
    html += `<div class="chead ${k === '+' ? 'plus' : 'minus'}">${esc(k === '+' ? cfg.hplus : cfg.hminus)}</div>`;
    for (const [c, i] of items) {
      html += `<div class="ci" data-ci="${i}">
        <span class="b">${esc(cfg.bullet)}</span>
        <span class="t" contenteditable="plaintext-only" spellcheck="true">${esc(c.text)}</span>
        ${c.text !== c.orig ? `<button class="save" data-csave="${i}" title="Save this wording to the bank">save</button>` : ''}
        <button class="x" data-cx="${i}" title="Remove">✕</button>
      </div>`;
    }
  }
  const body = $('#cartbody');
  // don't clobber the item being typed in
  if (body.contains(document.activeElement) && document.activeElement.isContentEditable) return;
  body.innerHTML = html;
}

/* ---------------- actions ---------------- */

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = s => { s = cap(s.trim()); return /[.!?)]$/.test(s) ? s : s + '.'; };

function touch(c) { c.t = Date.now(); persist(); }
function persist() { save(LS.bank, bank); scheduleSync(); }
function saveCart() { save(LS.cart, cart); }

function activate(i, keepQuery) {
  const r = rows[i];
  if (!r) return;
  if (r.type === 'more') { expanded[r.kind] = true; render(); return; }
  if (r.type === 'new') {
    const c = { id: newId(), kind: r.kind, tag: r.tag, text: sentence(r.text), uses: 0, t: Date.now() };
    bank.push(c);
    persist();
    cart.push({ id: c.id, kind: c.kind, text: c.text, orig: c.text });
    toast(`Added to bank & checkout`);
  } else {
    const at = cart.findIndex(x => x.id === r.c.id);
    if (at >= 0) cart.splice(at, 1);
    else cart.push({ id: r.c.id, kind: r.c.kind, text: r.c.text, orig: r.c.text });
  }
  saveCart();
  if (!keepQuery) { $('#q').value = ''; hi = 0; }
  render();
  $('#q').focus();
}

function formatted() {
  const out = [];
  for (const [k, h] of [['+', cfg.hplus], ['-', cfg.hminus]]) {
    const items = cart.filter(c => c.kind === k && c.text.trim());
    if (!items.length) continue;
    if (out.length) out.push('');
    if (h) out.push(h);
    for (const c of items) out.push(`${cfg.bullet ? cfg.bullet + ' ' : ''}${c.text.trim()}`);
  }
  return out.join('\n');
}

/* Rich version for the grade portal's editor.  It strips <p>/<ul>/<li> but keeps
   <strong>, so each line is <div>…<br></div> with a • character for the bullet:
   if the editor drops the <div> the <br> still breaks the line, and if it keeps
   both, a trailing <br> inside a block adds no extra space. */
function formattedHtml() {
  const line = h => `<div>${h}<br></div>`;
  const out = [];
  for (const [k, h] of [['+', cfg.hplus], ['-', cfg.hminus]]) {
    const items = cart.filter(c => c.kind === k && c.text.trim());
    if (!items.length) continue;
    if (out.length) out.push(line(''));
    if (h) out.push(line(`<strong>${esc(h)}</strong>`));
    for (const c of items) out.push(line(`•&nbsp;${esc(c.text.trim())}`));
  }
  return out.join('');
}

async function copy() {
  const text = formatted();
  if (!text) return toast('Checkout is empty');
  try {
    if (cfg.rich && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([formattedHtml()], { type: 'text/html' }),
      })]);
    } else await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  let changed = false;
  for (const c of cart) {
    const b = byId(c.id);
    if (b && !copiedThisStudent.has(c.id)) { b.uses++; b.last = b.t = Date.now(); copiedThisStudent.add(c.id); changed = true; }
  }
  if (changed) persist();
  toast(`Copied ${cart.length} comment${cart.length === 1 ? '' : 's'}`);
}

function wipe() {
  if (!cart.length) return;
  lastWipe = { cart, copied: copiedThisStudent };
  cart = []; copiedThisStudent = new Set();
  saveCart(); render();
  toast('New student — checkout cleared', 'Undo', undoWipe);
}

/* Load a previously written comment (copied back out of the portal) into the checkout.
   Headings pick the section; lines matching a bank comment link to it, others stay
   as one-off text with a "save" button. */
function loadPasted(raw) {
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!\s]+$/, '').trim();
  const index = new Map(live().map(c => [c.kind + norm(c.text), c]));
  const isHead = (line, h) => h && norm(line) === norm(h).replace(/:$/, '');
  let kind = '+';
  const items = [];
  for (let line of raw.replace(/\u00a0/g, ' ').split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const bare = line.replace(/:$/, '');
    if (isHead(bare, cfg.hplus) || /^(strengths?|going well|positives?)$/i.test(bare)) { kind = '+'; continue; }
    if (isHead(bare, cfg.hminus) || /^(areas? (for|of) growth|growth|to improve|areas? to improve|next steps)$/i.test(bare)) { kind = '-'; continue; }
    const text = line.replace(/^([•·*\-–—]|\d+[.)])\s*/, '').trim();
    if (!text) continue;
    const hit = index.get(kind + norm(text));
    items.push(hit ? { id: hit.id, kind, text, orig: text } : { id: newId(), kind, text, orig: '' });
  }
  if (!items.length) return false;
  if (cart.length) lastWipe = { cart, copied: copiedThisStudent };
  cart = items; copiedThisStudent = new Set(items.map(c => c.id));   // already counted when first written
  saveCart(); $('#q').value = ''; hi = 0; render();
  const linked = items.filter(c => byId(c.id)).length;
  toast(`Loaded ${items.length} comment${items.length === 1 ? '' : 's'} (${linked} from bank)`, lastWipe ? 'Undo' : '', lastWipe ? undoWipe : null);
  return true;
}

function undoWipe() {
  if (!lastWipe) return;
  ({ cart, copied: copiedThisStudent } = lastWipe);
  lastWipe = null;
  saveCart(); render(); toast('Restored');
}

function setFilter(f) {
  filter = f; expanded = {};
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.f === f));
  hi = 0; render();
}

function startEdit(id) {
  editing = id; render();
  const ta = $('#etext');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function finishEdit(id) {
  const c = byId(id), text = $('#etext')?.value.trim();
  if (c && text) {
    c.text = text; c.tag = $('#etag').value.trim().toLowerCase(); touch(c);
    cart.forEach(x => { if (x.id === id && x.text === x.orig) { x.text = x.orig = text; } });
    saveCart();
  }
  editing = null; render(); $('#q').focus();
}

/* ---------------- events ---------------- */

$('#q').addEventListener('input', () => { hi = 0; render(); });

// pasting a multi-line comment loads it into the checkout instead of searching for it
$('#q').addEventListener('paste', e => {
  const text = e.clipboardData?.getData('text/plain') || '';
  if (/\n/.test(text.trim()) && loadPasted(text)) e.preventDefault();
});

$('#chips').addEventListener('click', e => {
  const t = e.target.closest('[data-tag]')?.dataset.tag;
  if (!t) return;
  const q = $('#q'), tok = '#' + t.replace(/ /g, '-');
  const prefix = (q.value.match(/^\s*[+\-−]\s*/) || [''])[0];
  // toggle: clicking the active chip clears it; otherwise it replaces any #tag in the search
  const rest = q.value.slice(prefix.length).replace(/(^|\s)#\S+/g, '').trim();
  const on = e.target.closest('.chip').classList.contains('on');
  q.value = prefix + (on ? rest : (tok + ' ' + rest).trim() + ' ');
  hi = 0; render(); q.focus();
});

// vertical mouse wheel scrolls the chip row sideways
$('#chips').addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); $('#chips').scrollLeft += e.deltaY; }
}, { passive: false });

$('#seg').addEventListener('click', e => { if (e.target.dataset.f) setFilter(e.target.dataset.f); $('#q').focus(); });

$('#list').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.edit) return startEdit(t.dataset.edit);
  if (t.dataset.esave) return finishEdit(t.dataset.esave);
  if (t.dataset.kind) { const c = byId(t.dataset.kind); c.kind = c.kind === '+' ? '-' : '+'; touch(c); editing = null; return render(); }
  if (t.dataset.del) {
    const c = byId(t.dataset.del); c.del = 1; touch(c); editing = null;
    cart = cart.filter(x => x.id !== c.id); saveCart(); render();
    return toast('Deleted from bank', 'Undo', () => { delete c.del; touch(c); render(); });
  }
  if (t.closest('.edit')) return;
  const row = t.closest('[data-i]');
  if (row) { hi = +row.dataset.i; activate(hi, e.shiftKey); }
});

$('#cartbody').addEventListener('input', e => {
  const ci = e.target.closest('[data-ci]');
  if (!ci) return;
  const c = cart[+ci.dataset.ci];
  c.text = e.target.textContent;
  saveCart();
  // show/hide the "save" button without re-rendering (keeps the caret)
  const has = ci.querySelector('.save');
  if (c.text !== c.orig && !has) ci.querySelector('.x').insertAdjacentHTML('beforebegin', `<button class="save" data-csave="${ci.dataset.ci}" title="Save this wording to the bank">save</button>`);
  if (c.text === c.orig && has) has.remove();
});
$('#cartbody').addEventListener('focusout', () => setTimeout(renderCart));
$('#cartbody').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.cx) { cart.splice(+t.dataset.cx, 1); saveCart(); render(); $('#q').focus(); }
  if (t.dataset.csave) {
    const c = cart[+t.dataset.csave], src = byId(c.id);
    const n = { id: newId(), kind: c.kind, tag: src?.tag || '', text: c.text.trim(), uses: 0, t: Date.now() };
    bank.push(n); persist();
    c.id = n.id; c.orig = n.text; saveCart(); render();
    toast('Saved as a new bank comment');
  }
});

$('#copy').onclick = () => { copy(); $('#q').focus(); };
$('#wipe').onclick = () => { wipe(); $('#q').focus(); };
$('#help').onclick = () => $('#keys').showModal();
$('#gear').onclick = () => openSettings();

document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const t = e.target;
  const inCart = t.isContentEditable;
  const inEdit = !!t.closest?.('.edit');
  const inDialog = !!t.closest?.('dialog');
  if (inDialog) return;

  if (mod && e.key === 'Enter') { e.preventDefault(); if (inEdit) finishEdit(editing); else copy(); return; }

  if (inEdit) {
    if (e.key === 'Escape') { editing = null; render(); $('#q').focus(); }
    return;
  }
  if (inCart) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); t.blur(); $('#q').focus(); }
    return;
  }

  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); hi = Math.min(rows.length - 1, hi + 1); return moveHi();
    case 'ArrowUp':   e.preventDefault(); hi = Math.max(0, hi - 1); return moveHi();
    case 'PageDown':  e.preventDefault(); hi = Math.min(rows.length - 1, hi + 10); return moveHi();
    case 'PageUp':    e.preventDefault(); hi = Math.max(0, hi - 10); return moveHi();
    case 'Enter':     e.preventDefault(); return activate(hi, e.shiftKey);
    case 'Tab': {
      e.preventDefault();
      const order = ['all', '+', '-'];
      return setFilter(order[(order.indexOf(filter) + (e.shiftKey ? 2 : 1)) % 3]);
    }
    case 'Escape':
      e.preventDefault();
      if ($('#q').value) { $('#q').value = ''; hi = 0; render(); }
      else if (expanded['+'] || expanded['-']) { expanded = {}; hi = 0; render(); $('#list').scrollTop = 0; }
      else wipe();
      return $('#q').focus();
  }
  if (mod && e.key.toLowerCase() === 'z' && !$('#q').value && lastWipe) { e.preventDefault(); return undoWipe(); }
  if (mod && e.key.toLowerCase() === 'e' && rows[hi]?.type === 'item') { e.preventDefault(); return startEdit(rows[hi].c.id); }

  // any typing goes to the search box
  if (t !== $('#q') && e.key.length === 1 && !mod) $('#q').focus();
});

function moveHi() {
  document.querySelectorAll('.item.hi').forEach(el => el.classList.remove('hi'));
  document.querySelector(`.item[data-i="${hi}"]`)?.classList.add('hi');
  scrollHi();
}

let toastTimer;
function toast(msg, label, fn) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (label ? ` <button>${esc(label)}</button>` : '');
  if (fn) el.querySelector('button').onclick = () => { el.hidden = true; fn(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, label ? 6000 : 1800);
}

/* ---------------- settings / backup ---------------- */

function openSettings() {
  const f = $('#settings form');
  for (const k of ['repo', 'path', 'token', 'hplus', 'hminus', 'bullet']) f.elements[k].value = cfg[k] ?? '';
  f.elements.rich.checked = cfg.rich;
  $('#settings').showModal();
}
window.openSettings = openSettings;

// Saved directly on click (not via dialog.returnValue, which some browsers don't report).
$('#savesync').onclick = () => {
  const f = $('#settings form');
  cfg.repo = f.elements.repo.value.trim();
  cfg.path = f.elements.path.value.trim() || 'comments.json';
  cfg.token = f.elements.token.value.trim();
  save(LS.cfg, cfg);
  $('#settings').close();
  if (!cfg.repo || !cfg.token) return toast('Need both a repo and a token to sync');
  toast('Saved — syncing…');
  sync();
};

// Copy-format fields apply however the dialog closes.
$('#settings').addEventListener('close', () => {
  const f = $('#settings form');
  for (const k of ['hplus', 'hminus', 'bullet']) cfg[k] = f.elements[k].value;
  cfg.rich = f.elements.rich.checked;
  save(LS.cfg, cfg);
  render();
  $('#q').focus();
});

$('#sync').onclick = () => { if (cfg.token && cfg.repo) sync(); else openSettings(); };

$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(live(), null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `commentify-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};

$('#import').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = mergeIn(JSON.parse(await file.text()));
    persist(); render();
    toast(`Imported — ${n} new/updated`);
  } catch (err) { toast('Import failed: ' + err.message); }
  e.target.value = '';
};

/* Merge another copy of the bank into ours, newest t wins.  Returns # changed. */
function mergeIn(other) {
  const map = new Map(bank.map(c => [c.id, c]));
  let n = 0;
  for (const c of normalize(Array.isArray(other) ? other : other.comments || [])) {
    const mine = map.get(c.id);
    if (!mine || c.t > mine.t) { map.set(c.id, c); n++; }
  }
  bank = [...map.values()];
  return n;
}

/* ---------------- GitHub sync ---------------- */

let syncTimer, syncing = false, again = false, lastPull = 0;

function setSync(text, cls = '', why = '') {
  const p = $('#sync');
  p.textContent = text; p.className = 'pill ' + cls;
  p.title = why || { local: 'Sync not set up — click to open settings', synced: 'Synced with GitHub — click to sync now' }[text] || text;
}

function scheduleSync() {
  if (!cfg.token || !cfg.repo) return;
  setSync('saving…');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1500);
}

const b64enc = s => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), ch => ch.charCodeAt(0)));

async function gh(method, body) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`;
  return fetch(url, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body && JSON.stringify(body),
  });
}

/* Pull, merge, and push if our copy has anything the remote lacks. */
async function sync() {
  if (!cfg.token || !cfg.repo) { setSync('local'); return; }
  if (syncing) { again = true; return; }
  syncing = true;
  setSync('syncing…');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await gh('GET');
      let remote = [], sha;
      if (res.status === 404) remote = [];
      else if (!res.ok) throw new Error(`GitHub ${res.status}${res.status === 401 ? ' (bad token)' : res.status === 403 ? ' (token lacks Contents: write?)' : ''}`);
      else { const j = await res.json(); sha = j.sha; remote = JSON.parse(b64dec(j.content) || '[]'); }
      lastPull = Date.now();

      const before = JSON.stringify(bank);
      mergeIn(remote);
      if (JSON.stringify(bank) !== before) { save(LS.bank, bank); render(); }

      const remoteMap = new Map(normalize(remote).map(c => [c.id, c.t]));
      const ahead = bank.some(c => !remoteMap.has(c.id) || c.t > remoteMap.get(c.id));
      if (!ahead) break;

      const sorted = [...bank].sort((a, b) => a.kind.localeCompare(b.kind) || b.uses - a.uses || a.text.localeCompare(b.text));
      const put = await gh('PUT', { message: 'Update comments', content: b64enc(JSON.stringify(sorted, null, 1) + '\n'), ...(sha && { sha }) });
      if (put.ok) break;
      if (put.status !== 409 && put.status !== 422) throw new Error(`GitHub ${put.status}${put.status === 403 ? ' (token needs Contents: read & write)' : ''}`);
      // someone else wrote in between — loop to re-pull and merge
    }
    setSync('synced', 'ok');
  } catch (err) {
    const why = String(err.message || err);
    setSync(navigator.onLine ? 'sync error' : 'offline', 'err', why + ' — click to retry');
    if (navigator.onLine) toast('Sync failed: ' + why);
  } finally {
    syncing = false;
    if (again) { again = false; sync(); }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastPull > 60_000) sync();
});
window.addEventListener('online', () => sync());

/* ---------------- boot ---------------- */

async function boot() {
  // Local dev convenience: when served from the project folder, seed from comments.json.
  if (!live().length) {
    try {
      const r = await fetch('comments.json', { cache: 'no-store' });
      if (r.ok) { mergeIn(await r.json()); save(LS.bank, bank); }
    } catch {}
  }
  render();
  $('#q').focus();
  sync();
}
boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
