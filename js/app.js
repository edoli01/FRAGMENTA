import { forceSimulation, forceX, forceY, forceCollide } from "https://cdn.jsdelivr.net/npm/d3-force@3/+esm";

/* ── DOM refs ── */
const canvas   = document.getElementById("view");
const ctx      = canvas.getContext("2d", { alpha: false });
const panel    = document.getElementById("panel");
const tooltip  = document.getElementById("tooltip");
const btnClose  = document.getElementById("btnClose");
const btnTheme  = document.getElementById("btnTheme");
const btnReset  = document.getElementById("btnReset");
const btnMode   = document.getElementById("btnMode");
const modeLabel = document.getElementById("modeLabel");
const pTitle    = document.getElementById("pTitle");
const pMeta     = document.getElementById("pMeta");
const pStats    = document.getElementById("pStats");
const pGallerySection = document.getElementById("pGallerySection");
const pNeighbors      = document.getElementById("pNeighbors");
const pGallery        = document.getElementById("pGallery");

/* Lightbox refs */
const lightbox      = document.getElementById("lightbox");
const lbClose       = document.getElementById("lbClose");
const lbPrev        = document.getElementById("lbPrev");
const lbNext        = document.getElementById("lbNext");
const lbImg         = document.getElementById("lbImg");
const lbPdf         = document.getElementById("lbPdf");
const lbPdfFallback = document.getElementById("lbPdfFallback");
const lbPdfTitle    = document.getElementById("lbPdfTitle");
const lbPdfLink     = document.getElementById("lbPdfLink");
const lbDesc        = document.getElementById("lbDesc");
const lbSource      = document.getElementById("lbSource");
const lbCiteBtn     = document.getElementById("lbCiteBtn");
const citationModal = document.getElementById("citationModal");
const citationClose = document.getElementById("citationClose");
const citationText  = document.getElementById("citationText");
const citationBackdrop = citationModal.querySelector(".citation-modal-backdrop");

const CFTI_CITATION =
  "Guidoboni E., Ferrari G., Mariotti D., Comastri A., Tarabusi G.,\n" +
  "Sgattoni G., Valensise G. (2018) - CFTI5Med, Catalogo dei Forti\n" +
  "Terremoti in Italia (461 a.C.-1997) e nell'area Mediterranea\n" +
  "(760 a.C.-1500). Istituto Nazionale di Geofisica e Vulcanologia\n" +
  "(INGV). doi: https://doi.org/10.6092/ingv.it-cfti5";

function openCitationModal() {
  citationText.textContent = CFTI_CITATION;
  citationModal.setAttribute("aria-hidden", "false");
}
function closeCitationModal() {
  citationModal.setAttribute("aria-hidden", "true");
}
lbCiteBtn.addEventListener("click", openCitationModal);
citationClose.addEventListener("click", closeCitationModal);
citationBackdrop.addEventListener("click", closeCitationModal);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && citationModal.getAttribute("aria-hidden") === "false") {
    closeCitationModal();
  }
});
const lbBackdrop    = lightbox.querySelector(".lightbox-backdrop");

let lbItems = [];
let lbIndex = 0;

/* ── State ── */
let W = 1, H = 1, DPR = 1;
const cam = { x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1 }; // t* = target for smooth zoom
let nodes = [], edges = [], edgesByNode = new Map();
let selectedId = null;
let hoveredId  = null;
let mode = "geo";   // "geo" | "time"
const MAX_LINKS = 12;
const imgCache  = new Map();

/* ── Helpers ── */
const css = name => getComputedStyle(document.body).getPropertyValue(name).trim();

function yearLabel(y) {
  return y < 0 ? `${Math.abs(y)} a.C.` : String(y);
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t)  { return a + (b - a) * t; }

function worldToScreen(wx, wy) {
  return { x: wx * cam.k + cam.x, y: wy * cam.k + cam.y };
}
function screenToWorld(sx, sy) {
  return { x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k };
}

