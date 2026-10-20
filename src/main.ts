import './style.css';
import { applyCameraDefaults, clipRect, loadCalibration, saveCalibration } from './calibration';
import { Camera } from './camera';
import { ClipPlayer } from './clips';
import { FALLBACK_CLIP_ASPECT, PHOTO_JPEG_QUALITY, RING_TINT_COLOR } from './constants';
import { DebugOverlay } from './debug';
import { Detection } from './detection';
import { Flow } from './flow';
import { Panel } from './panel';
import { Renderer } from './renderer';
import { FloorRing } from './ring';
import { fitStage } from './stage';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const stage = $('stage');
const canvas = $('gl') as HTMLCanvasElement;
const notice = $('notice');
const debugCanvas = $('debug') as HTMLCanvasElement;
const videos = $('videos');
const panelRoot = $('panel');
const toggleButton = $('paneltoggle') as HTMLButtonElement;
// ?kiosk=1 hides the calibration button for installations. The C key still works.
const kioskMode = new URLSearchParams(location.search).get('kiosk') === '1';
toggleButton.hidden = kioskMode;

fitStage(stage, toggleButton);

function showNotice(text: string) {
  notice.textContent = text;
  notice.hidden = !text;
}


const cal = loadCalibration();

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  showNotice(err instanceof Error ? err.message : String(err));
  throw err;
}

const camera = new Camera(renderer, videos);

function refit() {
  fitStage(stage, toggleButton);
  camera.updateRotation();
}
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => setTimeout(refit, 100));
window.visualViewport?.addEventListener('resize', refit);
const player = new ClipPlayer(renderer, videos);
export const ring = new FloorRing();
export const detection = new Detection(camera);
const debugOverlay = new DebugOverlay(debugCanvas);

// Draws camera and characters. clean leaves out the ring and calibration aids.
function render(now: number, clean: boolean) {
  renderer.beginFrame();
  if (camera.upload(renderer)) {
    renderer.drawCamera(camera.texture, camera.width, camera.height, cal.camera.mirror, camera.rotation);
  } else {
    renderer.clear(0.13, 0.13, 0.15);
  }

  const list = player.drawables(now);
  if (!clean) ring.draw(renderer, cal, now, detection.trigger.state === 'counting' ? RING_TINT_COLOR : undefined);

  if (list.length) {
    for (const d of list) player.upload(d.clip);
    renderer.beginCharacters(list.length > 1);
    for (const d of list) {
      const c = d.clip;
      const aspect = c.width && c.height ? c.width / c.height : FALLBACK_CLIP_ASPECT;
      renderer.drawCharacter(c.texture, c.width || 1, c.height || 1, clipRect(cal, c.cfg.id, aspect), c.key, d.opacity);
    }
    renderer.endCharacters();
  }
  if (clean) return;

  if (cal.showOutline) {
    const shown = list.length ? list.map((d) => d.clip) : [...player.clips.values()].slice(0, 1);
    for (const c of shown) {
      const aspect = c.width && c.height ? c.width / c.height : FALLBACK_CLIP_ASPECT;
      renderer.drawOutline(clipRect(cal, c.cfg.id, aspect), [1, 0.4, 0.1, 0.9]);
    }
  }
  if (cal.showFloorLine) renderer.drawFloorLine(cal.ring.cy, [0.3, 0.9, 1, 0.9]);
}

// Renders a clean frame and reads it in the same task, as the canvas does
// not preserve its drawing buffer.
function capturePhoto(): Promise<Blob> {
  render(performance.now(), true);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', PHOTO_JPEG_QUALITY);
  });
}

export const flow = new Flow({
  player,
  ring,
  capture: capturePhoto,
  stage,
  prompt: $('prompt'),
  countdown: $('countdown'),
  flash: $('flash'),
  result: $('result'),
  canTapStart: () => !!panelRoot.hidden,
});
detection.trigger.onTrigger = () => flow.start();

const panel = new Panel({
  root: panelRoot,
  cal,
  player,
  camera,
  detection,
  flow,
  toggleButton: kioskMode ? null : toggleButton,
  onChange: () => saveCalibration(cal),
});

// Console handle for debugging and tests.
(window as unknown as { kiosk: unknown }).kiosk = { ring, detection, player, camera, cal, flow };

camera.onStarted = () => {
  camera.manualRotation = applyCameraDefaults(cal, camera.activeDeviceId, camera.facing);
  camera.updateRotation();
};
camera.onStatus = () => {
  showNotice(camera.error);
  panel.refreshAll();
};
player.onChange = () => panel.refreshStatus();
flow.onChange = () => panel.refreshStatus();

void camera.start(cal.camera.deviceId);

function frame(now: number) {
  player.update(now);
  flow.update(now);
  const stageEmpty = player.drawables(now).length === 0;
  // Detection only looks for a visitor while the flow waits with an empty stage.
  detection.update(now, cal, flow.state === 'waiting' && stageEmpty);
  ring.update(now, stageEmpty, cal.ring.showDuringClip);

  render(now, false);

  if (detection.debug) debugOverlay.draw(detection.poses, cal);
  else debugOverlay.clear();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
