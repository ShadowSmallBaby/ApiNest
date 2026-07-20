# ApiNest MVP 实施计划与任务

- **规格名称：** `apinest-mvp`
- **状态：** 待执行
- **关联文档：** [`requirements.md`](./requirements.md) · [`design.md`](./design.md)
- **实施范围：** P0 + P1 NewAPI；Sub2API/CPA 仅保留扩展接口

## 0. 执行约束

1. 每项任务开始前，将本任务状态从 `[ ]` 改为 `[-]`；完成并验证后改为 `[x]`。
2. 每项任务必须复查 `requirements.md` 与 `design.md` 中的安全边界，尤其是“账户隔离”“本地优先”“不绕过安全机制”。
3. 不实现 Cookie/API Key 手动导入、站点管理能力、Token 写操作、定时签到、远程同步或任何验证码/Cloudflare/Passkey 绕过。
4. 不得在日志、测试快照、错误详情、崩溃报告或 UI 中暴露 Cookie、Token、OAuth code、Authorization Header 或完整敏感 URL Query。
5. 每次新增外部网络请求前，必须明确其属于用户主动认证、查询、签到或快捷打开目标站点的必要请求。
6. 每项任务完成后记录实现内容、关键函数/组件、测试结果与文件变更，避免后续重复建设。

---

## 1. 工程基线与进程安全

- [x] **1.1 初始化 Electron 桌面工程**
  - **范围：** 建立 Electron + React + TypeScript + Vite 的 Windows/macOS 开发、测试与打包骨架。
  - **涉及文件：** `package.json`、构建配置、`src/main/*`、`src/preload/*`、`src/renderer/*`。
  - **要求：** 区分 main、preload、renderer 三个入口；不引入与一期无关的插件系统、同步框架或后台任务框架。
  - **验收：** 开发环境可启动主窗口；生产构建可生成目标平台安装包或打包产物。

