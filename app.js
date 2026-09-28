import { findDocument, perspectiveCrop, renderFilter } from './cv-pipeline.js';

const $ = (selector) => document.querySelector(selector);
const camera = $('#camera');
const overlay = $('#overlay');
const preview = $('#preview');
const cameraButton = $('#cameraButton');
const captureButton = $('#captureButton');
const placeholder = $('#cameraPlaceholder');
const statusPill = $('#statusPill');
const workspace = $('#workspace');
const pageStrip = $('#pageStrip');
const pageCount = $('#pageCount');

const state = { stream: null, detecting: false, corners: null, pages: [], active: -1, filter: 'color', installPrompt: null };
const detectionCanvas = document.createElement('canvas');
let lastDetection = 0;
let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2400);
}

function cameraErrorMessage(error) {
  if (!globalThis.isSecureContext) return 'Camera access needs HTTPS (or localhost).';
  if (error?.name === 'NotAllowedError') return 'Camera permission was denied. You can still import a photo.';
  if (error?.name === 'NotFoundError') return 'No camera was found. You can still import a photo.';
  return 'Could not start the camera. Try importing a photo.';
}

async function startCamera() {
  if (state.stream) return stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    camera.srcObject = state.stream;
    await camera.play();
    placeholder.hidden = true;
    captureButton.disabled = false;
    cameraButton.textContent = 'Stop camera';
    statusPill.textContent = globalThis.cv?.Mat ? 'Looking for a page…' : 'Camera ready';
    state.detecting = true;
    requestAnimationFrame(detectLoop);
  } catch (error) {
    toast(cameraErrorMessage(error));
  }
}

function stopCamera() {
  state.detecting = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  camera.srcObject = null;
  placeholder.hidden = false;
  captureButton.disabled = true;
  cameraButton.textContent = 'Start camera';
  statusPill.textContent = 'Camera is off';
  clearOverlay();
}

function clearOverlay() { overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height); }

