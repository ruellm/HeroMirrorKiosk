import type { Calibration } from './calibration';
import type { Camera } from './camera';
import { ANKLE_VISIBILITY_MIN, DETECT_INTERVAL_MS, DETECT_MAX_SIDE_PX, RING_INSIDE_MARGIN } from './constants';
import type { WorkerRequest, WorkerResponse } from './detect.worker';
import type { Delegate, ModelState } from './detector';
import { cameraToStage, insideRing, type StagePoint } from './mapping';
import { VisitorTrigger } from './trigger';

export interface DetectedPose {
  leftAnkle: StagePoint;
  rightAnkle: StagePoint;
  leftVisible: boolean;
  rightVisible: boolean;
  feet: StagePoint | null;
  inside: boolean;
}

// Runs the pose detector in a worker while the ring waits for a visitor and
// feeds the trigger. Camera frames go to the worker as downscaled bitmaps.
export class Detection {
  readonly trigger = new VisitorTrigger();
  debug = false;
  poses: DetectedPose[] = [];
  modelState: ModelState = 'loading';
  delegate: Delegate | '' = '';
  error = '';
  lastMs = 0;
  // Frames sent to the worker, for the status line and tests.
  sent = 0;
  private worker: Worker | null = null;
  private fallback: Delegate[] = [];
  private running = false;
  private inflight = false;
  private lastDetect = -Infinity;
  private cal: Calibration | null = null;

  constructor(private camera: Camera) {
    this.start(['GPU', 'CPU']);
  }

  // Starts a fresh worker for the first delegate, the rest are fallbacks.
  start(delegates: Delegate[]) {
    if (this.worker) this.worker.terminate();
    const [delegate, ...rest] = delegates;
    this.fallback = rest;
    this.modelState = 'loading';
    this.delegate = '';
    this.error = '';
    this.inflight = false;
    const worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (this.worker === worker) this.onMessage(e.data);
    };
    worker.onerror = (e) => {
      if (this.worker === worker) this.failed('worker: ' + (e.message || 'failed to start'));
    };
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    this.send({ type: 'init', wasmBase: base + 'wasm', modelPath: base + 'models/pose_landmarker_lite.task', delegate });
  }

  private failed(error: string) {
    this.inflight = false;
    if (this.fallback.length) {
      this.start(this.fallback);
      return;
    }
    this.modelState = 'failed';
    this.error = error;
  }

  private send(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  update(now: number, cal: Calibration, stageEmpty: boolean) {
    this.cal = cal;
    this.trigger.setPlaying(!stageEmpty, now);
    this.running = cal.detection.enabled && stageEmpty && this.camera.ready && this.modelState === 'ready';
    if (!this.running) {
      this.poses = [];
      return;
    }
    if (this.inflight || now - this.lastDetect < DETECT_INTERVAL_MS) return;
    this.lastDetect = now;
    this.inflight = true;
    this.sent++;

    const video = this.camera.video;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const scale = Math.min(1, DETECT_MAX_SIDE_PX / Math.max(w, h));
    createImageBitmap(video, {
      resizeWidth: Math.max(1, Math.round(w * scale)),
      resizeHeight: Math.max(1, Math.round(h * scale)),
      resizeQuality: 'low',
    }).then(
      (bitmap) => this.send({ type: 'detect', bitmap, ts: now, w, h, mirror: cal.camera.mirror }, [bitmap]),
      (err) => {
        this.inflight = false;
        this.error = 'frame capture failed: ' + String(err);
      },
    );
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === 'status') {
      if (msg.state === 'failed') {
        this.failed(msg.error);
        return;
      }
      this.modelState = msg.state;
      this.delegate = msg.delegate;
      this.error = msg.error;
      return;
    }
    this.inflight = false;
    this.lastMs = msg.ms;
    const cal = this.cal;
    if (!this.running || !cal) return;
    this.poses = msg.poses.map((p) => {
      const leftAnkle = cameraToStage(p.left.x, p.left.y, msg.w, msg.h, msg.mirror);
      const rightAnkle = cameraToStage(p.right.x, p.right.y, msg.w, msg.h, msg.mirror);
      const leftVisible = p.left.visibility >= ANKLE_VISIBILITY_MIN;
      const rightVisible = p.right.visibility >= ANKLE_VISIBILITY_MIN;
      const feet = leftVisible && rightVisible
        ? { x: (leftAnkle.x + rightAnkle.x) / 2, y: (leftAnkle.y + rightAnkle.y) / 2 }
        : null;
      const inside = feet ? insideRing(feet, cal.ring, RING_INSIDE_MARGIN) : false;
      return { leftAnkle, rightAnkle, leftVisible, rightVisible, feet, inside };
    });
    this.trigger.observe(performance.now(), this.poses.some((p) => p.inside));
  }

  status(): string {
    let model: string;
    if (this.modelState === 'loading') model = 'loading';
    else if (this.modelState === 'failed') model = 'failed: ' + this.error;
    else model = 'ready (' + this.delegate + ', worker)';
    return 'model ' + model + ' | poses ' + this.poses.length + ' | ' + this.lastMs.toFixed(1) + ' ms | ' + this.trigger.state;
  }
}