- [x] **1.2 固化 BrowserWindow 与 Renderer 安全默认值**
  - **范围：** 为主界面建立安全窗口配置和受限 Preload 基线。
  - **涉及文件：** `src/main/window/*`、`src/preload/index.ts`、安全测试文件。
  - **要求：** 强制 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`；禁止 Renderer 使用通用 Electron/Node API。
  - **验收：** Renderer 无法直接访问 `require`、文件系统、Electron `session`、数据库或进程环境。

- [x] **1.3 实现最小、类型化的 IPC 边界**
  - **范围：** 建立按领域划分的 IPC 通道、参数 schema 校验、返回值与错误码规范。
  - **涉及文件：** `src/shared/ipc/*`、`src/main/ipc/*`、`src/preload/index.ts`。
  - **要求：** 仅暴露账户、认证、签到、页面打开等明确操作；不提供任意命令执行、任意文件访问、任意 URL 浏览或任意 IPC 通道。
  - **验收：** 非法参数和未知账户 ID 被拒绝；错误不会携带敏感资料。

- [x] **1.4 建立日志脱敏策略**
  - **范围：** 统一日志接口、结构化脱敏和测试。
  - **涉及文件：** `src/main/logging/*`、测试文件。
  - **要求：** 过滤 Cookie、Token、OAuth code、Authorization Header、完整响应体和敏感 Query；默认仅记录脱敏错误摘要。
  - **验收：** 对含敏感字段的输入写日志后，输出中不存在原始敏感值。

---

## 2. 本地数据与应用级加密

- [x] **2.1 建立 SQLite 数据库与迁移框架**
  - **范围：** 创建 `schema_meta`、`accounts`、`account_auth_state`、`account_capabilities`、`account_snapshots`、`operations`、`checkin_results`、`secrets` 表及 repository 基础。
  - **涉及文件：** `src/main/storage/*`、迁移文件、数据库测试。
  - **需求引用：** R1、R3、R6、R7、R9、R10。
  - **要求：** `accounts.base_url` 不得唯一；所有关联必须使用 UUID `account_id`；普通表不得存储 Cookie、Token 或 API Key 明文。
  - **验收：** 可重复插入相同 URL 的两个账户；迁移可重复运行；敏感表只保存密文及元数据。

- [x] **2.2 实现主密码初始化与解锁状态机**
  - **范围：** 首次设置主密码、后续解锁、手动锁定、退出清理、错误密码处理。
  - **涉及文件：** `src/main/security/lock-service.*`、`src/main/ipc/auth.*`、对应 UI 状态与测试。
  - **需求引用：** R9。
  - **要求：** 未解锁时禁用登录、刷新、签到及应用内已认证页面；不得保存明文主密码。
  - **验收：** 重启后需要正确主密码才能使用敏感能力；锁定后主进程不再保留可用数据密钥。

- [x] **2.3 实现信封加密凭据库**
  - **范围：** Argon2id 派生 KEK、生成和包装 DEK、AEAD 逐条加密/解密及版本化元数据。
  - **涉及文件：** `src/main/security/crypto-service.*`、`src/main/security/vault-service.*`、测试文件。
  - **需求引用：** R9。
  - **要求：** 使用经验证库；每条密文独立随机 nonce；不在 Renderer 中处理明文密钥；主密码丢失只能清空并重新初始化。
  - **验收：** 不同记录的 nonce 不同；错误密码不能解密；数据库与日志均无凭据明文。

- [x] **2.4 抽象可选系统钥匙串增强**
  - **范围：** 定义系统密钥存储接口，并实现 Windows/macOS 可选“记住此设备”路径或可替换占位。
  - **涉及文件：** `src/main/security/keychain/*`、设置页。
  - **要求：** 系统钥匙串不得成为主密码解锁的唯一依赖；不可用、被拒绝或清空时必须仍能使用主密码。
  - **验收：** 禁用系统钥匙串后核心加密与解锁流程仍正常运行。

---

## 3. 账户管理与基础界面

- [x] **3.1 实现账户领域服务与 URL 规范化**
  - **范围：** 创建、编辑、复制、删除账户；仅做协议、主机和末尾斜杠等安全等价规范化。
  - **涉及文件：** `src/main/accounts/*`、`src/shared/domain/*`、单元测试。
  - **需求引用：** R1、R2、R3。
  - **要求：** 账户 ID 不可变；相同 URL 可多次创建；复制不复制敏感凭据、会话、缓存或历史；不擅自改变 URL 路径语义。
  - **验收：** 同 URL 两账号创建成功；复制后新账号处于未认证状态；编辑 A 不影响 B。

- [x] **3.2 实现账户列表、表单与详情骨架**
  - **范围：** 账户列表、添加/编辑表单、账户详情、删除确认对话框。
  - **涉及文件：** `src/renderer/features/accounts/*`。
  - **需求引用：** R1、R10。
  - **要求：** 表单包含平台、URL、显示名、备注和 NewAPI 的可选 LinuxDo Client ID；删除必须提示会话与缓存将被清除。
  - **验收：** 用户能创建、查看、编辑、删除同 URL 的不同账户；UI 正确显示账号独立状态。

- [x] **3.3 实现账户删除与会话清理事务**
  - **范围：** 删除一个账户时清理数据库关联资料、加密凭据和该账户 partition；实现“仅清除会话”操作。
  - **涉及文件：** `src/main/accounts/delete-account.*`、`src/main/auth/session-service.*`、测试。
  - **需求引用：** R1、R3、R9。
  - **要求：** 清理按 `accountId` 执行；不得删除同 URL 其他账号资料；执行前要求 UI 确认。
  - **验收：** 删除 A 后 B 的数据库记录、网页会话和查询能力均保持；清除 A 会话只让 A 需要重新登录。

---

## 4. 会话隔离与应用内认证基础

- [x] **4.1 实现账户专属 Session Partition 管理器**
  - **范围：** `accountId -> persist:apinest-account-<UUID>` 映射、session 生命周期和清理接口。
  - **涉及文件：** `src/main/auth/session-partition-manager.*`、测试。
  - **需求引用：** R3、R4、R5、R8。
  - **要求：** 禁止基于 URL、平台或显示名派生 partition；partition 名不得携带敏感或可识别业务数据。
  - **验收：** 同 URL 两账户返回不同持久 partition；分别清理后互不影响。

- [x] **4.2 实现受控内嵌浏览器容器**
  - **范围：** 账户专属登录窗口/BrowserView 生命周期、导航策略、`window.open`、下载、权限和外部协议拦截。
  - **涉及文件：** `src/main/browser/*`。
  - **需求引用：** R4、R5、R8、R9。
  - **要求：** 仅主进程可创建容器；默认拒绝非允许域名导航和权限；不使用带高权限预加载脚本的第三方页面；不得使用任意 URL 打开能力。
  - **验收：** 非允许导航被阻止；第三方页面无法触达本地 IPC；目标站点页面在正确 partition 中打开。

- [x] **4.3 实现手动内嵌登录与会话校验编排**
  - **范围：** 为账户提供“应用内登录”“重新登录”，完成后调用适配器验证站点会话并更新状态。
  - **涉及文件：** `src/main/auth/auth-session-service.*`、`src/main/ipc/auth.*`、账户详情 UI。
  - **需求引用：** R4、R5。
  - **要求：** 用户亲自在官方站点页面处理密码、OAuth、验证码、Cloudflare 和 Passkey；应用不收集 LinuxDo 密码，不绕过任何安全机制。
  - **验收：** 账户 A/B 能分别登录，A 的退出或过期不影响 B；登录成功标准是目标站点会话校验通过。

---

## 5. 平台适配器与 NewAPI P0

- [x] **5.1 建立能力驱动的适配器契约与注册表**
  - **范围：** `PlatformAdapter`、`CapabilitySet`、`AccountRequestContext`、统一错误模型、注册表及 NewAPI/Sub2API/CPA 枚举。
  - **涉及文件：** `src/main/adapters/*`、`src/shared/domain/*`、测试。
  - **需求引用：** R2、R6、R7、R8。
  - **要求：** 每次请求必须绑定 `accountId` 和对应 session；UI 不得散落平台判断；Sub2API/CPA 仅返回不支持占位。
  - **验收：** 功能可见性由能力集决定；无能力不会显示可点击操作。

- [x] **5.2 实现 NewAPI 探测与人工纠错路径**
  - **范围：** 低权限站点特征探测、置信度结果和平台手动选择。
  - **涉及文件：** `src/main/adapters/newapi/detect.*`、账户表单 UI、测试。
  - **需求引用：** R2。
  - **要求：** 探测失败不是创建失败；不可因探测失败将站点错误标注为可用；不得进行超出识别目的的扫描。
  - **验收：** 用户可覆盖探测结果；不确定状态在 UI 中清晰呈现。

- [x] **5.3 实现 NewAPI 会话校验与能力解析**
  - **范围：** 使用当前账户 session 验证登录状态，并填充可用用户侧能力。
  - **涉及文件：** `src/main/adapters/newapi/session.*`、`capabilities.*`、测试。
  - **需求引用：** R3、R6。
  - **要求：** 明确区分 `active`、`expired`、`unknown`、`error`；不以余额或空数据推断登录成功。
  - **验收：** 无会话、过期会话、接口错误和有效会话可区分并正确展示。

- [x] **5.4 实现 NewAPI 用户侧信息查询**
  - **范围：** 在稳定、经验证的接口范围内获取用户资料、余额/额度、用量；模型能力可按实际接口逐步启用。
  - **涉及文件：** `src/main/adapters/newapi/queries.*`、`src/main/refresh/*`、账户详情 UI、测试。
  - **需求引用：** R6、R10。
  - **要求：** 优先使用用户已授权/公开接口；查询失败不得覆盖最近成功快照；数据须记录时间、单位和语义来源。
  - **验收：** 成功数据可缓存；失败后 UI 同时显示旧缓存时间和当前错误，不显示伪造零值。

- [x] **5.5 实现 NewAPI 已知页面 URL 与快捷打开**
  - **范围：** 首页、用户中心、用量页、Token 页和登录页的已知路径解析、应用内/外部打开。
  - **涉及文件：** `src/main/adapters/newapi/pages.*`、`src/main/ipc/pages.*`、账户详情 UI。
  - **需求引用：** R8。
  - **要求：** 应用内打开使用账户 partition；外部打开不复制 Cookie；未确认路径不展示。
  - **验收：** 同 URL 的 A/B 在应用内页面使用各自会话；外部浏览器只获得 URL。

---

## 6. NewAPI 签到、总览与操作记录

- [x] **6.1 实现单账户手动签到**
  - **范围：** 调用适配器签到能力、结果映射、账户详情操作与历史写入。
  - **涉及文件：** `src/main/checkin/checkin-service.*`、`src/main/adapters/newapi/checkin.*`、UI 与测试。
  - **需求引用：** R7。
  - **要求：** 只在用户明确点击后执行；区分成功、已签到、会话过期、不支持和失败；不得自动重试。
  - **验收：** 每次签到都有可追踪操作记录；失败不被显示为成功。

- [x] **6.2 实现批量手动签到编排**
  - **范围：** 可签到账户快照、用户确认、顺序执行、取消与逐账户结果更新。
  - **涉及文件：** `src/main/checkin/batch-checkin-orchestrator.*`、总览 UI、测试。
  - **需求引用：** R7、R10。
  - **要求：** 失败不阻断后续账户；取消只影响尚未开始项目；不后台补跑，不定时执行。
  - **验收：** 批量执行中单账号失败后其他账号仍运行；汇总准确显示全部分类结果。

- [x] **6.3 实现总览、筛选与本地操作记录**
  - **范围：** 总账户状态、最近错误、最近签到、按平台/名称/状态筛选、可安全聚合的信息展示。
  - **涉及文件：** `src/renderer/features/dashboard/*`、`src/renderer/features/operations/*`、查询服务。
  - **需求引用：** R6、R7、R10。
  - **要求：** 无法确认币种、单位、统计口径一致时不聚合；突出过期会话和签到失败；日志仅展示脱敏摘要。
  - **验收：** 用户可定位异常账户；不兼容数据不会错误汇总。

---

## 7. LinuxDo OAuth P1

- [x] **7.1 定义 LinuxDo OAuth 前置条件与安全路径解析**
  - **范围：** 验证 NewAPI 账户、Client ID、站点入口和允许回跳域名；无法验证时拒绝专用流程。
  - **涉及文件：** `src/main/adapters/newapi/linuxdo-oauth.*`、账户设置 UI、测试。
  - **需求引用：** R4。
  - **要求：** Client ID 可选；不得猜测 Client ID 或任意接受回跳 URL；失败时只提供手动内嵌登录回退。
  - **验收：** 缺少前置条件不会启动 OAuth；UI 明确给出回退入口。

- [x] **7.2 实现 LinuxDo 官方授权导航辅助**
  - **范围：** 在账户专属 partition 中启动由目标 NewAPI 站点发起的官方 OAuth 流程，监测受信回跳并请求目标站点会话校验。
  - **涉及文件：** `src/main/auth/linuxdo-login-flow.*`、受控浏览器容器、测试。
  - **需求引用：** R4、R5。
  - **要求：** 用户自行输入账号密码、处理验证码和确认授权；应用不采集密码，不自动完成验证；成功标准仅为目标站点会话有效。
  - **验收：** 用户取消、站点不兼容、未知重定向和会话校验失败均能安全结束并回退手动登录。

- [x] **7.3 加密保存必要 OAuth 状态并实现重新验证**
  - **范围：** 仅保存维持目标站点授权确有必要的 OAuth material；绑定账户 ID，提供过期与失效状态处理。
  - **涉及文件：** `src/main/auth/oauth-credential-service.*`、Vault 集成、测试。
  - **需求引用：** R4、R9。
  - **要求：** 不保存 LinuxDo 密码、Passkey 私钥或不必要身份资料；不将 OAuth 凭据写入普通 SQLite 字段或日志。
  - **验收：** 重启解锁后可安全恢复必要状态；失效仅影响所属账户。

---

## 7A. 应用外壳与无边框窗口（R12）

- [x] **7A.1 主窗口无边框化与窗口控制 IPC**
  - **范围：** 主窗口改为无系统标题栏；新增固定枚举的窗口控制 IPC（最小化、最大化/还原、关闭、查询最大化状态）及最大化状态事件回推。
  - **涉及文件：** `src/main/window/create-main-window.ts`、`src/main/window/secure-web-preferences.ts`、`src/shared/ipc/channels.ts`、`src/shared/ipc/schemas.ts`、`src/shared/ipc/bridge.ts`、`src/preload/index.ts`、`src/main/ipc/handlers.ts`、测试。
  - **需求引用：** R12。
  - **要求：** `frame: false`；macOS 用 `titleBarStyle: 'hidden'` + `trafficLightPosition` 保留交通灯；不放松 `contextIsolation`/`sandbox`/`nodeIntegration:false`/`webSecurity`；窗口指令不接受任意句柄、坐标或尺寸参数。
  - **验收：** Windows/macOS 均可拖拽、缩放并使用窗口控件；Renderer 无法获得通用窗口/系统控制能力；非法窗口指令被拒绝。

- [x] **7A.2 自绘标题栏与外壳布局**
  - **范围：** 顶部自绘标题栏（品牌 + 拖拽区 + 窗口控件），左侧导航 + 右侧内容区；未实现导航项显示占位；拖拽/交互区正确区分。
  - **涉及文件：** `src/renderer/src/shell/AppShell.tsx`、`src/renderer/src/shell/TitleBar.tsx`（新增）、`src/renderer/src/shell/navigation.ts`、`src/renderer/src/styles.css`、测试。
  - **需求引用：** R12。
  - **要求：** 拖拽区用 `-webkit-app-region: drag`，控件与导航标注 `no-drag`；占位项不伪造数据；最大化按钮图标随窗口状态同步。
  - **验收：** 标题栏可拖拽移动窗口，控件可点击且状态正确；解锁后进入“左导航 + 右内容区”外壳；占位项明确标示待推出。

---

## 7B. 应用内嵌页面视图（R11）

- [x] **7B.1 实现基于 WebContentsView 的内嵌页面视图**
  - **范围：** 将目标站点页面从独立窗口改为主窗口内嵌视图；提供 mount/setBounds/hide/unmount 生命周期；复用 `navigation-policy` 全部安全判定。
  - **涉及文件：** `src/main/browser/embedded-page-view.*`（新增）、`src/main/browser/navigation-policy.ts`（复用）、`src/main/browser/browser-container.ts`（回退独立容器保留）、测试。
  - **需求引用：** R11。
  - **要求：** 内嵌视图绑定账户专属 partition，不注入本应用 Preload；导航/`window.open`/下载/权限/外部协议默认拒绝；`hide`/`unmount` 释放视图资源但不清除账户 partition 持久化。
  - **验收：** 目标页面在主窗口内容区内嵌显示；同 URL A/B 使用各自会话；非允许导航被阻止；卸载后账户持久会话仍在。

- [x] **7B.2 内容区 bounds 上报与视图定位接线**
  - **范围：** `pages.openInApp` 改为挂载内嵌视图；新增 `pages.closeEmbedded` 与 `pages.reportContentBounds`；Renderer 用 `ResizeObserver` 上报内容区几何并节流。
  - **涉及文件：** `src/shared/ipc/channels.ts`、`src/shared/ipc/schemas.ts`、`src/shared/ipc/bridge.ts`、`src/preload/index.ts`、`src/main/ipc/handlers.ts`、`src/main/index.ts`（组合根接线）、`src/renderer/src/shell/AppShell.tsx`、测试。
  - **需求引用：** R11。
  - **要求：** 主进程持“当前内嵌视图”单例，切换账户/页面先 `unmount` 旧视图再 `mount` 新视图；bounds 上报做节流；内嵌视图不遮挡标题栏与左导航；站点原生弹窗式 OAuth 回退受控独立容器。
  - **验收：** 内嵌视图精确贴合内容区并随窗口缩放更新；切换导航项正确显示/隐藏；多次打开不叠加、不串号。

---

## 7C. 认证方式的类型化管理（R13）

- [x] **7C.1 实现认证方式描述与登录入口分类**
  - **范围：** 按 `github_oauth`/`linuxdo_oauth`/`site_password` 分类呈现登录入口与可用状态；GitHub/LinuxDo 保持应用内手动登录并按账户隔离持久化会话。
  - **涉及文件：** `src/main/auth/auth-methods.*`（新增）、`src/main/auth/login-flow-service.ts`、`src/shared/ipc/bridge.ts`、`src/shared/ipc/channels.ts`、`src/shared/ipc/schemas.ts`、`src/preload/index.ts`、`src/main/ipc/handlers.ts`、账户详情 UI、测试。
  - **需求引用：** R13、R4、R5。
  - **要求：** 前置条件不满足时清晰展示不可用原因（脱敏）并提供回退；不采集/代填 GitHub、LinuxDo 密码；任一方式失效只影响所属账户。
  - **验收：** 三类入口分类可见且状态准确；GitHub/LinuxDo 登录成功后重启仍复用会话；不可用方式不伪造成功。

- [x] **7C.2 实现站点账号密码的加密凭据引用**
  - **范围：** 站点账号密码作为绑定账户的加密 secret 引用保存/清除/存在性查询；用户主动发起时于主进程内解密用于目标站点原生登录表单，用后即弃。
  - **涉及文件：** `src/main/auth/site-credential-service.*`（新增）、`src/main/security/vault-service.ts`（复用）、`src/main/storage/repositories/secret-repository.ts`（`purpose: 'site_login_credential'`）、`src/main/auth/login-flow-service.ts`、IPC 契约、账户详情 UI、测试。
  - **需求引用：** R13、R9。
  - **要求：** 复用信封加密逐条保护；明文只在主进程内存短暂存在，绝不写入普通字段、日志、快照、`details_json` 或 UI；不提供读取明文通道；仅用于目标站点原生表单，不绕过任何安全挑战。
  - **验收：** UI 只见“已保存/未保存”，不见凭据内容；账密登录由用户主动触发；数据库与日志无账号密码明文；遇安全挑战交由用户处理。

---

## 8. 质量、安全与发布验证

- [x] **8.1 完成领域与安全单元测试**
  - **范围：** 加密、锁定、重复 URL、多账号隔离、删除隔离、能力降级、签到结果分类、日志脱敏。
  - **涉及文件：** 各模块测试文件。
  - **验收：** 核心服务达到项目设定的覆盖目标；所有安全回归测试通过。

- [x] **8.2 完成双账号端到端场景**
  - **范围：** 两个相同 NewAPI URL 账号的独立登录、查询、失效、清会话、删除和重启恢复。
  - **涉及文件：** `e2e/*`。
  - **验收：** A 与 B 的网页会话持久化且互不影响；A 失效、退出、删除不会破坏 B。

- [x] **8.3 完成 OAuth、导航与异常负向测试**
  - **范围：** OAuth 取消、异常/未知回跳、非允许导航、下载/权限请求、过期会话、站点接口失败、未解锁调用。
  - **涉及文件：** `e2e/*`、适配器测试。
  - **验收：** 所有负向路径安全拒绝或回退到手动登录，不泄露凭据、不产生高权限访问。

- [ ] **8.4 完成 Windows/macOS 打包与网络边界检查**
  - **范围：** 两平台打包、用户私有目录验证、无自有远端请求检查、发行前人工清单。
  - **涉及文件：** 打包配置、发布检查清单。
  - **验收：** 数据目录位于用户私有应用目录；除用户主动访问目标站点外，无 ApiNest 自有云通信；无自动签到、同步、Token 写操作、凭据导入或安全绕过能力。

- [x] **8.5 完成外壳、内嵌与认证方式的安全回归测试**
  - **范围：** 无边框窗口控制 IPC 的最小权限校验、内嵌视图导航/权限拒绝与资源释放、账号密码引用的脱敏与用途限制。
  - **涉及文件：** `src/main/**` 相关测试、`e2e/*`。
  - **需求引用：** R11、R12、R13。
  - **要求：** 窗口指令拒绝任意句柄/坐标/尺寸；内嵌视图沿用 `navigation-policy` 拒绝非允许域名、`window.open`、下载、权限；账号密码明文不出现在日志/快照/UI/`details_json`；切换/卸载视图不清除账户 partition 持久化。
  - **验收：** 相关安全断言全部通过；内嵌视图与独立容器共享同一套导航策略；账密引用只在主进程内用于表单填充且无读取明文通道。

---

## 9. 推荐实施顺序

```text
1.1 → 1.2 → 1.3 → 1.4
  → 2.1 → 2.2 → 2.3 → 2.4
  → 3.1 → 3.2 → 3.3
  → 4.1 → 4.2 → 4.3
  → 5.1 → 5.2 → 5.3 → 5.4 → 5.5
  → 6.1 → 6.2 → 6.3
  → 7.1 → 7.2 → 7.3
  → 7A.1 → 7A.2            （无边框外壳与窗口控制，可与 7B/7C 并行）
  → 7B.1 → 7B.2            （内嵌页面视图，依赖 7A.1 的外壳布局）
  → 7C.1 → 7C.2            （认证方式管理，依赖既有 4.x/7.x 登录编排）
  → 8.1 → 8.2 → 8.3 → 8.5 → 8.4
```

说明：

- **7A（外壳）先行**：内嵌视图（7B）需要 `AppShell` 提供稳定的内容区布局边界，故 7A.1 应在 7B.1 之前完成；7A.2 窗口控制 IPC 可与 7B/7C 并行推进。
- **7C（认证方式）** 依赖既有 4.3 手动登录编排与 7.x LinuxDo 流程，可与 7A/7B 并行。
- **8.5** 是外壳/内嵌/认证方式的安全回归测试，须在 8.4 打包前通过。

**首个可演示里程碑：** 完成第 1～5 阶段后，用户可以为同一个 NewAPI URL 创建两个账户，在独立应用内会话中分别登录，并独立查看经适配器支持的账户信息。

**一期完成里程碑：** 完成第 6～8 阶段后，用户可在本地加密保护下使用 NewAPI 的 LinuxDo OAuth 或手动内嵌登录，查看统一总览并执行手动单账号/批量签到，且双账号隔离、异常与安全边界均有测试验证。

**外壳与体验里程碑（本轮增补）：** 完成 7A～7C 后，应用具备无边框自绘外壳（锁定页 → 左导航 + 右内容区）、目标站点页面在内容区内嵌浏览，并按 GitHub/LinuxDo/站点账号密码三类认证方式分类管理登录入口与会话复用。
