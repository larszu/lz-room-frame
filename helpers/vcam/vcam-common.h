// Shared between the virtual camera source (lz-vcam-source.dll, loaded by the Windows Frame
// Server) and the feeder (lz-vcam.exe, started by LZ Room Frame).
#pragma once
#include <windows.h>

// {6B1F3C2A-5E8D-4C7B-9A41-2D7E0F5B8C13}
static const GUID CLSID_LzVcamSource = { 0x6b1f3c2a, 0x5e8d, 0x4c7b, { 0x9a, 0x41, 0x2d, 0x7e, 0x0f, 0x5b, 0x8c, 0x13 } };
#define LZ_VCAM_CLSID_STR L"{6B1F3C2A-5E8D-4C7B-9A41-2D7E0F5B8C13}"
#define LZ_VCAM_NAME L"LZ Room Frame"

// The camera always offers 1920x1080 at 30 fps; the feeder scales into it.
#define LZ_VCAM_W 1920
#define LZ_VCAM_H 1080
#define LZ_VCAM_FPS 30

// Global so the Frame Server (session 0, LocalService) and the feeder (user session) share
// it. The source creates it (creating Global objects needs a privilege the service has),
// the feeder opens it.
#define LZ_VCAM_MAPPING L"Global\\LZRoomFrameVirtualCamera"
#define LZ_VCAM_MAGIC 0x4D52464Cu // "LFRM"

struct LzVcamShared {
  UINT32 magic;
  UINT32 width, height;
  volatile LONG seq;        // incremented after each frame
  volatile LONGLONG stamp;  // GetTickCount64 of the last frame; old = no signal
  BYTE bgra[LZ_VCAM_W * LZ_VCAM_H * 4]; // top-down BGRA
};
