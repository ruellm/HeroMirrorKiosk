import { STAGE_HEIGHT, STAGE_WIDTH } from './constants';

// Sizes the stage element to a 9:16 box that fits the window, centered.
// The panel toggle button sits over the stage's top right corner.
export function fitStage(stage: HTMLElement, toggleButton?: HTMLElement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.min(vw / STAGE_WIDTH, vh / STAGE_HEIGHT);
  const w = Math.floor(STAGE_WIDTH * s);
  const h = Math.floor(STAGE_HEIGHT * s);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  stage.style.left = Math.floor((vw - w) / 2) + 'px';
  stage.style.top = Math.floor((vh - h) / 2) + 'px';
  if (toggleButton) {
    toggleButton.style.top = Math.floor((vh - h) / 2) + 8 + 'px';
    toggleButton.style.right = Math.floor((vw - w) / 2) + 8 + 'px';
  }
}
