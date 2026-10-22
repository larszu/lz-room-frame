// Minimal declarations of the NDI(R) SDK C API used by lz-ndi.cpp, for loading the NDI
// runtime dynamically (the user installs it; nothing of NDI is shipped here).
//
// Derived from the NDI SDK headers Processing.NDI.structs.h, Processing.NDI.Find.h,
// Processing.NDI.Recv.h, Processing.NDI.Send.h and Processing.NDI.Lib.h, version 6.3
// (only the types, field orders, enum values and names below were taken over). Those
// files carry this notice:
//
//   NOTE : The following MIT license applies to this file ONLY and not to the SDK as a whole.
//   Please review the SDK documentation for the description of the full license terms,
//   which are also provided in the file "NDI License Agreement.pdf" within the SDK or online
//   at http://ndi.link/ndisdk_license. Your use of any part of this SDK is acknowledgment
//   that you agree to the SDK license terms. The full NDI SDK may be downloaded at
//   http://ndi.video/
//
//   Copyright (C) 2023-2026 Vizrt NDI AB. All rights reserved.
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this
//   software and associated documentation files(the "Software"), to deal in the Software
//   without restriction, including without limitation the rights to use, copy, modify,
//   merge, publish, distribute, sublicense, and / or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to the following
//   conditions :
//
//   The above copyright notice and this permission notice shall be included in all copies
//   or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
//   PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
//   FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// NDI(R) is a registered trademark of Vizrt NDI AB.

#pragma once
#include <stdint.h>

#define LZ_NDI_FOURCC(a, b, c, d) ((uint32_t)(uint8_t)(a) | ((uint32_t)(uint8_t)(b) << 8) | ((uint32_t)(uint8_t)(c) << 16) | ((uint32_t)(uint8_t)(d) << 24))

// runtime library per platform (Processing.NDI.Lib.h)
#if defined(_WIN32)
#define LZ_NDI_LIBRARY "Processing.NDI.Lib.x64.dll"
#elif defined(__APPLE__)
#define LZ_NDI_LIBRARY "libndi.dylib"
#else
#define LZ_NDI_LIBRARY "libndi.so.6"
#endif
#define LZ_NDI_REDIST_FOLDER "NDI_RUNTIME_DIR_V6"

enum {
  NDI_frame_type_none = 0, NDI_frame_type_video = 1, NDI_frame_type_audio = 2, NDI_frame_type_metadata = 3,
  NDI_frame_type_error = 4, NDI_frame_type_status_change = 100, NDI_frame_type_source_change = 101,
};
enum {
  NDI_frame_format_interleaved = 0, NDI_frame_format_progressive = 1, NDI_frame_format_field_0 = 2, NDI_frame_format_field_1 = 3,
};
enum { NDI_recv_color_format_fastest = 100, NDI_recv_color_format_best = 101 };
enum { NDI_recv_bandwidth_lowest = 0, NDI_recv_bandwidth_highest = 100 };

typedef void* NDI_find_instance;
typedef void* NDI_recv_instance;
typedef void* NDI_send_instance;

typedef struct { const char* p_ndi_name; const char* p_url_address; } NDI_source;
typedef struct { bool show_local_sources; const char* p_groups; const char* p_extra_ips; } NDI_find_create;
typedef struct { NDI_source source_to_connect_to; int32_t color_format; int32_t bandwidth; bool allow_video_fields; const char* p_ndi_recv_name; } NDI_recv_create_v3;
typedef struct { const char* p_ndi_name; const char* p_groups; bool clock_video, clock_audio; } NDI_send_create;
typedef struct { int64_t video_frames; int64_t audio_frames; int64_t metadata_frames; } NDI_recv_performance;
typedef struct { int video_frames; int audio_frames; int metadata_frames; } NDI_recv_queue;
typedef struct {
  int xres, yres;
  uint32_t FourCC;
  int frame_rate_N, frame_rate_D;
  float picture_aspect_ratio;
  int32_t frame_format_type;
  int64_t timecode;
  uint8_t* p_data;
  int line_stride_in_bytes;
  const char* p_metadata;
  int64_t timestamp;
} NDI_video_frame_v2;

typedef bool (*NDI_initialize_fn)(void);
typedef void (*NDI_destroy_fn)(void);
typedef const char* (*NDI_version_fn)(void);
typedef NDI_find_instance (*NDI_find_create_v2_fn)(const NDI_find_create*);
typedef bool (*NDI_find_wait_for_sources_fn)(NDI_find_instance, uint32_t);
typedef const NDI_source* (*NDI_find_get_current_sources_fn)(NDI_find_instance, uint32_t*);
typedef void (*NDI_find_destroy_fn)(NDI_find_instance);
typedef NDI_recv_instance (*NDI_recv_create_v3_fn)(const NDI_recv_create_v3*);
typedef int32_t (*NDI_recv_capture_v3_fn)(NDI_recv_instance, NDI_video_frame_v2*, void* audio, void* metadata, uint32_t timeout_ms);
typedef void (*NDI_recv_free_video_v2_fn)(NDI_recv_instance, const NDI_video_frame_v2*);
typedef void (*NDI_recv_destroy_fn)(NDI_recv_instance);
typedef void (*NDI_recv_get_performance_fn)(NDI_recv_instance, NDI_recv_performance* total, NDI_recv_performance* dropped);
typedef void (*NDI_recv_get_queue_fn)(NDI_recv_instance, NDI_recv_queue* total);
typedef int (*NDI_recv_get_no_connections_fn)(NDI_recv_instance);
typedef NDI_send_instance (*NDI_send_create_fn)(const NDI_send_create*);
typedef void (*NDI_send_send_video_v2_fn)(NDI_send_instance, const NDI_video_frame_v2*);
typedef void (*NDI_send_destroy_fn)(NDI_send_instance);
