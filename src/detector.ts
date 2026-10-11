import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { MAX_POSES } from './constants';

export type ModelState = 'loading' | 'ready' | 'failed';
export type Delegate = 'GPU' | 'CPU';

const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

export interface DetectorOptions {
  wasmBase: string;
  modelPath: string;
  delegate: Delegate;
  // true inside a module worker, where the wasm loader must be imported.
  useModule: boolean;
}

export interface RawPose {
  leftAnkle: NormalizedLandmark;
  rightAnkle: NormalizedLandmark;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Wraps the MediaPipe pose landmarker for one delegate. The wasm loader can
// only be consumed once per realm, so a retry needs a fresh worker.
export class PoseDetector {
  state: ModelState = 'loading';
  error = '';
  delegate: Delegate | '' = '';
  lastMs = 0;
  private landmarker: PoseLandmarker | null = null;
  private lastTs = -1;

  async load(opts: DetectorOptions) {
    this.state = 'loading';
    this.error = '';
    try {
      const vision = await FilesetResolver.forVisionTasks(opts.wasmBase, opts.useModule);
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: opts.modelPath, delegate: opts.delegate },
        runningMode: 'VIDEO',
        numPoses: MAX_POSES,
      });
      this.delegate = opts.delegate;
      this.state = 'ready';
    } catch (err) {
      this.state = 'failed';
      this.error = describe(err);
    }
  }

  // Runs one detection. Returns the ankle landmarks of each pose.
  detect(image: ImageBitmap | HTMLVideoElement, nowMs: number): RawPose[] {
    if (!this.landmarker || this.state !== 'ready') return [];
    let ts = Math.round(nowMs);
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(image, ts);
    } catch (err) {
      this.state = 'failed';
      this.error = describe(err);
      return [];
    }
    this.lastMs = performance.now() - t0;
    const poses: RawPose[] = [];
    for (const lm of result.landmarks) {
      const l = lm[LEFT_ANKLE];
      const r = lm[RIGHT_ANKLE];
      if (l && r) poses.push({ leftAnkle: l, rightAnkle: r });
    }
    return poses;
  }
}
