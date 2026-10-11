export type ClipId = 'entrance' | 'pose' | 'exit';

export interface CropInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Shape of the "Copy settings" JSON from tools/keytest.html.
// Paste that JSON as the key object of a clip. Fields keytest writes for
// information only are optional and ignored by the renderer.
export interface KeySettings {
  keyColor: string;
  keyMode: 'chromaDistance' | 'colorDifference';
  tolerance: number;
  softness: number;
  spill: number;
  spillBalance: number;
  chokePx: number;
  crop: CropInsets;
  keyColorRGB?: number[];
  chromaSpace?: string;
  colorDifference?: { formula: string; threshold: number; band: number };
  cropPx?: CropInsets;
  video?: { width: number; height: number; duration: number; fps: number; fpsMeasured: boolean };
  viewMode?: string;
  background?: string;
}

// Per clip alignment in stage units: dx, dy as fractions of stage width and
// height, scale as a multiplier on the global scale. Pivot is the bottom
// right corner of the clip frame.
export interface ClipAdjust {
  dx: number;
  dy: number;
  scale: number;
}

export interface ClipConfig {
  id: ClipId;
  file: string;
  loop: boolean;
  key: KeySettings;
  // When set, overrides key.crop.
  crop?: CropInsets;
  adjust: ClipAdjust;
}


export const KEYTEST_DEFAULTS: KeySettings = {
  keyColor: '#00b140',
  keyMode: 'chromaDistance',
  tolerance: 0.276,
  softness: 0.08,
  spill: 1.0,
  spillBalance: 1.0,
  chokePx: 3.00,
  crop: { left: 0, right: 0, top: 0, bottom: 0 },
};

export const CLIPS: ClipConfig[] = [
  {
    id: 'entrance',
    file: 'clips/1.mp4',
    loop: false,
    key: { ...KEYTEST_DEFAULTS },
    adjust: { dx: 0, dy: 0, scale: 1 },
  },
  {
    id: 'pose',
    file: 'clips/2.mp4',
    loop: true,
    key: { ...KEYTEST_DEFAULTS },
    adjust: { dx: 0, dy: 0, scale: 1 },
  },
  {
    id: 'exit',
    file: 'clips/3.mp4',
    loop: false,
    key: { ...KEYTEST_DEFAULTS },
    adjust: { dx: 0, dy: 0, scale: 1 },
  },
];
