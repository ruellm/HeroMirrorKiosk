export const STAGE_WIDTH = 1080;
export const STAGE_HEIGHT = 1920;
export const STAGE_ASPECT = STAGE_WIDTH / STAGE_HEIGHT;

export const CROSSFADE_MS = 200;
export const POSE_LOOP_MS = 10000;

// How long to wait for the first decoded frame of a clip before switching anyway.
export const FIRST_FRAME_TIMEOUT_MS = 2000;

export const STORAGE_KEY = 'heromirror.calibration.v1';

// Used for the frame outline before a clip's metadata is known.
export const FALLBACK_CLIP_ASPECT = 716 / 1284;

// Floor ring animation, in ms and stage pixels.
export const RING_FADE_MS = 300;
export const RING_PULSE_PERIOD_MS = 1500;
export const RING_PULSE_MAX_SCALE = 1.6;
export const CHEVRON_BOB_PERIOD_MS = 1000;
export const CHEVRON_BOB_PX = 16;
export const CHEVRON_HALF_WIDTH_PX = 36;
export const CHEVRON_GAP_PX = 30;
export const CHEVRON_ABOVE_RING_PX = 70;

// Visitor detection.
export const DETECT_INTERVAL_MS = 100;
export const MAX_POSES = 3;
export const ANKLE_VISIBILITY_MIN = 0.5;
export const RING_INSIDE_MARGIN = 1.15;
export const TRIGGER_HOLD_MS = 800;
export const TRIGGER_GAP_MS = 300;
export const TRIGGER_REARM_MS = 2000;
export const RING_TINT_COLOR: [number, number, number] = [0.45, 1, 0.55];
// Longest side of the frame sent to the detector.
export const DETECT_MAX_SIDE_PX = 640;

// Kiosk flow.
export const COUNTDOWN_SECONDS = 10;
export const FLASH_MS = 400;
export const RESULT_TIMEOUT_MS = 20000;
export const PHOTO_JPEG_QUALITY = 0.92;
