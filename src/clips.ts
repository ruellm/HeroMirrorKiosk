import { CLIPS, type ClipConfig, type ClipId } from './clips.config';
import { CROSSFADE_MS, FIRST_FRAME_TIMEOUT_MS, POSE_LOOP_MS } from './constants';
import type { KeyUniforms, Renderer } from './renderer';
import { VideoSource } from './video';

export type ClipState = 'loading' | 'ready' | 'missing';

export interface Clip {
  cfg: ClipConfig;
  video: HTMLVideoElement;
  source: VideoSource;
  texture: WebGLTexture;
  key: KeyUniforms;
  state: ClipState;
  error: string;
  width: number;
  height: number;
  duration: number;
}

export interface Drawable {
  clip: Clip;
  opacity: number;
}

interface Fade {
  from: Clip | null;
  to: Clip | null;
  start: number;
}

export type SequenceStep = 'entrance' | 'pose' | 'exit' | null;

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [0, 0.694, 0.251];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function keyUniforms(cfg: ClipConfig): KeyUniforms {
  const k = cfg.key;
  const crop = cfg.crop ?? k.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    key: hexToRgb(k.keyColor),
    keyMode: k.keyMode === 'colorDifference' ? 1 : 0,
    tol: k.tolerance,
    soft: k.softness,
    spill: k.spill,
    spillBal: k.spillBalance,
    choke: k.chokePx,
    crop: [crop.left, crop.right, crop.top, crop.bottom],
  };
}

function mediaErrorText(err: MediaError | null): string {
  if (!err) return 'unknown error';
  const names: Record<number, string> = {
    1: 'aborted',
    2: 'network error',
    3: 'decode error',
    4: 'file missing or unsupported',
  };
  return (names[err.code] ?? 'error ' + err.code) + (err.message ? ' (' + err.message + ')' : '');
}

export class ClipPlayer {
  readonly clips = new Map<ClipId, Clip>();
  active: Clip | null = null;
  sequenceStep: SequenceStep = null;
  onChange: () => void = () => {};
  private fade: Fade | null = null;
  private pending: Clip | null = null;
  private poseStart = 0;
  private token = 0;

  constructor(
    private renderer: Renderer,
    container: HTMLElement,
  ) {
    for (const cfg of CLIPS) this.clips.set(cfg.id, this.createClip(cfg, container));
  }

  get fading(): boolean {
    return this.fade !== null;
  }

  private createClip(cfg: ClipConfig, container: HTMLElement): Clip {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';
    video.loop = cfg.loop;
    video.src = import.meta.env.BASE_URL + cfg.file;
    container.appendChild(video);

    const clip: Clip = {
      cfg,
      video,
      source: new VideoSource(video),
      texture: this.renderer.createTexture(),
      key: keyUniforms(cfg),
      state: 'loading',
      error: '',
      width: 0,
      height: 0,
      duration: 0,
    };
    video.addEventListener('loadedmetadata', () => {
      clip.width = video.videoWidth;
      clip.height = video.videoHeight;
      clip.duration = video.duration;
      clip.state = 'ready';
      this.onChange();
    });
    video.addEventListener('error', () => {
      clip.state = 'missing';
      clip.error = mediaErrorText(video.error);
      this.onChange();
    });
    video.load();
    return clip;
  }

  private whenLoaded(clip: Clip): Promise<void> {
    return new Promise((resolve) => {
      if (clip.state !== 'loading') return resolve();
      const check = () => {
        if (clip.state === 'loading') return;
        clip.video.removeEventListener('loadedmetadata', check);
        clip.video.removeEventListener('error', check);
        resolve();
      };
      clip.video.addEventListener('loadedmetadata', check);
      clip.video.addEventListener('error', check);
    });
  }

