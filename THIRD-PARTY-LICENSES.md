# Third-party components

| Component | Licence | Use |
|---|---|---|
| RTMO-s (OpenMMLab MMPose) | Apache-2.0 | people and body keypoints |
| OSNet-AIN x0.25 (Torchreid, weights via LibreReID) | MIT | re-identification |
| ONNX Runtime Web | MIT | runs RTMO and OSNet |
| MediaPipe Tasks Vision and Face Landmarker | Apache-2.0 | lip detection |
| FFmpeg 9.0.2 with x264, x265, libsrt, mbedTLS, zlib (own static build, no nonfree parts; scripts/ffmpeg-builds.json) | GPL-3.0 (libsrt MPL-2.0, mbedTLS Apache-2.0) | streams, v4l2 output, network inputs; runs as a separate program. Corresponding source and build script are attached to every release; licence texts in licenses/ffmpeg |
| atem-connection, @julusian/freetype2 (contains FreeType) | MIT, FTL | ATEM SuperSource control |
| Electron, Chromium | MIT, BSD-3-Clause and others (LICENSE.electron.txt, LICENSES.chromium.html in the app) | application shell |
| ws | MIT | control and frame sockets |
| React, Lucide | MIT, ISC | user interface |
| Public Sans | OFL-1.1 | typeface |
| NDI SDK headers (types and names only, helpers/ndi/ndi-min.h) | MIT, see helpers/ndi/ndi-sdk-headers-MIT.txt | NDI sender; the NDI runtime is installed by the user |

The app ships the full texts in `<resources>/legal` (built by `scripts/notices.mjs`: every npm package in the app, the models, the NDI headers, FFmpeg's licences and source offer); they are reachable under Info in the app.
