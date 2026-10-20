import {
  applyCalibration,
  cameraDeviceKey,
  defaultCalibration,
  exportJSON,
  importJSON,
  type Calibration,
  type Rotation,
} from './calibration';
import type { Camera } from './camera';
import type { ClipPlayer } from './clips';
import { CLIPS, type ClipId } from './clips.config';
import { PANEL_STORAGE_KEY } from './constants';
import type { Detection } from './detection';
import type { Flow } from './flow';

export interface PanelDeps {
  root: HTMLElement;
  cal: Calibration;
  player: ClipPlayer;
  camera: Camera;
  detection: Detection;
  flow: Flow;
  // Visible toggle button over the stage, null when hidden by ?kiosk=1.
  toggleButton: HTMLButtonElement | null;
  // Called after any calibration value changes.
  onChange: () => void;
}

type Attrs = Record<string, string | number | boolean>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) e.append(c);
  return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

interface Bound {
  node: HTMLElement;
  refresh: () => void;
}

function sliderRow(
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
): Bound {
  const range = el('input', { type: 'range', min, max, step });
  const num = el('input', { type: 'number', min, max, step });
  const refresh = () => {
    const v = get();
    range.value = String(v);
    num.value = String(+v.toFixed(4));
  };
  const apply = (v: number) => {
    if (!isFinite(v)) return;
    set(v);
    refresh();
  };
  range.addEventListener('input', () => apply(+range.value));
  num.addEventListener('change', () => apply(+num.value));
  refresh();
  return { node: el('div', { class: 'row' }, el('label', {}, label), range, num), refresh };
}

function checkRow(label: string, get: () => boolean, set: (v: boolean) => void): Bound {
  const box = el('input', { type: 'checkbox' });
  box.addEventListener('change', () => set(box.checked));
  const refresh = () => {
    box.checked = get();
  };
  refresh();
  return { node: el('label', { class: 'row check' }, box, label), refresh };
}

const FACING_LABEL: Record<string, string> = { user: 'front', environment: 'back' };

