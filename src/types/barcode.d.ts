/** Ambient types for experimental APIs */

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(
    source: ImageBitmapSource | HTMLVideoElement | HTMLCanvasElement
  ): Promise<Array<{ rawValue: string; format?: string }>>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
  Html5Qrcode?: any;
  Html5QrcodeSupportedFormats?: any;
  XLSX?: any;
  webkitAudioContext?: typeof AudioContext;
}