/* Node radius in world units — so nodes scale with zoom */
function nodeRadius(n) {
  const mag = n.mag ?? 5.0;
  // base world size: larger so they're visible at default zoom
  return (18 + (mag - 5.0) * 22) / cam.k;
}
/* Node half-size in screen px (for image drawing) */
function nodeScreenR(n) {
  return nodeRadius(n) * cam.k;
}

/* ── Resize ── */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.parentElement.clientWidth;
  H = canvas.parentElement.clientHeight;
  canvas.width  = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", () => { resize(); resetCamera(false); }, { passive: true });

/* ── Layout ── */
const GEO = { x0: -1200, x1: 1200, y0: -1300, y1: 1300 };
// TIME world is wider (linear timeline with more room)
const TIME_X0 = -8000;
const TIME_X1 =  8000;

function computePositions() {
  const years = nodes.map(n => n.year);
  const minYr = Math.min(...years), maxYr = Math.max(...years);

  const allLat = nodes.map(n => n.lat ?? 0);
  const allLon = nodes.map(n => n.lon ?? 0);
  const minLat = Math.min(...allLat), maxLat = Math.max(...allLat);
  const minLon = Math.min(...allLon), maxLon = Math.max(...allLon);

  // Magnitude range for TIME Y axis
  const mags = nodes.map(n => (n.mag ?? 5.0));
  const minMag = Math.min(...mags), maxMag = Math.max(...mags);

  for (const n of nodes) {
    // GEO mode: lon → x, lat → y (north up)
    const gx = GEO.x0 + ((n.lon - minLon) / (maxLon - minLon || 1)) * (GEO.x1 - GEO.x0);
    const gy = GEO.y1 - ((n.lat - minLat) / (maxLat - minLat || 1)) * (GEO.y1 - GEO.y0);
    n.gx = gx; n.gy = gy;

    // TIME mode (LINEAR): year → x, magnitude → y
    const tx = TIME_X0 + ((n.year - minYr) / (maxYr - minYr || 1)) * (TIME_X1 - TIME_X0);
    const ty = GEO.y1 - (((n.mag ?? 5.0) - minMag) / (maxMag - minMag || 1)) * (GEO.y1 - GEO.y0);
    n.tx = tx; n.ty = ty;

    n.x = gx; n.y = gy;
    n.vx = 0; n.vy = 0;
  }

  // Separate overlapping nodes in TIME mode with force
  runForce("time");
  // Store time positions
  for (const n of nodes) { n.txf = n.x; n.tyf = n.y; }

  // Restore geo positions
  for (const n of nodes) { n.x = n.gx; n.y = n.gy; }
}

function runForce(modeKey) {
  const getX = modeKey === "time" ? d => d.tx : d => d.gx;
  const getY = modeKey === "time" ? d => d.ty : d => d.gy;

  const sim = forceSimulation(nodes)
    .alpha(1).alphaDecay(0.05).velocityDecay(0.4)
    .force("x", forceX(getX).strength(0.3))
    .force("y", forceY(getY).strength(0.3))
    .force("collide", forceCollide(d => nodeRadius(d) * 1.1 + 2).iterations(3))
    .stop();

  for (let i = 0; i < 120; i++) sim.tick();
}

/* Interpolate node positions between modes */
let morphT = 1.0;   // 0=time, 1=geo
let morphTarget = 1.0;
let morphing = false;

function currentPos(n) {
  const t = morphT;
  return {
    x: lerp(n.txf ?? n.tx, n.gx, t),
    y: lerp(n.tyf ?? n.ty, n.gy, t),
  };
}

