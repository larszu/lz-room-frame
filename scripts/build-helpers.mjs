// Builds the helpers for this platform into helpers/bin: the NDI sender (without the NDI SDK,
// helpers/ndi/ndi-min.h; the runtime is loaded at run time) and on Windows the virtual camera
// (helpers/vcam: the Media Foundation source DLL and its feeder).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join('helpers', 'ndi'), src = join(dir, 'lz-ndi-send.cpp'), bin = join('helpers', 'bin');
mkdirSync(bin, { recursive: true });
const run = (cmd, args) => { console.log(cmd, args.join(' ')); execFileSync(cmd, args, { stdio: 'inherit' }); };
if (process.platform === 'darwin') run('clang++', ['-std=c++17', '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', `-I${dir}`, src, '-o', join(bin, 'lz-ndi-send')]);
else if (process.platform === 'linux') run('g++', ['-std=c++17', '-O2', `-I${dir}`, src, '-ldl', '-o', join(bin, 'lz-ndi-send')]);
else {
  run('cl', ['/nologo', '/EHsc', '/O2', '/std:c++17', `/I${dir}`, src, `/Fe:${join(bin, 'lz-ndi-send.exe')}`, `/Fo:${join(bin, 'lz-ndi-send.obj')}`]);
  const v = join('helpers', 'vcam');
  run('cl', ['/nologo', '/EHsc', '/O2', '/std:c++17', '/LD', '/DUNICODE', '/D_UNICODE', `/I${v}`, join(v, 'lz-vcam-source.cpp'), `/Fe:${join(bin, 'lz-vcam-source.dll')}`, `/Fo:${join(bin, 'lz-vcam-source.obj')}`,
    '/link', `/DEF:${join(v, 'lz-vcam-source.def')}`, 'mfplat.lib', 'mfuuid.lib', 'ole32.lib', 'advapi32.lib']);
  run('cl', ['/nologo', '/EHsc', '/O2', '/std:c++17', '/DUNICODE', '/D_UNICODE', `/I${v}`, join(v, 'lz-vcam.cpp'), `/Fe:${join(bin, 'lz-vcam.exe')}`, `/Fo:${join(bin, 'lz-vcam.obj')}`,
    '/link', 'mfplat.lib', 'mfuuid.lib', 'ole32.lib', 'advapi32.lib', 'shell32.lib']);
}
