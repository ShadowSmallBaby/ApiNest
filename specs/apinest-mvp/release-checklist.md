# ApiNest MVP 发布前检查清单

> 本清单只覆盖当前一期范围。任何未验证项不得在发布记录中标记为已完成。

## 构建产物

- [x] 在 Windows x64 执行 `npm run build`（2026-07-18 成功；`electron-vite build` 通过）。
- [ ] 在 Windows x64 执行 `npm run dist` 并确认 NSIS 产物生成。**当前阻塞：** `argon2` Electron 原生模块重编译要求可用的 Visual Studio C++ Build Tools；当前项目路径含空格且本机未检测到 Visual Studio，因此 `node-gyp` 失败。应在已安装 VS C++ Build Tools 的无空格路径工作区重新执行。
- [ ] 在 macOS x64 实机或 macOS CI 执行 `npm run build && npm run dist` 并确认 DMG 产物生成。
- [ ] 安装产物后手动验证首次初始化、解锁、账户创建及退出重启。

## 本地数据与网络边界

- [x] SQLite 路径由 Electron `app.getPath('userData')` 派生：`src/main/storage/paths.ts`。
- [x] Cookie/网页存储使用按 UUID 派生的 `persist:apinest-account-<accountId>` partition；不含 URL、平台或账户名称。
- [x] 除用户主动操作的目标站点查询、签到、官方登录与已知页面打开外，项目没有 ApiNest 自有云 API/client。
- [x] 不实现 WebDAV、远程同步、后台常驻或定时签到。
- [x] 不提供 Cookie/API Key 导入、Token 写操作、渠道/用户/管理员站点管理。
- [x] 不绕过验证码、Cloudflare、Passkey/WebAuthn 或 OAuth 授权确认；应用不读取 LinuxDo 密码或 OAuth code。

## 安全与回归

- [x] `npm run typecheck` 通过（2026-07-18）。
- [x] `npm test` 通过（2026-07-18；51 个测试文件 / 236 项）。
- [x] 受控容器默认拒绝未知导航、window.open、权限与下载；第三方页面无本地 preload/IPC。
- [x] 日志与安全投影测试覆盖 Cookie、Token、Authorization、OAuth code 和敏感 Query 脱敏。
- [x] 双账户 session partition、清会话、缓存和操作记录隔离已由测试验证。
- [x] Site → Account 隔离已由测试验证：`listBySite` 只返回目标站点账号；删除 Site 仅清理其账号 session；同一 auth 可被多站点账号引用且结果不含凭据明文。