/* ── Camera ── */
function resetCamera(animate = true) {
  const margin = 80;

  // GEO bbox
  const dxGeo = GEO.x1 - GEO.x0;
  const dyGeo = GEO.y1 - GEO.y0;

  // TIME bbox (wider X, same Y range as GEO)
  const dxTime = TIME_X1 - TIME_X0;
  const dyTime = dyGeo;

  let k, cx, cy;

  if (mode === "time") {
    // Fit ONLY vertically in TIME (keep linear timeline in-scale; X can overflow)
    k = ((H - margin * 2) / dyTime) * 0.9;

    // Center the TIME world by default
    const midX = (TIME_X0 + TIME_X1) / 2;
    cx = W / 2 - midX * k;
    cy = H / 2 - ((GEO.y0 + GEO.y1) / 2) * k;
  } else {
    // GEO: full fit
    k = Math.min((W - margin * 2) / dxGeo, (H - margin * 2) / dyGeo) * 0.9;
    cx = W / 2 - ((GEO.x0 + GEO.x1) / 2) * k;
    cy = H / 2 - ((GEO.y0 + GEO.y1) / 2) * k;
  }

  cam.tx = cx; cam.ty = cy; cam.tk = k;
  if (!animate) { cam.x = cx; cam.y = cy; cam.k = k; }
}

function centerOnNode(n) {
  const p = currentPos(n);
  cam.tx = W * 0.38 - p.x * cam.k;
  cam.ty = H * 0.50 - p.y * cam.k;
}

/* ── Interaction ── */
let isPanning = false, panStart = {};
let clickStart = null;
let mouseScreen = { x: -999, y: -999 };

canvas.addEventListener("pointerdown", e => {
  isPanning = true;
  canvas.setPointerCapture(e.pointerId);
  panStart = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
  clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
}, { passive: true });

canvas.addEventListener("pointermove", e => {
  mouseScreen = { x: e.clientX, y: e.clientY - 56 }; // 56 = topbar height
  if (isPanning) {
    cam.tx = panStart.cx + (e.clientX - panStart.x);
    cam.ty = panStart.cy + (e.clientY - 56 - panStart.y);
    cam.x  = cam.tx;
    cam.y  = cam.ty;
  }
}, { passive: true });

canvas.addEventListener("pointerup", e => {
  isPanning = false;
  if (!clickStart) return;
  const dist = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
  const dt   = performance.now() - clickStart.t;
  clickStart = null;
  if (dist > 6 || dt > 500) return;

  const hit = pickNode(e.clientX, e.clientY - 56);
  if (hit) selectNode(hit);
  else { selectedId = null; closePanel(); }
}, { passive: true });

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const zoom = Math.exp(-e.deltaY * 0.0012);
  // Always pivot on current rendered camera, not target — this prevents drift
  const k0 = cam.k;
  const k1 = clamp(k0 * zoom, 0.12, 5.0);
  const mx = e.clientX, my = e.clientY - 56;
  // world point under cursor at current render position
  const wx = (mx - cam.x) / k0;
  const wy = (my - cam.y) / k0;
  // update both target and current so zoom is instant + accurate
  cam.k  = k1; cam.tk = k1;
  cam.x  = mx - wx * k1; cam.tx = cam.x;
  cam.y  = my - wy * k1; cam.ty = cam.y;
}, { passive: false });

/* hover detection */
canvas.addEventListener("mousemove", e => {
  const sy = e.clientY - 56;
  const hit = pickNode(e.clientX, sy);
  const newHov = hit ? hit.id : null;
  if (newHov !== hoveredId) {
    hoveredId = newHov;
    canvas.classList.toggle("hovering", !!hoveredId);
  }
  // update tooltip
  if (hit) {
    showTooltip(hit, e.clientX, sy);
  } else {
    hideTooltip();
  }
});
canvas.addEventListener("mouseleave", () => { hideTooltip(); hoveredId = null; });

