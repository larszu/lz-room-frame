// lz-ndi-send – NDI(R) sender for LZ Room Frame.
//
//   lz-ndi-send --probe                one JSON line: {"ok":true,"version":"…"} or {"ok":false,"error":"…"}
//   lz-ndi-send <source name>          reads frames from stdin and sends them as an NDI source
//
// Frame on stdin: 16-byte header "LZRF" + uint32 LE width + uint32 LE height + uint32 LE fps,
// followed by width * height * 4 bytes RGBA. The size may change from frame to frame.
// The NDI runtime is loaded at run time from $NDI_RUNTIME_DIR_V6 or the system paths; it is
// installed by the user (NDI Tools or the runtime from ndi.video) and not shipped here.
//
// NDI(R) is a registered trademark of Vizrt NDI AB. https://ndi.video/

#include "ndi-min.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <fcntl.h>
#include <io.h>
typedef HMODULE LibHandle;
static LibHandle openLib(const std::string& p) { return LoadLibraryA(p.c_str()); }
static void* sym(LibHandle h, const char* n) { return (void*)GetProcAddress(h, n); }
static const char SEP = '\\';
#else
#include <dlfcn.h>
typedef void* LibHandle;
static LibHandle openLib(const std::string& p) { return dlopen(p.c_str(), RTLD_NOW | RTLD_LOCAL); }
static void* sym(LibHandle h, const char* n) { return dlsym(h, n); }
static const char SEP = '/';
#endif

struct Ndi {
  NDI_initialize_fn initialize = nullptr;
  NDI_destroy_fn destroy = nullptr;
  NDI_version_fn version = nullptr;
  NDI_send_create_fn send_create = nullptr;
  NDI_send_send_video_v2_fn send_send_video_v2 = nullptr;
  NDI_send_destroy_fn send_destroy = nullptr;
};

static std::string loadNdi(Ndi& n) {
  std::vector<std::string> tries;
  if (const char* dir = std::getenv(LZ_NDI_REDIST_FOLDER)) tries.push_back(std::string(dir) + SEP + LZ_NDI_LIBRARY);
  tries.push_back(LZ_NDI_LIBRARY);
#if defined(__APPLE__)
  tries.push_back("/usr/local/lib/libndi.dylib");
  tries.push_back("/opt/homebrew/lib/libndi.dylib");
  tries.push_back("/Library/NDI SDK for Apple/lib/macOS/libndi.dylib");
#elif !defined(_WIN32)
  tries.push_back("/usr/lib/libndi.so.6");
  tries.push_back("/usr/local/lib/libndi.so.6");
#if defined(__aarch64__)
  tries.push_back("/usr/lib/aarch64-linux-gnu/libndi.so.6");
#else
  tries.push_back("/usr/lib/x86_64-linux-gnu/libndi.so.6");
#endif
#endif
  LibHandle h = nullptr;
  for (const auto& p : tries) { h = openLib(p); if (h) break; }
  if (!h) return "NDI runtime not found";
#define LOAD(field, name) n.field = (decltype(n.field))sym(h, name); if (!n.field) return std::string("NDI runtime incomplete: ") + name;
  LOAD(initialize, "NDIlib_initialize")
  LOAD(destroy, "NDIlib_destroy")
  LOAD(version, "NDIlib_version")
  LOAD(send_create, "NDIlib_send_create")
  LOAD(send_send_video_v2, "NDIlib_send_send_video_v2")
  LOAD(send_destroy, "NDIlib_send_destroy")
#undef LOAD
  if (!n.initialize()) return "NDI cannot be initialised on this computer";
  return "";
}

static bool readFull(void* buf, size_t len) {
  auto* p = static_cast<uint8_t*>(buf);
  while (len) {
    size_t r = fread(p, 1, len, stdin);
    if (r == 0) return false;
    p += r; len -= r;
  }
  return true;
}

static uint32_t le32(const uint8_t* b) { return b[0] | (b[1] << 8) | (b[2] << 16) | ((uint32_t)b[3] << 24); }

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
#endif
  if (argc < 2) { fprintf(stderr, "usage: lz-ndi-send --probe | <source name>\n"); return 1; }
  Ndi n;
  std::string err = loadNdi(n);
  if (std::strcmp(argv[1], "--probe") == 0) {
    if (err.empty()) printf("{\"ok\":true,\"version\":\"%s\"}\n", n.version ? n.version() : "");
    else printf("{\"ok\":false,\"error\":\"%s\"}\n", err.c_str());
    return 0;
  }
  if (!err.empty()) { fprintf(stderr, "%s\n", err.c_str()); return 2; }
  NDI_send_create sc = { argv[1], nullptr, false, false };
  NDI_send_instance s = n.send_create(&sc);
  if (!s) { fprintf(stderr, "NDI sender cannot be created\n"); return 2; }
  // two buffers: NDI may still read the previous one (send_video_v2 is synchronous, but keep it simple and safe)
  std::vector<uint8_t> buf;
  uint8_t hdr[16];
  while (readFull(hdr, sizeof hdr)) {
    if (std::memcmp(hdr, "LZRF", 4) != 0) { fprintf(stderr, "bad frame header\n"); break; }
    uint32_t w = le32(hdr + 4), h = le32(hdr + 8), fps = le32(hdr + 12);
    if (!w || !h || w > 8192 || h > 8192) { fprintf(stderr, "bad frame size\n"); break; }
    buf.resize((size_t)w * h * 4);
    if (!readFull(buf.data(), buf.size())) break;
    NDI_video_frame_v2 v;
    std::memset(&v, 0, sizeof v);
    v.xres = (int)w; v.yres = (int)h; v.FourCC = LZ_NDI_FOURCC('R', 'G', 'B', 'X');
    v.frame_rate_N = fps ? (int)fps * 1000 : 30000; v.frame_rate_D = 1000;
    v.picture_aspect_ratio = (float)w / (float)h; v.frame_format_type = NDI_frame_format_progressive;
    v.timecode = INT64_MAX; v.p_data = buf.data(); v.line_stride_in_bytes = (int)w * 4;
    n.send_send_video_v2(s, &v);
  }
  n.send_destroy(s);
  n.destroy();
  return 0;
}
