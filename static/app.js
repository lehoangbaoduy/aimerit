'use strict';

// ── State machine ──────────────────────────────────────────────────────────
const State = { LANDING: 'LANDING', SCANNING: 'SCANNING', REVIEWING: 'REVIEWING', PDF_READY: 'PDF_READY' };
let currentState = State.LANDING;

// ── Session data ───────────────────────────────────────────────────────────
let capturedPages      = [];   // Array<Blob> — JPEG blobs, one per saved page
let capturedThumbnails = [];   // Array<string> — object URLs for preview
let sessionId    = null;
let pdfFilename  = null;
let mediaStream  = null;

// ── Canvas rectangle state ─────────────────────────────────────────────────
let rect = { x: 0, y: 0, w: 0, h: 0 };
const HANDLE_RADIUS = 22;   // touch handle radius (44 px diameter = iOS min)
const MIN_RECT      = 80;

// Current drag operation: null | { type, corner?, startX, startY, origRect }
let drag = null;

// ── DOM refs (resolved after DOMContentLoaded) ─────────────────────────────
let video, canvas, ctx;

// ═══════════════════════════════════════════════════════════════════════════
// Camera
// ═══════════════════════════════════════════════════════════════════════════

async function initCamera() {
  video  = document.getElementById('camera-feed');
  canvas = document.getElementById('overlay-canvas');
  ctx    = canvas.getContext('2d');

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { min: 1280, ideal: 9999 },
        height: { min: 720,  ideal: 9999 },
      },
      audio: false,
    });
    video.srcObject = mediaStream;
    video.addEventListener('loadedmetadata', () => {
      syncCanvasSize();
      initRect();
      drawOverlay();
    });
    window.addEventListener('resize', () => { syncCanvasSize(); drawOverlay(); });
  } catch (err) {
    document.getElementById('camera-error').classList.remove('hidden');
    video.style.display = 'none';
    canvas.style.display = 'none';
    console.error('Camera error:', err);
  }
}

function syncCanvasSize() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas overlay — rectangle with drag handles
// ═══════════════════════════════════════════════════════════════════════════

function initRect() {
  const cw = canvas.width, ch = canvas.height;
  rect.w = cw * 0.72;
  rect.h = ch * 0.55;
  rect.x = (cw - rect.w) / 2;
  rect.y = (ch - rect.h) / 2;
}

/** Four corner positions of the current rect. */
function corners() {
  return [
    { x: rect.x,          y: rect.y },           // 0 TL
    { x: rect.x + rect.w, y: rect.y },           // 1 TR
    { x: rect.x,          y: rect.y + rect.h },  // 2 BL
    { x: rect.x + rect.w, y: rect.y + rect.h },  // 3 BR
  ];
}

function drawOverlay() {
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  // 1. Darken entire canvas
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, cw, ch);

  // 2. Punch out the document rectangle
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalCompositeOperation = 'source-over';

  // 3. Yellow border
  ctx.strokeStyle = '#FFD60A';
  ctx.lineWidth   = 2.5;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  // 4. Corner L-brackets
  const BRACKET = 22;
  ctx.lineWidth = 4;
  [
    [rect.x,          rect.y,           1, 0,  0,  1],
    [rect.x + rect.w, rect.y,          -1, 0,  0,  1],
    [rect.x,          rect.y + rect.h,  1, 0,  0, -1],
    [rect.x + rect.w, rect.y + rect.h, -1, 0,  0, -1],
  ].forEach(([sx, sy, dx1, dy1, dx2, dy2]) => {
    ctx.beginPath();
    ctx.moveTo(sx + dx1 * BRACKET, sy + dy1 * BRACKET);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx + dx2 * BRACKET, sy + dy2 * BRACKET);
    ctx.stroke();
  });

  // 5. Circular drag handles at corners
  ctx.fillStyle = '#FFD60A';
  corners().forEach(({ x, y }) => {
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Touch / mouse interaction
// ═══════════════════════════════════════════════════════════════════════════

function eventPoint(e) {
  const bounds = canvas.getBoundingClientRect();
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - bounds.left) * (canvas.width  / bounds.width),
    y: (src.clientY - bounds.top)  * (canvas.height / bounds.height),
  };
}

function hitCorner(px, py) {
  const c = corners();
  for (let i = 0; i < c.length; i++) {
    const dx = px - c[i].x, dy = py - c[i].y;
    if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_RADIUS + 10) return i;
  }
  return -1;
}

function hitInside(px, py) {
  return px >= rect.x && px <= rect.x + rect.w &&
         py >= rect.y && py <= rect.y + rect.h;
}

function onPointerDown(e) {
  e.preventDefault();
  const { x, y } = eventPoint(e);
  const ci = hitCorner(x, y);
  if (ci !== -1) {
    drag = { type: 'resize', corner: ci, startX: x, startY: y, origRect: { ...rect } };
  } else if (hitInside(x, y)) {
    drag = { type: 'move', startX: x, startY: y, origRect: { ...rect } };
  }
}

