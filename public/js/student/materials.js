// Materiallar ro'yxati va hujjat ko'rish oynasi (PDF — lazy-load pdf.js, rasm, boshqa fayllar).
import { $, esc, icon, loadScript, safeUrl, toast, haptic } from './util.js';
import { S, bus, actions, push, onEnter, onLeave, currentScreen } from './state.js';
import { t } from './i18n.js';
import { markMaterialsSeen } from './lesson.js';

const kindLabel = (k) => t('kind.' + k);

const KINDS = {
  pdf: { badge: 'PDF', bg: 'linear-gradient(135deg,#ef4444,#f97316)' },
  word: { badge: 'DOC', bg: 'linear-gradient(135deg,#3b82f6,#6366f1)' },
  ppt: { badge: 'PPT', bg: 'linear-gradient(135deg,#f97316,#f59e0b)' },
  excel: { badge: 'XLS', bg: 'linear-gradient(135deg,#10b981,#06b6d4)' },
  image: { badge: 'IMG', bg: 'linear-gradient(135deg,#8b5cf6,#d946ef)' },
  text: { badge: 'TXT', bg: 'linear-gradient(135deg,#64748b,#475569)' },
  file: { badge: 'FILE', bg: 'linear-gradient(135deg,#64748b,#334155)' },
};
export function kindOf(m) {
  const name = String(m.fileName || m.fileUrl || '').toLowerCase().split('?')[0];
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const t = String(m.fileType || '').toLowerCase();
  if (ext === 'pdf' || t === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext) || t === 'word') return 'word';
  if (['ppt', 'pptx'].includes(ext) || t === 'ppt') return 'ppt';
  if (['xls', 'xlsx'].includes(ext) || t === 'excel') return 'excel';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext) || t === 'image') return 'image';
  if (!m.fileUrl) return 'text';
  return 'file';
}

// ---------- Ro'yxat ----------
function renderList() {
  const box = $('#mats-list');
  if (!S.materials.length) {
    box.innerHTML = `<div class="glass empty"><div class="eic">${icon('file', 'lg')}</div><h3>${esc(t('mats.emptyT'))}</h3><p>${esc(t('mats.emptyD'))}</p></div>`;
    return;
  }
  box.innerHTML = S.materials.map((m) => {
    const k = KINDS[kindOf(m)];
    const meta = [m.fileName || kindLabel(kindOf(m)), m.fileSize].filter(Boolean).join(' · ');
    return `<button class="glass item fade-in" data-act="open-mat" data-id="${esc(m.id)}"><span class="ftype" style="background:${k.bg}">${k.badge}</span><span class="it"><b>${esc(m.title || t('mats.defaultTitle'))}</b><span>${esc(meta)}</span></span>${icon('next', 'sm muted')}</button>`;
  }).join('');
}
onEnter('s-mats', () => { renderList(); markMaterialsSeen(); });

actions['open-mat'] = (el) => {
  const m = S.materials.find((x) => String(x.id) === el.dataset.id);
  if (m) openMaterial(m);
};

// ---------- Ko'rish oynasi ----------
let cur = null;
let pdf = null;
let page = 1;
let token = 0;
const cache = new Map();
let zoom = 1, px = 0, py = 0;

function applyTransform() { $('#v-inner').style.transform = `translate3d(${px}px,${py}px,0) scale(${zoom})`; }
function resetZoom() { zoom = 1; px = 0; py = 0; applyTransform(); }

export function openMaterial(m) {
  cur = m;
  if (currentScreen() === 's-viewer') renderViewer(); else push('s-viewer');
}

function cleanup() {
  token++;
  cache.clear();
  if (pdf) { try { pdf.destroy(); } catch { /* ignore */ } pdf = null; }
  $('#v-inner').replaceChildren();
  $('#v-foot').hidden = true;
  $('#v-spin').hidden = true;
  resetZoom();
}
onLeave('s-viewer', cleanup);
onEnter('s-viewer', () => renderViewer());

async function renderViewer() {
  if (!cur) return;
  cleanup();
  const m = cur;
  const kind = kindOf(m);
  const k = KINDS[kind];
  $('#v-title').textContent = m.title || m.fileName || t('mats.material');
  $('#v-sub').textContent = [kindLabel(kindOf(m)), m.fileSize].filter(Boolean).join(' · ');
  const note = $('#v-note');
  note.textContent = m.text || '';
  note.hidden = !m.text || kind === 'text' || kind === 'file';
  const inner = $('#v-inner');
  const url = m.fileUrl ? safeUrl(m.fileUrl) : '';

  if (kind === 'pdf' && url) return openPdf(url);
  if (kind === 'image' && url) {
    const img = document.createElement('img');
    img.alt = m.title || kindLabel('image');
    img.draggable = false;
    img.src = url;
    inner.appendChild(img);
    return;
  }
  inner.innerHTML = `<div class="glass vcard"><span class="ftype" style="background:${k.bg};width:64px;height:64px;font-size:15px;border-radius:20px">${k.badge}</span>
    <h3>${esc(m.fileName || m.title || t('mats.material'))}</h3>
    ${m.fileSize ? `<div style="opacity:.7;font-size:13px">${esc(m.fileSize)}</div>` : ''}
    ${m.text ? `<div style="text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.5">${esc(m.text)}</div>` : ''}
    ${url && kind === 'file' || (url && ['word', 'ppt', 'excel'].includes(kind)) ? `<div style="font-size:13px;opacity:.75">${esc(t('viewer.noPreview'))}</div>` : ''}
  </div>`;
}

