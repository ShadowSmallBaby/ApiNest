import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';

const projectRoot = __dirname;
const mainEntry = resolve(projectRoot, 'src/main/index.ts');
const preloadEntry = resolve(projectRoot, 'src/preload/index.ts');
const rendererRoot = resolve(projectRoot, 'src/renderer');
const rendererOutDir = resolve(projectRoot, 'dist');
const mainOutDir = resolve(projectRoot, 'dist-electron/main');
const preloadOutDir = resolve(projectRoot, 'dist-electron/preload');
// 「main 构建就绪」标记：electron:dev 的 wait-on 靠它 + dev server 端口双条件判定何时启动 Electron。
const readyFlagPath = resolve(projectRoot, 'dist-electron/.electron-ready');

// 主进程 external：原生模块（Electron ABI，运行时从 asarUnpack 加载）+ electron-log（内部依赖运行环境，
// bundle 易出错）。其余纯 JS 依赖交给打包器内联。electron 与 node 内置模块由插件默认外部化。
const mainExternal = ['better-sqlite3', 'argon2', 'electron-log'];

export default defineConfig({
  root: rendererRoot,
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: mainEntry,
        // 只写就绪标记，不调用 startup()：dev 期不由本插件启动 Electron，
        // 改由 electron:dev 的 concurrently 手动 `electron .`，从而不加载 native、不锁 .node。
        onstart() {
          writeFileSync(readyFlagPath, '');
        },
        vite: {
          build: {
            outDir: mainOutDir,
            emptyOutDir: true,
            sourcemap: true,
            minify: false,
            rollupOptions: {
              external: mainExternal,
            },
          },
        },
      },
      {
        // 预加载脚本入口（sandbox:true → 必须 CommonJS 产物）
        entry: preloadEntry,
        onstart() {},
        vite: {
          build: {
            outDir: preloadOutDir,
            emptyOutDir: true,
            sourcemap: true,
            minify: false,
          },
        },
      },
    ]),
  ],
  // 强制 dev server 监听 IPv4 127.0.0.1：Windows 上 Vite 默认可能只绑 IPv6 ::1，
  // 而 Electron 主进程用 127.0.0.1 连接，导致 ERR_CONNECTION_REFUSED。
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: rendererOutDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(rendererRoot, 'index.html'),
      },
    },
  },
});
