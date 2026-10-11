import { type Delegate, type ModelState, PoseDetector } from './detector';

// Messages from the main thread.
export type WorkerRequest =
  | { type: 'init'; wasmBase: string; modelPath: string; delegate: Delegate }
  | { type: 'detect'; bitmap: ImageBitmap; ts: number; w: number; h: number; mirror: boolean };

export interface AnklePoint {
  x: number;
  y: number;
  visibility: number;
}

// Messages to the main thread.
export type WorkerResponse =
  | { type: 'status'; state: ModelState; delegate: Delegate | ''; error: string }
  | {
      type: 'result';
      poses: Array<{ left: AnklePoint; right: AnklePoint }>;
      ms: number;
      ts: number;
      w: number;
      h: number;
      mirror: boolean;
    };

const ctx = self as unknown as {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

const detector = new PoseDetector();
let lastStatus = '';

function postStatus() {
  const key = detector.state + detector.delegate + detector.error;
  if (key === lastStatus) return;
  lastStatus = key;
  ctx.postMessage({ type: 'status', state: detector.state, delegate: detector.delegate, error: detector.error });
}

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    void detector.load({ wasmBase: msg.wasmBase, modelPath: msg.modelPath, delegate: msg.delegate, useModule: true }).then(postStatus);
    return;
  }
  const raw = detector.detect(msg.bitmap, msg.ts);
  msg.bitmap.close();
  const poses = raw.map((p) => ({
    left: { x: p.leftAnkle.x, y: p.leftAnkle.y, visibility: p.leftAnkle.visibility ?? 0 },
    right: { x: p.rightAnkle.x, y: p.rightAnkle.y, visibility: p.rightAnkle.visibility ?? 0 },
  }));
  ctx.postMessage({ type: 'result', poses, ms: detector.lastMs, ts: msg.ts, w: msg.w, h: msg.h, mirror: msg.mirror });
  postStatus();
};
