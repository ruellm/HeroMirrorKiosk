import { CLIPS, type ClipAdjust, type ClipId } from './clips.config';
import { STAGE_ASPECT, STORAGE_KEY } from './constants';
import type { Rect } from './renderer';

// All values are normalized to the stage so they carry across screen sizes.
// global.scale: clip frame height as a fraction of stage height.
// global.x, global.y: offset of the clip's bottom right corner from the
// stage's bottom right corner, as fractions of stage width and height.
// ring.cx, ring.cy: ellipse center as fractions of stage width and height.
// ring.halfWidth: horizontal radius as a fraction of stage width.
// ring.flatness: vertical radius divided by horizontal radius, in pixels.
// ring.thickness: line width as a fraction of stage width.
export interface RingCalibration {
  cx: number;
  cy: number;
  halfWidth: number;
  flatness: number;
  thickness: number;
  showDuringClip: boolean;
}

export type Rotation = 0 | 90 | 180 | 270;

// Manual camera choices per device id. A missing field means use the default
// derived from the camera's facing mode.
export interface CameraDeviceCalibration {
  mirror?: boolean;
  rotation?: Rotation;
}

export interface Calibration {
  version: 1;
  global: { scale: number; x: number; y: number };
  clips: Record<ClipId, ClipAdjust>;
  // mirror is the value in effect for the active camera.
  camera: { deviceId: string; mirror: boolean; byDevice: Record<string, CameraDeviceCalibration> };
  showOutline: boolean;
  ring: RingCalibration;
  showFloorLine: boolean;
  detection: { enabled: boolean };
}

export function defaultCalibration(): Calibration {
  const clips = {} as Record<ClipId, ClipAdjust>;
  for (const c of CLIPS) clips[c.id] = { ...c.adjust };
  return {
    version: 1,
    global: { scale: 1, x: 0, y: 0 },
    clips,
    camera: { deviceId: '', mirror: true, byDevice: {} },
    showOutline: false,
    ring: { cx: 0.3, cy: 0.85, halfWidth: 0.2, flatness: 0.3, thickness: 0.008, showDuringClip: false },
    showFloorLine: false,
    detection: { enabled: true },
  };
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' ? (v as Obj) : {};
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function rotation(v: unknown): Rotation | undefined {
  return v === 0 || v === 90 || v === 180 || v === 270 ? v : undefined;
}

function byDevice(v: unknown): Record<string, CameraDeviceCalibration> {
  const out: Record<string, CameraDeviceCalibration> = {};
  for (const [id, raw] of Object.entries(obj(v))) {
    const d = obj(raw);
    const e: CameraDeviceCalibration = {};
    if (typeof d.mirror === 'boolean') e.mirror = d.mirror;
    const r = rotation(d.rotation);
    if (r !== undefined) e.rotation = r;
    out[id] = e;
  }
  return out;
}

// Fills a calibration from untrusted input, falling back to defaults per field.
export function normalizeCalibration(input: unknown): Calibration {
  const d = defaultCalibration();
  const o = obj(input);
  const g = obj(o.global);
  const cam = obj(o.camera);
  const ring = obj(o.ring);
  const clipsIn = obj(o.clips);
  const clips = {} as Record<ClipId, ClipAdjust>;
  for (const c of CLIPS) {
    const a = obj(clipsIn[c.id]);
    const dd = d.clips[c.id];
    clips[c.id] = { dx: num(a.dx, dd.dx), dy: num(a.dy, dd.dy), scale: num(a.scale, dd.scale) };
  }
  return {
    version: 1,
    global: { scale: num(g.scale, d.global.scale), x: num(g.x, d.global.x), y: num(g.y, d.global.y) },
    clips,
    camera: {
      deviceId: str(cam.deviceId, d.camera.deviceId),
      mirror: bool(cam.mirror, d.camera.mirror),
      byDevice: byDevice(cam.byDevice),
    },
    showOutline: bool(o.showOutline, d.showOutline),
    ring: {
      cx: num(ring.cx, d.ring.cx),
      cy: num(ring.cy, d.ring.cy),
      halfWidth: num(ring.halfWidth, d.ring.halfWidth),
      flatness: num(ring.flatness, d.ring.flatness),
      thickness: num(ring.thickness, d.ring.thickness),
      showDuringClip: bool(ring.showDuringClip, d.ring.showDuringClip),
    },
    showFloorLine: bool(o.showFloorLine, d.showFloorLine),
    detection: { enabled: bool(obj(o.detection).enabled, d.detection.enabled) },
  };
}

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeCalibration(JSON.parse(raw)) : defaultCalibration();
  } catch {
    return defaultCalibration();
  }
}

export function saveCalibration(cal: Calibration) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
  } catch {
    // storage unavailable, keep running with in memory values
  }
}

export function exportJSON(cal: Calibration): string {
  return JSON.stringify(cal, null, 2);
}

export function importJSON(text: string): Calibration {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !('global' in parsed)) {
    throw new Error('Not a calibration JSON (no "global" field)');
  }
  return normalizeCalibration(parsed);
}

// Copies values into an existing object so other modules keep their reference.
export function applyCalibration(target: Calibration, source: Calibration) {
  target.global = { ...source.global };
  for (const c of CLIPS) target.clips[c.id] = { ...source.clips[c.id] };
  target.camera = { ...source.camera, byDevice: byDevice(source.camera.byDevice) };
  target.showOutline = source.showOutline;
  target.ring = { ...source.ring };
  target.showFloorLine = source.showFloorLine;
  target.detection = { ...source.detection };
}

export function cameraDeviceKey(deviceId: string): string {
  return deviceId || 'default';
}

// Sets the mirror in effect for a camera and returns its manual rotation.
// Without a manual choice, a back camera is not mirrored and a front or
// unknown camera is.
export function applyCameraDefaults(cal: Calibration, deviceId: string, facing: string): Rotation | null {
  const d = cal.camera.byDevice[cameraDeviceKey(deviceId)] ?? {};
  cal.camera.mirror = d.mirror ?? facing !== 'environment';
  return d.rotation ?? null;
}

// Clip frame rect in stage units, pivoting at the bottom right corner.
export function clipRect(cal: Calibration, id: ClipId, clipAspect: number): Rect {
  const g = cal.global;
  const a = cal.clips[id];
  const scale = g.scale * a.scale;
  const h = scale;
  const w = (scale * clipAspect) / STAGE_ASPECT;
  const right = 1 + g.x + a.dx;
  const bottom = 1 + g.y + a.dy;
  return { x: right - w, y: bottom - h, w, h };
}
