# Auth 身份实体化重构方案（R13 演进）

- **规格名称：** `apinest-mvp`
- **状态：** 待主人确认
- **关联需求：** R4、R5、R9、R13
- **触发来源：** 主人要求把「认证」从绑定在账户上的凭据，提升为独立可复用的 auth 身份实体

## 1. 背景与决策

### 1.1 需求原话

> OAuth 页面相当于对 auth 账号的管理：新增 auth → 选择类型 → github → 打开对应页面 → 用户操作登录 → 系统保存数据 → 如果有站点需要自动登录则关联对应的 auth 进行登录；如果是密码类型，直接进行账号密码填写即可，由站点引用。

### 1.2 四次关键决策（已与主人对齐）

1. **仅共享 IdP 会话**：站点会话仍严格按账户隔离（不破坏「同 URL 两账户不串号」红线）。
2. **完整新模型 + 迁移**：不做兼容层，直接引入 auth 实体并迁移现有 7C 账密数据。
3. **独立 auth 窗口登录一次**：用户亲自在 IdP 官方页授权；登录态持久在 auth 专属 partition。
   - **红线修订（2026-07-20，主人已授权）**：允许在主进程内、仅针对已绑定的 github/linuxdo auth 身份、仅 IdP 白名单域名，将 Cookie 从 auth partition 复制到对应账户 partition，用于站点原生 OAuth 复用已登录会话。禁止复制站点自身 Cookie、禁止跨账户、禁止把 Cookie 值回传 Renderer / 日志 / 快照。
4. **auth = 分类 + 密码引用**（最终收敛）：
   - `github` / `linuxdo` 类型：作为**分类标签**，登录仍在账户自己的 partition 内完成，站点会话隔离不破坏。
   - `password` 类型：账号密码加密存为 auth 实体，**可被多个账户引用**，用于目标站点原生表单填充。

### 1.3 物理约束说明与红线演进

要同时做到「github/linuxdo 免重登」+「站点会话隔离」，物理上唯一的路是把 IdP Cookie 从 auth partition 搬到账户 partition。原方案因红线（不复制任何 IdP Cookie）将其降级为「分类与状态管理」。

**2026-07-20 主人授权改写此红线**：允许受限的 IdP Cookie 注入（见 1.2 决策 3 修订）。因此 github/linuxdo 的复用从「仅分类标签」升级为「IdP 会话可注入账户登录流」——站点原生 OAuth 发起时，账户 partition 已持有对应 IdP 的登录态，可少确认或直接回跳。站点会话本身仍严格按账户隔离，被复制的只有 IdP 白名单域下的 Cookie，绝不含站点自身 Cookie。password 类型仍走表单填充，不涉及会话搬运。

**2026-07-22 主人授权（LinuxDo 无头自动登录）**：在已同步 IdP Cookie 且账户配置了 `linuxDoClientId` 时，主进程可用账户 partition 的 `session.fetch` 自动完成 NewAPI OAuth 协议——`GET /api/oauth/state` → `connect.linux.do/oauth2/authorize` → 抽取并 GET 同意链 `/oauth2/approve/…` → 站点回调 `/api/oauth/linuxdo?code&state`。`code`/`state` 仅编排栈瞬态，不落库、不写日志、不回传 Renderer。失败（未登录 IdP、验证码、无同意按钮、state 失败等）降级既有受控窗口；回调 Location 非本站点 host 时**拒绝跟随且不开窗伪装成功**。成功后尽力引导站内 `siteUserId`；不得伪造 `active`。

## 2. 数据模型

### 2.1 新增 `auth_identities` 表（迁移 004）

```sql
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,              -- UUID，不可变
  kind TEXT NOT NULL,               -- 'github' | 'linuxdo' | 'password'
  label TEXT NOT NULL,              -- 用户可读名称（如 "我的 GitHub"）
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- 敏感凭据**不**入此表；password 类型的账号密码仍走 `secrets` 表加密存储，`secret_id` 由 auth id 派生。
- `github`/`linuxdo` 类型不存任何凭据，仅为分类标签 + 元数据。

### 2.2 `accounts` 表加列（迁移 004 同批）

```sql
ALTER TABLE accounts ADD COLUMN auth_ref_id TEXT
  REFERENCES auth_identities(id) ON DELETE SET NULL;
