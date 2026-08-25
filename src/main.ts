import './styles.css';
import type { DetectionResult, FilterName, Point, ScanDocument, ScanMode, ScanPage, Screen } from './types';
import { DEFAULT_ADJUSTMENTS, FILTER_LABELS } from './types';
import { CameraController } from './lib/camera';
import { detectDocumentCorners } from './lib/geometry';
import { estimateSharpness, processDocument, rotateBlob } from './lib/image-processing';
import { detectDocumentCornersOpenCv } from './lib/opencv-detector';
import { createPdf } from './lib/pdf';
import { recognizePages } from './lib/ocr';
import { deleteDocument, estimateStorage, listDocuments, saveDocument } from './lib/storage';
import { blobToCanvas, canvasToBlob, escapeHtml, formatBytes, formatDate, sanitizeName, uid, vibrate } from './lib/utils';

interface ReviewState { original: Blob; corners: Point[]; autoCorners: Point[] | null; detection: DetectionResult | null; }
interface AppState {
  screen: Screen;
  documents: ScanDocument[];
  draft: ScanDocument | null;
  review: ReviewState | null;
  selectedPage: number;
  selectedFilter: FilterName;
  mode: ScanMode;
  query: string;
  message: string;
  busy: boolean;
  busyLabel: string;
  onboarding: boolean;
  importQueue: File[];
  ocrLanguage: 'spa' | 'eng' | 'por';
  ocrProgress: number;
  ocrLabel: string;
  torch: boolean;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const camera = new CameraController();
const state: AppState = {
  screen: 'home', documents: [], draft: null, review: null, selectedPage: 0, selectedFilter: 'auto', mode: 'document', query: '', message: '', busy: false, busyLabel: '', onboarding: localStorage.getItem('folio-onboarding') !== 'done', importQueue: [], ocrLanguage: 'spa', ocrProgress: 0, ocrLabel: '', torch: false,
};
let reviewUrl = '';
let editorPreviewUrl = '';
let draggedCorner = -1;
let draggedPage = -1;
const MIN_DETECTION_CONFIDENCE = 0.45;
let cameraLoop = 0;
let cameraDetectionRunning = false;
let cameraStableFrames = 0;
let cameraDetection: DetectionResult | null = null;
const objectUrls: string[] = [];

function icon(name: string, size = 20): string {
  const paths: Record<string, string> = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
    settings: '<path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z"/><path d="m19 13 .1-1-.1-1 2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.5 3h-5L9 6a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L4.8 10l-.1 1 .1 1-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.5 3h5l.5-3a8 8 0 0 0 1.8-1l2.4 1 2-3.4z"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    flash: '<path d="m13 2-8 11h6l-1 9 8-12h-6z"/>',
    auto: '<path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.4 6.4l2.1 2.1M15.5 15.5l2.1 2.1M17.6 6.4l-2.1 2.1M8.5 15.5l-2.1 2.1"/><circle cx="12" cy="12" r="3.5"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    rotate: '<path d="M4 12a8 8 0 0 1 13.4-5.8L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.4 5.8L4 15M4 20v-5h5"/>',
    trash: '<path d="M5 7h14M10 11v5M14 11v5M8 7l1-3h6l1 3 1 13H7z"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 15H4V4h11v1"/>',
    text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.file}</svg>`;
}

function button(label: string, action: string, options: { icon?: string; kind?: string; disabled?: boolean; className?: string } = {}): string {
  return `<button class="button ${options.kind ?? 'secondary'} ${options.className ?? ''}" data-action="${action}" ${options.disabled ? 'disabled' : ''}>${options.icon ? icon(options.icon, 18) : ''}<span>${label}</span></button>`;
}

function setMessage(message: string): void { state.message = message; render(); }

function render(): void {
  objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  app.innerHTML = `<div class="app-shell" data-screen="${state.screen}">${renderScreen()}${renderToast()}${state.onboarding ? renderOnboarding() : ''}</div>`;
  if (state.screen === 'camera') void startCameraView();
  if (state.screen === 'review') void setupReview();
  if (state.screen === 'editor') void setupEditorPreview();
  bindImageInputs();
}

function renderToast(): string { return state.message ? `<div class="toast" role="status">${escapeHtml(state.message)}</div>` : ''; }

function renderHeader(title: string, backAction = 'home'): string {
  return `<header class="topbar"><button class="icon-button" data-action="${backAction}" aria-label="Volver">${icon('back')}</button><div><p class="eyebrow">FOLIO</p><h1>${escapeHtml(title)}</h1></div><div class="topbar-actions">${button('Ajustes', 'settings', { icon: 'settings', className: 'compact' })}</div></header>`;
}

function renderScreen(): string {
  if (state.screen === 'camera') return renderCamera();
  if (state.screen === 'review') return renderReview();
  if (state.screen === 'editor') return renderEditor();
  if (state.screen === 'ocr') return renderOcr();
  if (state.screen === 'export') return renderExport();
  if (state.screen === 'settings') return renderSettings();
  return renderHome();
}

function renderHome(): string {
  const filtered = state.documents.filter((document) => `${document.name} ${document.pages.map((page) => page.ocrText ?? '').join(' ')}`.toLowerCase().includes(state.query.toLowerCase()));
  return `<main class="home page-content">
    <header class="home-header"><div><p class="eyebrow">ESCÁNER PRIVADO</p><h1>Tu biblioteca</h1></div>${button('Ajustes', 'settings', { icon: 'settings', className: 'compact' })}</header>
    <div class="privacy-note">${icon('lock', 16)} <span>Tus documentos se procesan en este dispositivo.</span></div>
    <label class="search-field">${icon('search', 18)}<input id="search-input" type="search" placeholder="Buscar documentos u OCR" value="${escapeHtml(state.query)}" aria-label="Buscar documentos" /></label>
    <section class="library-heading"><div><p class="eyebrow">ARCHIVO LOCAL</p><h2>Recientes <span>${filtered.length}</span></h2></div><button class="text-button" data-action="refresh">Actualizar</button></section>
    ${filtered.length ? `<div class="document-grid">${filtered.map(renderDocumentCard).join('')}</div>` : `<section class="empty-state"><div class="empty-icon">${icon('file', 30)}</div><h2>Aún no hay documentos</h2><p>Convierte una hoja en un PDF limpio, sin subirla a ninguna nube.</p>${button('Escanear ahora', 'open-camera', { icon: 'camera', kind: 'primary' })}</section>`}
    <div class="home-actions">${button('Importar imagen', 'import-image', { icon: 'file' })}${button('Escanear', 'open-camera', { icon: 'camera', kind: 'primary' })}</div>
    <nav class="bottom-nav" aria-label="Navegación principal"><button class="nav-item active" data-action="home">${icon('file', 20)}<span>Documentos</span></button><button class="nav-item" data-action="open-camera">${icon('camera', 20)}<span>Escanear</span></button><button class="nav-item" data-action="settings">${icon('settings', 20)}<span>Ajustes</span></button></nav>
  </main>`;
}

function renderDocumentCard(document: ScanDocument): string {
  const page = document.pages[0];
  const url = URL.createObjectURL(page.thumbnail); objectUrls.push(url);
  const size = document.pages.reduce((sum, current) => sum + current.processed.size, 0);
  return `<article class="document-card"><button class="card-main" data-action="open-document" data-id="${document.id}"><img src="${url}" alt="Miniatura de ${escapeHtml(document.name)}" /><div class="doc-card-copy"><h3>${escapeHtml(document.name)}</h3><p>${document.pages.length} ${document.pages.length === 1 ? 'página' : 'páginas'} · ${formatBytes(size)}</p><small>${formatDate(document.updatedAt)}</small></div></button><button class="icon-button card-menu" data-action="document-menu" data-id="${document.id}" aria-label="Acciones de ${escapeHtml(document.name)}">${icon('more')}</button></article>`;
}

function renderCamera(): string {
  return `<main class="camera-screen"><video id="camera-video" autoplay muted playsinline></video><canvas id="camera-preview" class="visually-hidden"></canvas><div class="camera-shade"></div><svg id="camera-overlay" class="camera-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M18 16h18M18 16v18M82 16H64M82 16v18M18 84h18M18 84V66M82 84H64M82 84V66" /></svg><div class="camera-top"><button class="icon-button light" data-action="home" aria-label="Cerrar cámara">${icon('close')}</button><div class="camera-title"><span class="live-dot"></span><span>Documento</span></div><button class="icon-button light" data-action="toggle-torch" id="torch-button" aria-label="Activar flash">${icon('flash')}</button></div><div class="camera-center"><div class="camera-status" id="camera-status">Preparando cámara</div><div class="camera-hint" id="camera-hint">Alinea la hoja dentro del marco</div></div><div class="camera-bottom"><div class="camera-tools"><button class="camera-tool" data-action="import-image" aria-label="Importar desde galería">${icon('file', 22)}<span>Galería</span></button><button class="capture-button" data-action="capture" aria-label="Capturar documento"><span></span></button><button class="camera-tool" data-action="toggle-auto" id="auto-button" aria-label="Desactivar captura automática">${icon('auto', 22)}<span>Auto</span></button></div><div class="camera-modes"><button class="mode-chip active" data-mode="document">Documento</button><button class="mode-chip" data-mode="receipt">Recibo</button><button class="mode-chip" data-mode="id">ID / tarjeta</button><button class="mode-chip" data-mode="board">Pizarra</button></div><p class="camera-privacy">Procesamiento local · sin cuenta</p></div><input id="image-input" class="visually-hidden" type="file" accept="image/*" capture="environment" multiple /></main>`;
}

function renderReview(): string {
  const review = state.review;
  if (!review) return '<main class="page-content"><p>No hay captura para revisar.</p></main>';
  return `<main class="review-screen page-content"><header class="topbar"><button class="icon-button" data-action="back-camera" aria-label="Volver a cámara">${icon('back')}</button><div><p class="eyebrow">PASO 02</p><h1>Ajustar bordes</h1></div><button class="text-button" data-action="select-all">Todo</button></header><p class="screen-intro">Arrastra las esquinas para afinar el recorte. La foto original se conserva.</p><section class="crop-stage"><img id="review-image" alt="Captura para ajustar" /><svg id="review-overlay" class="review-overlay" aria-label="Ajuste manual de las cuatro esquinas"><polygon id="review-polygon" points="" /><g id="review-handles"></g></svg></section><div class="review-status"><span class="status-dot ${review.detection ? 'good' : ''}"></span><span>${review.detection ? `Detección automática · ${Math.round(review.detection.confidence * 100)}% de confianza` : 'Ajuste manual disponible'}</span></div><section class="review-controls"><div class="segmented"><button class="segment active" data-action="auto-crop">Automático</button><button class="segment" data-action="rotate-review">${icon('rotate', 16)} Rotar</button><button class="segment" data-action="reset-review">${icon('rotate', 16)} Reiniciar</button></div><div class="filter-row">${renderFilterChips()}</div></section><div class="sticky-actions">${button('Volver a tomar', 'back-camera', { kind: 'secondary' })}${button('Usar esta página', 'apply-review', { icon: 'check', kind: 'primary' })}</div></main>`;
}

function renderFilterChips(): string {
  return (Object.keys(FILTER_LABELS) as FilterName[]).map((filter) => `<button class="filter-chip ${state.selectedFilter === filter ? 'active' : ''}" data-filter="${filter}">${FILTER_LABELS[filter]}</button>`).join('');
}

function renderEditor(): string {
  const draft = state.draft;
  if (!draft) return renderHome();
  return `<main class="editor-screen page-content">${renderHeader('Editar documento', 'home')}<div class="editor-title-row"><div><p class="eyebrow">${draft.pages.length} ${draft.pages.length === 1 ? 'PÁGINA' : 'PÁGINAS'}</p><input id="document-name" class="document-name" value="${escapeHtml(draft.name)}" aria-label="Nombre del documento" /></div><button class="round-action" data-action="save-draft" aria-label="Guardar">${icon('check')}</button></div><section class="page-preview"><img id="editor-preview" alt="Vista previa de la página" /></section><div class="page-counter">Página ${state.selectedPage + 1} de ${draft.pages.length}</div><div class="thumbnail-strip">${draft.pages.map((page, index) => { const url = URL.createObjectURL(page.thumbnail); objectUrls.push(url); return `<button class="thumbnail ${index === state.selectedPage ? 'active' : ''}" draggable="true" data-page="${index}" aria-label="Página ${index + 1}"><img src="${url}" alt="" /><span>${index + 1}</span></button>`; }).join('')}<button class="add-page" data-action="open-camera" aria-label="Añadir página">${icon('plus')}<span>Añadir</span></button></div><p class="drag-hint">Mantén pulsada una miniatura para reordenar.</p><section class="editor-section"><div class="section-title"><div><p class="eyebrow">MEJORA</p><h2>Filtro</h2></div><span class="muted">${FILTER_LABELS[draft.pages[state.selectedPage]?.filter ?? 'auto']}</span></div><div class="filter-row editor-filters">${renderFilterChips()}</div></section><section class="editor-toolbar"><button data-action="rotate-page">${icon('rotate')}<span>Rotar</span></button><button data-action="duplicate-page">${icon('copy')}<span>Duplicar</span></button><button data-action="delete-page">${icon('trash')}<span>Eliminar</span></button><button data-action="open-ocr">${icon('text')}<span>OCR</span></button></section><div class="editor-bottom">${button('Añadir página', 'open-camera', { icon: 'plus' })}${button('Exportar PDF', 'open-export', { icon: 'download', kind: 'primary' })}</div></main>`;
}

function renderOcr(): string {
  const draft = state.draft;
  const text = draft?.pages.map((page, index) => `Página ${index + 1}\n${page.ocrText ?? ''}`).join('\n\n') ?? '';
  return `<main class="page-content ocr-screen">${renderHeader('Texto reconocido', 'editor')}<section class="feature-hero"><div class="feature-icon">${icon('text', 30)}</div><p class="eyebrow">OCR LOCAL</p><h2>Extrae texto sin subir imágenes</h2><p>Tesseract se descarga solo al usar esta función. El resultado queda guardado en tu dispositivo.</p></section><div class="field-row"><label>Idioma <select id="ocr-language"><option value="spa" ${state.ocrLanguage === 'spa' ? 'selected' : ''}>Español</option><option value="eng" ${state.ocrLanguage === 'eng' ? 'selected' : ''}>English</option><option value="por" ${state.ocrLanguage === 'por' ? 'selected' : ''}>Português</option></select></label>${button(state.busy ? 'Reconociendo…' : 'Reconocer páginas', 'run-ocr', { icon: 'text', kind: 'primary', disabled: state.busy })}</div>${state.busy ? `<div class="progress-block"><div class="progress-label"><span>${escapeHtml(state.ocrLabel)}</span><strong>${Math.round(state.ocrProgress * 100)}%</strong></div><div class="progress"><span style="width:${state.ocrProgress * 100}%"></span></div></div>` : ''}<textarea id="ocr-output" class="ocr-output" placeholder="El texto aparecerá aquí…" aria-label="Texto OCR">${escapeHtml(text)}</textarea><div class="inline-actions">${button('Copiar texto', 'copy-ocr', { icon: 'copy' })}${button('Descargar TXT', 'download-ocr', { icon: 'download' })}</div><p class="privacy-note">${icon('lock', 16)} OCR ejecutado localmente · nunca se envía la imagen</p></main>`;
}

function renderExport(): string {
  const draft = state.draft;
  if (!draft) return renderHome();
  const total = draft.pages.reduce((sum, page) => sum + page.processed.size, 0);
  return `<main class="page-content export-screen">${renderHeader('Exportar', 'editor')}<section class="export-summary"><div class="pdf-icon">PDF</div><div><p class="eyebrow">DOCUMENTO LISTO</p><h2>${escapeHtml(draft.name)}</h2><p>${draft.pages.length} páginas · ${formatBytes(total)}</p></div></section><section class="settings-card"><label>Formato<select id="pdf-format"><option value="auto">Ajustar a imagen</option><option value="a4">A4</option><option value="letter">Carta</option><option value="legal">Legal</option></select></label><label>Orientación<select id="pdf-orientation"><option value="auto">Automática</option><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label><label>Márgenes<select id="pdf-margin"><option value="small">Pequeños</option><option value="none">Ninguno</option><option value="normal">Normales</option></select></label><label>Calidad<select id="pdf-quality"><option value="high">Alta</option><option value="maximum">Máxima</option><option value="balanced">Equilibrada</option><option value="small">Archivo pequeño</option></select></label><label>Marca de agua <input id="watermark" type="text" placeholder="Opcional" maxlength="120" /></label></section><div class="export-note">${icon('lock', 16)} El PDF se crea localmente. No es un PDF con texto buscable; usa OCR para copiar o descargar el texto reconocido.</div><div class="sticky-actions export-actions">${button('Crear y descargar PDF', 'create-pdf', { icon: 'download', kind: 'primary' })}${button('Compartir PDF', 'share-pdf', { icon: 'share' })}</div></main>`;
}

function renderSettings(): string {
  const theme = localStorage.getItem('folio-theme') ?? 'system';
  return `<main class="page-content settings-screen">${renderHeader('Ajustes', 'home')}<section class="settings-group"><p class="eyebrow">APARIENCIA</p><div class="settings-card"><div class="setting-line"><div><strong>Tema</strong><span>Adapta la interfaz a tu preferencia</span></div><select id="theme-select"><option value="system" ${theme === 'system' ? 'selected' : ''}>Sistema</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Claro</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Oscuro</option></select></div></div></section><section class="settings-group"><p class="eyebrow">ESCÁNER</p><div class="settings-card"><label class="setting-line"><div><strong>Captura automática</strong><span>Captura al detectar estabilidad</span></div><input type="checkbox" id="auto-setting" checked /></label><label class="setting-line"><div><strong>Guardar originales</strong><span>Permite volver a procesar cada página</span></div><input type="checkbox" checked /></label></div></section><section class="settings-group"><p class="eyebrow">ALMACENAMIENTO</p><div class="settings-card storage-card"><div><strong>Espacio utilizado</strong><span id="storage-value">Calculando…</span></div>${button('Borrar documentos', 'clear-documents', { kind: 'danger', icon: 'trash' })}</div></section><section class="settings-group"><p class="eyebrow">PRIVACIDAD</p><div class="privacy-panel">${icon('lock', 22)}<div><strong>Todo queda aquí</strong><p>Folio no tiene cuentas, trackers ni servidores de imágenes. El procesamiento, el OCR y la creación de PDF ocurren en este dispositivo.</p></div></div></section><p class="version">Folio 0.1 · PWA estática para GitHub Pages</p></main>`;
}

function renderOnboarding(): string {
  return `<div class="modal-backdrop"><section class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div class="onboarding-mark">${icon('file', 32)}</div><p class="eyebrow">BIENVENIDO A FOLIO</p><h2 id="onboarding-title">Escanea documentos con tu teléfono</h2><p>Corrección automática, mejora de imagen y OCR local, sin subir tus archivos.</p><div class="onboarding-points"><span>${icon('check', 16)} Perspectiva corregida</span><span>${icon('lock', 16)} Privacidad por diseño</span><span>${icon('file', 16)} PDF y multipágina</span></div>${button('Comenzar', 'finish-onboarding', { icon: 'chevron', kind: 'primary' })}<small>Sin cuenta · funciona offline después de instalar</small></section></div>`;
}

function bindImageInputs(): void {
  const input = document.querySelector<HTMLInputElement>('#image-input');
  if (input) input.addEventListener('change', () => { if (input.files?.length) handleImportedFiles(Array.from(input.files)); });
  const search = document.querySelector<HTMLInputElement>('#search-input');
  search?.addEventListener('input', () => { state.query = search.value; render(); search.focus(); });
  const theme = document.querySelector<HTMLSelectElement>('#theme-select');
  theme?.addEventListener('change', () => { localStorage.setItem('folio-theme', theme.value); applyTheme(); render(); });
  const language = document.querySelector<HTMLSelectElement>('#ocr-language');
  language?.addEventListener('change', () => { state.ocrLanguage = language.value as AppState['ocrLanguage']; });
  const name = document.querySelector<HTMLInputElement>('#document-name');
  name?.addEventListener('change', () => { if (state.draft) state.draft.name = sanitizeName(name.value); });
  void updateStorageLabel();
}

function applyTheme(): void {
  const theme = localStorage.getItem('folio-theme') ?? 'system';
  document.documentElement.dataset.theme = theme;
}

async function updateStorageLabel(): Promise<void> {
  const element = document.querySelector('#storage-value'); if (!element) return;
  const storage = await estimateStorage();
  element.textContent = storage.quota ? `${formatBytes(storage.usage)} de ${formatBytes(storage.quota)}` : 'Disponible localmente';
}

async function startCameraView(): Promise<void> {
  const video = document.querySelector<HTMLVideoElement>('#camera-video');
  const preview = document.querySelector<HTMLCanvasElement>('#camera-preview');
  if (!video || !preview) return;
  try {
    const capabilities = await camera.start(video);
    camera.setPreviewCanvas(preview);
    const torchButton = document.querySelector<HTMLButtonElement>('#torch-button');
    if (torchButton) torchButton.hidden = !capabilities.torch;
    if (!capabilities.torch) torchButton?.setAttribute('aria-label', 'Flash no disponible');
    runCameraDetection(video, preview);
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Puedes importar una imagen.' : 'No se pudo abrir la cámara en este navegador.';
    const status = document.querySelector('#camera-status'); if (status) status.textContent = message;
    const hint = document.querySelector('#camera-hint'); if (hint) hint.textContent = 'Usa Galería para continuar';
  }
}

function runCameraDetection(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const tick = async () => {
    if (state.screen !== 'camera') return;
    if (!video.videoWidth || cameraDetectionRunning) { cameraLoop = window.setTimeout(tick, 120); return; }
    cameraDetectionRunning = true;
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const openCvDetection = await detectDocumentCornersOpenCv(canvas);
    const fallbackDetection = detectDocumentCorners(canvas);
    const detection = [openCvDetection, fallbackDetection].find((candidate) => candidate && candidate.confidence >= MIN_DETECTION_CONFIDENCE) ?? null;
    cameraDetection = detection;
    const status = document.querySelector('#camera-status'); const hint = document.querySelector('#camera-hint');
    if (detection) {
      cameraStableFrames += 1;
      if (status) status.textContent = detection.message;
      if (hint) hint.textContent = cameraStableFrames > 4 ? 'Mantén firme…' : 'Mueve el teléfono suavemente';
      updateCameraOverlay(detection.corners, canvas.width, canvas.height);
      if (cameraStableFrames > 12 && localStorage.getItem('folio-auto-scan') !== 'off') { cameraStableFrames = 0; void captureCurrent(); }
    } else {
      cameraStableFrames = 0;
      if (status) status.textContent = 'Buscando documento';
      if (hint) hint.textContent = 'Alinea la hoja dentro del marco';
    }
    cameraDetectionRunning = false;
    cameraLoop = window.setTimeout(tick, 220);
  };
  void tick();
}

function updateCameraOverlay(corners: Point[], width: number, height: number): void {
  const svg = document.querySelector<SVGSVGElement>('#camera-overlay'); if (!svg) return;
  const path = svg.querySelector('path'); if (!path) return;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  path.setAttribute('d', `M${corners[0].x} ${corners[0].y}L${corners[1].x} ${corners[1].y}L${corners[2].x} ${corners[2].y}L${corners[3].x} ${corners[3].y}Z`);
  path.classList.add('detected');
}

async function captureCurrent(): Promise<void> {
  if (state.busy || state.screen !== 'camera') return;
  state.busy = true; state.busyLabel = 'Procesando captura';
  try {
    const blob = await camera.capture();
    vibrate(10); camera.stop(); window.clearTimeout(cameraLoop);
    await prepareReview(blob, cameraDetection);
  } catch { camera.stop(); setMessage('No se pudo capturar la imagen. Intenta importar una foto.'); }
  state.busy = false;
}

async function prepareReview(blob: Blob, detection: DetectionResult | null): Promise<void> {
  const preview = await blobToCanvas(blob, 1280);
  const openCvDetection = detection?.confidence && detection.confidence >= MIN_DETECTION_CONFIDENCE ? detection : await detectDocumentCornersOpenCv(preview);
  const fallbackDetection = detectDocumentCorners(preview);
  const resolvedDetection = [openCvDetection, fallbackDetection].find((candidate) => candidate && candidate.confidence >= MIN_DETECTION_CONFIDENCE) ?? null;
  let corners = resolvedDetection?.corners.map((point) => ({ x: point.x / preview.width, y: point.y / preview.height })) ?? [{ x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }];
  const full = await blobToCanvas(blob);
  corners = corners.map((point) => ({ x: point.x * full.width, y: point.y * full.height }));
  state.review = { original: blob, corners, autoCorners: resolvedDetection ? corners.map((point) => ({ ...point })) : null, detection: resolvedDetection };
  state.screen = 'review'; state.selectedFilter = 'auto'; state.message = (await estimateSharpness(blob)) < 35 ? 'La imagen parece desenfocada. Puedes repetirla o continuar.' : '';
  render();
}

async function setupReview(): Promise<void> {
  const image = document.querySelector<HTMLImageElement>('#review-image'); const overlay = document.querySelector<SVGSVGElement>('#review-overlay');
  if (!image || !overlay || !state.review) return;
  if (reviewUrl) URL.revokeObjectURL(reviewUrl);
  reviewUrl = URL.createObjectURL(state.review.original); image.src = reviewUrl;
  await new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); });
  overlay.setAttribute('viewBox', `0 0 ${image.naturalWidth || 1} ${image.naturalHeight || 1}`);
  updateReviewOverlay();
}

async function setupEditorPreview(): Promise<void> {
  const image = document.querySelector<HTMLImageElement>('#editor-preview');
  const page = state.draft?.pages[state.selectedPage];
  if (!image || !page) return;
  if (editorPreviewUrl) URL.revokeObjectURL(editorPreviewUrl);
  editorPreviewUrl = URL.createObjectURL(page.processed);
  image.src = editorPreviewUrl;
}

function updateReviewOverlay(): void {
  const overlay = document.querySelector<SVGSVGElement>('#review-overlay'); const polygon = document.querySelector<SVGPolygonElement>('#review-polygon'); const group = document.querySelector<SVGGElement>('#review-handles');
  if (!overlay || !polygon || !group || !state.review) return;
  const points = state.review.corners.map((point) => `${point.x},${point.y}`).join(' '); polygon.setAttribute('points', points);
  group.innerHTML = state.review.corners.map((point, index) => `<circle class="corner-handle" data-corner="${index}" cx="${point.x}" cy="${point.y}" r="26" tabindex="0" aria-label="Esquina ${index + 1}" />`).join('');
}

function handleReviewPointer(event: PointerEvent): void {
  const overlay = document.querySelector<SVGSVGElement>('#review-overlay'); if (!overlay || !state.review) return;
  const rect = overlay.getBoundingClientRect(); const viewBox = overlay.viewBox.baseVal;
  const point = { x: ((event.clientX - rect.left) / rect.width) * viewBox.width, y: ((event.clientY - rect.top) / rect.height) * viewBox.height };
  if (event.type === 'pointerdown') {
    const target = event.target as Element; const index = Number(target.getAttribute('data-corner'));
    if (Number.isInteger(index) && index >= 0) { draggedCorner = index; overlay.setPointerCapture(event.pointerId); }
  } else if (event.type === 'pointermove' && draggedCorner >= 0) {
    state.review.corners[draggedCorner] = { x: Math.max(0, Math.min(viewBox.width, point.x)), y: Math.max(0, Math.min(viewBox.height, point.y)) }; updateReviewOverlay();
  } else if ((event.type === 'pointerup' || event.type === 'pointercancel') && draggedCorner >= 0) { draggedCorner = -1; }
}

async function applyReview(): Promise<void> {
  if (!state.review || state.busy) return;
  state.busy = true; state.busyLabel = 'Corrigiendo perspectiva y mejorando imagen'; render();
  try {
    const result = await processDocument(state.review.original, state.review.corners, state.selectedFilter, DEFAULT_ADJUSTMENTS);
    const page: ScanPage = { id: uid('page'), original: state.review.original, processed: result.processed, thumbnail: result.thumbnail, corners: state.review.corners, filter: state.selectedFilter, adjustments: { ...DEFAULT_ADJUSTMENTS }, rotation: 0 };
    if (!state.draft) { const now = Date.now(); state.draft = { id: uid('doc'), name: `Documento ${new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit' }).format(now)}`, createdAt: now, updatedAt: now, pages: [], mode: state.mode }; }
    state.draft.pages.push(page); state.draft.updatedAt = Date.now(); state.review = null;
    if (state.importQueue.length) { const next = state.importQueue.shift()!; state.busy = false; await prepareReview(next, null); return; }
    state.selectedPage = state.draft.pages.length - 1; state.screen = 'editor'; state.busy = false; vibrate(8); render();
  } catch (error) { state.busy = false; setMessage(error instanceof Error ? error.message : 'No se pudo procesar la página.'); }
}

