// lz-vcam – the "LZ Room Frame" virtual camera for Teams, Zoom and Meet (Windows 11).
//
//   lz-vcam --probe       one JSON line: {"ok":true} or {"ok":false,"setup":bool,"error":"…"}
//   lz-vcam --register    (elevated) copies lz-vcam-source.dll to %ProgramData% and
//                         registers it for the Frame Server; once per PC
//   lz-vcam --unregister  (elevated) the opposite
//   lz-vcam               shows the camera while it runs; frames on stdin as for lz-ndi-send:
//                         16-byte header "LZRF" + uint32 LE width, height, fps + RGBA
//
// The camera exists as long as this process runs (MFVirtualCameraLifetime_Session). Frames
// go into shared memory the source DLL created in the Frame Server; they are scaled to the
// camera's fixed 1920x1080, letterboxed.

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfvirtualcamera.h>
#include <shlobj.h>
#include <sddl.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "vcam-common.h"

typedef HRESULT(WINAPI* CreateVcamFn)(MFVirtualCameraType, MFVirtualCameraLifetime, MFVirtualCameraAccess, LPCWSTR, LPCWSTR, const GUID*, ULONG, IMFVirtualCamera**);

static std::wstring exeDir() {
  wchar_t p[MAX_PATH]; GetModuleFileNameW(nullptr, p, MAX_PATH);
  std::wstring s(p); return s.substr(0, s.find_last_of(L"\\/"));
}

/** The Frame Server runs as LocalService and cannot read a per-user install: the DLL lives here. */
static std::wstring installedDll() {
  PWSTR pd = nullptr; SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &pd);
  std::wstring s = std::wstring(pd ? pd : L"C:\\ProgramData") + L"\\LZ Room Frame\\lz-vcam-source.dll";
  CoTaskMemFree(pd);
  return s;
}

static const wchar_t* KEY = L"SOFTWARE\\Classes\\CLSID\\" LZ_VCAM_CLSID_STR L"\\InprocServer32";

static bool registered() {
  wchar_t v[MAX_PATH] = {}; DWORD n = sizeof(v);
  if (RegGetValueW(HKEY_LOCAL_MACHINE, KEY, nullptr, RRF_RT_REG_SZ, nullptr, v, &n) != ERROR_SUCCESS) return false;
  if (GetFileAttributesW(v) == INVALID_FILE_ATTRIBUTES) return false;
  // a newer app brings a newer DLL: compare sizes and times
  WIN32_FILE_ATTRIBUTE_DATA a = {}, b = {};
  std::wstring ship = exeDir() + L"\\lz-vcam-source.dll";
  if (!GetFileAttributesExW(v, GetFileExInfoStandard, &a) || !GetFileAttributesExW(ship.c_str(), GetFileExInfoStandard, &b)) return true;
  return a.nFileSizeLow == b.nFileSizeLow && CompareFileTime(&a.ftLastWriteTime, &b.ftLastWriteTime) >= 0;
}

static int doRegister() {
  std::wstring dst = installedDll();
  // writable for the Frame Server (LocalService), which keeps a small log there
  SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, FALSE };
  ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;LS)(A;OICI;0x1200a9;;;BU)", SDDL_REVISION_1, &sa.lpSecurityDescriptor, nullptr);
  CreateDirectoryW(dst.substr(0, dst.find_last_of(L'\\')).c_str(), sa.lpSecurityDescriptor ? &sa : nullptr);
  if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
  if (!CopyFileW((exeDir() + L"\\lz-vcam-source.dll").c_str(), dst.c_str(), FALSE)) { fprintf(stderr, "copy failed: %lu\n", GetLastError()); return 2; }
  HKEY k;
  if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, KEY, 0, nullptr, 0, KEY_WRITE, nullptr, &k, nullptr) != ERROR_SUCCESS) { fprintf(stderr, "registry failed\n"); return 3; }
  RegSetValueExW(k, nullptr, 0, REG_SZ, (const BYTE*)dst.c_str(), (DWORD)((dst.size() + 1) * sizeof(wchar_t)));
  const wchar_t* tm = L"Both";
  RegSetValueExW(k, L"ThreadingModel", 0, REG_SZ, (const BYTE*)tm, (DWORD)((wcslen(tm) + 1) * sizeof(wchar_t)));
  RegCloseKey(k);
  return 0;
}

static int doUnregister() {
  RegDeleteTreeW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Classes\\CLSID\\" LZ_VCAM_CLSID_STR);
  DeleteFileW(installedDll().c_str());
  return 0;
}

static CreateVcamFn createFn() {
  HMODULE m = LoadLibraryW(L"mfsensorgroup.dll");
  return m ? (CreateVcamFn)GetProcAddress(m, "MFCreateVirtualCamera") : nullptr;
}

static bool readAll(void* p, size_t n) {
  BYTE* b = (BYTE*)p;
  while (n) { size_t r = fread(b, 1, n, stdin); if (!r) return false; b += r; n -= r; }
  return true;
}