```

- 账户引用一个 auth 身份（可空，未关联时为 null）。
- `ON DELETE SET NULL`：删除 auth 身份不级联删账户，只解除引用。

### 2.3 secrets purpose 演进

- 旧：`site_login_credential:<accountId>`（绑账户）
- 新：`auth_identity_credential:<authId>`（绑 auth 身份，可被多账户引用）
- 迁移：将现有 `site_login_credential:*` 数据为每个账户各建一个 password 类型 auth 身份并搬运密文，保持零丢失。

## 3. 领域服务

### 3.1 `AuthIdentityService`（新增）

CRUD auth 身份：`create/list/get/update/delete`。password 类型 create 时同步调 vault 存密文；delete 时清对应 secret。

### 3.2 `SiteCredentialService`（改造）

- secretId 派生从 `accountId` 改为 `authId`。
- `reveal(authId)` 供主进程内表单填充（保持不外泄明文红线）。

### 3.3 `LoginFlowService`（改造）

- `github`/`linuxdo`：打开站点登录页前，先把绑定 auth 身份的 IdP Cookie（仅白名单域）从 auth partition 注入账户 partition，让站点原生 OAuth 复用已登录会话；manual 登录默认放行 `github.com` + `connect.linux.do` 导航。同步失败降级为用户手动完成 OAuth，不阻断开窗。
- `password`：打开站点登录页 + 主进程内用引用的 auth 凭据填充表单（不绕过验证码，遇挑战交用户）。

## 4. IPC 契约扩展

```ts
interface ApiNestBridge {
  authIdentities: {
    list(): Promise<AuthIdentity[]>;
    create(input: CreateAuthIdentityInput): Promise<AuthIdentity>;
    update(id: string, input: UpdateAuthIdentityInput): Promise<AuthIdentity>;
    remove(id: string): Promise<void>;
    // password 类型：保存/清除凭据（明文一次性传入，绝不回传）
    saveCredential(id: string, input: { username: string; password: string }): Promise<void>;
    hasCredential(id: string): Promise<boolean>;
    // github/linuxdo 类型：打开独立 auth 窗口登录一次
    openLogin(id: string): Promise<LoginResult>;
  };
  accounts: {
    // 既有方法 + 关联/解除 auth 引用
    linkAuth(accountId: string, authId: string | null): Promise<AccountRecord>;
  };
}
```

`AuthIdentity` 类型（不含任何凭据明文）：

```ts
type AuthKind = 'github' | 'linuxdo' | 'password';
interface AuthIdentity {
  id: string;
  kind: AuthKind;
  label: string;
  note?: string;
  hasCredential: boolean;  // password 类型是否已存凭据；仅布尔
}
```

## 5. UI 重做（OAuthPage → AuthIdentityPage）

- **列表 + 新增**：展示所有 auth 身份，新增时选类型 → 填 label。
- **github/linuxdo**：「登录」按钮 → 打开独立 auth 窗口，用户登录一次，系统记录状态。
- **password**：账号密码表单（保存/更新/清除），只显示「已保存/未保存」。
- **账户关联**：账户详情页新增「关联认证身份」下拉，选一个 auth 身份或解除。

## 6. 安全红线（全程保持）

1. 站点会话严格按 accountId 隔离，partition 名只由 accountId 派生（不变）。
2. IdP Cookie 同步（2026-07-20 主人授权修订）：仅允许主进程内、仅针对已绑定的 github/linuxdo auth 身份、仅 IdP 白名单域名，将 Cookie 从 auth partition 复制到对应账户 partition；禁止复制站点自身 Cookie、禁止跨账户复制、禁止把 Cookie 值回传 Renderer / 日志 / 快照。
3. password 明文只在主进程内存短暂存在用于表单填充，绝不回传 Renderer / 日志 / 快照 / UI。
4. 不绕过验证码、Cloudflare、Passkey；遇安全挑战交用户亲自处理。
5. auth 凭据走 vault 信封加密，与其他敏感资料同级保护。

## 7. 任务分解

| 编号 | 内容 |
| --- | --- |
| A1 | 迁移 004：`auth_identities` 表 + `accounts.auth_ref_id` 列 + 现有账密数据迁移 |
| A2 | `AuthIdentityRepository` + `AuthIdentityService` + 测试 |
| A3 | `SiteCredentialService` 改造为按 authId + 测试 |
| A4 | IPC 契约扩展（channels/schemas/bridge/preload/handlers）+ 测试 |
| A5 | `LoginFlowService` 支持 password 类型表单填充 + 测试 |
| A6 | UI：AuthIdentityPage 重做 + 账户关联下拉 |
| A7 | typecheck + 全量测试回归 |

## 8. 验证

- 迁移可重复运行、幂等；现有账密数据零丢失搬运到 auth 身份。
- 同 URL 两账户即使引用同一 password auth，站点会话仍隔离。
- 明文凭据不出现在任何返回值 / 日志 / 快照。
- typecheck 全绿；新增服务纯逻辑测试全绿。
