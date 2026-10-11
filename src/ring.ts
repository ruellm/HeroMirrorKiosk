import type { Calibration } from './calibration';
import {
  CHEVRON_ABOVE_RING_PX,
  CHEVRON_BOB_PERIOD_MS,
  CHEVRON_BOB_PX,
  CHEVRON_GAP_PX,
  CHEVRON_HALF_WIDTH_PX,
  RING_FADE_MS,
  RING_PULSE_MAX_SCALE,
  RING_PULSE_PERIOD_MS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from './constants';
import type { Renderer } from './renderer';

// Floor ring: visible while the stage is empty unless overridden.
export class FloorRing {
  opacity = 0;
  private override: boolean | null = null;
  private lastNow = -1;

  // Force the ring on or off. setAuto() returns to the stage empty rule.
  setVisible(visible: boolean) {
    this.override = visible;
  }

  setAuto() {
    this.override = null;
  }

  update(now: number, stageEmpty: boolean, keepDuringClip: boolean) {
    const target = (this.override ?? (stageEmpty || keepDuringClip)) ? 1 : 0;
    const dt = this.lastNow < 0 ? 0 : now - this.lastNow;
    this.lastNow = now;
    const step = dt / RING_FADE_MS;
    this.opacity += Math.max(-step, Math.min(step, target - this.opacity));
  }

  draw(renderer: Renderer, cal: Calibration, now: number, tint: [number, number, number] = [1, 1, 1]) {
    if (this.opacity <= 0) return;
    const r = cal.ring;
    const cx = r.cx * STAGE_WIDTH;
    const cy = r.cy * STAGE_HEIGHT;
    const rx = Math.max(1, r.halfWidth * STAGE_WIDTH);
    const ry = Math.max(1, rx * r.flatness);
    const thick = Math.max(1, r.thickness * STAGE_WIDTH);

    const pulse = (now % RING_PULSE_PERIOD_MS) / RING_PULSE_PERIOD_MS;
    const eased = 1 - (1 - pulse) * (1 - pulse);
    renderer.drawRing({
      cx, cy, rx, ry, thick,
      pulseScale: 1 + (RING_PULSE_MAX_SCALE - 1) * eased,
      pulseAlpha: 1 - pulse,
      opacity: this.opacity,
      color: tint,
    });

    const bob = Math.sin((now / CHEVRON_BOB_PERIOD_MS) * Math.PI * 2) * CHEVRON_BOB_PX;
    renderer.drawChevrons({
      x: cx,
      y: cy - ry - CHEVRON_ABOVE_RING_PX + bob,
      size: CHEVRON_HALF_WIDTH_PX,
      gap: CHEVRON_GAP_PX,
      thick: Math.max(thick, 6),
      opacity: this.opacity,
    });
  }
}