/** RGBA w×h → BGRA 1920×1080, fitted with black bars, nearest neighbour. */
static void scaleInto(BYTE* dst, const BYTE* src, UINT32 w, UINT32 h) {
  const double k = (double)LZ_VCAM_W / w < (double)LZ_VCAM_H / h ? (double)LZ_VCAM_W / w : (double)LZ_VCAM_H / h;
  const int ow = (int)(w * k), oh = (int)(h * k), ox = (LZ_VCAM_W - ow) / 2, oy = (LZ_VCAM_H - oh) / 2;
  std::vector<UINT32> xs(ow);
  for (int x = 0; x < ow; x++) xs[x] = (UINT32)(x / k) < w ? (UINT32)(x / k) : w - 1;
  for (int y = 0; y < LZ_VCAM_H; y++) {
    UINT32* d = (UINT32*)(dst + (size_t)y * LZ_VCAM_W * 4);
    if (y < oy || y >= oy + oh) { for (int x = 0; x < LZ_VCAM_W; x++) d[x] = 0xFF000000; continue; }
    UINT32 sy = (UINT32)((y - oy) / k); if (sy >= h) sy = h - 1;
    const BYTE* s = src + (size_t)sy * w * 4;
    for (int x = 0; x < ox; x++) d[x] = 0xFF000000;
    for (int x = 0; x < ow; x++) { const BYTE* p = s + xs[x] * 4; d[ox + x] = 0xFF000000u | (p[0] << 16) | (p[1] << 8) | p[2]; }
    for (int x = ox + ow; x < LZ_VCAM_W; x++) d[x] = 0xFF000000;
  }
}

int wmain(int argc, wchar_t** argv) {
  const std::wstring a = argc > 1 ? argv[1] : L"";
  if (a == L"--register") return doRegister();
  if (a == L"--unregister") return doUnregister();
  if (a == L"--probe") {
    if (!createFn()) { printf("{\"ok\":false,\"setup\":false,\"error\":\"Windows 11 nötig\"}\n"); return 0; }
    printf(registered() ? "{\"ok\":true}\n" : "{\"ok\":false,\"setup\":true,\"error\":\"Einmal einrichten\"}\n");
    return 0;
  }

  CreateVcamFn create = createFn();
  if (!create) { fprintf(stderr, "Windows 11 nötig\n"); return 4; }
  if (!registered()) { fprintf(stderr, "Kamera nicht eingerichtet\n"); return 5; }
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  MFStartup(MF_VERSION);
  IMFVirtualCamera* cam = nullptr;
  HRESULT hr = create(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_Session, MFVirtualCameraAccess_CurrentUser, LZ_VCAM_NAME, LZ_VCAM_CLSID_STR, nullptr, 0, &cam);
  if (SUCCEEDED(hr)) hr = cam->Start(nullptr);
  if (FAILED(hr)) {
    if (hr == E_ACCESSDENIED) fprintf(stderr, "Kamerazugriff gesperrt: Windows-Einstellungen > Datenschutz > Kamera > Desktop-Apps erlauben\n");
    else fprintf(stderr, "virtual camera: 0x%08lx\n", (unsigned long)hr);
    if (cam) cam->Release(); MFShutdown(); return 6;
  }

  _setmode(_fileno(stdin), _O_BINARY);
  std::vector<BYTE> buf;
  HANDLE map = nullptr; LzVcamShared* mem = nullptr;
  ULONGLONG lastTry = 0;
  unsigned misses = 0;
  for (;;) {
    BYTE head[16];
    if (!readAll(head, 16) || memcmp(head, "LZRF", 4)) break;
    UINT32 w, h; memcpy(&w, head + 4, 4); memcpy(&h, head + 8, 4);
    if (!w || !h || w > 8192 || h > 8192) break;
    buf.resize((size_t)w * h * 4);
    if (!readAll(buf.data(), buf.size())) break;
    // the source creates the memory when an app opens the camera: look for it now and then
    if (!mem && GetTickCount64() - lastTry > 500) {
      lastTry = GetTickCount64();
      map = OpenFileMappingW(FILE_MAP_WRITE, FALSE, LZ_VCAM_MAPPING);
      if (map) mem = (LzVcamShared*)MapViewOfFile(map, FILE_MAP_WRITE, 0, 0, sizeof(LzVcamShared));
      if (mem) fprintf(stderr, "camera memory connected\n");
      else if (++misses % 10 == 1) fprintf(stderr, "waiting for camera memory (%lu)\n", GetLastError());
    }
    if (!mem) continue;
    scaleInto(mem->bgra, buf.data(), w, h);
    mem->width = LZ_VCAM_W; mem->height = LZ_VCAM_H; mem->magic = LZ_VCAM_MAGIC;
    mem->stamp = (LONGLONG)GetTickCount64();
    if (InterlockedIncrement(&mem->seq) % 60 == 1) fprintf(stderr, "frames written: %ld\n", mem->seq);
  }
  if (mem) UnmapViewOfFile(mem);
  if (map) CloseHandle(map);
  cam->Remove();
  cam->Release();
  MFShutdown();
  return 0;
}
