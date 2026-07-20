# ApiNest MVP 技术方案

- **规格名称：** `apinest-mvp`
- **项目名称：** ApiNest
- **状态：** 草案
- **关联需求：** [`requirements.md`](./requirements.md)
- **设计原则：** 本地优先、账号隔离、最小权限、能力驱动、KISS、YAGNI

## 1. 方案概述

ApiNest 一期是面向 Windows 和 macOS 的本地优先桌面应用。它以“站点账户”为唯一管理和隔离单位，为用户统一呈现自己有权访问的 NewAPI 账户信息和手动签到能力。

一期交付重心为 **P0 + P1 的 NewAPI**：

- 同一 `baseUrl` 的多账号独立存在；
- 每个账号拥有持久且独立的网页会话；
- 用户在应用内完成站点认证；
- 支持 NewAPI 的 LinuxDo OAuth 辅助流程和手动内嵌登录回退；
- 在站点实际支持的前提下，查询用户侧状态、余额/额度、用量和模型；
- 单账户/批量的用户主动签到；
- 本地数据库、应用级加密凭据和操作记录。

Sub2API 与 CPA 一期仅预留平台枚举、能力模型和适配器注册点，不实现未经验证的具体接口。

## 2. 技术选型

| 层级 | 选型 | 理由 |
| --- | --- | --- |
| 桌面运行时 | Electron | Chromium 的持久 `session partition` 可直接按账户隔离 Cookie、Local Storage、IndexedDB 和网页缓存，降低多账号内嵌登录的实现风险。 |
| 前端 | React + TypeScript + Vite | 适合构建账户看板、表单和状态化 UI；类型可覆盖 IPC 与领域模型边界。 |
| 本地数据库 | SQLite | 离线、轻量、事务一致，适合账户元数据、缓存与操作历史。 |
| 加密 | Argon2id + 信封加密 + AEAD | 主密码不落盘，随机数据密钥用于逐条保护敏感资料。 |
| 可选系统安全存储 | Windows Credential Manager / macOS Keychain | 仅作为“记住此设备”的增强；核心路径仍可只用应用主密码。 |
| 测试 | 单元测试 + Electron 端到端测试 | 覆盖加密、适配器、会话隔离和双账号登录等关键路径。 |

不选用 Tauri 的原因是：一期最高风险是第三方 WebView 会话持久化、账户级隔离、导航管控及 OAuth 流程观察；Electron 对此有成熟且直接的 `session.fromPartition` 模型。安装包体积不是一期首要约束。

## 3. 系统架构

```text
┌─────────────────────────────────────────────┐
│ Renderer：React UI                           │
│ 总览 / 账户 / 登录入口 / 签到 / 操作记录    │
└─────────────────┬───────────────────────────┘
                  │ 受限、类型化 IPC
┌─────────────────▼───────────────────────────┐
│ Preload                                      │
│ 仅暴露按领域划分的最小 API                   │
└─────────────────┬───────────────────────────┘
                  │ 参数校验与授权检查
┌─────────────────▼───────────────────────────┐
│ Main Process：应用编排层                     │
│ ├─ AccountService                            │
│ ├─ AdapterRegistry / NewApiAdapter           │
│ ├─ AuthSessionService                        │
│ ├─ EmbeddedBrowserController                 │
│ ├─ CheckInOrchestrator                       │
│ ├─ VaultService / CryptoService              │
│ └─ SQLite Repositories                       │
└───────┬───────────────────────┬─────────────┘
        │                       │
┌───────▼──────────┐    ┌───────▼────────────────────────┐
│ SQLite           │    │ Electron session partition       │
│ 元数据/缓存/历史 │    │ persist:apinest-account-<UUID>  │
└──────────────────┘    │ Cookie/网页存储/缓存，按账户隔离 │
                        └─────────────────────────────────┘
```

### 3.1 进程与权限边界