function handleImportedFiles(files: File[]): void {
  const images = files.filter((file) => file.type.startsWith('image/')).slice(0, 100);
  if (!images.length) { setMessage('Selecciona una imagen compatible.'); return; }
  camera.stop(); window.clearTimeout(cameraLoop);
  state.importQueue = images.slice(1); state.mode = 'document';
  void prepareReview(images[0], null);
}

async function saveDraft(): Promise<void> {
  if (!state.draft) return;
  state.draft.name = sanitizeName(state.draft.name); state.draft.updatedAt = Date.now();
  state.busy = true; state.busyLabel = 'Guardando localmente'; render();
  try { await saveDocument(state.draft); state.documents = await listDocuments(); setMessage('Guardado en este dispositivo.'); } catch { setMessage('No se pudo guardar. Revisa el espacio disponible del navegador.'); }
  state.busy = false; render();
}

async function openDocument(id: string): Promise<void> {
  const document = state.documents.find((item) => item.id === id); if (!document) return;
  state.draft = document; state.selectedPage = 0; state.selectedFilter = document.pages[0]?.filter ?? 'auto'; state.screen = 'editor'; render();
}

async function updatePageFilter(filter: FilterName): Promise<void> {
  if (!state.draft) return;
  const page = state.draft.pages[state.selectedPage]; if (!page) return;
  state.selectedFilter = filter; state.busy = true; state.busyLabel = 'Aplicando filtro'; render();
  try { const result = await processDocument(page.original, page.corners, filter, page.adjustments); page.processed = result.processed; page.thumbnail = result.thumbnail; page.filter = filter; state.draft.updatedAt = Date.now(); } catch { setMessage('No se pudo aplicar el filtro.'); }
  state.busy = false; render();
}

