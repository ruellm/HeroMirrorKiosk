import type { ClipPlayer } from './clips';
import type { ClipId } from './clips.config';
import { COUNTDOWN_SECONDS, FLASH_MS, RESULT_TIMEOUT_MS } from './constants';
import type { FloorRing } from './ring';
import { STRINGS } from './strings';

export type FlowState = 'waiting' | 'entrance' | 'pose' | 'capture' | 'exit' | 'result';

export interface FlowDeps {
  player: ClipPlayer;
  ring: FloorRing;
  // Renders a clean frame and returns it as a JPEG.
  capture: () => Promise<Blob>;
  stage: HTMLElement;
  prompt: HTMLElement;
  countdown: HTMLElement;
  flash: HTMLElement;
  result: HTMLElement;
}

// Panel toggle zone in the top left, kept clear of tap to start.
const CORNER_PX = 120;

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

export class Flow {
  state: FlowState = 'waiting';
  photo: Blob | null = null;
  onChange: () => void = () => {};
  private token = 0;
  private busy = false;
  private poseStart = 0;
  private resultTimer = 0;
  private photoUrl = '';

  constructor(private d: FlowDeps) {
    d.ring.setAuto();
    this.showPrompt(STRINGS.stepIn);

    d.stage.addEventListener('pointerdown', (e) => {
      if (e.clientX <= CORNER_PX && e.clientY <= CORNER_PX) return;
      if (this.state === 'result') {
        this.armResultTimeout();
        return;
      }
      this.start();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON')) return;
      e.preventDefault();
      this.start();
    });
  }

  // Starts the flow from waiting. Ignored in any other state.
  start() {
    if (this.state !== 'waiting') return;
    this.enter('entrance');
  }

  // Returns to waiting from any state.
  reset() {
    this.token++;
    this.busy = false;
    void this.d.player.show(null);
    this.enter('waiting');
  }

  update(now: number) {
    if (this.busy) return;
    const p = this.d.player;
    switch (this.state) {
      case 'entrance':
        if (!this.isActive('entrance') || p.isNearEnd('entrance')) this.enter('pose', now);
        break;
      case 'pose': {
        const elapsed = now - this.poseStart;
        const left = COUNTDOWN_SECONDS - Math.floor(elapsed / 1000);
        this.d.countdown.textContent = String(Math.max(1, left));
        if (elapsed >= COUNTDOWN_SECONDS * 1000) this.enter('capture');
        break;
      }
      case 'exit':
        if (!this.isActive('exit') || p.isNearEnd('exit')) this.enter('result');
        break;
      default:
        break;
    }
  }

  private isActive(id: ClipId): boolean {
    return this.d.player.active?.cfg.id === id;
  }

  private enter(state: FlowState, now = performance.now()) {
    const d = this.d;
    if (this.state === 'result') this.leaveResult();
    this.state = state;
    this.onChange();
    switch (state) {
      case 'waiting':
        d.ring.setAuto();
        d.countdown.hidden = true;
        this.showPrompt(STRINGS.stepIn);
        break;
      case 'entrance':
        d.ring.setVisible(false);
        this.hidePrompt();
        this.play('entrance');
        break;
      case 'pose':
        this.play('pose');
        this.poseStart = now;
        this.showPrompt(STRINGS.smile);
        d.countdown.textContent = String(COUNTDOWN_SECONDS);
        d.countdown.hidden = false;
        break;
      case 'capture':
        this.hidePrompt();
        d.countdown.hidden = true;
        this.capture();
        break;
      case 'exit':
        break;
      case 'result':
        void d.player.show(null);
        this.showResult();
        break;
    }
  }

  // Starts a clip and blocks state polling until it is on stage.
  private play(id: ClipId) {
    const token = ++this.token;
    this.busy = true;
    void this.d.player.show(id).then(() => {
      if (token !== this.token) return;
      this.busy = false;
    });
  }

  private capture() {
    const token = ++this.token;
    this.busy = true;
    const d = this.d;
    const photo = d.capture().catch(() => null);
    this.flash();
    const exit = d.player.show('exit');
    void Promise.all([photo, exit]).then(([blob]) => {
      if (token !== this.token) return;
      this.photo = blob;
      this.busy = false;
      this.enter('exit');
    });
  }

  private flash() {
    const f = this.d.flash;
    f.style.transition = 'none';
    f.style.opacity = '1';
    requestAnimationFrame(() => {
      f.style.transition = 'opacity ' + FLASH_MS + 'ms ease-out';
      f.style.opacity = '0';
    });
  }

  private showPrompt(text: string) {
    this.d.prompt.textContent = text;
    this.d.prompt.hidden = false;
  }

  private hidePrompt() {
    this.d.prompt.hidden = true;
  }

  private showResult() {
    const r = this.d.result;
    r.replaceChildren();
    const file = this.photo ? new File([this.photo], 'heromirror-' + timestamp() + '.jpg', { type: 'image/jpeg' }) : null;
    if (file) {
      this.photoUrl = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.src = this.photoUrl;
      img.alt = '';
      r.append(img);
    }
    const h = document.createElement('h1');
    h.textContent = STRINGS.yourPhoto;
    r.append(h);

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const button = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      buttons.append(b);
    };
    if (file) {
      button(STRINGS.save, () => {
        const a = document.createElement('a');
        a.href = this.photoUrl;
        a.download = file.name;
        a.click();
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        button(STRINGS.share, () => {
          navigator.share({ files: [file] }).catch(() => {});
        });
      }
    }
    button(STRINGS.done, () => this.enter('waiting'));
    r.append(buttons);
    r.hidden = false;
    this.armResultTimeout();
  }

  private armResultTimeout() {
    clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => {
      if (this.state === 'result') this.enter('waiting');
    }, RESULT_TIMEOUT_MS);
  }

  private leaveResult() {
    clearTimeout(this.resultTimer);
    this.d.result.hidden = true;
    this.d.result.replaceChildren();
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
    this.photoUrl = '';
    this.photo = null;
  }
}
