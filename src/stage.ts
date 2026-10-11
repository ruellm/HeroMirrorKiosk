import { STAGE_HEIGHT, STAGE_WIDTH } from './constants';

// Sizes the stage element to a 9:16 box that fits the window, centered.
export function fitStage(stage: HTMLElement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.min(vw / STAGE_WIDTH, vh / STAGE_HEIGHT);
  const w = Math.floor(STAGE_WIDTH * s);
  const h = Math.floor(STAGE_HEIGHT * s);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  stage.style.left = Math.floor((vw - w) / 2) + 'px';
  stage.style.top = Math.floor((vh - h) / 2) + 'px';
}