function onPointerMove(e) {
  if (!drag) return;
  e.preventDefault();
  const { x, y } = eventPoint(e);
  const dx = x - drag.startX, dy = y - drag.startY;
  const or = drag.origRect;

  if (drag.type === 'move') {
    rect.x = Math.max(0, Math.min(canvas.width  - rect.w, or.x + dx));
    rect.y = Math.max(0, Math.min(canvas.height - rect.h, or.y + dy));
  } else {
    // corners: 0=TL, 1=TR, 2=BL, 3=BR
    let nx = or.x, ny = or.y, nw = or.w, nh = or.h;
    switch (drag.corner) {
      case 0: nx = or.x + dx; nw = or.w - dx; ny = or.y + dy; nh = or.h - dy; break;
      case 1:                  nw = or.w + dx; ny = or.y + dy; nh = or.h - dy; break;
      case 2: nx = or.x + dx; nw = or.w - dx;                  nh = or.h + dy; break;
      case 3:                  nw = or.w + dx;                  nh = or.h + dy; break;
    }
    if (nw >= MIN_RECT && nh >= MIN_RECT) {
      rect.x = nx; rect.y = ny; rect.w = nw; rect.h = nh;
    }
  }
  drawOverlay();
}

function onPointerUp() { drag = null; }

// ═══════════════════════════════════════════════════════════════════════════
// Page capture
// ═══════════════════════════════════════════════════════════════════════════

function triggerShutter() {
  const flash = document.getElementById('shutter-flash');
  flash.classList.remove('flash');
  // Force reflow so re-adding the class restarts the animation
  void flash.offsetWidth;
  flash.classList.add('flash');
}

function capturePage() {
  if (!video.videoWidth) return;
  triggerShutter();

  // Map rect from canvas-display-space → actual video-pixel-space.
  // video uses object-fit:cover, so we must account for letterboxing.
  const cw = canvas.width,  ch = canvas.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  const videoAspect   = vw / vh;
  const displayAspect = cw / ch;

  let scaleX, scaleY, offX = 0, offY = 0;
  if (videoAspect > displayAspect) {
    // Wider video: letterboxed left/right
    scaleY = vh / ch; scaleX = scaleY;
    offX   = (vw - cw * scaleX) / 2;
  } else {
    // Taller video: letterboxed top/bottom
    scaleX = vw / cw; scaleY = scaleX;
    offY   = (vh - ch * scaleY) / 2;
  }

  const sx = rect.x * scaleX + offX;
  const sy = rect.y * scaleY + offY;
  const sw = rect.w * scaleX;
  const sh = rect.h * scaleY;

  const off = document.createElement('canvas');
  off.width  = Math.round(sw);
  off.height = Math.round(sh);
  off.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, off.width, off.height);

  off.toBlob(blob => {
    capturedPages.push(blob);
    capturedThumbnails.push(URL.createObjectURL(blob));
    updatePageCount();
    updatePreview();
    document.getElementById('btn-retake').disabled = false;
    document.getElementById('btn-clear').disabled  = false;
    document.getElementById('btn-done').disabled   = false;
  }, 'image/jpeg', 0.97);
}

function retakePage() {
  if (capturedPages.length === 0) return;
  capturedPages.pop();
  const url = capturedThumbnails.pop();
  if (url) URL.revokeObjectURL(url);
  updatePageCount();
  updatePreview();
  if (capturedPages.length === 0) {
    document.getElementById('btn-retake').disabled = true;
    document.getElementById('btn-clear').disabled  = true;
    document.getElementById('btn-done').disabled   = true;
  }
}

