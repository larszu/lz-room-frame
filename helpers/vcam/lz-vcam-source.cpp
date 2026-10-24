// lz-vcam-source.dll – the media source behind the "LZ Room Frame" virtual camera
// (Windows 11, MFCreateVirtualCamera). The Windows Frame Server loads it when an app such as
// Teams or Zoom opens the camera. Each frame comes from the shared memory that lz-vcam.exe
// fills with the program picture; without a feeder the camera shows a dark picture.
//
// Structure after Microsoft's SimpleMediaSource / VirtualCamera samples (Windows-Camera):
// an IMFActivate the Frame Server creates through the class factory, a media source with
// one video stream (NV12 and RGB32, 1920x1080, 30 fps), samples from a system-memory
// sample allocator.

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <mfobjects.h>
#include <sddl.h>
#include <new>
#include <cstring>
#include <cstdio>
#include "vcam-common.h"

// IKsControl (ksproxy.h) without the DirectShow headers
static const GUID IID_LzKsControl = { 0x28F54685, 0x06FD, 0x11D2, { 0xB2, 0x7A, 0x00, 0xA0, 0xC9, 0x22, 0x31, 0x96 } };
struct KSIDENTIFIER_ { GUID Set; ULONG Id; ULONG Flags; };
struct ILzKsControl : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE KsProperty(KSIDENTIFIER_* p, ULONG pl, LPVOID d, ULONG dl, ULONG* r) = 0;
  virtual HRESULT STDMETHODCALLTYPE KsMethod(KSIDENTIFIER_* m, ULONG ml, LPVOID d, ULONG dl, ULONG* r) = 0;
  virtual HRESULT STDMETHODCALLTYPE KsEvent(KSIDENTIFIER_* e, ULONG el, LPVOID d, ULONG dl, ULONG* r) = 0;
};
// PINNAME_VIDEO_CAPTURE (ksmedia.h)
static const GUID LZ_PINNAME_VIDEO_CAPTURE = { 0xfb6c4281, 0x0353, 0x11d1, { 0x90, 0x5f, 0x00, 0x00, 0xc0, 0xcc, 0x16, 0xba } };

static HMODULE g_module = nullptr;
static volatile LONG g_objects = 0, g_locks = 0;

template <class T> static void SafeRelease(T*& p) { if (p) { p->Release(); p = nullptr; } }

// ---------------------------------------------------------------- shared picture

class Picture {
public:
  Picture() {
    // the Frame Server runs as LocalService: allow everyone in, so the user's feeder can write
    SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, FALSE };
    ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:(A;;GA;;;WD)(A;;GA;;;SY)(A;;GA;;;LS)S:(ML;;NW;;;LW)", SDDL_REVISION_1, &sa.lpSecurityDescriptor, nullptr);
    map_ = CreateFileMappingW(INVALID_HANDLE_VALUE, sa.lpSecurityDescriptor ? &sa : nullptr, PAGE_READWRITE, 0, sizeof(LzVcamShared), LZ_VCAM_MAPPING);
    if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
    DWORD err = map_ ? 0 : GetLastError();
    if (map_) mem_ = (LzVcamShared*)MapViewOfFile(map_, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(LzVcamShared));
    Log(map_ ? (mem_ ? "shared memory ready" : "map view failed") : "create mapping failed", map_ ? (mem_ ? 0 : GetLastError()) : err);
  }
  /** One line in %ProgramData%\LZ Room Frame\vcam.log: the Frame Server has no console. */
  static void Log(const char* what, DWORD code) {
    char path[MAX_PATH]; DWORD n = GetEnvironmentVariableA("ProgramData", path, MAX_PATH);
    if (!n || n > MAX_PATH - 40) return;
    strcat_s(path, "\\LZ Room Frame\\vcam.log");
    HANDLE f = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, 0, nullptr);
    if (f == INVALID_HANDLE_VALUE) return;
    char line[200]; int len = sprintf_s(line, "%llu source pid %lu: %s (%lu)\r\n", GetTickCount64(), GetCurrentProcessId(), what, code);
    DWORD w; WriteFile(f, line, len, &w, nullptr); CloseHandle(f);
  }
  ~Picture() { if (mem_) UnmapViewOfFile(mem_); if (map_) CloseHandle(map_); }
  /** BGRA source picture or null when no feeder sent a frame in the last 2 s. */
  const BYTE* frame() {
    if (mem_ && ++calls_ % 60 == 1) { char m[160]; sprintf_s(m, "frame magic %08x age %lld seq %ld", mem_->magic, (long long)(GetTickCount64() - (ULONGLONG)mem_->stamp), mem_->seq); Log(m, 0); }
    if (!mem_ || mem_->magic != LZ_VCAM_MAGIC) return nullptr;
    if (GetTickCount64() - (ULONGLONG)mem_->stamp > 2000) return nullptr;
    return mem_->bgra;
  }