async function openPdf(url) {
  const my = token;
  $('#v-spin').hidden = false;
  try {
    await loadScript('/js/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.js';
    const doc = await window.pdfjsLib.getDocument({ url }).promise;
    if (my !== token) { doc.destroy(); return; }
    pdf = doc;
    const c = document.createElement('canvas');
    c.id = 'v-canvas';
    $('#v-inner').replaceChildren(c);
    $('#v-foot').hidden = pdf.numPages < 2;
    await showPage(1);
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    $('#v-inner').innerHTML = `<div class="glass vcard">${icon('alert', 'lg')}<h3>${esc(t('viewer.errT'))}</h3><div style="opacity:.75;font-size:14px">${esc(t('viewer.errD'))}</div><button class="btn btn-primary" data-act="retry-viewer">${esc(t('conn.retry'))}</button></div>`;
  } finally {
    if (my === token) $('#v-spin').hidden = true;
  }
}
actions['retry-viewer'] = () => renderViewer();

async function renderPageCanvas(n) {
  if (cache.has(n)) return cache.get(n);
  const p = await pdf.getPage(n);
  const stage = $('#v-stage');
  const base = p.getViewport({ scale: 1 });
  const fit = Math.min((stage.clientWidth - 16) / base.width, (stage.clientHeight - 16) / base.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = p.getViewport({ scale: fit * dpr });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  c.dataset.w = String(Math.floor(vp.width / dpr)); c.dataset.h = String(Math.floor(vp.height / dpr));
  await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  cache.set(n, c);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return c;
}

async function showPage(n) {
  if (!pdf || n < 1 || n > pdf.numPages) return;
  const my = token;
  page = n;
  $('#v-page').textContent = `${n} / ${pdf.numPages}`;
  resetZoom();
  $('#v-spin').hidden = false;
  try {
    const src = await renderPageCanvas(n);
    if (my !== token || page !== n) return;
    const dst = $('#v-canvas');
    dst.width = src.width; dst.height = src.height;
    dst.style.width = src.dataset.w + 'px'; dst.style.height = src.dataset.h + 'px';
    dst.getContext('2d').drawImage(src, 0, 0);
    if (n < pdf.numPages) renderPageCanvas(n + 1).catch(() => {});
  } finally {
    if (my === token) $('#v-spin').hidden = true;
  }
}
actions['pdf-next'] = () => showPage(page + 1);
actions['pdf-prev'] = () => showPage(page - 1);

// ---------- Ishoralar: surish, chimchilash, ikki marta bosish ----------
(function gestures() {
  const stage = $('#v-stage');
  const pts = new Map();
  let startDist = 0, startZoom = 1, sx = 0, sy = 0, st = 0, lastTap = 0, moved = false;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false; }
    if (pts.size === 2) { startDist = dist() || 1; startZoom = zoom; moved = true; }
  });
  stage.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {
      zoom = Math.min(4, Math.max(1, startZoom * (dist() / startDist)));
      applyTransform();
    } else if (pts.size === 1 && zoom > 1.05) {
      px += dx; py += dy; moved = true;
      const maxX = (zoom - 1) * stage.clientWidth / 2, maxY = (zoom - 1) * stage.clientHeight / 2;
      px = Math.max(-maxX, Math.min(maxX, px)); py = Math.max(-maxY, Math.min(maxY, py));
      applyTransform();
    }
  });
  const end = (e) => {
    const wasSingle = pts.size === 1;
    pts.delete(e.pointerId);
    if (!wasSingle) return;
    const dx = e.clientX - sx, dy = e.clientY - sy, now = Date.now();
    if (zoom <= 1.05 && pdf && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && now - st < 700) {
      haptic(10);
      showPage(page + (dx < 0 ? 1 : -1));
      return;
    }
    if (!moved || (Math.abs(dx) < 8 && Math.abs(dy) < 8)) {
      if (now - lastTap < 300) { lastTap = 0; if (zoom > 1.1) resetZoom(); else { zoom = 2.2; px = 0; py = 0; applyTransform(); } }
      else lastTap = now;
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
})();

// ---------- Yangi material ----------
bus.on('material', (m) => {
  haptic([100, 50, 100]);
  toast(t('mats.new', { title: m.title || t('mats.defaultTitle') }));
  if (S.phase !== 'joined') return;
  if (currentScreen() === 's-mats') { renderList(); markMaterialsSeen(); }
  if (m.fileUrl || m.text) { markMaterialsSeen(); openMaterial(m); }
});
