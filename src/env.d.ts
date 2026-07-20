/**
 * 主进程环境变量类型声明。
 * 迁移到 vite-plugin-electron 后不再依赖 electron-vite/node 提供的 ambient 类型。
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * 开发期 Renderer dev server 地址，由 `start:electron` 脚本经 cross-env 注入
     * （例如 http://127.0.0.1:5173）。打包运行时不存在。
     */
    ELECTRON_START_URL?: string;
    NODE_ENV?: 'development' | 'production' | 'test';
  }
}