function drawCorners(points, scaleX, scaleY) {
  const context = overlay.getContext('2d');
  context.clearRect(0, 0, overlay.width, overlay.height);
  if (!points) return;
  context.beginPath();
  points.forEach((point, index) => {
    const x = point.x * scaleX;
    const y = point.y * scaleY;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.closePath();
  context.fillStyle = 'rgba(216, 255, 79, .12)';
  context.fill();
  context.strokeStyle = '#d8ff4f';
  context.lineWidth = 4;
  context.lineJoin = 'round';
  context.stroke();
}

function detectLoop(timestamp) {
  if (!state.detecting) return;
  requestAnimationFrame(detectLoop);
  if (timestamp - lastDetection < 140 || camera.readyState < 2) return;
  lastDetection = timestamp;
  const stage = $('#cameraStage').getBoundingClientRect();
  const videoRatio = camera.videoWidth / camera.videoHeight;
  const stageRatio = stage.width / stage.height;
  let sourceX = 0, sourceY = 0, sourceWidth = camera.videoWidth, sourceHeight = camera.videoHeight;
  if (videoRatio > stageRatio) {
    sourceWidth = camera.videoHeight * stageRatio;
    sourceX = (camera.videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = camera.videoWidth / stageRatio;
    sourceY = (camera.videoHeight - sourceHeight) / 2;
  }
  detectionCanvas.width = 320;
  detectionCanvas.height = Math.round(320 / stageRatio);
  detectionCanvas.getContext('2d').drawImage(camera, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, detectionCanvas.width, detectionCanvas.height);
  const points = findDocument(detectionCanvas);
  state.corners = points?.map(({ x, y }) => ({ x: sourceX + x * sourceWidth / detectionCanvas.width, y: sourceY + y * sourceHeight / detectionCanvas.height })) || null;
  overlay.width = Math.round(stage.width * devicePixelRatio);
  overlay.height = Math.round(stage.height * devicePixelRatio);
  drawCorners(points, overlay.width / detectionCanvas.width, overlay.height / detectionCanvas.height);
  statusPill.textContent = points ? 'Page detected' : (globalThis.cv?.Mat ? 'Looking for a page…' : 'Camera ready');
}

function canvasFromImage(image) {
  const canvas = document.createElement('canvas');
  const maxSide = 2800;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.videoWidth, image.naturalHeight || image.videoHeight));
  canvas.width = Math.round((image.naturalWidth || image.videoWidth) * scale);
  canvas.height = Math.round((image.naturalHeight || image.videoHeight) * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function addPage(source, corners = null) {
  let cropped;
  try { cropped = perspectiveCrop(source, corners); }
  catch (error) { console.warn(error); cropped = source; toast('Edge correction unavailable; using the original image.'); }
  state.pages.push({ source: cropped, filter: state.filter });
  state.active = state.pages.length - 1;
  workspace.hidden = false;
  renderActivePage();
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function capture() {
  if (!state.stream || camera.readyState < 2) return;
  const source = canvasFromImage(camera);
  const scaleX = source.width / camera.videoWidth;
  const scaleY = source.height / camera.videoHeight;
  const corners = state.corners?.map(({ x, y }) => ({ x: x * scaleX, y: y * scaleY }));
  addPage(source, corners);
}

function renderActivePage() {
  const page = state.pages[state.active];
  if (!page) { workspace.hidden = true; return; }
  state.filter = page.filter;
  renderFilter(page.source, preview, page.filter);
  document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === page.filter));
  pageCount.textContent = `${state.pages.length} ${state.pages.length === 1 ? 'page' : 'pages'}`;
  pageStrip.replaceChildren(...state.pages.map((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `page-thumb${index === state.active ? ' active' : ''}`;
    button.setAttribute('aria-label', `Show page ${index + 1}`);
    const thumb = document.createElement('canvas');
    renderFilter(item.source, thumb, item.filter);
    const image = new Image();
    image.src = thumb.toDataURL('image/jpeg', .6);
    const number = document.createElement('span');
    number.textContent = index + 1;
    button.append(image, number);
    button.addEventListener('click', () => { state.active = index; renderActivePage(); });
    return button;
  }));
}

function downloadCanvas(canvas, type, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return toast('Could not create the file.');
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, type, .94);
}

function exportPdf() {
  if (!state.pages.length) return;
  const JsPdf = globalThis.jspdf?.jsPDF;
  if (!JsPdf) return toast('PDF tools are still loading. Try again in a moment.');
  let pdf;
  state.pages.forEach((page, index) => {
    const canvas = document.createElement('canvas');
    renderFilter(page.source, canvas, page.filter);
    const landscape = canvas.width > canvas.height;
    const orientation = landscape ? 'l' : 'p';
    if (!pdf) pdf = new JsPdf({ orientation, unit: 'mm', format: 'a4', compress: true });
    else pdf.addPage('a4', orientation);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, undefined, 'FAST');
  });
  pdf.save(`scan-${new Date().toISOString().slice(0, 10)}.pdf`);
}

cameraButton.addEventListener('click', startCamera);
captureButton.addEventListener('click', capture);
$('#fileInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const image = new Image();
  image.onload = () => { addPage(canvasFromImage(image), findDocument(canvasFromImage(image))); URL.revokeObjectURL(image.src); };
  image.onerror = () => toast('That image could not be opened.');
  image.src = URL.createObjectURL(file);
  event.target.value = '';
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.pages[state.active].filter = button.dataset.filter;
  renderActivePage();
}));
$('#addPageButton').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); if (!state.stream) startCamera(); });
$('#deleteButton').addEventListener('click', () => { state.pages.splice(state.active, 1); state.active = Math.min(state.active, state.pages.length - 1); renderActivePage(); });
$('#jpgButton').addEventListener('click', () => downloadCanvas(preview, 'image/jpeg', `scan-page-${state.active + 1}.jpg`));
$('#pngButton').addEventListener('click', () => downloadCanvas(preview, 'image/png', `scan-page-${state.active + 1}.png`));
$('#pdfButton').addEventListener('click', exportPdf);
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; $('#installButton').hidden = false; });
$('#installButton').addEventListener('click', async () => { await state.installPrompt?.prompt(); state.installPrompt = null; $('#installButton').hidden = true; });
window.addEventListener('pagehide', stopCamera);

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.warn));