async function rotateCurrentPage(): Promise<void> {
  if (!state.draft) return; const page = state.draft.pages[state.selectedPage]; if (!page) return;
  page.processed = await rotateBlob(page.processed); page.thumbnail = await rotateBlob(page.thumbnail, 1); page.rotation = (page.rotation + 90) % 360; state.draft.updatedAt = Date.now(); render();
}

async function runOcr(): Promise<void> {
  if (!state.draft || state.busy) return;
  state.busy = true; state.ocrProgress = 0; state.ocrLabel = 'Preparando OCR'; render();
  try { const texts = await recognizePages(state.draft.pages, state.ocrLanguage, (progress, label) => { state.ocrProgress = progress; state.ocrLabel = label; render(); }); texts.forEach((text, index) => { state.draft!.pages[index].ocrText = text; }); await saveDocument(state.draft); setMessage('OCR completado y guardado localmente.'); } catch { setMessage('OCR no pudo completarse. Revisa la conexión inicial o prueba con otra página.'); }
  state.busy = false; render();
}

async function exportPdf(share = false): Promise<void> {
  if (!state.draft) return;
  state.busy = true; state.busyLabel = 'Creando PDF local'; render();
  const get = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)?.value ?? 'auto';
  try {
    const blob = await createPdf(state.draft.pages, { format: get('pdf-format') as 'auto' | 'a4' | 'letter' | 'legal', orientation: get('pdf-orientation') as 'auto' | 'portrait' | 'landscape', margin: get('pdf-margin') as 'none' | 'small' | 'normal', quality: get('pdf-quality') as 'maximum' | 'high' | 'balanced' | 'small' }, document.querySelector<HTMLInputElement>('#watermark')?.value ?? '');
    const file = new File([blob], `${sanitizeName(state.draft.name)}.pdf`, { type: 'application/pdf' });
    if (share && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ files: [file], title: state.draft.name });
    else { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); URL.revokeObjectURL(url); }
    await saveDocument(state.draft); vibrate(8); setMessage('PDF creado localmente.');
  } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo crear el PDF.'); }
  state.busy = false; render();
}

