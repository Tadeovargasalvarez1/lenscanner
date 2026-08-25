import { canvasToBlob } from './utils';

export interface CameraCapabilities {
  torch: boolean;
  zoom: boolean;
  imageCapture: boolean;
}

export class CameraController {
  private stream: MediaStream | null = null;
  private imageCapture: ImageCapture | null = null;
  private track: MediaStreamTrack | null = null;
  private video: HTMLVideoElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private detectTimer: number | null = null;

  async start(video: HTMLVideoElement): Promise<CameraCapabilities> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no ofrece acceso a la cámara.');
    this.video = video;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
    });
    this.track = this.stream.getVideoTracks()[0] ?? null;
    video.srcObject = this.stream;
    video.setAttribute('playsinline', 'true');
    await video.play();
    if ('ImageCapture' in window && this.track) {
      try { this.imageCapture = new ImageCapture(this.track); } catch { this.imageCapture = null; }
    }
    const capabilities = this.track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number } } | undefined;
    return { torch: Boolean(capabilities?.torch), zoom: Boolean(capabilities?.zoom), imageCapture: Boolean(this.imageCapture) };
  }

  setPreviewCanvas(canvas: HTMLCanvasElement): void { this.previewCanvas = canvas; }

  async capture(): Promise<Blob> {
    if (!this.video) throw new Error('La cámara todavía no está lista.');
    if (this.imageCapture) {
      try {
        const photo = await this.imageCapture.takePhoto();
        if (photo.size > 0) return photo;
      } catch { /* fallback below */ }
    }
    const canvas = this.previewCanvas ?? document.createElement('canvas');
    const width = this.video.videoWidth || 1280;
    const height = this.video.videoHeight || 720;
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(this.video, 0, 0, width, height);
    return canvasToBlob(canvas, 'image/jpeg', 0.95);
  }

  async setTorch(enabled: boolean): Promise<void> {
    const capabilities = this.track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined;
    if (!this.track || !capabilities?.torch) return;
    await this.track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
  }

  async setZoom(value: number): Promise<void> {
    const capabilities = this.track?.getCapabilities?.() as MediaTrackCapabilities & { zoom?: { min: number; max: number } } | undefined;
    if (!this.track || !capabilities?.zoom) return;
    await this.track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
  }

  stop(): void {
    if (this.detectTimer) window.clearInterval(this.detectTimer);
    this.detectTimer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null; this.track = null; this.imageCapture = null;
    if (this.video) this.video.srcObject = null;
  }

  get isRunning(): boolean { return Boolean(this.stream); }
}

export function setupFileInput(input: HTMLInputElement, onFiles: (files: File[]) => void): () => void {
  const listener = () => { if (input.files?.length) onFiles(Array.from(input.files)); input.value = ''; };
  input.addEventListener('change', listener);
  return () => input.removeEventListener('change', listener);
}
