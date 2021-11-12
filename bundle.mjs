import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';

let is_debug = false;
let args = process.argv.slice(2);
if (args.length == 0) {
    console.warn('Usage: node bundle.mjs {debug/release}');
} else {
    if (args[0] == 'debug') is_debug = true;
}
console.log(`DEBUG=${is_debug}`);

// -------------------------------
// Clear directory

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
mkdir.sync(dist);

// -------------------------------
// Copy WASM files

const mode = is_debug ? "debug" : 'release';
const buildPath = path.resolve(__dirname, `arrow/cpp/build/${mode}/${mode}`);
fs.copyFileSync(path.resolve(buildPath, 'gandiva_wasm.wasm'), path.resolve(dist, 'gandiva_wasm.wasm'));
fs.copyFileSync(path.resolve(buildPath, 'gandiva_wasm.js'), path.resolve(dist, 'gandiva_wasm.js'));

// -------------------------------
// ESM

const TARGET = ['esnext'];
const EXTERNALS = ['fs', 'path'];

(async () => {
    console.log('[ESBUILD] gandiva.module.js');
    await esbuild.build({
        entryPoints: ['./dist/gandiva_wasm.js'],
        outfile: 'dist/gandiva.module.js',
        platform: 'neutral',
        format: 'esm',
        target: TARGET,
        bundle: true,
        minify: true,
        sourcemap: true,
        external: EXTERNALS,
    });

    console.log('[ESBUILD] gandiva.browser.js');
    await esbuild.build({
        entryPoints: ['./dist/gandiva_wasm.js'],
        outfile: 'dist/gandiva.browser.js',
        platform: 'browser',
        format: 'iife',
        globalName: 'gandiva',
        target: TARGET,
        bundle: true,
        minify: true,
        define: { 'process.env.NODE_ENV': '"production"' },
        sourcemap: is_debug ? 'inline' : true,
        external: EXTERNALS,
    });

    console.log('[ESBUILD] gandiva.node.js');
    await esbuild.build({
        entryPoints: ['./dist/gandiva_wasm.js'],
        outfile: 'dist/gandiva.node.js',
        platform: 'node',
        format: 'cjs',
        target: TARGET,
        bundle: true,
        minify: true,
        sourcemap: is_debug ? 'inline' : true,
        external: EXTERNALS,
    });

    console.log('[ESBUILD] gandiva.benchmark.browser.js');
    await esbuild.build({
        entryPoints: ['./benchmarks/index.browser.ts'],
        outfile: 'dist/gandiva.benchmark.browser.js',
        platform: 'browser',
        format: 'iife',
        globalName: 'gandiva',
        target: TARGET,
        bundle: true,
        minify: true,
        define: { 'process.env.NODE_ENV': '"production"' },
        sourcemap: is_debug ? 'inline' : true,
        external: EXTERNALS,
    });
})();
