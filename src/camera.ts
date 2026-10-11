import type { Renderer } from './renderer';
import { VideoSource } from './video';

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const e = err as { name: string; message?: string };
    const hints: Record<string, string> = {
      NotAllowedError: 'camera permission denied',
      NotFoundError: 'no camera found',
      NotReadableError: 'camera is in use or cannot be read',
      OverconstrainedError: 'requested camera not available',
      SecurityError: 'camera blocked by browser security settings',
    };
    const hint = hints[e.name] ? hints[e.name] + ' ' : '';
    return hint + '(' + e.name + (e.message ? ': ' + e.message : '') + ')';
  }
  return String(err);
}

export class Camera {
  readonly video = document.createElement('video');
  readonly source: VideoSource;
  readonly texture: WebGLTexture;
  stream: MediaStream | null = null;
  error = '';
  devices: MediaDeviceInfo[] = [];
  activeDeviceId = '';
  // Dimensions of the frame currently on the GPU.
  width = 0;
  height = 0;
  onStatus: () => void = () => {};
  private token = 0;

  constructor(renderer: Renderer, container: HTMLElement) {
    const v = this.video;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.autoplay = true;
    container.appendChild(v);
    this.source = new VideoSource(v);
    this.texture = renderer.createTexture();
    if (navigator.mediaDevices && 'addEventListener' in navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => void this.refreshDevices());
    }
  }

  get ready(): boolean {
    return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async start(deviceId: string) {
    const token = ++this.token;
    this.stop();
    if (!window.isSecureContext) {
      this.error = 'Camera needs a secure context. Open the https:// URL.';
      this.onStatus();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.error = 'getUserMedia is not available in this browser';
      this.onStatus();
      return;
    }
    const attempts: MediaTrackConstraints[] = [];
    if (deviceId) attempts.push({ deviceId: { exact: deviceId } });
    attempts.push({ facingMode: 'user' });

    let stream: MediaStream | null = null;
    let lastErr: unknown = null;
    for (const base of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...base, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (token !== this.token) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (!stream) {
      this.error = 'Camera unavailable: ' + describeError(lastErr);
      this.onStatus();
      return;
    }

    this.stream = stream;
    this.error = '';
    const track = stream.getVideoTracks()[0];
    this.activeDeviceId = track ? track.getSettings().deviceId ?? '' : '';
    if (track) {
      track.addEventListener('ended', () => {
        if (this.stream === stream) {
          this.error = 'Camera stream ended';
          this.onStatus();
        }
      });
    }
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (err) {
      this.error = 'Camera play failed: ' + describeError(err);
    }
    await this.refreshDevices();
    this.onStatus();
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.activeDeviceId = '';
    this.width = 0;
    this.height = 0;
  }

  async refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter((d) => d.kind === 'videoinput');
    } catch {
      this.devices = [];
    }
    this.onStatus();
  }

  // Uploads a new frame if there is one. Returns true when a frame is on the GPU.
  upload(renderer: Renderer): boolean {
    if (this.ready && this.source.hasNewFrame()) {
      renderer.uploadVideo(this.texture, this.video);
      this.source.markUploaded();
      this.width = this.video.videoWidth;
      this.height = this.video.videoHeight;
    }
    return !!this.stream && this.width > 0;
  }
}
