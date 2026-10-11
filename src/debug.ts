import type { Calibration } from './calibration';
import { RING_INSIDE_MARGIN, STAGE_WIDTH } from './constants';
import type { DetectedPose } from './detection';

// 2D overlay on top of the stage for detection debugging. Never part of the
// WebGL canvas, so it cannot end up in a captured photo.
export class DebugOverlay {
  private ctx: CanvasRenderingContext2D;
  private cleared = true;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  private fit(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return true;
  }

  clear() {
    if (this.cleared) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.cleared = true;
  }

  draw(poses: DetectedPose[], cal: Calibration) {
    if (!this.fit()) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sx = W / STAGE_WIDTH;
    ctx.clearRect(0, 0, W, H);
    this.cleared = false;

    const r = cal.ring;
    const rx = r.halfWidth * STAGE_WIDTH * RING_INSIDE_MARGIN * sx;
    ctx.strokeStyle = 'rgba(80, 220, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.ellipse(r.cx * W, r.cy * H, rx, rx * r.flatness, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const dot = (x: number, y: number, color: string, size: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x * W, y * H, size, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of poses) {
      dot(p.leftAnkle.x, p.leftAnkle.y, p.leftVisible ? '#ff5050' : 'rgba(255,80,80,0.35)', 6);
      dot(p.rightAnkle.x, p.rightAnkle.y, p.rightVisible ? '#5080ff' : 'rgba(80,128,255,0.35)', 6);
      if (p.feet) dot(p.feet.x, p.feet.y, p.inside ? '#50ff80' : '#ffd050', 9);
    }
  }
}
