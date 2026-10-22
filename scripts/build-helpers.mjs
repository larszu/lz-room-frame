// Builds the NDI sender helper for this platform into helpers/bin. It builds without the NDI
// SDK (helpers/ndi/ndi-min.h); the NDI runtime is loaded at run time.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join('helpers', 'ndi'), src = join(dir, 'lz-ndi-send.cpp'), bin = join('helpers', 'bin');
mkdirSync(bin, { recursive: true });
const run = (cmd, args) => { console.log(cmd, args.join(' ')); execFileSync(cmd, args, { stdio: 'inherit' }); };
if (process.platform === 'darwin') run('clang++', ['-std=c++17', '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', `-I${dir}`, src, '-o', join(bin, 'lz-ndi-send')]);
else if (process.platform === 'linux') run('g++', ['-std=c++17', '-O2', `-I${dir}`, src, '-ldl', '-o', join(bin, 'lz-ndi-send')]);
else run('cl', ['/nologo', '/EHsc', '/O2', '/std:c++17', `/I${dir}`, src, `/Fe:${join(bin, 'lz-ndi-send.exe')}`, `/Fo:${join(bin, 'lz-ndi-send.obj')}`]);