function ocrText(): string { return state.draft?.pages.map((page) => page.ocrText ?? '').join('\n\n').trim() ?? ''; }

async function handleAction(action: string, element: HTMLElement): Promise<void> {
  if (action === 'finish-onboarding') { state.onboarding = false; localStorage.setItem('folio-onboarding', 'done'); render(); return; }
  if (action === 'home') { camera.stop(); window.clearTimeout(cameraLoop); state.screen = 'home'; state.review = null; render(); return; }
  if (action === 'settings') { camera.stop(); state.screen = 'settings'; render(); return; }
  if (action === 'open-camera') { state.screen = 'camera'; state.message = ''; state.mode = 'document'; cameraStableFrames = 0; cameraDetection = null; render(); return; }
  if (action === 'back-camera') { camera.stop(); state.screen = 'camera'; render(); return; }
  if (action === 'capture') { await captureCurrent(); return; }
  if (action === 'toggle-torch') { state.torch = !state.torch; try { await camera.setTorch(state.torch); } catch { setMessage('El flash no pudo activarse en este dispositivo.'); } return; }
  if (action === 'toggle-auto') { const isOff = localStorage.getItem('folio-auto-scan') === 'off'; localStorage.setItem('folio-auto-scan', isOff ? 'on' : 'off'); element.classList.toggle('active', isOff); setMessage(isOff ? 'Captura automática activada.' : 'Captura automática desactivada.'); return; }
  if (action === 'import-image') { const input = document.querySelector<HTMLInputElement>('#image-input'); if (input) input.click(); else openFileFallback(); return; }
  if (action === 'select-all' && state.review) { const image = document.querySelector<HTMLImageElement>('#review-image'); state.review.corners = [{ x: 0, y: 0 }, { x: image?.naturalWidth ?? 1, y: 0 }, { x: image?.naturalWidth ?? 1, y: image?.naturalHeight ?? 1 }, { x: 0, y: image?.naturalHeight ?? 1 }]; updateReviewOverlay(); return; }
  if (action === 'auto-crop' && state.review) { if (state.review.autoCorners) state.review.corners = state.review.autoCorners.map((point) => ({ ...point })); else { const image = document.querySelector<HTMLImageElement>('#review-image'); const w = image?.naturalWidth ?? 1; const h = image?.naturalHeight ?? 1; state.review.corners = [{ x: w * 0.08, y: h * 0.08 }, { x: w * 0.92, y: h * 0.08 }, { x: w * 0.92, y: h * 0.92 }, { x: w * 0.08, y: h * 0.92 }]; } updateReviewOverlay(); return; }
  if (action === 'reset-review' && state.review) { const image = document.querySelector<HTMLImageElement>('#review-image'); const w = image?.naturalWidth ?? 1; const h = image?.naturalHeight ?? 1; state.review.corners = [{ x: w * 0.08, y: h * 0.08 }, { x: w * 0.92, y: h * 0.08 }, { x: w * 0.92, y: h * 0.92 }, { x: w * 0.08, y: h * 0.92 }]; updateReviewOverlay(); return; }
  if (action === 'rotate-review' && state.review) { const image = document.querySelector<HTMLImageElement>('#review-image'); const w = image?.naturalWidth ?? 1; const h = image?.naturalHeight ?? 1; state.review.corners = state.review.corners.map((point) => ({ x: h - point.y, y: point.x })); render(); return; }
  if (action === 'apply-review') { await applyReview(); return; }
  if (action === 'save-draft') { await saveDraft(); return; }
  if (action === 'open-document') { await openDocument(element.dataset.id ?? ''); return; }
  if (action === 'document-menu') { const id = element.dataset.id ?? ''; const document = state.documents.find((item) => item.id === id); if (document && confirm(`¿Eliminar “${document.name}”?`)) { await deleteDocument(id); state.documents = await listDocuments(); render(); } return; }
  if (action === 'refresh') { state.documents = await listDocuments(); render(); return; }
  if (action === 'rotate-page') { await rotateCurrentPage(); return; }
  if (action === 'duplicate-page' && state.draft) { const page = state.draft.pages[state.selectedPage]; state.draft.pages.splice(state.selectedPage + 1, 0, { ...page, id: uid('page') }); state.selectedPage += 1; render(); return; }
  if (action === 'delete-page' && state.draft) { if (state.draft.pages.length === 1) { setMessage('Un documento debe conservar al menos una página.'); return; } state.draft.pages.splice(state.selectedPage, 1); state.selectedPage = Math.min(state.selectedPage, state.draft.pages.length - 1); render(); return; }
  if (action === 'open-ocr') { state.screen = 'ocr'; render(); return; }
  if (action === 'open-export') { state.screen = 'export'; render(); return; }
  if (action === 'run-ocr') { await runOcr(); return; }
  if (action === 'copy-ocr') { const text = (document.querySelector<HTMLTextAreaElement>('#ocr-output')?.value || ocrText()); if (text) { await navigator.clipboard?.writeText(text); setMessage('Texto copiado.'); } return; }
  if (action === 'download-ocr') { const blob = new Blob([ocrText()], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${sanitizeName(state.draft?.name ?? 'ocr')}.txt`; anchor.click(); URL.revokeObjectURL(url); return; }
  if (action === 'create-pdf') { await exportPdf(false); return; }
  if (action === 'share-pdf') { await exportPdf(true); return; }
  if (action === 'clear-documents' && confirm('¿Eliminar todos los documentos guardados en este dispositivo?')) { for (const document of state.documents) await deleteDocument(document.id); state.documents = []; render(); }
}

function openFileFallback(): void { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.click(); input.onchange = () => { if (input.files?.length) handleImportedFiles(Array.from(input.files)); }; }

app.addEventListener('click', (event) => {
  const target = event.target as HTMLElement; const actionElement = target.closest<HTMLElement>('[data-action]');
  if (actionElement) void handleAction(actionElement.dataset.action ?? '', actionElement);
  const filterElement = target.closest<HTMLElement>('[data-filter]'); if (filterElement) void updatePageFilter(filterElement.dataset.filter as FilterName);
  const modeElement = target.closest<HTMLElement>('[data-mode]'); if (modeElement) { state.mode = modeElement.dataset.mode as ScanMode; document.querySelectorAll('[data-mode]').forEach((node) => node.classList.toggle('active', node === modeElement)); }
  const pageElement = target.closest<HTMLElement>('[data-page]'); if (pageElement) { state.selectedPage = Number(pageElement.dataset.page); state.selectedFilter = state.draft?.pages[state.selectedPage]?.filter ?? 'auto'; render(); }
});
app.addEventListener('pointerdown', handleReviewPointer);
app.addEventListener('pointermove', handleReviewPointer);
app.addEventListener('pointerup', handleReviewPointer);
app.addEventListener('pointercancel', handleReviewPointer);
app.addEventListener('dragstart', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-page]');
  if (target) draggedPage = Number(target.dataset.page);
});
app.addEventListener('dragover', (event) => { if ((event.target as HTMLElement).closest('[data-page]')) event.preventDefault(); });
app.addEventListener('drop', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-page]');
  if (!target || !state.draft || draggedPage < 0) return;
  event.preventDefault();
  const destination = Number(target.dataset.page);
  if (destination !== draggedPage && Number.isInteger(destination)) {
    const [page] = state.draft.pages.splice(draggedPage, 1); state.draft.pages.splice(destination, 0, page); state.selectedPage = destination; state.draft.updatedAt = Date.now(); render();
  }
  draggedPage = -1;
});

async function init(): Promise<void> {
  applyTheme();
  try { state.documents = await listDocuments(); } catch { state.message = 'El almacenamiento local no está disponible; podrás exportar sin guardar.'; }
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  render();
}

void init();
