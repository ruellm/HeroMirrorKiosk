import type { Rotation } from './calibration';
import { STAGE_ASPECT, STAGE_HEIGHT, STAGE_WIDTH } from './constants';
import {
  CAMERA_FS, CHARACTER_FS, CHEVRON_FS, COMPOSITE_FS, FULLSCREEN_VS, OUTLINE_FS, QUAD_VS, RING_FS,
} from './shaders';

// Stage units: x, y, w, h as fractions of the stage, y down.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KeyUniforms {
  key: [number, number, number];
  keyMode: number;
  tol: number;
  soft: number;
  spill: number;
  spillBal: number;
  choke: number;
  crop: [number, number, number, number];
}

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

const OUTLINE_BORDER_PX = 4;
const FLOOR_LINE_PX = 3;

// Pixel space description of the ring, stage pixels, y down.
export interface RingDraw {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  thick: number;
  pulseScale: number;
  pulseAlpha: number;
  opacity: number;
  color: [number, number, number];
}

export interface ChevronDraw {
  x: number;
  y: number;
  size: number;
  gap: number;
  thick: number;
  opacity: number;
}

function pxRect(x: number, y: number, w: number, h: number): Rect {
  return { x: x / STAGE_WIDTH, y: y / STAGE_HEIGHT, w: w / STAGE_WIDTH, h: h / STAGE_HEIGHT };
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private cameraProg: Program;
  private characterProg: Program;
  private compositeProg: Program;
  private outlineProg: Program;
  private ringProg: Program;
  private chevronProg: Program;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private inFbo = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = STAGE_WIDTH;
    canvas.height = STAGE_HEIGHT;
    // preserveDrawingBuffer is off for speed. To capture a photo, run a
    // render synchronously and read the canvas in the same task.
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;

    this.cameraProg = this.build(FULLSCREEN_VS, CAMERA_FS, ['u_flipY', 'u_tex', 'u_scale', 'u_mirror', 'u_rot']);
    this.compositeProg = this.build(FULLSCREEN_VS, COMPOSITE_FS, ['u_flipY', 'u_tex']);
    this.characterProg = this.build(QUAD_VS, CHARACTER_FS, [
      'u_rect', 'u_video', 'u_key', 'u_tol', 'u_soft', 'u_spill', 'u_spillBal', 'u_keyMode', 'u_choke',
      'u_videoSize', 'u_crop', 'u_opacity',
    ]);
    this.outlineProg = this.build(QUAD_VS, OUTLINE_FS, ['u_rect', 'u_sizePx', 'u_border', 'u_color']);
    this.ringProg = this.build(QUAD_VS, RING_FS, [
      'u_rect', 'u_rectPx', 'u_center', 'u_radius', 'u_thick', 'u_pulseScale', 'u_pulseAlpha', 'u_opacity', 'u_color',
    ]);
    this.chevronProg = this.build(QUAD_VS, CHEVRON_FS, [
      'u_rect', 'u_rectPx', 'u_center', 'u_size', 'u_gap', 'u_thick', 'u_opacity',
    ]);

    gl.bindVertexArray(gl.createVertexArray());
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  private build(vs: string, fs: string, uniforms: string[]): Program {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(prog, n);
    return { prog, u };
  }

  createTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('createTexture failed');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return t;
  }

  uploadVideo(tex: WebGLTexture, video: HTMLVideoElement) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  beginFrame() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    gl.disable(gl.BLEND);
  }

  clear(r: number, g: number, b: number) {
    const gl = this.gl;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // rotation turns the raw frame clockwise before the cover fit.
  drawCamera(tex: WebGLTexture, videoW: number, videoH: number, mirror: boolean, rotation: Rotation = 0) {
    const gl = this.gl;
    const va = rotation % 180 ? videoH / videoW : videoW / videoH;
    const sx = va > STAGE_ASPECT ? STAGE_ASPECT / va : 1;
    const sy = va > STAGE_ASPECT ? 1 : va / STAGE_ASPECT;
    const p = this.cameraProg;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.uniform1f(p.u.u_flipY, 1);
    gl.uniform2f(p.u.u_scale, sx, sy);
    gl.uniform1f(p.u.u_mirror, mirror ? 1 : 0);
    gl.uniform1i(p.u.u_rot, rotation / 90);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // With twoLayers the characters are summed into an offscreen buffer as an
  // exact premultiplied lerp, so a crossfade never dips in coverage.
  beginCharacters(twoLayers: boolean) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (twoLayers) {
      this.ensureFbo();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.inFbo = true;
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.inFbo = false;
    }
  }

  drawCharacter(tex: WebGLTexture, videoW: number, videoH: number, rect: Rect, k: KeyUniforms, opacity: number) {
    const gl = this.gl;
    const p = this.characterProg;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u.u_video, 0);
    gl.uniform4f(p.u.u_rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform3f(p.u.u_key, k.key[0], k.key[1], k.key[2]);
    gl.uniform1f(p.u.u_tol, k.tol);
    gl.uniform1f(p.u.u_soft, k.soft);
    gl.uniform1f(p.u.u_spill, k.spill);
    gl.uniform1f(p.u.u_spillBal, k.spillBal);
    gl.uniform1i(p.u.u_keyMode, k.keyMode);
    gl.uniform1f(p.u.u_choke, k.choke);
    gl.uniform2f(p.u.u_videoSize, videoW, videoH);
    gl.uniform4f(p.u.u_crop, k.crop[0], k.crop[1], k.crop[2], k.crop[3]);
    gl.uniform1f(p.u.u_opacity, opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  endCharacters() {
    const gl = this.gl;
    if (!this.inFbo) return;
    this.inFbo = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.compositeProg;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.uniform1f(p.u.u_flipY, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawOutline(rect: Rect, rgba: [number, number, number, number]) {
    const gl = this.gl;
    const p = this.outlineProg;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.prog);
    gl.uniform4f(p.u.u_rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2f(p.u.u_sizePx, rect.w * STAGE_WIDTH, rect.h * STAGE_HEIGHT);
    gl.uniform1f(p.u.u_border, OUTLINE_BORDER_PX);
    const a = rgba[3];
    gl.uniform4f(p.u.u_color, rgba[0] * a, rgba[1] * a, rgba[2] * a, a);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawRing(r: RingDraw) {
    const gl = this.gl;
    const p = this.ringProg;
    const margin = r.thick * 6;
    const ex = r.rx * Math.max(1, r.pulseScale) + margin;
    const ey = r.ry * Math.max(1, r.pulseScale) + margin;
    const x = r.cx - ex, y = r.cy - ey, w = ex * 2, h = ey * 2;
    const rect = pxRect(x, y, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.prog);
    gl.uniform4f(p.u.u_rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform4f(p.u.u_rectPx, x, y, w, h);
    gl.uniform2f(p.u.u_center, r.cx, r.cy);
    gl.uniform2f(p.u.u_radius, r.rx, r.ry);
    gl.uniform1f(p.u.u_thick, r.thick);
    gl.uniform1f(p.u.u_pulseScale, r.pulseScale);
    gl.uniform1f(p.u.u_pulseAlpha, r.pulseAlpha);
    gl.uniform1f(p.u.u_opacity, r.opacity);
    gl.uniform3f(p.u.u_color, r.color[0], r.color[1], r.color[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawChevrons(c: ChevronDraw) {
    const gl = this.gl;
    const p = this.chevronProg;
    const margin = c.thick * 6;
    const x = c.x - c.size - margin;
    const y = c.y - c.gap - c.size * 0.6 - margin;
    const w = (c.size + margin) * 2;
    const h = c.gap + c.size * 0.6 + margin * 2;
    const rect = pxRect(x, y, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.prog);
    gl.uniform4f(p.u.u_rect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform4f(p.u.u_rectPx, x, y, w, h);
    gl.uniform2f(p.u.u_center, c.x, c.y);
    gl.uniform1f(p.u.u_size, c.size);
    gl.uniform1f(p.u.u_gap, c.gap);
    gl.uniform1f(p.u.u_thick, c.thick);
    gl.uniform1f(p.u.u_opacity, c.opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Horizontal line across the stage at y (stage units).
  drawFloorLine(y: number, rgba: [number, number, number, number]) {
    const h = FLOOR_LINE_PX / STAGE_HEIGHT;
    this.drawOutline({ x: 0, y: y - h / 2, w: 1, h }, rgba);
  }

  private ensureFbo() {
    if (this.fbo) return;
    const gl = this.gl;
    this.fboTex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, STAGE_WIDTH, STAGE_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: ' + status);
  }
}
