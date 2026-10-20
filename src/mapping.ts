import { STAGE_ASPECT, STAGE_HEIGHT, STAGE_WIDTH } from './constants';
import type { RingCalibration, Rotation } from './calibration';

export interface StagePoint {
  x: number;
  y: number;
}

// Maps a point normalized to the raw camera frame (0..1, y down) to stage
// units, using the same rotation, cover fit crop and mirror as the camera
// shader. Points outside 0..1 are cropped off the stage.
export function cameraToStage(
  nx: number,
  ny: number,
  videoW: number,
  videoH: number,
  mirror: boolean,
  rotation: Rotation = 0,
): StagePoint {
  let x = nx;
  let y = ny;
  if (rotation === 90) [x, y] = [1 - ny, nx];
  else if (rotation === 180) [x, y] = [1 - nx, 1 - ny];
  else if (rotation === 270) [x, y] = [ny, 1 - nx];
  const va = rotation % 180 ? videoH / videoW : videoW / videoH;
  const sx = va > STAGE_ASPECT ? STAGE_ASPECT / va : 1;
  const sy = va > STAGE_ASPECT ? 1 : va / STAGE_ASPECT;
  const ux = mirror ? 1 - x : x;
  return { x: (ux - 0.5) / sx + 0.5, y: (y - 0.5) / sy + 0.5 };
}

// True when the stage point lies inside the ring ellipse scaled by margin.
export function insideRing(p: StagePoint, ring: RingCalibration, margin: number): boolean {
  const rx = ring.halfWidth * STAGE_WIDTH * margin;
  const ry = rx * ring.flatness;
  if (rx <= 0 || ry <= 0) return false;
  const dx = ((p.x - ring.cx) * STAGE_WIDTH) / rx;
  const dy = ((p.y - ring.cy) * STAGE_HEIGHT) / ry;
  return dx * dx + dy * dy <= 1;
}