主窗口必须启用：

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`

Renderer 不得直接访问 Node.js、Electron Session、SQLite、密钥、文件系统或通用 IPC。Preload 只暴露领域方法，例如：

```ts
interface ApiNestBridge {
  accounts: {
    list(): Promise<AccountSummary[]>;
    create(input: CreateAccountInput): Promise<Account>;
    update(id: string, input: UpdateAccountInput): Promise<Account>;
    copy(id: string): Promise<Account>;
    remove(id: string): Promise<void>;
    refresh(id: string): Promise<RefreshResult>;
  };
  auth: {
    unlock(masterPassword: string): Promise<void>;
    lock(): Promise<void>;
    openLogin(accountId: string, mode: "manual" | "linuxdo"): Promise<LoginResult>;
    clearSession(accountId: string): Promise<void>;
  };
  checkIn: {
    runOne(accountId: string): Promise<CheckInResult>;
    runAll(): Promise<BatchCheckInResult>;
  };
  pages: {
    openInApp(accountId: string, page: KnownPage): Promise<void>;
    openExternal(accountId: string, page: KnownPage): Promise<void>;
  };
}
```

每个 IPC 参数必须经 schema 校验，所有调用必须验证应用已解锁、账户存在且当前操作允许执行。

## 4. 领域模型与数据设计

### 4.1 站点与账户

站点是非敏感配置聚合根，账户是会话与操作的隔离边界。一个 Site 可包含多个 Account；Account 通过 `siteId` 引用 Site，并继续以不可变 `accountId` 隔离 partition、认证状态、快照与操作记录。

```ts
type PlatformType = "newapi" | "sub2api" | "cliproxyapi";
type SiteRouteProfile = "modern" | "classic" | "legacy-panel";
type AuthState = "unknown" | "active" | "expired" | "error";

interface Site {
  id: string;
  name: string;
  platform: PlatformType;
  baseUrl: string;
  note?: string;
  linuxDoClientId?: string;
  routeProfile: SiteRouteProfile;
  recordVersion: number;
}