private:
  HANDLE map_ = nullptr;
  LzVcamShared* mem_ = nullptr;
  unsigned calls_ = 0;
};

// ---------------------------------------------------------------- pixel conversion

static void FillRgb32(BYTE* dst, LONG pitch, const BYTE* src) {
  for (int y = 0; y < LZ_VCAM_H; y++) {
    BYTE* d = dst + (LONGLONG)pitch * y;
    if (src) memcpy(d, src + (size_t)y * LZ_VCAM_W * 4, LZ_VCAM_W * 4);
    else for (int x = 0; x < LZ_VCAM_W; x++) { d[x * 4] = 0x23; d[x * 4 + 1] = 0x1F; d[x * 4 + 2] = 0x1E; d[x * 4 + 3] = 0xFF; }
  }
}

static void FillNv12(BYTE* dst, LONG pitch, const BYTE* src) {
  BYTE* uv = dst + (LONGLONG)pitch * LZ_VCAM_H;
  for (int y = 0; y < LZ_VCAM_H; y++) {
    BYTE* d = dst + (LONGLONG)pitch * y;
    if (!src) { memset(d, 31, LZ_VCAM_W); continue; }
    const BYTE* s = src + (size_t)y * LZ_VCAM_W * 4;
    for (int x = 0; x < LZ_VCAM_W; x++) {
      int b = s[x * 4], g = s[x * 4 + 1], r = s[x * 4 + 2];
      d[x] = (BYTE)(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16); // BT.601 limited range
    }
  }
  for (int y = 0; y < LZ_VCAM_H / 2; y++) {
    BYTE* d = uv + (LONGLONG)pitch * y;
    if (!src) { memset(d, 128, LZ_VCAM_W); continue; }
    const BYTE* s = src + (size_t)(y * 2) * LZ_VCAM_W * 4;
    for (int x = 0; x < LZ_VCAM_W / 2; x++) {
      const BYTE* p = s + x * 8;
      int b = p[0], g = p[1], r = p[2];
      d[x * 2] = (BYTE)(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
      d[x * 2 + 1] = (BYTE)(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
    }
  }
}

// ---------------------------------------------------------------- stream

class Source;

class Stream : public IMFMediaStream2, public ILzKsControl {
public:
  Stream(Source* src) : source_(src) { InterlockedIncrement(&g_objects); InitializeCriticalSection(&lock_); }
  ~Stream() { SafeRelease(queue_); SafeRelease(desc_); SafeRelease(alloc_); SafeRelease(attrs_); DeleteCriticalSection(&lock_); InterlockedDecrement(&g_objects); }

  HRESULT Init(IMFStreamDescriptor* desc) {
    desc_ = desc; desc_->AddRef();
    HRESULT hr = MFCreateEventQueue(&queue_);
    if (SUCCEEDED(hr)) hr = MFCreateAttributes(&attrs_, 8);
    if (SUCCEEDED(hr)) hr = attrs_->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, LZ_PINNAME_VIDEO_CAPTURE);
    if (SUCCEEDED(hr)) hr = attrs_->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
    if (SUCCEEDED(hr)) hr = attrs_->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
    if (SUCCEEDED(hr)) hr = attrs_->SetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, MFFrameSourceTypes_Color);
    return hr;
  }
  IMFAttributes* Attributes() { return attrs_; }

  HRESULT Start(IMFMediaType* type) {
    EnterCriticalSection(&lock_);
    HRESULT hr = S_OK;
    GUID sub = GUID_NULL;
    type->GetGUID(MF_MT_SUBTYPE, &sub);
    nv12_ = sub == MFVideoFormat_NV12;
    SafeRelease(alloc_);
    hr = MFCreateVideoSampleAllocatorEx(IID_PPV_ARGS(&alloc_));
    if (SUCCEEDED(hr)) hr = alloc_->InitializeSampleAllocator(10, type);
    if (SUCCEEDED(hr)) { state_ = MF_STREAM_STATE_RUNNING; hr = queue_->QueueEventParamVar(MEStreamStarted, GUID_NULL, S_OK, nullptr); }
    LeaveCriticalSection(&lock_);
    return hr;
  }
  HRESULT Stop() {
    EnterCriticalSection(&lock_);
    state_ = MF_STREAM_STATE_STOPPED;
    HRESULT hr = queue_ ? queue_->QueueEventParamVar(MEStreamStopped, GUID_NULL, S_OK, nullptr) : S_OK;
    LeaveCriticalSection(&lock_);
    return hr;
  }
  void Shutdown() {
    EnterCriticalSection(&lock_);
    shutdown_ = true;
    if (queue_) queue_->Shutdown();
    SafeRelease(alloc_);
    LeaveCriticalSection(&lock_);
  }

  // IUnknown
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == __uuidof(IMFMediaStream) || riid == __uuidof(IMFMediaStream2) || riid == __uuidof(IMFMediaEventGenerator)) *ppv = static_cast<IMFMediaStream2*>(this);
    else if (riid == IID_LzKsControl) *ppv = static_cast<ILzKsControl*>(this);
    else { *ppv = nullptr; return E_NOINTERFACE; }
    AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  STDMETHODIMP_(ULONG) Release() override { LONG r = InterlockedDecrement(&ref_); if (!r) delete this; return r; }

  // IMFMediaEventGenerator
  STDMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* st) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->BeginGetEvent(cb, st); }
  STDMETHODIMP EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** e) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->EndGetEvent(r, e); }
  STDMETHODIMP GetEvent(DWORD f, IMFMediaEvent** e) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->GetEvent(f, e); }
  STDMETHODIMP QueueEvent(MediaEventType t, REFGUID g, HRESULT s, const PROPVARIANT* v) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->QueueEventParamVar(t, g, s, v); }

  // IMFMediaStream
  STDMETHODIMP GetMediaSource(IMFMediaSource** out) override;
  STDMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** out) override {
    if (!out) return E_POINTER;
    if (shutdown_) return MF_E_SHUTDOWN;
    *out = desc_; desc_->AddRef(); return S_OK;
  }
  STDMETHODIMP RequestSample(IUnknown* token) override {
    EnterCriticalSection(&lock_);
    HRESULT hr = S_OK;
    IMFSample* sample = nullptr;
    IMFMediaBuffer* buf = nullptr;
    if (shutdown_) hr = MF_E_SHUTDOWN;
    else if (state_ != MF_STREAM_STATE_RUNNING || !alloc_) hr = MF_E_MEDIA_SOURCE_WRONGSTATE;
    if (SUCCEEDED(hr)) hr = alloc_->AllocateSample(&sample);
    if (SUCCEEDED(hr)) hr = sample->GetBufferByIndex(0, &buf);
    if (SUCCEEDED(hr)) {
      IMF2DBuffer2* b2 = nullptr;
      BYTE* scan0 = nullptr; BYTE* start = nullptr; LONG pitch = 0; DWORD len = 0;
      if (SUCCEEDED(buf->QueryInterface(IID_PPV_ARGS(&b2))) && SUCCEEDED(b2->Lock2DSize(MF2DBuffer_LockFlags_Write, &scan0, &pitch, &start, &len))) {
        const BYTE* src = picture_.frame();
        if (nv12_) FillNv12(scan0, pitch, src); else FillRgb32(scan0, pitch, src);
        b2->Unlock2D();
      } else {
        BYTE* p = nullptr; DWORD max = 0;
        if (SUCCEEDED(buf->Lock(&p, &max, nullptr))) {
          const BYTE* src = picture_.frame();
          if (nv12_) FillNv12(p, LZ_VCAM_W, src); else FillRgb32(p, LZ_VCAM_W * 4, src);
          buf->Unlock();
          buf->SetCurrentLength(nv12_ ? LZ_VCAM_W * LZ_VCAM_H * 3 / 2 : LZ_VCAM_W * LZ_VCAM_H * 4);
        }
      }
      SafeRelease(b2);
      sample->SetSampleTime(MFGetSystemTime());
      sample->SetSampleDuration(10000000LL / LZ_VCAM_FPS);
      if (token) sample->SetUnknown(MFSampleExtension_Token, token);
      hr = queue_->QueueEventParamUnk(MEMediaSample, GUID_NULL, S_OK, sample);
    }
    SafeRelease(buf); SafeRelease(sample);
    LeaveCriticalSection(&lock_);
    return hr;
  }

  // IMFMediaStream2
  STDMETHODIMP SetStreamState(MF_STREAM_STATE v) override {
    if (v == state_) return S_OK;
    if (v == MF_STREAM_STATE_STOPPED) return Stop();
    if (v == MF_STREAM_STATE_PAUSED) { state_ = v; return S_OK; }
    if (v == MF_STREAM_STATE_RUNNING && alloc_) { state_ = v; return S_OK; }
    return MF_E_INVALID_STATE_TRANSITION;
  }
  STDMETHODIMP GetStreamState(MF_STREAM_STATE* v) override { if (!v) return E_POINTER; *v = state_; return S_OK; }

  // IKsControl: no camera controls
  STDMETHODIMP KsProperty(KSIDENTIFIER_*, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
  STDMETHODIMP KsMethod(KSIDENTIFIER_*, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
  STDMETHODIMP KsEvent(KSIDENTIFIER_*, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }

private:
  volatile LONG ref_ = 1;
  CRITICAL_SECTION lock_;
  Source* source_;
  IMFMediaEventQueue* queue_ = nullptr;
  IMFStreamDescriptor* desc_ = nullptr;
  IMFVideoSampleAllocatorEx* alloc_ = nullptr;
  IMFAttributes* attrs_ = nullptr;
  MF_STREAM_STATE state_ = MF_STREAM_STATE_STOPPED;
  bool nv12_ = true, shutdown_ = false;
  Picture picture_;
};

// ---------------------------------------------------------------- source

static HRESULT MakeType(const GUID& sub, IMFMediaType** out) {
  IMFMediaType* t = nullptr;
  HRESULT hr = MFCreateMediaType(&t);
  if (SUCCEEDED(hr)) hr = t->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  if (SUCCEEDED(hr)) hr = t->SetGUID(MF_MT_SUBTYPE, sub);
  if (SUCCEEDED(hr)) hr = MFSetAttributeSize(t, MF_MT_FRAME_SIZE, LZ_VCAM_W, LZ_VCAM_H);
  if (SUCCEEDED(hr)) hr = MFSetAttributeRatio(t, MF_MT_FRAME_RATE, LZ_VCAM_FPS, 1);
  if (SUCCEEDED(hr)) hr = MFSetAttributeRatio(t, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  if (SUCCEEDED(hr)) hr = t->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  if (SUCCEEDED(hr)) hr = t->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
  const bool nv12 = sub == MFVideoFormat_NV12;
  if (SUCCEEDED(hr)) hr = t->SetUINT32(MF_MT_DEFAULT_STRIDE, nv12 ? LZ_VCAM_W : LZ_VCAM_W * 4);
  if (SUCCEEDED(hr)) hr = t->SetUINT32(MF_MT_SAMPLE_SIZE, nv12 ? LZ_VCAM_W * LZ_VCAM_H * 3 / 2 : LZ_VCAM_W * LZ_VCAM_H * 4);
  if (SUCCEEDED(hr)) { *out = t; return S_OK; }
  SafeRelease(t);
  return hr;
}

class Source : public IMFMediaSourceEx, public IMFGetService, public ILzKsControl {
public:
  Source() { InterlockedIncrement(&g_objects); InitializeCriticalSection(&lock_); }
  ~Source() { SafeRelease(queue_); SafeRelease(pd_); SafeRelease(attrs_); if (stream_) stream_->Release(); DeleteCriticalSection(&lock_); InterlockedDecrement(&g_objects); }

  HRESULT Init() {
    IMFMediaType* types[2] = {};
    IMFStreamDescriptor* sd = nullptr;
    IMFMediaTypeHandler* th = nullptr;
    HRESULT hr = MFCreateEventQueue(&queue_);
    if (SUCCEEDED(hr)) hr = MFCreateAttributes(&attrs_, 4);
    if (SUCCEEDED(hr)) hr = MakeType(MFVideoFormat_NV12, &types[0]);
    if (SUCCEEDED(hr)) hr = MakeType(MFVideoFormat_RGB32, &types[1]);
    if (SUCCEEDED(hr)) hr = MFCreateStreamDescriptor(0, 2, types, &sd);
    if (SUCCEEDED(hr)) hr = sd->GetMediaTypeHandler(&th);
    if (SUCCEEDED(hr)) hr = th->SetCurrentMediaType(types[0]);
    if (SUCCEEDED(hr)) hr = sd->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, LZ_PINNAME_VIDEO_CAPTURE);
    if (SUCCEEDED(hr)) hr = sd->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
    if (SUCCEEDED(hr)) hr = sd->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
    if (SUCCEEDED(hr)) hr = sd->SetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, MFFrameSourceTypes_Color);
    if (SUCCEEDED(hr)) hr = MFCreatePresentationDescriptor(1, &sd, &pd_);
    if (SUCCEEDED(hr)) hr = pd_->SelectStream(0);
    if (SUCCEEDED(hr)) { stream_ = new (std::nothrow) Stream(this); hr = stream_ ? stream_->Init(sd) : E_OUTOFMEMORY; }
    SafeRelease(th); SafeRelease(sd); SafeRelease(types[0]); SafeRelease(types[1]);
    return hr;
  }

  // IUnknown
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == __uuidof(IMFMediaSource) || riid == __uuidof(IMFMediaSourceEx) || riid == __uuidof(IMFMediaEventGenerator)) *ppv = static_cast<IMFMediaSourceEx*>(this);
    else if (riid == __uuidof(IMFGetService)) *ppv = static_cast<IMFGetService*>(this);
    else if (riid == IID_LzKsControl) *ppv = static_cast<ILzKsControl*>(this);
    else { *ppv = nullptr; return E_NOINTERFACE; }
    AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  STDMETHODIMP_(ULONG) Release() override { LONG r = InterlockedDecrement(&ref_); if (!r) delete this; return r; }

  // IMFMediaEventGenerator
  STDMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* st) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->BeginGetEvent(cb, st); }
  STDMETHODIMP EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** e) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->EndGetEvent(r, e); }
  STDMETHODIMP GetEvent(DWORD f, IMFMediaEvent** e) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->GetEvent(f, e); }
  STDMETHODIMP QueueEvent(MediaEventType t, REFGUID g, HRESULT s, const PROPVARIANT* v) override { return shutdown_ ? MF_E_SHUTDOWN : queue_->QueueEventParamVar(t, g, s, v); }

  // IMFMediaSource
  STDMETHODIMP CreatePresentationDescriptor(IMFPresentationDescriptor** out) override {
    if (!out) return E_POINTER;
    if (shutdown_) return MF_E_SHUTDOWN;
    return pd_->Clone(out);
  }
  STDMETHODIMP GetCharacteristics(DWORD* c) override { if (!c) return E_POINTER; if (shutdown_) return MF_E_SHUTDOWN; *c = MFMEDIASOURCE_IS_LIVE; return S_OK; }
  STDMETHODIMP Start(IMFPresentationDescriptor* pd, const GUID* fmt, const PROPVARIANT* pos) override {
    if (!pd || !pos) return E_INVALIDARG;
    if (fmt && *fmt != GUID_NULL) return MF_E_UNSUPPORTED_TIME_FORMAT;
    EnterCriticalSection(&lock_);
    HRESULT hr = shutdown_ ? MF_E_SHUTDOWN : S_OK;
    IMFStreamDescriptor* sd = nullptr;
    IMFMediaTypeHandler* th = nullptr;
    IMFMediaType* type = nullptr;
    BOOL selected = FALSE;
    if (SUCCEEDED(hr)) hr = pd->GetStreamDescriptorByIndex(0, &selected, &sd);
    if (SUCCEEDED(hr) && selected) {
      hr = sd->GetMediaTypeHandler(&th);
      if (SUCCEEDED(hr)) hr = th->GetCurrentMediaType(&type);
      // the stream event first, then the source event
      if (SUCCEEDED(hr)) hr = queue_->QueueEventParamUnk(wasStarted_ ? MEUpdatedStream : MENewStream, GUID_NULL, S_OK, static_cast<IMFMediaStream2*>(stream_));
      if (SUCCEEDED(hr)) hr = stream_->Start(type);
      wasStarted_ = true;
    }
    if (SUCCEEDED(hr)) {
      PROPVARIANT t; PropVariantInit(&t); t.vt = VT_I8; t.hVal.QuadPart = MFGetSystemTime();
      hr = queue_->QueueEventParamVar(MESourceStarted, GUID_NULL, S_OK, &t);
    }
    SafeRelease(type); SafeRelease(th); SafeRelease(sd);
    LeaveCriticalSection(&lock_);
    return hr;
  }
  STDMETHODIMP Stop() override {
    EnterCriticalSection(&lock_);
    HRESULT hr = shutdown_ ? MF_E_SHUTDOWN : stream_->Stop();
    if (SUCCEEDED(hr)) hr = queue_->QueueEventParamVar(MESourceStopped, GUID_NULL, S_OK, nullptr);
    LeaveCriticalSection(&lock_);
    return hr;
  }
  STDMETHODIMP Pause() override { return MF_E_INVALID_STATE_TRANSITION; }
  STDMETHODIMP Shutdown() override {
    EnterCriticalSection(&lock_);
    if (!shutdown_) {
      shutdown_ = true;
      if (stream_) stream_->Shutdown();
      if (queue_) queue_->Shutdown();
    }
    LeaveCriticalSection(&lock_);
    return S_OK;
  }

  // IMFMediaSourceEx
  STDMETHODIMP GetSourceAttributes(IMFAttributes** out) override { if (!out) return E_POINTER; if (shutdown_) return MF_E_SHUTDOWN; *out = attrs_; attrs_->AddRef(); return S_OK; }
  STDMETHODIMP GetStreamAttributes(DWORD id, IMFAttributes** out) override {
    if (!out) return E_POINTER;
    if (shutdown_) return MF_E_SHUTDOWN;
    if (id != 0) return MF_E_INVALIDSTREAMNUMBER;
    *out = stream_->Attributes(); (*out)->AddRef(); return S_OK;
  }
  STDMETHODIMP SetD3DManager(IUnknown*) override { return shutdown_ ? MF_E_SHUTDOWN : S_OK; } // system memory samples

  // IMFGetService
  STDMETHODIMP GetService(REFGUID, REFIID, LPVOID*) override { return MF_E_UNSUPPORTED_SERVICE; }

  // IKsControl
  STDMETHODIMP KsProperty(KSIDENTIFIER_*, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
  STDMETHODIMP KsMethod(KSIDENTIFIER_*, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
  STDMETHODIMP KsEvent(KSIDENTIFIER_*, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }

private:
  volatile LONG ref_ = 1;
  CRITICAL_SECTION lock_;
  IMFMediaEventQueue* queue_ = nullptr;
  IMFPresentationDescriptor* pd_ = nullptr;
  IMFAttributes* attrs_ = nullptr;
  Stream* stream_ = nullptr;
  bool shutdown_ = false, wasStarted_ = false;
};

STDMETHODIMP Stream::GetMediaSource(IMFMediaSource** out) {
  if (!out) return E_POINTER;
  if (shutdown_) return MF_E_SHUTDOWN;
  return source_->QueryInterface(IID_PPV_ARGS(out));
}

// ---------------------------------------------------------------- activator

/** What the Frame Server creates: attributes plus ActivateObject, which builds the source. */
class Activator : public IMFActivate {
public:
  Activator() { InterlockedIncrement(&g_objects); }
  ~Activator() { SafeRelease(attrs_); if (source_) source_->Release(); InterlockedDecrement(&g_objects); }
  HRESULT Init() { return MFCreateAttributes(&attrs_, 4); }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == __uuidof(IMFActivate) || riid == __uuidof(IMFAttributes)) { *ppv = static_cast<IMFActivate*>(this); AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  STDMETHODIMP_(ULONG) Release() override { LONG r = InterlockedDecrement(&ref_); if (!r) delete this; return r; }

  STDMETHODIMP ActivateObject(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (!source_) {
      source_ = new (std::nothrow) Source();
      if (!source_) return E_OUTOFMEMORY;
      HRESULT hr = source_->Init();
      if (FAILED(hr)) { source_->Release(); source_ = nullptr; return hr; }
    }
    return source_->QueryInterface(riid, ppv);
  }
  STDMETHODIMP ShutdownObject() override { if (source_) { source_->Shutdown(); source_->Release(); source_ = nullptr; } return S_OK; }
  STDMETHODIMP DetachObject() override { if (source_) { source_->Release(); source_ = nullptr; } return S_OK; }

  // IMFAttributes, passed through
  STDMETHODIMP GetItem(REFGUID k, PROPVARIANT* v) override { return attrs_->GetItem(k, v); }
  STDMETHODIMP GetItemType(REFGUID k, MF_ATTRIBUTE_TYPE* t) override { return attrs_->GetItemType(k, t); }
  STDMETHODIMP CompareItem(REFGUID k, REFPROPVARIANT v, BOOL* r) override { return attrs_->CompareItem(k, v, r); }
  STDMETHODIMP Compare(IMFAttributes* t, MF_ATTRIBUTES_MATCH_TYPE m, BOOL* r) override { return attrs_->Compare(t, m, r); }
  STDMETHODIMP GetUINT32(REFGUID k, UINT32* v) override { return attrs_->GetUINT32(k, v); }
  STDMETHODIMP GetUINT64(REFGUID k, UINT64* v) override { return attrs_->GetUINT64(k, v); }
  STDMETHODIMP GetDouble(REFGUID k, double* v) override { return attrs_->GetDouble(k, v); }
  STDMETHODIMP GetGUID(REFGUID k, GUID* v) override { return attrs_->GetGUID(k, v); }
  STDMETHODIMP GetStringLength(REFGUID k, UINT32* v) override { return attrs_->GetStringLength(k, v); }
  STDMETHODIMP GetString(REFGUID k, LPWSTR v, UINT32 n, UINT32* l) override { return attrs_->GetString(k, v, n, l); }
  STDMETHODIMP GetAllocatedString(REFGUID k, LPWSTR* v, UINT32* l) override { return attrs_->GetAllocatedString(k, v, l); }
  STDMETHODIMP GetBlobSize(REFGUID k, UINT32* v) override { return attrs_->GetBlobSize(k, v); }
  STDMETHODIMP GetBlob(REFGUID k, UINT8* b, UINT32 n, UINT32* s) override { return attrs_->GetBlob(k, b, n, s); }
  STDMETHODIMP GetAllocatedBlob(REFGUID k, UINT8** b, UINT32* s) override { return attrs_->GetAllocatedBlob(k, b, s); }
  STDMETHODIMP GetUnknown(REFGUID k, REFIID r, LPVOID* p) override { return attrs_->GetUnknown(k, r, p); }
  STDMETHODIMP SetItem(REFGUID k, REFPROPVARIANT v) override { return attrs_->SetItem(k, v); }
  STDMETHODIMP DeleteItem(REFGUID k) override { return attrs_->DeleteItem(k); }
  STDMETHODIMP DeleteAllItems() override { return attrs_->DeleteAllItems(); }
  STDMETHODIMP SetUINT32(REFGUID k, UINT32 v) override { return attrs_->SetUINT32(k, v); }
  STDMETHODIMP SetUINT64(REFGUID k, UINT64 v) override { return attrs_->SetUINT64(k, v); }
  STDMETHODIMP SetDouble(REFGUID k, double v) override { return attrs_->SetDouble(k, v); }
  STDMETHODIMP SetGUID(REFGUID k, REFGUID v) override { return attrs_->SetGUID(k, v); }
  STDMETHODIMP SetString(REFGUID k, LPCWSTR v) override { return attrs_->SetString(k, v); }
  STDMETHODIMP SetBlob(REFGUID k, const UINT8* b, UINT32 n) override { return attrs_->SetBlob(k, b, n); }
  STDMETHODIMP SetUnknown(REFGUID k, IUnknown* p) override { return attrs_->SetUnknown(k, p); }
  STDMETHODIMP LockStore() override { return attrs_->LockStore(); }
  STDMETHODIMP UnlockStore() override { return attrs_->UnlockStore(); }
  STDMETHODIMP GetCount(UINT32* n) override { return attrs_->GetCount(n); }
  STDMETHODIMP GetItemByIndex(UINT32 i, GUID* k, PROPVARIANT* v) override { return attrs_->GetItemByIndex(i, k, v); }
  STDMETHODIMP CopyAllItems(IMFAttributes* d) override { return attrs_->CopyAllItems(d); }

private:
  volatile LONG ref_ = 1;
  IMFAttributes* attrs_ = nullptr;
  Source* source_ = nullptr;
};

// ---------------------------------------------------------------- COM plumbing

class Factory : public IClassFactory {
public:
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) { *ppv = static_cast<IClassFactory*>(this); AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }
  STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    Activator* a = new (std::nothrow) Activator();
    if (!a) return E_OUTOFMEMORY;
    HRESULT hr = a->Init();
    if (SUCCEEDED(hr)) hr = a->QueryInterface(riid, ppv);
    a->Release();
    return hr;
  }
  STDMETHODIMP LockServer(BOOL lock) override { if (lock) InterlockedIncrement(&g_locks); else InterlockedDecrement(&g_locks); return S_OK; }
};
static Factory g_factory;

extern "C" BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) { g_module = h; DisableThreadLibraryCalls(h); }
  return TRUE;
}
STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, LPVOID* ppv) {
  if (clsid != CLSID_LzVcamSource) return CLASS_E_CLASSNOTAVAILABLE;
  return g_factory.QueryInterface(riid, ppv);
}
STDAPI DllCanUnloadNow() { return g_objects == 0 && g_locks == 0 ? S_OK : S_FALSE; }
