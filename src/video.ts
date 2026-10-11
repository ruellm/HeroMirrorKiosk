type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback(cb: () => void): number;
};

export const HAS_RVFC =
  typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

// Tracks when a video element has a frame that is not on the GPU yet.
export class VideoSource {
  dirty = false;
  private lastTime = -1;
  private waiters: Array<() => void> = [];

  constructor(readonly video: HTMLVideoElement) {
    if (HAS_RVFC) {
      this.arm();
    } else {
      for (const ev of ['seeked', 'playing', 'loadeddata']) video.addEventListener(ev, this.onFrame);
    }
  }

  private arm() {
    (this.video as RvfcVideo).requestVideoFrameCallback(() => {
      this.onFrame();
      this.arm();
    });
  }

  private onFrame = () => {
    this.dirty = true;
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  };

  hasNewFrame(): boolean {
    if (this.video.readyState < 2) return false;
    if (!HAS_RVFC && this.video.currentTime !== this.lastTime) this.dirty = true;
    return this.dirty;
  }

  markUploaded() {
    this.dirty = false;
    this.lastTime = this.video.currentTime;
  }

  // Resolves when the next frame is presented, or after timeoutMs.
  nextFrame(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        resolve();
      };
      this.waiters.push(fin);
      setTimeout(fin, timeoutMs);
    });
  }
}
