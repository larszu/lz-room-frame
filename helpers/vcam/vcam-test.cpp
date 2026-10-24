// CI check of the virtual camera: opens "LZ Room Frame" like an app (Media Foundation source
// reader, RGB32) and prints the centre pixel of a frame as JSON.
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <cstdio>
#include <cwchar>

int wmain() {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  MFStartup(MF_VERSION);
  IMFAttributes* q = nullptr; MFCreateAttributes(&q, 1);
  q->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  IMFActivate** devs = nullptr; UINT32 n = 0;
  HRESULT hr = MFEnumDeviceSources(q, &devs, &n);
  IMFActivate* cam = nullptr;
  for (UINT32 i = 0; SUCCEEDED(hr) && i < n; i++) {
    WCHAR* name = nullptr; UINT32 len = 0;
    devs[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &name, &len);
    wprintf(L"device: %s\n", name ? name : L"?");
    if (name && wcsstr(name, L"LZ Room Frame")) cam = devs[i];
    CoTaskMemFree(name);
  }
  if (!cam) { printf("{\"ok\":false,\"error\":\"camera not listed\",\"devices\":%u}\n", n); return 1; }
  IMFMediaSource* src = nullptr;
  hr = cam->ActivateObject(IID_PPV_ARGS(&src));
  if (FAILED(hr)) { printf("{\"ok\":false,\"error\":\"activate 0x%08lx\"}\n", (unsigned long)hr); return 2; }
  IMFAttributes* ra = nullptr; MFCreateAttributes(&ra, 1);
  ra->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
  IMFSourceReader* rd = nullptr;
  hr = MFCreateSourceReaderFromMediaSource(src, ra, &rd);
  IMFMediaType* t = nullptr; MFCreateMediaType(&t);
  t->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); t->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
  if (SUCCEEDED(hr)) hr = rd->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, t);
  if (FAILED(hr)) { printf("{\"ok\":false,\"error\":\"reader 0x%08lx\"}\n", (unsigned long)hr); return 3; }
  IMFMediaType* cur = nullptr; rd->GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, &cur);
  UINT32 w = 0, h = 0; MFGetAttributeSize(cur, MF_MT_FRAME_SIZE, &w, &h);
  for (int i = 0; i < 60; i++) {
    DWORD flags = 0; LONGLONG ts = 0; IMFSample* s = nullptr;
    hr = rd->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, nullptr, &flags, &ts, &s);
    if (FAILED(hr)) { printf("{\"ok\":false,\"error\":\"read 0x%08lx\"}\n", (unsigned long)hr); return 4; }
    if (!s || i < 30) { if (s) s->Release(); continue; } // let the feeder find the shared memory
    IMFMediaBuffer* b = nullptr; s->ConvertToContiguousBuffer(&b);
    BYTE* p = nullptr; DWORD max = 0, len = 0; b->Lock(&p, &max, &len);
    // RGB32 may be bottom-up; the centre pixel is the centre either way
    const BYTE* c = p + ((size_t)(h / 2) * w + w / 2) * 4;
    printf("{\"ok\":true,\"width\":%u,\"height\":%u,\"r\":%u,\"g\":%u,\"b\":%u}\n", w, h, c[2], c[1], c[0]);
    b->Unlock(); b->Release(); s->Release();
    return 0;
  }
  printf("{\"ok\":false,\"error\":\"no frame\"}\n");
  return 5;
}
