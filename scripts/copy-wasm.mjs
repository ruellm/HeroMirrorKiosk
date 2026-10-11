// Copies the MediaPipe wasm runtime from node_modules into public/wasm so the
// app serves it itself. public/wasm is not committed.
import { cpSync, mkdirSync } from 'node:fs';

const src = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const dst = new URL('../public/wasm/', import.meta.url);
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('copied MediaPipe wasm files to public/wasm');