  // Starts a clip, waits for its first decoded frame, then crossfades to it.
  // null fades the current clip out.
  async show(id: ClipId | null): Promise<void> {
    const token = ++this.token;
    const wanted = id ? this.clips.get(id) ?? null : null;
    if (wanted && wanted.state === 'loading') await this.whenLoaded(wanted);
    if (token !== this.token) return;
    const target = wanted && wanted.state === 'ready' ? wanted : null;
    this.pending = target;

    if (target) {
      const v = target.video;
      const prepared = v.currentTime === 0 && v.readyState >= 2 && !v.seeking && v.paused;
      let firstFrame: Promise<void> | null = null;
      if (!prepared) {
        v.pause();
        v.currentTime = 0;
        firstFrame = target.source.nextFrame(FIRST_FRAME_TIMEOUT_MS);
      }
      v.loop = target.cfg.loop;
      v.play().catch((err) => {
        target.error = 'play failed: ' + String(err);
        this.onChange();
      });
      if (firstFrame) {
        await firstFrame;
        if (token !== this.token) return;
      }
    }
    this.pending = null;
    this.beginFade(target);
  }

  private beginFade(target: Clip | null) {
    const prev = this.fade;
    this.fade = null;
    if (prev && prev.from && prev.from !== prev.to && prev.from !== target) this.park(prev.from);

    const from = this.active;
    this.active = target;
    if (from !== target) {
      if (target) target.source.dirty = true;
      this.fade = { from, to: target, start: performance.now() };
    }
    this.onChange();
  }

  // Pauses a clip that left the stage and rewinds it so the next start is instant.
  private park(clip: Clip) {
    if (clip === this.pending) return;
    const v = clip.video;
    v.pause();
    if (v.currentTime !== 0) v.currentTime = 0;
  }

  runSequence() {
    this.sequenceStep = 'entrance';
    void this.show('entrance');
    this.onChange();
  }

  stopSequence() {
    if (this.sequenceStep === null) return;
    this.sequenceStep = null;
    this.onChange();
  }

  // True when the clip is on stage and within one crossfade of its end.
  isNearEnd(id: ClipId): boolean {
    const c = this.clips.get(id);
    return !!c && this.active === c && this.nearEnd(c);
  }

  private nearEnd(clip: Clip): boolean {
    const v = clip.video;
    if (v.ended) return true;
    return isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - CROSSFADE_MS / 1000;
  }

  private updateSequence(now: number) {
    const get = (id: ClipId) => this.clips.get(id)!;
    switch (this.sequenceStep) {
      case 'entrance': {
        const c = get('entrance');
        if (c.state === 'missing' || (this.active === c && this.nearEnd(c))) {
          this.sequenceStep = 'pose';
          this.poseStart = now;
          void this.show('pose');
          this.onChange();
        }
        break;
      }
      case 'pose': {
        if (now - this.poseStart >= POSE_LOOP_MS) {
          this.sequenceStep = 'exit';
          void this.show('exit');
          this.onChange();
        }
        break;
      }
      case 'exit': {
        const c = get('exit');
        if (c.state === 'missing' || (this.active === c && this.nearEnd(c))) {
          this.sequenceStep = null;
          void this.show(null);
          this.onChange();
        }
        break;
      }
      default:
        break;
    }
  }

  update(now: number) {
    const f = this.fade;
    if (f && now - f.start >= CROSSFADE_MS) {
      this.fade = null;
      if (f.from && f.from !== f.to) this.park(f.from);
      this.onChange();
    }
    this.updateSequence(now);
  }

  drawables(now: number): Drawable[] {
    const f = this.fade;
    if (f) {
      const t = Math.min(1, Math.max(0, (now - f.start) / CROSSFADE_MS));
      const out: Drawable[] = [];
      if (f.from) out.push({ clip: f.from, opacity: 1 - t });
      if (f.to) out.push({ clip: f.to, opacity: t });
      return out;
    }
    return this.active ? [{ clip: this.active, opacity: 1 }] : [];
  }

  // Uploads the clip's frame if a new one is available.
  upload(clip: Clip) {
    if (clip.source.hasNewFrame()) {
      this.renderer.uploadVideo(clip.texture, clip.video);
      clip.source.markUploaded();
      clip.width = clip.video.videoWidth;
      clip.height = clip.video.videoHeight;
    }
  }
}