// Collapsed section titles, kept across reloads.
function loadClosedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    const o = raw ? (JSON.parse(raw) as { closed?: unknown }) : {};
    return new Set(Array.isArray(o.closed) ? o.closed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export class Panel {
  private root: HTMLElement;
  private sections: HTMLFieldSetElement[] = [];
  private closed = loadClosedSections();
  private bound: Bound[] = [];
  private status: HTMLElement;
  private detectionStatus: HTMLElement;
  private flowStatus: HTMLElement;
  private deviceSelect: HTMLSelectElement;
  private rotationSelect: HTMLSelectElement;
  private jsonBox: HTMLTextAreaElement;
  private jsonMsg: HTMLElement;
  private selectedClip: ClipId = CLIPS[0].id;

  constructor(private deps: PanelDeps) {
    this.root = deps.root;
    this.status = el('pre', { class: 'status' });
    this.detectionStatus = el('pre', { class: 'status' });
    this.flowStatus = el('pre', { class: 'status' });
    this.deviceSelect = el('select');
    this.rotationSelect = el('select');
    this.jsonBox = el('textarea', { spellcheck: 'false', rows: 8 });
    this.jsonMsg = el('span', { class: 'hint' });
    this.build();
    this.installToggles();
    setInterval(() => this.refreshDetection(), 250);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(show = this.root.hidden) {
    this.root.hidden = !show;
    const b = this.deps.toggleButton;
    if (b) b.textContent = show ? '>>' : '<<';
    if (show) this.refreshAll();
  }

  // Section with a title that collapses it. The CSS hides the contents of a
  // closed section only on narrow viewports.
  private section(name: string, ...children: Array<Node | string>): HTMLFieldSetElement {
    const legend = el('legend', {}, name);
    const f = el('fieldset', { 'data-section': name }, legend, ...children);
    f.classList.toggle('closed', this.closed.has(name));
    legend.addEventListener('click', () => {
      if (this.closed.has(name)) this.closed.delete(name);
      else this.closed.add(name);
      f.classList.toggle('closed', this.closed.has(name));
      try {
        localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ closed: [...this.closed] }));
      } catch {
        // storage unavailable
      }
    });
    this.sections.push(f);
    return f;
  }

  private build() {
    const { cal, player, camera } = this.deps;
    const changed = () => this.deps.onChange();
    const root = this.root;
    root.replaceChildren();

    root.append(
      el('div', { class: 'head' }, el('b', {}, 'Calibration'), el('span', { class: 'hint' }, 'C key or the << button')),
      this.section('Status', this.status),
    );

    const { flow } = this.deps;
    root.append(
      this.section(
        'Flow',
        this.flowStatus,
        el(
          'div',
          { class: 'buttons' },
          button('Start', () => flow.start()),
          button('Reset', () => flow.reset()),
        ),
      ),
    );

    // Manual playback is for calibration and only makes sense while waiting.
    const manual = (fn: () => void) => () => {
      if (flow.state !== 'waiting') return;
      player.stopSequence();
      fn();
    };
    root.append(
      this.section(
        'Playback',
        el(
          'div',
          { class: 'buttons' },
          button('Entrance', manual(() => void player.show('entrance'))),
          button('Loop pose', manual(() => void player.show('pose'))),
          button('Exit', manual(() => void player.show('exit'))),
          button('Hide', manual(() => void player.show(null))),
          button('Run sequence', manual(() => player.runSequence())),
        ),
      ),
    );

    const g = () => cal.global;
    const global = this.section('Global placement');
    for (const b of [
      sliderRow('Scale', 0.25, 2.5, 0.001, () => g().scale, (v) => { g().scale = v; changed(); }),
      sliderRow('X', -0.5, 0.5, 0.001, () => g().x, (v) => { g().x = v; changed(); }),
      sliderRow('Y', -0.5, 0.5, 0.001, () => g().y, (v) => { g().y = v; changed(); }),
    ]) {
      this.bound.push(b);
      global.append(b.node);
    }
    root.append(global);

    const clipSelect = el('select');
    for (const c of CLIPS) clipSelect.append(el('option', { value: c.id }, c.id + ' (' + c.file + ')'));
    clipSelect.addEventListener('change', () => {
      this.selectedClip = clipSelect.value as ClipId;
      this.refreshAll();
    });
    const a = () => cal.clips[this.selectedClip];
    const clipSet = this.section('Clip adjust', el('div', { class: 'row' }, el('label', {}, 'Clip'), clipSelect));
    for (const b of [
      sliderRow('dx', -0.25, 0.25, 0.001, () => a().dx, (v) => { a().dx = v; changed(); }),
      sliderRow('dy', -0.25, 0.25, 0.001, () => a().dy, (v) => { a().dy = v; changed(); }),
      sliderRow('Scale mult', 0.5, 1.5, 0.001, () => a().scale, (v) => { a().scale = v; changed(); }),
    ]) {
      this.bound.push(b);
      clipSet.append(b.node);
    }
    root.append(clipSet);

    this.deviceSelect.addEventListener('change', () => {
      cal.camera.deviceId = this.deviceSelect.value;
      changed();
      void camera.start(cal.camera.deviceId);
    });
    // Mirror and rotation are remembered per camera device.
    const deviceCal = () => {
      const key = cameraDeviceKey(camera.activeDeviceId);
      return (cal.camera.byDevice[key] ??= {});
    };
    const mirror = checkRow('Mirror', () => cal.camera.mirror, (v) => {
      cal.camera.mirror = v;
      deviceCal().mirror = v;
      changed();
    });
    for (const [v, label] of [['', 'Auto'], ['0', '0'], ['90', '90'], ['180', '180'], ['270', '270']]) {
      this.rotationSelect.append(el('option', { value: v }, label));
    }
    this.rotationSelect.addEventListener('change', () => {
      const v = this.rotationSelect.value;
      const d = deviceCal();
      if (v === '') delete d.rotation;
      else d.rotation = +v as Rotation;
      camera.manualRotation = d.rotation ?? null;
      camera.updateRotation();
      changed();
    });
    const rotation: Bound = {
      node: el('div', { class: 'row' }, el('label', {}, 'Rotate'), this.rotationSelect),
      refresh: () => {
        const r = cal.camera.byDevice[cameraDeviceKey(camera.activeDeviceId)]?.rotation;
        this.rotationSelect.value = r === undefined ? '' : String(r);
      },
    };
    this.bound.push(mirror, rotation);
    root.append(
      this.section(
        'Camera',
        el('div', { class: 'row' }, el('label', {}, 'Device'), this.deviceSelect),
        mirror.node,
        rotation.node,
      ),
    );

    const outline = checkRow('Draw clip frame outline', () => cal.showOutline, (v) => { cal.showOutline = v; changed(); });
    this.bound.push(outline);
    root.append(this.section('View', outline.node));

    const r = () => cal.ring;
    const ringSet = this.section('Floor ring');
    for (const b of [
      sliderRow('Center x', 0, 1, 0.001, () => r().cx, (v) => { r().cx = v; changed(); }),
      sliderRow('Center y', 0, 1, 0.001, () => r().cy, (v) => { r().cy = v; changed(); }),
      sliderRow('Half width', 0.02, 0.6, 0.001, () => r().halfWidth, (v) => { r().halfWidth = v; changed(); }),
      sliderRow('Flatness', 0.05, 1, 0.001, () => r().flatness, (v) => { r().flatness = v; changed(); }),
      sliderRow('Thickness', 0.001, 0.03, 0.0005, () => r().thickness, (v) => { r().thickness = v; changed(); }),
      checkRow('Keep visible while a clip plays', () => r().showDuringClip, (v) => { r().showDuringClip = v; changed(); }),
      checkRow('Floor line at ring center', () => cal.showFloorLine, (v) => { cal.showFloorLine = v; changed(); }),
    ]) {
      this.bound.push(b);
      ringSet.append(b.node);
    }
    root.append(ringSet);

    const { detection } = this.deps;
    const detEnable = checkRow('Enable detection', () => cal.detection.enabled, (v) => { cal.detection.enabled = v; changed(); });
    const detDebug = checkRow('Draw ankles and feet point', () => detection.debug, (v) => { detection.debug = v; });
    this.bound.push(detEnable, detDebug);
    root.append(this.section('Detection', this.detectionStatus, detEnable.node, detDebug.node));

    root.append(
      this.section(
        'Calibration JSON',
        el(
          'div',
          { class: 'buttons' },
          button('Export', () => this.exportToBox()),
          button('Import', () => this.importFromBox()),
          button('Reset values', () => {
            applyCalibration(cal, defaultCalibration());
            changed();
            this.refreshAll();
            void camera.start(cal.camera.deviceId);
          }),
          this.jsonMsg,
        ),
        this.jsonBox,
      ),
    );
  }

  private exportToBox() {
    const txt = exportJSON(this.deps.cal);
    this.jsonBox.value = txt;
    this.flash('Exported.');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(
        () => this.flash('Copied to clipboard.'),
        () => this.flash('Exported. Clipboard blocked, copy from the box.'),
      );
    }
  }

  private importFromBox() {
    const { cal, camera } = this.deps;
    try {
      const next = importJSON(this.jsonBox.value);
      applyCalibration(cal, next);
      this.deps.onChange();
      this.refreshAll();
      if (cal.camera.deviceId !== camera.activeDeviceId) void camera.start(cal.camera.deviceId);
      this.flash('Imported.');
    } catch (err) {
      this.flash('Import failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private flash(msg: string) {
    this.jsonMsg.textContent = msg;
    setTimeout(() => {
      if (this.jsonMsg.textContent === msg) this.jsonMsg.textContent = '';
    }, 3000);
  }

  refreshAll() {
    for (const b of this.bound) b.refresh();
    this.refreshDevices();
    this.refreshStatus();
    this.refreshDetection();
  }

  refreshDetection() {
    if (!this.visible) return;
    this.detectionStatus.textContent = this.deps.detection.status();
  }

  refreshDevices() {
    const { cal, camera } = this.deps;
    const sel = this.deviceSelect;
    sel.replaceChildren(el('option', { value: '' }, 'Default (front camera)'));
    camera.devices.forEach((d, i) => {
      const facing = FACING_LABEL[camera.facingById[d.deviceId]];
      const label = (d.label || 'Camera ' + (i + 1)) + (facing ? ' (' + facing + ')' : '');
      sel.append(el('option', { value: d.deviceId }, label));
    });
    sel.value = cal.camera.deviceId;
    if (sel.value !== cal.camera.deviceId) sel.value = '';
  }

  refreshStatus() {
    if (!this.visible) return;
    const { camera, player } = this.deps;
    const lines: string[] = [];
    if (camera.error) lines.push('camera: ' + camera.error);
    else if (camera.stream) {
      let s = 'camera: ' + camera.video.videoWidth + 'x' + camera.video.videoHeight;
      if (camera.facing) s += ' ' + FACING_LABEL[camera.facing];
      if (camera.rotation) s += ', rotated ' + camera.rotation;
      lines.push(s);
    } else lines.push('camera: starting');
    for (const c of player.clips.values()) {
      let s: string;
      if (c.state === 'missing') s = 'MISSING, ' + c.error;
      else if (c.state === 'loading') s = 'loading';
      else s = c.width + 'x' + c.height + ', ' + c.duration.toFixed(2) + ' s';
      lines.push(c.cfg.id + ' ' + c.cfg.file + ': ' + s);
    }
    lines.push(
      'playing: ' + (player.active ? player.active.cfg.id : 'none') +
        (player.fading ? ' (crossfade)' : '') +
        (player.sequenceStep ? ', sequence: ' + player.sequenceStep : ''),
    );
    this.status.textContent = lines.join('\n');
    this.flowStatus.textContent = 'state: ' + this.deps.flow.state;
  }

  private installToggles() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))) return;
      this.toggle();
    });
    const b = this.deps.toggleButton;
    if (b) {
      // Stop the tap reaching the stage, which would start the flow.
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => this.toggle());
    }
  }
}
