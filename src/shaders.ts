// Full screen triangle. u_flipY = 1 puts texture row 0 at the top of the stage.
export const FULLSCREEN_VS = `#version 300 es
uniform float u_flipY;
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  v_uv = vec2(p.x, mix(p.y, 1.0 - p.y, u_flipY));
}`;

// Cover fit camera frame, optional horizontal mirror, then u_rot quarter
// turns clockwise on the raw frame.
export const CAMERA_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_scale;
uniform float u_mirror;
uniform int u_rot;
void main() {
  vec2 uv = (v_uv - 0.5) * u_scale + 0.5;
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
  if (u_rot == 1) uv = vec2(uv.y, 1.0 - uv.x);
  else if (u_rot == 2) uv = vec2(1.0 - uv.x, 1.0 - uv.y);
  else if (u_rot == 3) uv = vec2(1.0 - uv.y, uv.x);
  o = vec4(texture(u_tex, uv).rgb, 1.0);
}`;

// Composites the premultiplied crossfade buffer over the stage.
export const COMPOSITE_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
void main() {
  o = texture(u_tex, v_uv);
}`;

// Quad placed by u_rect = (x, y, w, h) in stage units, y down. Triangle strip, 4 vertices.
export const QUAD_VS = `#version 300 es
uniform vec4 u_rect;
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 n = u_rect.xy + p * u_rect.zw;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
  v_uv = p;
}`;

// Keying, spill and choke ported from tools/keytest.html. Output is premultiplied.
export const CHARACTER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;

uniform sampler2D u_video;
uniform vec3 u_key;
uniform float u_tol;
uniform float u_soft;
uniform float u_spill;
uniform float u_spillBal;
uniform int u_keyMode;
uniform float u_choke;
uniform vec2 u_videoSize;
uniform vec4 u_crop;
uniform float u_opacity;

vec2 chroma(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
               0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}

float keyAlpha(vec3 c) {
  if (u_keyMode == 1) {
    float d = (c.g - max(c.r, c.b)) / max(c.g, 0.15);
    float thr = 1.0 - 2.0 * u_tol;
    return 1.0 - smoothstep(thr - max(2.0 * u_soft, 0.001), thr, d);
  }
  float d = distance(chroma(c), chroma(u_key));
  return smoothstep(u_tol, u_tol + max(u_soft, 0.0005), d);
}

float matte(vec2 uv) {
  float a = keyAlpha(texture(u_video, uv).rgb);
  if (u_choke <= 0.0) return a;
  vec2 t = u_choke / u_videoSize;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      a = min(a, keyAlpha(texture(u_video, uv + vec2(float(i), float(j)) * t).rgb));
    }
  return a;
}

void main() {
  vec2 uv = v_uv;
  vec3 c = texture(u_video, uv).rgb;
  bool inside = uv.x >= u_crop.x && uv.x <= 1.0 - u_crop.y && uv.y >= u_crop.z && uv.y <= 1.0 - u_crop.w;

  float a = matte(uv);
  if (!inside) a = 0.0;

  float limit = mix(max(c.r, c.b), (c.r + c.b) * 0.5, u_spillBal);
  c.g = mix(c.g, min(c.g, limit), u_spill);
  o = vec4(c * a, a) * u_opacity;
}`;

// Border of the quad, u_border pixels wide at stage resolution.
export const OUTLINE_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_sizePx;
uniform float u_border;
uniform vec4 u_color;
void main() {
  vec2 d = min(v_uv, 1.0 - v_uv) * u_sizePx;
  if (min(d.x, d.y) > u_border) discard;
  o = u_color;
}`;

// Ellipse outline with glow plus an expanding pulse ring. Pixel space, premultiplied white.
export const RING_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform vec4 u_rectPx;
uniform vec2 u_center;
uniform vec2 u_radius;
uniform float u_thick;
uniform float u_pulseScale;
uniform float u_pulseAlpha;
uniform float u_opacity;
uniform vec3 u_color;

float ellipseDist(vec2 p, vec2 r) {
  vec2 q = p / r;
  float l = length(q);
  return (l - 1.0) * l / max(length(q / r), 1e-5);
}

float stroke(float d, float hw) {
  float core = 1.0 - smoothstep(hw - 1.0, hw + 1.0, abs(d));
  float glow = exp(-max(abs(d) - hw, 0.0) / (u_thick * 1.5)) * 0.45;
  return max(core, glow);
}

void main() {
  vec2 p = u_rectPx.xy + v_uv * u_rectPx.zw - u_center;
  float a = stroke(ellipseDist(p, u_radius), u_thick * 0.5);
  float b = stroke(ellipseDist(p, u_radius * u_pulseScale), u_thick * 0.35) * u_pulseAlpha;
  float alpha = max(a, b) * u_opacity;
  o = vec4(u_color * alpha, alpha);
}`;

// Two downward chevrons, tips at u_center and u_gap above it.
export const CHEVRON_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o;
uniform vec4 u_rectPx;
uniform vec2 u_center;
uniform float u_size;
uniform float u_gap;
uniform float u_thick;
uniform float u_opacity;

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float chevron(vec2 p) {
  vec2 arm = vec2(u_size, -u_size * 0.6);
  return min(seg(p, vec2(-arm.x, arm.y), vec2(0.0)), seg(p, arm, vec2(0.0)));
}

void main() {
  vec2 p = u_rectPx.xy + v_uv * u_rectPx.zw - u_center;
  float d = min(chevron(p), chevron(p + vec2(0.0, u_gap)));
  float hw = u_thick * 0.5;
  float core = 1.0 - smoothstep(hw - 1.0, hw + 1.0, d);
  float glow = exp(-max(d - hw, 0.0) / (u_thick * 1.5)) * 0.45;
  float alpha = max(core, glow) * u_opacity;
  o = vec4(vec3(alpha), alpha);
}`;
