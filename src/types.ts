export type Screen = 'home' | 'camera' | 'review' | 'editor' | 'ocr' | 'export' | 'settings';
export type FilterName = 'auto' | 'original' | 'enhanced' | 'document' | 'bw' | 'gray' | 'vivid' | 'photo' | 'board' | 'receipt';
export type ScanMode = 'document' | 'book' | 'id' | 'receipt' | 'board';

export interface Point { x: number; y: number; }

export interface Adjustments {
  brightness: number;
  contrast: number;
  exposure: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  temperature: number;
  sharpness: number;
}

export interface ScanPage {
  id: string;
  original: Blob;
  processed: Blob;
  thumbnail: Blob;
  corners: Point[];
  filter: FilterName;
  adjustments: Adjustments;
  rotation: number;
  ocrText?: string;
}

export interface ScanDocument {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pages: ScanPage[];
  mode: ScanMode;
}

export interface DetectionResult {
  corners: Point[];
  confidence: number;
  message: string;
}

export interface PdfOptions {
  format: 'auto' | 'a4' | 'letter' | 'legal';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: 'none' | 'small' | 'normal';
  quality: 'maximum' | 'high' | 'balanced' | 'small';
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  exposure: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  temperature: 0,
  sharpness: 0,
};

export const FILTER_LABELS: Record<FilterName, string> = {
  auto: 'Auto',
  original: 'Original',
  enhanced: 'Mejorado',
  document: 'Documento',
  bw: 'B/N',
  gray: 'Grises',
  vivid: 'Color intenso',
  photo: 'Foto',
  board: 'Pizarra',
  receipt: 'Recibo',
};