interface Account {
  id: string;
  siteId: string;
  displayName: string;
  note?: string;
  authRefId?: string | null;
  recordVersion: number;
}
```

### 4.1.1 NewAPI 三档页面路由

NewAPI 的 `routeProfile` 只影响由适配器解析的受信 `KnownPage` 页面 URL；它不影响查询、签到、会话校验等共享 `/api/*` 接口，也不影响账户专属 partition。

| routeProfile | 定位 | `userCenter` | `usage` | `token` | `login` |
| --- | --- | --- | --- | --- | --- |
| `modern` | 新建站点默认 UI | `/profile` | `/usage-logs` | `/keys` | `/sign-in` |
| `classic` | console 兼容 UI | `/console/personal` | `/console/log` | `/console/token` | `/login` |
| `legacy-panel` | 历史迁移站点的 Panel UI | `/panel` | `/panel/log` | `/panel/token` | `/login` |

三档的 `home` 均为 `/`。`legacy-panel` 是迁移历史 NewAPI 账户时使用的保守默认值；用户可在站点表单中切换为 `modern` 或 `classic`。所有页面 URL 必须由 `resolveNewApiPageUrl` 统一解析，Renderer 仅可通过 `KnownPage` 请求，不能传入任意 URL。

约束：`/api/user/self`、`/api/user/checkin` 和会话校验只基于站点 `baseUrl` 与账户专属 session 发起，绝不因 `routeProfile` 改变。



- Site 与 Account 均使用随机 UUID，创建后不可变；
- `sites.base_url` 允许重复，不建立唯一约束；
- 一个 Account 至多引用一个 AuthIdentity，同一 AuthIdentity 可被多个站点下的 Account 引用；
- 复制账户只在同一 Site 内复制账号显示名与备注，不复制 auth 引用、会话、缓存或历史；
- 所有敏感状态、缓存、网页会话与操作记录仍只通过 `accountId` 关联，绝不能通过 Site ID 或 URL 关联。

### 4.2 SQLite 表

| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `schema_meta` | `version`, `applied_at` | 数据迁移版本。 |
| `accounts` | `id`, `platform`, `base_url`, `display_name`, `note`, `linuxdo_client_id`, `record_version` | 非敏感账户元数据。 |
| `account_auth_state` | `account_id`, `state`, `last_verified_at`, `last_error_code`, `last_error_summary` | 登录状态摘要；不含明文 Session。 |
| `account_capabilities` | `account_id`, `adapter_version`, `capabilities_json`, `checked_at` | 适配器能力缓存。 |
| `account_snapshots` | `id`, `account_id`, `kind`, `payload_json`, `semantic_unit`, `fetched_at`, `is_latest` | 用户资料、余额、用量、模型的非敏感快照。 |
| `operations` | `id`, `account_id`, `kind`, `status`, `started_at`, `finished_at`, `error_code`, `error_summary`, `details_json` | 刷新、会话校验和签到等历史。 |
| `checkin_results` | `operation_id`, `account_id`, `result`, `message`, `checked_at` | 可检索的签到结果。 |
| `secrets` | `secret_id`, `account_id`, `purpose`, `ciphertext`, `nonce`, `encryption_version` | 仅存密文与加密元数据。 |

日志与错误详情不可记录 Cookie、OAuth code/token、`Authorization` Header、原始响应体或敏感 URL Query。

### 4.3 敏感资料边界

敏感资料包括：OAuth material、站点 Session 的可导出资料（若后续确有需要）以及其他可直接用于认证的内容。它们只能存入 `secrets` 的加密字段或账号专属 Chromium partition。

Cookie、Local Storage、IndexedDB 等网页认证状态由 Electron 的持久化 partition 保存：

```text
persist:apinest-account-<accountId>
```

要求：

- partition 名仅含 UUID，不能包含 URL、账户名、用户名或 Token；
- 不将 Electron 用户数据目录纳入备份、同步、诊断包或导出；
- 删除账户时清理该 partition 存储；
- 不在页面、日志和崩溃报告中显示 Cookie 内容。

## 5. 应用级加密与解锁

### 5.1 信封加密模型

```text
用户主密码
  ↓ Argon2id（独立随机 salt、可版本化参数）
主密钥 KEK
  ↓ 解密
随机生成的数据密钥 DEK
  ↓ AEAD（逐条、独立随机 nonce）
敏感凭据密文
```

首次启动时：

1. 用户设置应用主密码；
2. 系统生成随机 DEK；
3. 使用 Argon2id 从主密码派生 KEK；
4. 使用 KEK 加密 DEK；
5. 持久化 `salt`、KDF 参数、被包装的 DEK、算法版本与校验密文；
6. 不保存明文主密码。

运行期：

- 未解锁时，可显示有限账户元数据，但禁用登录、刷新、签到和已认证内嵌页面；
- 解锁后，DEK 仅存在主进程内存；
- 手动锁定、应用退出或主进程重启时清除 DEK；
- 主密码遗失时只能清除加密资料并重新初始化，不能提供恢复后门；
- 系统钥匙串仅可保存“本设备解锁辅助材料”，且失败时必须可退回主密码解锁。

### 5.2 加密算法要求

- 密钥派生使用 Argon2id；
- 凭据加密使用维护良好的 AEAD 实现，如 AES-256-GCM 或 XChaCha20-Poly1305；
- 每条密文使用独立随机 nonce；
- 记录算法与加密版本，支持将来迁移；
- 不自定义加密算法，不在 Renderer 中处理明文密钥。

## 6. 平台适配器架构

业务层只依赖能力，不直接判断平台类型。

```ts
type CapabilitySet = {
  embeddedLogin: boolean;
  linuxDoOAuth: boolean;
  profile: boolean;
  balance: boolean;
  usage: boolean;
  models: boolean;
  checkIn: boolean;
  pages: Partial<Record<KnownPage, true>>;
};

interface AccountRequestContext {
  accountId: string;
  baseUrl: string;
  platform: PlatformType;
  session: AccountSessionHandle;
}

interface PlatformAdapter {
  readonly platform: PlatformType;

  detect(baseUrl: string): Promise<DetectionResult>;
  getCapabilities(account: Account): Promise<CapabilitySet>;
  validateSession(context: AccountRequestContext): Promise<AuthState>;

  fetchProfile?(context: AccountRequestContext): Promise<UserProfile>;
  fetchBalance?(context: AccountRequestContext): Promise<BalanceInfo>;
  fetchUsage?(context: AccountRequestContext): Promise<UsageInfo>;
  fetchModels?(context: AccountRequestContext): Promise<ModelInfo[]>;
  checkIn?(context: AccountRequestContext): Promise<CheckInResult>;

  getPageUrl(account: Account, page: KnownPage): URL | null;
  getLinuxDoLoginUrl?(account: Account): URL | null;
}
```

设计规则：

1. `AccountRequestContext` 强制包含 `accountId` 和独立 session；禁止共享 Cookie Jar。
2. UI 只渲染 `CapabilitySet` 声明的功能。
3. API 路径、字段映射、实例差异和站点原始错误文本只保留在适配器内部。
4. API 调用失败不能被映射为零余额、零用量或“已签到”。
5. NewAPI 是一期唯一完整实现；Sub2API 和 CPA 仅注册为“不支持”的扩展占位。

## 7. NewAPI 一期能力边界

| 优先级 | 能力 | 行为 |
| --- | --- | --- |
| P0 | 平台检测 | 使用轻量、低权限的特征探测；失败时允许用户手动指定。 |
| P0 | 手动内嵌登录 | 使用当前账户独立 partition 打开目标站点官方登录页。 |
| P0 | 会话校验 | 返回 `active`、`expired`、`unknown`、`error`，绝不以业务值替代错误。 |
| P0 | 用户侧查询 | 只实现经验证稳定的用户资料、余额/额度、用量接口；不可靠字段保守降级。 |
| P0 | 签到 | 用户明确触发；返回成功、已签到、会话过期、不支持或失败。 |
| P0 | 快捷页 | 首页、用户中心、用量页、Token 页、登录页中已确认存在的入口。 |
| P1 | LinuxDo OAuth | 仅在填写 Client ID 且目标站点可验证支持时提供官方流程导航辅助。 |
| P1 | 模型列表 | 仅在实例提供稳定用户侧能力时展示。 |
| P1 | 快照缓存 | 保存非敏感最近成功结果，显示时间和错误状态。 |

## 8. 认证与嵌入式网页

### 8.1 会话隔离

登录、重新登录和应用内打开网页均按以下流程：

1. 根据 `accountId` 获取固定 `session partition`；
2. 创建或复用此账户专属的受控浏览器容器；
3. 导航到适配器提供的已知 URL；
4. 用户亲自在目标站点官方页面完成登录、验证码、安全挑战与授权；
5. 适配器执行目标站点会话校验；
6. 成功后更新本地认证状态和操作记录。

登录容器由主进程全权创建和销毁。所有外部导航、`window.open`、下载、权限请求与外部协议必须被主进程拦截，默认拒绝，仅允许当前站点、已配置 OAuth 域名和确认的回跳域名。

### 8.2 LinuxDo OAuth

专用流程只在以下条件同时满足时启用：

- 当前账户为 NewAPI；
- 用户提供 `linuxDoClientId`；
- NewAPI 适配器确认目标站点支持对应 LinuxDo OAuth 入口；
- 启动 URL 和允许回跳域名可被安全确定。

流程：

```text
用户选择 LinuxDo 登录
  ↓
使用账户专属 partition 打开目标 NewAPI 的官方 OAuth 入口
  ↓
用户在 LinuxDo 官方页面亲自登录、验证与授权
  ↓
回跳至目标 NewAPI 站点
  ↓
NewAPI 适配器验证目标站点会话
  ↓
更新账户状态；必要的 OAuth 资料作为敏感信息加密处理
```

以下场景必须回退到“手动内嵌登录”：Client ID 缺失、站点不兼容、自动路径无法安全识别、用户取消、授权失败或出现安全挑战。

应用不得：

- 收集或保存 LinuxDo 密码；
- 绕过验证码、Cloudflare 或授权确认；
- 保存、导出、复制或同步 Passkey 私钥；
- 提供 Cookie/API Key 手动导入。

站点原生页面内的 GitHub OAuth、Passkey 等登录方式可由用户自行使用；应用只以目标站点会话通过验证为成功标准。

## 9. 查询、缓存、签到与总览

### 9.1 刷新与缓存

刷新只由用户主动触发。每次请求均：

1. 检查应用已解锁；
2. 根据 `accountId` 建立请求上下文；
3. 调用适配器的可用能力；
4. 成功时写入非敏感快照；
5. 失败时写入错误操作记录，但不覆盖最近成功快照；
6. UI 同时展示缓存数据时间与当前错误/过期状态。

余额、额度、用量仅在币种、单位和统计口径可确认一致时才允许聚合；默认按账户逐项显示。

### 9.2 签到

- 单账户签到：用户在账户详情中明确点击后执行。
- 批量签到：用户在总览明确点击、确认将执行的账户数量后，按启动时快照的可签到账户顺序执行。
- 每个账户的结果分别记录为：`success`、`already_checked_in`、`unsupported`、`session_expired`、`failed`、`cancelled`。
- 单账户失败不得中断其他账户。
- 用户取消时停止尚未开始的账户；已执行结果必须保留。
- 一期不做定时、后台或应用启动自动签到。

### 9.3 网页快捷打开

- 应用内打开：使用当前账户 partition，保留该账号自己的站点会话；
- 外部浏览器打开：只通过系统默认浏览器打开 URL，不复制 Cookie 或登录态；
- 只有适配器明确返回的页面 URL 才能显示入口。

## 10. UI 信息架构

一期采用“锁定页 → 主外壳”的两级结构。主外壳为无边框自绘窗口，顶部是自绘标题栏，主体分左侧固定导航与右侧内容区（详见第 14、15 节）。

```text
锁定页（未解锁）
└─ 设置主密码 / 输入主密码解锁

主外壳（已解锁，无边框自绘窗口）
├─ 自绘标题栏
│  ├─ 品牌区 + 可拖拽区域
│  └─ 窗口控制：最小化 / 最大化·还原 / 关闭
├─ 左侧导航（列出全部一期入口，未实现项显示占位）
│  ├─ 仪表盘（总览）
│  ├─ 站点（账户）
│  ├─ 模型（占位）
│  ├─ 日志（操作记录）
│  ├─ 测试（占位）
│  ├─ OAuth（认证管理）
│  └─ 系统设置
└─ 右侧内容区（按导航项切换）
   ├─ 仪表盘：账户总数、有效/过期/异常、最近签到与错误、筛选、批量签到
   ├─ 站点：
   │  ├─ 账户列表 + 创建 / 编辑 / 复制 / 删除
   │  └─ 账户详情：登录状态与最后检查时间、余额/用量/模型、刷新与签到、
   │     应用内登录 / LinuxDo 登录 / 重新登录、清除会话、打开已知页面
   ├─ 内嵌页面视图：应用内打开的目标站点页面在内容区内嵌显示（详见第 14 节）
   ├─ 日志：刷新 / 会话校验 / 签到结果与失败摘要
   ├─ OAuth：按认证方式（GitHub / LinuxDo / 站点账号密码）分类的登录管理（详见第 16 节）
   └─ 系统设置：手动锁定、桥接版本、可选“记住此设备”的系统钥匙串设置
```

删除账户、清除账户会话、批量签到都必须展示影响范围并获得用户确认。

## 11. 非目标与约束

一期严禁范围漂移到以下功能：

- 渠道、用户、管理员或站点运营管理；
- Token/API Key 的创建、修改、撤销或批量管理；
- Cookie/API Key 手动导入；
- 自动化 GitHub OAuth；
- 验证码、Cloudflare、Passkey/WebAuthn 的绕过、自动处理、保存、同步或导出；
- 定时签到、后台常驻任务与通知；
- WebDAV、云同步、跨设备凭据迁移；
- Sub2API/CPA 的未验证具体接口实现。

## 12. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 同 URL 账号串号 | partition 只由 `accountId` 派生；每次请求显式绑定账户上下文。 |
| NewAPI 实例差异 | 能力驱动、保守探测、手动选择平台、失败不伪造。 |
| 内嵌第三方页面扩大本地权限 | Sandbox、隔离上下文、最小 Preload、严格导航和权限策略。 |
| OAuth 回跳形态不一致 | 以目标站点会话校验作为唯一成功标准。 |
| Cookie/Token 出现在日志 | 结构化脱敏，禁止记录完整 Header、响应体、Query 与 Cookie。 |
| 用户遗失主密码 | 明确不可恢复；仅支持清空加密资料重新初始化。 |
| 站点安全挑战阻断自动流程 | 不绕过，提供当前隔离会话内的手动操作路径。 |
| 过早支持其他平台 | 一期只做适配器契约，不为 Sub2API/CPA 预写请求逻辑。 |

## 13. 验证策略

1. **单元测试：** URL 规范化、数据库约束、加密解锁、错误主密码、适配器能力降级、签到分类、日志脱敏。
2. **集成测试：** 同 URL 双账户创建、复制不复制敏感资料、删除 A 不影响 B、清除 A 会话不影响 B。
3. **端到端测试：** 双账号使用不同 partition 登录，重启后会话仍隔离；其中一个会话失效只影响自身。
4. **负向测试：** OAuth 取消、未知重定向、站点接口异常、过期会话、未解锁访问敏感功能、批量签到单项失败。
5. **发布前检查：** Windows/macOS 打包后数据仅存在用户私有应用目录；除用户主动访问目标站点外无 ApiNest 自有远端请求；无自动签到、无同步、无 Token 写操作、无凭据导入和无安全绕过代码。
6. **外壳与内嵌：** 无边框窗口控制仅经受限 IPC 触发；内嵌页面视图沿用受控容器安全策略、绑定账户 partition、切换导航时正确挂载/卸载且释放资源。
7. **认证方式管理：** 账号密码引用仅在用户主动登录时用于目标站点原生表单，密文不出现在日志/快照/UI；GitHub/LinuxDo 保持手动登录且会话按账户隔离持久化。

## 14. 应用外壳与无边框窗口（R12）

### 14.1 无边框窗口与安全默认值

主窗口改为无系统标题栏，但不放松任何既有安全默认值。窗口构造在既有安全基线上追加无边框相关字段：

```ts
const MAIN_WINDOW_OPTIONS: Electron.BrowserWindowConstructorOptions = {
  width: 1280,
  height: 800,
  minWidth: 1024,
  minHeight: 720,
  show: false,
  frame: false,                 // 隐藏系统边框
  titleBarStyle: 'hidden',      // macOS 隐藏标题栏但保留交通灯
  trafficLightPosition: { x: 16, y: 18 }, // macOS 交通灯定位到自绘栏内
  webPreferences: getMainWindowWebPreferences(), // 仍是 contextIsolation/sandbox/nodeIntegration:false/webSecurity
};
```

- Windows/Linux：`frame: false` 完全交由自绘栏渲染最小化、最大化/还原、关闭控件；
- macOS：`titleBarStyle: 'hidden'` 保留系统交通灯并用 `trafficLightPosition` 对齐自绘栏，避免重复绘制关闭控件；
- `SECURE_WEB_PREFERENCES` 保持不变，无边框改造不触碰 `contextIsolation`、`sandbox`、`nodeIntegration`、`webSecurity`。

### 14.2 拖拽与窗口控制 IPC

自绘标题栏的拖拽区通过 CSS `-webkit-app-region: drag` 实现，交互控件区域标注 `no-drag`，无需 IPC：

```css
.app-titlebar { -webkit-app-region: drag; }
.app-titlebar button, .app-nav { -webkit-app-region: no-drag; }
```

窗口控制动作经受限、类型化 IPC 触发，主进程只暴露固定枚举的窗口指令，Renderer 不得获得通用窗口/系统控制能力：

```ts
// shared/ipc/bridge.ts 增补
interface ApiNestBridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
  };
}
```

主进程 handler 对当前聚焦/发起窗口执行动作，动作集合固定为最小化、最大化/还原、关闭、查询最大化状态；不接受任意窗口句柄、坐标或尺寸参数，杜绝被内嵌第三方页面滥用为窗口操纵能力。窗口 `maximize`/`unmaximize` 事件回推 Renderer 以同步按钮图标。

### 14.3 外壳布局与信息架构

解锁后进入 `AppShell`：顶部自绘标题栏（品牌 + 拖拽区 + 窗口控件），下方为左侧导航 + 右侧内容区。导航项由前端配置驱动，未实现项渲染占位页，不伪造数据。内容区是 R11 内嵌页面视图的宿主容器，负责为 `WebContentsView` 提供稳定的布局边界（bounds）。

## 15. 应用内嵌页面视图（R11）

### 15.1 从独立窗口到内嵌视图

一期原设计用独立 `BrowserWindow` 承载目标站点页面。为满足“右侧内容区内嵌浏览”的信息架构，引入基于 Electron `WebContentsView` 的内嵌视图：将站点 `WebContents` 作为子视图挂载到主窗口，覆盖在 Renderer 内容区的预留区域上，由主进程按内容区上报的 bounds 定位。

安全策略与既有受控容器完全一致，`navigation-policy` 纯函数保持复用，仅“承载方式”从独立窗口变为内嵌视图：

```ts
interface EmbeddedPageView {
  mount(request: OpenContainerRequest & { bounds: ViewBounds }): void;
  setBounds(bounds: ViewBounds): void;
  hide(): void;      // 切换导航项时隐藏但可保留
  unmount(): void;   // 释放视图资源，不清除账户 partition 持久化
}

interface ViewBounds { x: number; y: number; width: number; height: number; }
```

要点：

1. `WebContentsView` 使用账户专属 `partition`，与独立容器同源同策略，不注入本应用 Preload；
2. `will-navigate`、`setWindowOpenHandler`、权限、下载、外部协议判定全部复用 `navigation-policy`，默认拒绝；
3. Renderer 通过 `ResizeObserver` 上报内容区 bounds，主进程据此调用 `setBounds`，使内嵌视图精确贴合内容区，不遮挡自绘标题栏与左侧导航；
4. 切换到其他导航项时 `hide()`，返回时可复用；关闭页面或长期离开时 `unmount()` 释放视图资源，但**不**清除该账户 partition 的持久化会话；
5. 站点原生弹窗式 OAuth（`window.open` 授权页）等确需独立窗口的场景，回退到既有受控独立容器，仍受同一套导航/权限策略约束（对应 R11-6）。

### 15.2 视图定位与 IPC

内嵌视图的挂载/隐藏/卸载由 `pages.openInApp` 触发，新增内容区 bounds 上报通道：

```ts
interface ApiNestBridge {
  pages: {
    openInApp(accountId: string, page: KnownPage): Promise<void>;
    openExternal(accountId: string, page: KnownPage): Promise<void>;
    closeEmbedded(): Promise<void>;               // 关闭当前内嵌视图
    reportContentBounds(bounds: ViewBounds): Promise<void>; // 上报内容区几何
  };
}
```

主进程持有“当前内嵌视图”单例引用，切换账户或页面时先 `unmount` 旧视图再 `mount` 新视图，避免多个视图叠加或串号；bounds 上报做节流，减少无谓重排。

## 16. 认证方式的类型化管理（R13）

### 16.1 认证方式模型

按认证方式对账户登录入口分类，一期涵盖三类，能力仍由适配器声明：

```ts
type AuthMethodKind = 'github_oauth' | 'linuxdo_oauth' | 'site_password';

interface AuthMethodDescriptor {
  kind: AuthMethodKind;
  available: boolean;          // 前置条件是否满足（配置/站点支持）
  mode: 'manual_login' | 'credential_reference';
  unavailableReason?: string;  // 脱敏，不含敏感细节
}
```

- `github_oauth` / `linuxdo_oauth`：`mode = 'manual_login'`，一期仅提供应用内手动登录，用户在官方页面亲自认证，应用只在账户专属隔离会话中持久化维持登录所需的会话信息以实现重启复用；不采集、不代填、不绕过安全挑战；
- `site_password`：`mode = 'credential_reference'`，用户可将站点账号密码保存为绑定账户的加密凭据引用。

### 16.2 账号密码作为加密凭据引用（类 Secret 引用）

站点账号密码借鉴 Kubernetes Secret 引用思路：UI 与业务层只持有“引用句柄”，明文只在用户当次主动登录时、于主进程内解密并用于目标站点原生登录表单填充。

```ts
// secrets 表 purpose 扩展：'site_login_credential'
interface SiteCredentialReference {
  accountId: string;
  purpose: 'site_login_credential';
  secretId: string;   // 指向 secrets 表密文，UI 侧仅见此引用
  // 明文 { username, password } 绝不进入 Renderer / 日志 / 快照 / 操作 details
}
```

存取规则：

1. 复用既有 Vault 信封加密（Argon2id → DEK → AEAD 逐条加密），账号密码与其他敏感凭据同级保护；
2. 明文仅在主进程内存中短暂存在，仅用于向目标站点自身登录表单注入，注入后立即丢弃引用；
3. 严禁将账号密码写入普通 SQLite 字段、日志、快照、操作 `details_json` 或 UI；
4. 仅用于目标站点原生登录表单，**不得**用于绕过验证码、Cloudflare、Passkey 或任何安全挑战；遇挑战交由用户亲自处理（对应 R13-5）；
5. 与一期非目标“Cookie/API Key 手动导入”本质区别：它不导入会话/密钥、不跳过站点登录流程、只是用户主动登录的表单辅助。

### 16.3 会话复用与失效隔离

- 三类认证方式的会话与凭据均绑定 `accountId`，持久化于账户专属 partition 或加密 secrets；
- 任一方式的会话/凭据失效只标记所属账户，不波及同站点其他账户或其他认证方式（对应 R13-7）；
- 复制账户不复制任何认证会话与账号密码引用，新账户处于未认证状态（延续 R1-5）。

### 16.4 IPC 契约增补

```ts
interface ApiNestBridge {
  auth: {
    listAuthMethods(accountId: string): Promise<AuthMethodDescriptor[]>;
    // 站点账号密码引用：仅保存/清除引用，绝不回传明文
    saveSiteCredential(accountId: string, input: { username: string; password: string }): Promise<void>;
    clearSiteCredential(accountId: string): Promise<void>;
    hasSiteCredential(accountId: string): Promise<boolean>;
    // 使用引用发起站点账密登录（用户主动触发，明文只在主进程用于表单填充）
    openLoginWithCredential(accountId: string): Promise<LoginResult>;
  };
}
```

`saveSiteCredential` 只接收一次性输入并立即加密落盘，不提供任何读取明文的通道；`hasSiteCredential` 仅返回布尔存在性，UI 据此渲染“已保存/未保存”，绝不展示凭据内容。