function updatePageCount() {
  document.getElementById('page-count').textContent = `Pages: ${capturedPages.length}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Clear all pages
// ═══════════════════════════════════════════════════════════════════════════

function clearAllPages() {
  capturedPages = [];
  capturedThumbnails.forEach(url => URL.revokeObjectURL(url));
  capturedThumbnails = [];
  updatePageCount();
  updatePreview();
  document.getElementById('btn-retake').disabled = true;
  document.getElementById('btn-clear').disabled  = true;
  document.getElementById('btn-done').disabled   = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Preview modal
// ═══════════════════════════════════════════════════════════════════════════

let modalIndex = 0;
let swipeStartX = 0;

function openModal(index) {
  modalIndex = Math.max(0, Math.min(index, capturedThumbnails.length - 1));
  refreshModal();
  document.getElementById('preview-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('preview-modal').classList.add('hidden');
}

function refreshModal() {
  document.getElementById('modal-img').src = capturedThumbnails[modalIndex];
  document.getElementById('modal-counter').textContent =
    capturedThumbnails.length > 1 ? `${modalIndex + 1} / ${capturedThumbnails.length}` : '';
  document.getElementById('modal-prev').disabled = modalIndex === 0;
  document.getElementById('modal-next').disabled = modalIndex === capturedThumbnails.length - 1;
}

function updatePreview() {
  const preview = document.getElementById('page-preview');
  const stack   = document.getElementById('preview-stack');
  stack.innerHTML = '';

  if (capturedThumbnails.length === 0) {
    preview.classList.add('hidden');
    return;
  }
  preview.classList.remove('hidden');

  // Show up to 3 most recent; oldest rendered first (back), newest last (front)
  const show = capturedThumbnails.slice(-3);
  const n    = show.length;
  // Rotation/offset per position from front: index 0=front, 1=middle, 2=back
  const transforms = ['none', 'rotate(-4deg) translate(-3px, 2px)', 'rotate(-8deg) translate(-6px, 4px)'];

  show.forEach((url, i) => {
    const fromFront = n - 1 - i;   // 0 = newest (front), n-1 = oldest (back)
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.style.zIndex   = n - fromFront;
    card.style.transform = transforms[fromFront] || transforms[2];
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    card.appendChild(img);
    stack.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Screen transitions
// ═══════════════════════════════════════════════════════════════════════════

const SCREEN_MAP = {
  [State.LANDING]:   'screen-landing',
  [State.SCANNING]:  'screen-scanning',
  [State.REVIEWING]: 'screen-reviewing',
  [State.PDF_READY]: 'screen-pdf-ready',
};

function transitionTo(state) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(SCREEN_MAP[state]).classList.add('active');
  currentState = state;
}

// ═══════════════════════════════════════════════════════════════════════════
// OCR / process document
// ═══════════════════════════════════════════════════════════════════════════

async function processDocument() {
  transitionTo(State.REVIEWING);
  showSpinner(true);

  const formData = new FormData();
  capturedPages.forEach((blob, i) => formData.append('images', blob, `page_${i}.jpg`));

  try {
    const res  = await fetch('/process-images', { method: 'POST', body: formData });
    const data = await res.json();
    showSpinner(false);

    document.getElementById('field-formula').value = data.formula_number || '';
    document.getElementById('field-date').value    = data.date || '';

    const hint = document.getElementById('ocr-hint');
    if (data.confidence === 'low') {
      hint.textContent = 'Some fields could not be detected automatically — please fill them in.';
      hint.classList.remove('hidden');
    } else if (data.confidence === 'unavailable') {
      hint.textContent = 'Could not extract data automatically — please fill in the fields manually.';
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  } catch (err) {
    showSpinner(false);
    document.getElementById('ocr-hint').textContent = 'Network error — please fill in the fields manually.';
    document.getElementById('ocr-hint').classList.remove('hidden');
  }
}

function showSpinner(visible) {
  document.getElementById('spinner').classList.toggle('hidden', !visible);
  document.getElementById('ocr-results').classList.toggle('hidden', visible);
}

// ═══════════════════════════════════════════════════════════════════════════
// Confirm & generate PDF
// ═══════════════════════════════════════════════════════════════════════════

/** Mirror the Python normalize_date logic on the client side. */
function normalizeDateClient(raw) {
  if (!raw) return null;
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

  // MM/DD/YYYY or MM-DD-YYYY
  let m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${yr}`;
  }
  // Month DD, YYYY  or  Month DD YYYY
  m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const mo = months[m[1].toLowerCase().slice(0, 3)];
    if (mo) {
      const yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${String(mo).padStart(2,'0')}.${m[2].padStart(2,'0')}.${yr}`;
    }
  }
  // DD Month YYYY  (with space)
  m = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const mo = months[m[2].toLowerCase().slice(0, 3)];
    if (mo) {
      const yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${String(mo).padStart(2,'0')}.${m[1].padStart(2,'0')}.${yr}`;
    }
  }
  // DDMonYY or DD-Mon-YY or DD-Mon-YYYY  (e.g. 19Jan26, 19-Jan-26)
  m = raw.match(/^(\d{1,2})-?([A-Za-z]{3})-?(\d{2,4})$/);
  if (m) {
    const mo = months[m[2].toLowerCase()];
    if (mo) {
      const yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${String(mo).padStart(2,'0')}.${m[1].padStart(2,'0')}.${yr}`;
    }
  }
  return null;
}

async function confirmAndGeneratePDF() {
  const formulaNumber = document.getElementById('field-formula').value.trim();
  const dateDisplay   = document.getElementById('field-date').value.trim();

  if (!formulaNumber || !dateDisplay) {
    alert('Please enter both formula number and date before confirming.');
    return;
  }

  const normalized = normalizeDateClient(dateDisplay) || dateDisplay.replace(/[\/\-\s]/g, '.');

  const formData = new FormData();
  capturedPages.forEach((blob, i) => formData.append('images', blob, `page_${i}.jpg`));
  formData.append('formula_number', formulaNumber);
  formData.append('date',           dateDisplay);
  formData.append('normalized_date', normalized);

  showSpinner(true);
  try {
    const res  = await fetch('/generate-pdf', { method: 'POST', body: formData });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    showSpinner(false);
    sessionId   = data.session_id;
    pdfFilename = data.filename;
    transitionTo(State.PDF_READY);
    setupPDFReadyScreen();
  } catch (err) {
    showSpinner(false);
    alert('Failed to generate PDF: ' + err.message);
  }
}

function setupPDFReadyScreen() {
  document.getElementById('pdf-filename').textContent = pdfFilename;
  const dl = document.getElementById('btn-download');
  dl.href     = `/exports/${sessionId}`;
  dl.download = pdfFilename;
  document.getElementById('email-status').textContent = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// Email
// ═══════════════════════════════════════════════════════════════════════════

async function sendEmail() {
  const email = document.getElementById('field-email').value.trim();
  if (!email) { alert('Please enter a recipient email address.'); return; }

  const statusEl = document.getElementById('email-status');
  statusEl.style.color = 'var(--text-dim)';
  statusEl.textContent = 'Sending…';

  const formData = new FormData();
  formData.append('session_id',      sessionId);
  formData.append('recipient_email', email);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res  = await fetch('/send-email', { method: 'POST', body: formData, signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    statusEl.style.color = 'var(--success)';
    statusEl.textContent = 'Email sent successfully!';
  } catch (err) {
    clearTimeout(timer);
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = err.name === 'AbortError' ? 'Email timed out — check SMTP settings.' : 'Failed to send: ' + err.message;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Scan More — reset everything and go back to scanning
// ═══════════════════════════════════════════════════════════════════════════

function scanMore() {
  capturedPages = [];
  capturedThumbnails.forEach(url => URL.revokeObjectURL(url));
  capturedThumbnails = [];
  sessionId     = null;
  pdfFilename   = null;

  updatePageCount();
  updatePreview();
  document.getElementById('btn-retake').disabled = true;
  document.getElementById('btn-done').disabled   = true;
  document.getElementById('field-email').value   = '';
  document.getElementById('ocr-hint').classList.add('hidden');

  transitionTo(State.SCANNING);
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Wire up canvas pointer events
  const oc = document.getElementById('overlay-canvas');
  oc.addEventListener('touchstart',  onPointerDown, { passive: false });
  oc.addEventListener('touchmove',   onPointerMove, { passive: false });
  oc.addEventListener('touchend',    onPointerUp);
  oc.addEventListener('touchcancel', onPointerUp);
  oc.addEventListener('mousedown',   onPointerDown);
  oc.addEventListener('mousemove',   onPointerMove);
  oc.addEventListener('mouseup',     onPointerUp);

  // Landing screen
  document.getElementById('btn-start').addEventListener('click', () => {
    transitionTo(State.SCANNING);
    initCamera();
  });

  // Scanning screen buttons
  document.getElementById('btn-save').addEventListener('click',   capturePage);
  document.getElementById('btn-retake').addEventListener('click', retakePage);
  document.getElementById('btn-clear').addEventListener('click',  clearAllPages);
  document.getElementById('btn-done').addEventListener('click',   processDocument);

  // Preview thumbnail → open modal at last page
  document.getElementById('page-preview').addEventListener('click', () => {
    if (capturedThumbnails.length > 0) openModal(capturedThumbnails.length - 1);
  });

  // Modal controls
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-prev').addEventListener('click', () => {
    if (modalIndex > 0) { modalIndex--; refreshModal(); }
  });
  document.getElementById('modal-next').addEventListener('click', () => {
    if (modalIndex < capturedThumbnails.length - 1) { modalIndex++; refreshModal(); }
  });

  // Swipe to navigate inside modal
  const wrap = document.getElementById('modal-img-wrap');
  wrap.addEventListener('touchstart', e => { swipeStartX = e.touches[0].clientX; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    if (Math.abs(dx) > 50) {
      if (dx < 0 && modalIndex < capturedThumbnails.length - 1) { modalIndex++; refreshModal(); }
      else if (dx > 0 && modalIndex > 0)                         { modalIndex--; refreshModal(); }
    }
  }, { passive: true });

  // Reviewing screen buttons
  document.getElementById('btn-confirm').addEventListener('click',   confirmAndGeneratePDF);
  document.getElementById('btn-back-scan').addEventListener('click', () => transitionTo(State.SCANNING));

  // PDF ready screen buttons
  document.getElementById('btn-send-email').addEventListener('click', sendEmail);
  document.getElementById('btn-scan-more').addEventListener('click',  scanMore);

});
