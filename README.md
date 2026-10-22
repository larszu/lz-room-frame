# LZ Room Frame

Multi-person framing for meeting rooms, from any camera. Every person gets their own tile, like the "tile view" of AI room cameras. The picture goes out as a window, NDI, a stream or a virtual camera, and Crestron, Q-SYS or a browser control it.

[Deutsch](README.de.md)

## Features

- **Any input, any resolution:** USB/UVC cameras, HDMI and SDI capture cards, IP and PTZ cameras over RTSP/SRT/RTMP, video files. The app asks for the most the device offers; output size is free (16:9, 9:16, square, 4K …).
- **Framing like AI PTZ cameras:** modes *overview, group, tiles, speaker, presenter*; shot sizes from close-up to wide; headroom, group margin, dead band, speed, transition (smooth, fade, cut), hold time and a sharpness guard that never enlarges the camera picture beyond a set factor.
- **Layouts that follow the head count:** grid, grid with centre overview (as in the "7 tiles with centre view"), speaker large with strip, overview with strip. Custom layouts can be drawn on a 12 × 12 grid and assigned to a head count or fixed per scene, e.g. *group large + close-up as picture-in-picture*.
- **Room:** room boundary, exclusion zones (glass walls, doors, screens) and a minimum head size.
- **Speaker:** from the room's audio system (speaker zones switched by Q-SYS automixer gates, Crestron, seat mics) or experimental lip movement with the room mic.
- **Second output (B):** a second picture from the same camera with its own size and scene, e.g. 9:16 for social media.
- **PTZ auto-tracking:** detection steers a real PTZ camera over VISCA (Sony VISCA over IP UDP 52381, VISCA TCP/UDP).
- **ATEM:** a SuperSource box shows the camera cropped to the main person and follows them. Tracking data are also available as `TRK` lines and `GET /api/tracking`.
- **Outputs:** fullscreen window on any display or HDMI out, NDI (A and B), RTMP/SRT/RTSP/UDP stream, Linux v4l2loopback. Zoom/Teams/Meet run through NDI Virtual Input (Mac) or NDI Webcam Input (Windows).
- **Control:** TCP 4198 (one command per line), HTTP and WebSocket 4197, a web remote for touch panels, a Q-SYS plugin and Crestron examples (`docs/integrations`).
- **Room PC:** start with the system, start hidden in the tray, and come back with the last input, scene and outputs.

Detection runs locally in a worker (MediaPipe EfficientDet-Lite0 + BlazeFace, GPU with CPU fallback). No cloud is involved.

## Control protocol

```
scene 2 | scene Gruppe        mode overview|group|people|speaker|presenter
style grid|center|speaker|strip   shot close|mcu|medium|cowboy|wide   speed slow|normal|fast
privacy on|off   freeze on|off   speaker 3|none   zone 2 on|off   presenter 1|auto
sceneb 4   output window|ndi|stream|v4l2|b|ndib|windowb on|off   ptz on|off
status   scenes   subscribe on   tracking on   help
```

HTTP: `GET /api/command?c=scene%201`, `POST /api/command`, `GET /api/status`, `GET /api/scenes`, `GET /api/tracking`, `GET /preview.mjpg`.

## Development

```sh
npm install
npm run dev          # Vite on 4196 + Electron
npm test             # unit tests (tracker, framing, layouts, director, commands, PTZ, ATEM)
npm run dist:mac     # or dist:win / dist:linux – builds the NDI helper and the installer
```

NDI needs the free NDI runtime (ndi.video) on the target machine; LZ Room Frame does not ship it.

## Status

Tested on macOS (Apple Silicon) with a video file: detection, all layouts, scenes, programme B, NDI A/B (received with an NDI receiver), UDP stream, TCP/HTTP control and VISCA packets (checked on a UDP listener). **Not tested yet:** real cameras and capture cards, a real PTZ camera, a real ATEM, the Q-SYS plugin in Designer, Crestron, Windows and Linux builds.

NDI® is a registered trademark of Vizrt NDI AB. ATEM is a trademark of Blackmagic Design.
