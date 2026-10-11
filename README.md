# HeroMirrorKiosk
Augmented Reality Kiosk

## Run

    npm install
    npm run dev

The dev server serves HTTPS on the LAN. Open the Network URL it prints
(https://<laptop-ip>:5173/) on the phone and accept the self signed
certificate. Press C, or tap the top left corner three times, for the
calibration panel.

Clips go in `public/clips/` as 1.mp4, 2.mp4, 3.mp4. Key settings per clip
live in `src/clips.config.ts` and take the JSON from `tools/keytest.html`.

Visitor detection uses MediaPipe Pose Landmarker. `npm run dev` and
`npm run build` copy its wasm runtime from node_modules into `public/wasm`
(not committed). The lite model is in `public/models/`.