function pickNode(sx, sy) {
  const w = screenToWorld(sx, sy);
  let best = null, bestD = 1e9;
  for (const n of nodes) {
    const p = currentPos(n);
    const r = nodeRadius(n) + 6 / cam.k; // nodeRadius is already in world units
    const d = Math.hypot(p.x - w.x, p.y - w.y);
    if (d < r && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

function showTooltip(n, sx, sy) {
  tooltip.innerHTML = `<strong>${n.place || "Evento " + n.id}</strong>${yearLabel(n.year)} &nbsp;·&nbsp; M ${n.mag ?? "—"} &nbsp;·&nbsp; ${n.locality_count ?? 0} loc.`;
  tooltip.style.left = sx + "px";
  tooltip.style.top  = (sy + 56) + "px";
  tooltip.classList.add("visible");
  tooltip.removeAttribute("aria-hidden");
}
function hideTooltip() {
  tooltip.classList.remove("visible");
  tooltip.setAttribute("aria-hidden", "true");
}

function selectNode(n) {
  selectedId = n.id;
  centerOnNode(n);
  openPanel(n);
}

function openPanel(n) {
  panel.setAttribute("aria-hidden", "false");
  pTitle.textContent = n.place || `Evento ${n.id}`;
  pMeta.innerHTML = `${yearLabel(n.year)} &nbsp;·&nbsp; lat ${n.lat?.toFixed(2)}, lon ${n.lon?.toFixed(2)}`;

  // stats
  const neigh = edgesByNode.get(n.id) || [];
  const maxW  = neigh.length ? Math.max(...neigh.map(x => x.w)) : 0;
  pStats.innerHTML = `
    <div class="p-stat"><span class="p-stat-val">${n.mag ?? "—"}</span><span class="p-stat-lbl">Magnitudo</span></div>
    <div class="p-stat"><span class="p-stat-val">${n.locality_count ?? 0}</span><span class="p-stat-lbl">Località</span></div>
    <div class="p-stat"><span class="p-stat-val">${neigh.length}</span><span class="p-stat-lbl">Connessioni</span></div>
  `;

  // links
  // gallery
  buildGallery(n);

  // neighbors
  pNeighbors.innerHTML = "";
  if (!neigh.length) {
    pNeighbors.innerHTML = `<div style="font-size:12px;color:var(--fg);padding:10px 0">Nessuna connessione sopra soglia.</div>`;
  } else {
    for (const it of neigh) {
      const nb = nodes.find(x => x.id === it.id);
      const row = document.createElement("div");
      row.className = "p-item";
      row.innerHTML = `
        <span class="p-item-id">${yearLabel(nb?.year ?? "?")} · ${nb?.place ?? it.id}</span>
        <span class="p-item-weight">${it.w}</span>
      `;
      row.title = `Evento ${it.id} — ${it.w} località in comune`;
      row.addEventListener("click", () => {
        const nn = nodes.find(x => x.id === it.id);
        if (nn) selectNode(nn);
      });
      pNeighbors.appendChild(row);
    }
  }
}

function buildGallery(n) {
  pGallery.innerHTML = "";

  // Separate images from PDFs
  const imageItems = [];
  const pdfUrls = n.pdf_r_urls && n.pdf_r_urls.length ? n.pdf_r_urls
                  : (n.pdf_r_url ? [n.pdf_r_url] : []);

  if (n.assets && n.assets.length) {
    for (const a of n.assets) {
      if (a.type === "pdf") {
        // asset PDFs go into pdfUrls if not already there
        if (!pdfUrls.includes(a.path)) pdfUrls.push(a.path);
      } else {
        imageItems.push({ ...a, kind: "image" });
      }
    }
  }

  // Build lightbox items: images first, then all PDFs
  const allPdfItems = pdfUrls.map((url, i) => ({
    kind: "pdf",
    path: url,
    title: "PDF_R · " + url.split("/").pop().replace("_R.pdf", ""),
    description: "Rapporto macrosismico PDF_R dell'evento.",
    source: "INGV – CFTI",
    pdfIndex: i,
    pdfTotal: pdfUrls.length
  }));

  const allItems = [...imageItems, ...allPdfItems];

  if (!allItems.length) {
    pGallerySection.style.display = "none";
    return;
  }

  pGallerySection.style.display = "";

  // Render image tiles (one per image)
  imageItems.forEach((item, idx) => {
    const tile = document.createElement("div");
    tile.className = "p-gallery-item";
    tile.innerHTML = `
      <img src="${item.path}" alt="${item.title || ''}" loading="lazy" />
      <div class="p-gallery-overlay"><span class="p-gallery-overlay-icon">⊕</span></div>
    `;
    tile.addEventListener("click", () => openLightbox(allItems, idx));
    pGallery.appendChild(tile);
  });

  // Render a SINGLE PDF tile (with count badge if > 1)
  if (allPdfItems.length) {
    const firstPdfIdx = imageItems.length; // index in allItems
    const tile = document.createElement("div");
    tile.className = "p-gallery-pdf";
    tile.innerHTML = `
      <span class="p-gallery-pdf-icon">
        PDF
        ${allPdfItems.length > 1 ? `<span class="p-gallery-pdf-badge">${allPdfItems.length}</span>` : ""}
      </span>
      <span class="p-gallery-pdf-label">PDF_R</span>
    `;
    tile.title = allPdfItems.length > 1
      ? `${allPdfItems.length} rapporti PDF_R`
      : allPdfItems[0].title;
    tile.addEventListener("click", () => openLightbox(allItems, firstPdfIdx));
    pGallery.appendChild(tile);
  }
}

/* ── PDF.js setup ── */
let pdfjsLib = null;
let pdfJsLoaded = false;
let pdfJsLoading = false;
const pdfJsCallbacks = [];

function loadPdfJs(cb) {
  if (pdfJsLoaded) { cb(pdfjsLib); return; }
  pdfJsCallbacks.push(cb);
  if (pdfJsLoading) return;
  pdfJsLoading = true;
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  script.onload = () => {
    pdfjsLib = window["pdfjs-dist/build/pdf"];
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfJsLoaded = true;
    pdfJsCallbacks.forEach(fn => fn(pdfjsLib));
    pdfJsCallbacks.length = 0;
  };
  document.head.appendChild(script);
}

/* ── Lightbox ── */
function openLightbox(items, index) {
  lbItems = items;
  lbIndex = index;
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderLbItem();
}

function closeLightbox() {
  lightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  lbImg.src = "";
  // Clear PDF canvas
  const oldCanvas = lbPdf.querySelector(".lb-pdf-canvas");
  if (oldCanvas) oldCanvas.remove();
  lbPdf.style.display = "none";
  lbPdfFallback.style.display = "none";
}

function renderLbItem() {
  const item = lbItems[lbIndex];
  if (!item) return;

  lbPrev.classList.toggle("hidden", lbIndex === 0);
  lbNext.classList.toggle("hidden", lbIndex === lbItems.length - 1);

  // reset
  lbImg.style.display = "none";
  lbPdf.style.display = "none";
  lbPdfFallback.style.display = "none";

  // Description (scrollable via CSS)
  lbDesc.textContent = item.description || "";

  if (item.kind === "pdf") {
    const counter = (item.pdfTotal > 1) ? ` · doc. ${item.pdfIndex + 1}/${item.pdfTotal}` : "";
    lbSource.textContent = (item.source || "INGV – CFTI") + counter;
    lbSource.removeAttribute("data-citation");
    lbCiteBtn.style.display = "flex";
  } else {
    const parts = [item.author, item.rights].filter(Boolean);
    lbSource.textContent = parts.join(" · ") || (item.source || "");
    lbSource.removeAttribute("data-citation");
    lbCiteBtn.style.display = "none";
  }

  if (item.kind === "pdf") {
    lbPdfTitle.textContent = item.title || "PDF";
    lbPdfLink.href = item.path;

    // Show PDF viewer container with loading state
    lbPdf.style.display = "flex";
    lbPdf.innerHTML = `<div class="lb-pdf-loading">Caricamento PDF…</div>`;

    loadPdfJs(lib => renderPdfWithJs(lib, item.path));
  } else {
    lbImg.classList.add("loading");
    lbImg.style.display = "block";
    lbImg.src = "";
    lbImg.alt = item.title || "";
    lbImg.onload = () => lbImg.classList.remove("loading");
    lbImg.onerror = () => { lbImg.classList.remove("loading"); };
    lbImg.src = item.path;
  }
}

/* ── CORS Proxy ──────────────────────────────────────────────────────────────
 * I PDF INGV bloccano fetch() cross-origin (no CORS headers).
 * Se il proxy locale è attivo (proxy.js su porta 3131), lo usiamo
 * per tunnellare la richiesta. Se non è attivo, cade nel fallback "Apri ↗".
 * ────────────────────────────────────────────────────────────────────────── */
const PROXY_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3131/proxy?url="
  : "/proxy?url=";
let proxyAvailable = null; // null=unknown, true/false dopo il check

async function checkProxy() {
  if (proxyAvailable !== null) return proxyAvailable;
  try {
    const healthUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3131/health"
      : "/proxy?url=health-check"; // su Netlify il proxy è sempre disponibile
    // Su Netlify consideriamo il proxy sempre attivo
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      proxyAvailable = true;
      return true;
    }
    const r = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    proxyAvailable = r.ok;
  } catch {
    proxyAvailable = false;
  }
  return proxyAvailable;
}

function proxyUrl(url) {
  return PROXY_BASE + encodeURIComponent(url);
}

async function renderPdfWithJs(lib, url) {
  // Check if proxy is available; use it for INGV URLs
  const isIngv = url.includes("storing.ingv.it");
  const hasProxy = isIngv ? await checkProxy() : false;
  const fetchUrl = (isIngv && hasProxy) ? proxyUrl(url) : url;

  try {
    const loadingTask = lib.getDocument({ url: fetchUrl, withCredentials: false });
    const pdf = await loadingTask.promise;

    // Render first page
    const page = await pdf.getPage(1);
    const containerW = lbPdf.clientWidth || 800;
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(1.8, (containerW / unscaled.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.className = "lb-pdf-canvas";
    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    lbPdf.innerHTML = "";
    lbPdf.appendChild(canvas);

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    // Footer: pagine + link apri completo
    const footer = document.createElement("div");
    footer.className = "lb-pdf-pages";
    footer.innerHTML = `Pagina 1 di ${pdf.numPages} &nbsp;·&nbsp; <a href="${url}" target="_blank" rel="noreferrer" class="lb-pdf-open-inline">Apri completo ↗</a>`;
    lbPdf.appendChild(footer);

  } catch (err) {
    console.warn("PDF.js render failed:", err);
    lbPdf.style.display = "none";
    lbPdfFallback.style.display = "flex";
  }
}

lbClose.addEventListener("click", closeLightbox);
lbBackdrop.addEventListener("click", closeLightbox);
lbPrev.addEventListener("click", () => { if (lbIndex > 0) { lbIndex--; renderLbItem(); } });
lbNext.addEventListener("click", () => { if (lbIndex < lbItems.length - 1) { lbIndex++; renderLbItem(); } });

document.addEventListener("keydown", e => {
  if (lightbox.getAttribute("aria-hidden") === "true") return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft")  { if (lbIndex > 0) { lbIndex--; renderLbItem(); } }
  if (e.key === "ArrowRight") { if (lbIndex < lbItems.length - 1) { lbIndex++; renderLbItem(); } }
});

function closePanel() {
  panel.setAttribute("aria-hidden", "true");
  selectedId = null;
}

/* ── Mode toggle ── */
btnMode.addEventListener("click", () => {
  mode = mode === "geo" ? "time" : "geo";
  morphTarget = mode === "geo" ? 1.0 : 0.0;
  morphing = true;
  modeLabel.textContent = mode === "geo" ? "GEO" : "TIME";
  document.body.setAttribute("data-mode", mode);
  resetCamera(true);
});

btnTheme.addEventListener("click", () => {
  const cur = document.body.getAttribute("data-theme") || "dark";
  document.body.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
});

btnReset.addEventListener("click", () => {
  closePanel();
  resetCamera(true);
});

btnClose.addEventListener("click", closePanel);

/* ── Load ── */
async function load() {
  const res = await fetch("./network.json");
  const net = await res.json();
  nodes = net.nodes.map(d => ({ ...d }));
  edges = net.edges.map(e => ({ ...e }));

  // adjacency
  edgesByNode = new Map();
  for (const n of nodes) edgesByNode.set(n.id, []);
  for (const e of edges) {
    edgesByNode.get(e.source)?.push({ id: e.target, w: e.weight });
    edgesByNode.get(e.target)?.push({ id: e.source, w: e.weight });
  }
  for (const [id, lst] of edgesByNode) {
    lst.sort((a, b) => b.w - a.w);
    edgesByNode.set(id, lst.slice(0, MAX_LINKS));
  }

  resize();
  computePositions();
  resetCamera(false);
  requestAnimationFrame(loop);
}

/* ── Images ── */
function getThumb(n) {
  if (!n.image_path) return null;
  const src = `./${n.image_path}`;
  if (imgCache.has(src)) return imgCache.get(src);
  const img = new Image();
  img.src = src;
  imgCache.set(src, img);
  return img;
}

/* ── Render loop ── */
let lastT = 0;
function loop(ts) {
  const dt = Math.min(ts - lastT, 32) / 1000;
  lastT = ts;

  // smooth camera
  const ck = 0.10;
  cam.x = lerp(cam.x, cam.tx, ck + 0.05);
  cam.y = lerp(cam.y, cam.ty, ck + 0.05);
  cam.k = lerp(cam.k, cam.tk, ck);

  // morph
  if (morphing) {
    morphT = lerp(morphT, morphTarget, 0.07);
    if (Math.abs(morphT - morphTarget) < 0.001) { morphT = morphTarget; morphing = false; }
  }

  draw();
  requestAnimationFrame(loop);
}

function draw() {
  // background
  ctx.fillStyle = css("--bg");
  ctx.fillRect(0, 0, W, H);

  const fgMid   = css("--fg-mid");
  const lineCol  = css("--line");
  const selLine  = css("--line-sel");
  const nodeIdle = css("--node-idle");
  const nodeSel  = css("--node-sel");
  const nodeFade = css("--node-faded");
  const accent   = css("--accent");
  const fgStr    = css("--fg-strong");

  // axis grid (very faint)
  drawGrid(lineCol);

  // edges for selected node
  if (selectedId != null) {
    const from = nodes.find(n => n.id === selectedId);
    if (from) {
      const neigh = edgesByNode.get(selectedId) || [];
      const a = currentPos(from);
      const sa = worldToScreen(a.x, a.y);

      for (const it of neigh) {
        const to = nodes.find(n => n.id === it.id);
        if (!to) continue;
        const b = currentPos(to);
        const sb = worldToScreen(b.x, b.y);

        const alpha = clamp(0.15 + (it.w / 50) * 0.6, 0.15, 0.75);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = selLine;
        ctx.lineWidth = clamp(0.5 + it.w * 0.04, 0.5, 3);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // nodes (back pass: faded)
  if (selectedId != null) {
    for (const n of nodes) {
      if (n.id === selectedId) continue;
      const isNeigh = edgesByNode.get(selectedId)?.some(x => x.id === n.id);
      if (!isNeigh) drawNode(n, "faded", nodeFade, fgStr);
    }
    // neighbor nodes
    const neigh = edgesByNode.get(selectedId) || [];
    for (const it of neigh) {
      const n = nodes.find(x => x.id === it.id);
      if (n) drawNode(n, "neighbor", nodeIdle, fgStr);
    }
    // selected node on top
    const sel = nodes.find(n => n.id === selectedId);
    if (sel) drawNode(sel, "selected", nodeSel, fgStr);
  } else {
    for (const n of nodes) {
      const state = n.id === hoveredId ? "hovered" : "idle";
      drawNode(n, state, nodeIdle, fgStr);
    }
  }

  // axis labels overlay
  drawAxisLabels(fgMid, fgStr, accent);
}

function drawNode(n, state, baseColor, fgStr) {
  const p = currentPos(n);
  const s = worldToScreen(p.x, p.y);
  const r = nodeScreenR(n);  // screen px, scales with zoom

  // cull
  if (s.x < -r - 4 || s.x > W + r + 4 || s.y < -r - 4 || s.y > H + r + 4) return;

  const isSelected = state === "selected";
  const isFaded    = state === "faded";
  const isHovered  = state === "hovered";

  // square bounds
  const x = s.x - r, y = s.y - r, d = r * 2;

  ctx.save();
  ctx.globalAlpha = isFaded ? 0.15 : 1.0;

  // glow for selected
  if (isSelected) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4);
    grd.addColorStop(0, baseColor + "88");
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.fillRect(s.x - r * 4, s.y - r * 4, r * 8, r * 8);
    ctx.restore();
  }

  // clip to square
  ctx.beginPath();
  ctx.rect(x, y, d, d);
  ctx.clip();

  // image or color fill
  const img = getThumb(n);
  if (img && img.complete && img.naturalWidth > 0 && !isFaded) {
    // cover-fit image into square
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(d / iw, d / ih);
    const sw = iw * scale, sh = ih * scale;
    ctx.drawImage(img, s.x - sw / 2, s.y - sh / 2, sw, sh);
  } else {
    ctx.fillStyle = isSelected ? baseColor : (isHovered ? css("--fg-mid") : baseColor);
    ctx.fillRect(x, y, d, d);
  }

  ctx.restore();

  // stroke (outside clip)
  ctx.save();
  ctx.globalAlpha = isFaded ? 0.15 : 1.0;
  ctx.strokeStyle = isSelected ? baseColor : (isHovered ? css("--fg-strong") : "rgba(255,255,255,0.15)");
  ctx.lineWidth = isSelected ? 1.5 : (isHovered ? 1 : 0.5);
  ctx.strokeRect(x, y, d, d);
  ctx.restore();
}

function drawGrid(lineCol) {
  ctx.save();
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.35;

  // horizontal line (equator-ish)
  const midY = (GEO.y0 + GEO.y1) / 2;
  const sy0 = worldToScreen(GEO.x0, midY);
  const sy1 = worldToScreen(GEO.x1, midY);
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(Math.max(0, sy0.x), sy0.y);
  ctx.lineTo(Math.min(W, sy1.x), sy1.y);
  ctx.stroke();

  ctx.restore();
}

function drawAxisLabels(fgMid, fgStr, accent) {
  // No axes in GEO
  if (mode !== "time") return;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = fgStr;
  ctx.font = `10px 'JetBrains Mono', monospace`;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";

  // X axis — years (TIME only)
  const years = [-436, 0, 500, 1000, 1500, 1700, 1900, 1997];
  const allYears = nodes.map(n => n.year);
  const minYr = Math.min(...allYears), maxYr = Math.max(...allYears);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const yr of years) {
    const t = (yr - minYr) / (maxYr - minYr || 1);
    const wx = TIME_X0 + t * (TIME_X1 - TIME_X0);
    const s = worldToScreen(wx, GEO.y1);
    if (s.x < 30 || s.x > W - 30) continue;
    const label = yearLabel(yr);
    ctx.strokeText(label, s.x, H - 20);
    ctx.fillText(label, s.x, H - 20);
  }

  // Y axis — Magnitude ticks (TIME only)
  const mags = nodes.map(n => (n.mag ?? 5.0));
  const minMag = Math.min(...mags), maxMag = Math.max(...mags);

  const tickCount = 4;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let i = 0; i < tickCount; i++) {
    const tt = i / (tickCount - 1); // 0..1
    const mag = (minMag + (maxMag - minMag) * (1 - tt)); // top = maxMag
    const wy  = GEO.y0 + (GEO.y1 - GEO.y0) * tt;
    const s   = worldToScreen(GEO.x0, wy);
    if (s.y < 12 || s.y > H - 12) continue;

    // tick
    ctx.save();
    ctx.strokeStyle = fgStr;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(10, s.y);
    ctx.lineTo(22, s.y);
    ctx.stroke();
    ctx.restore();

    const label = `M ${mag.toFixed(1)}`;
    ctx.strokeText(label, 28, s.y);
    ctx.fillText(label, 28, s.y);
  }

  ctx.restore();
}

load();
