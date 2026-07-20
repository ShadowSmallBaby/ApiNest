import { z } from 'zod';

export const accountIdSchema = z.uuid();

export const platformTypeSchema = z.enum(['newapi', 'sub2api', 'cliproxyapi']);
export const siteRouteProfileSchema = z.enum(['modern', 'classic', 'legacy-panel']);

export const siteIdSchema = z.uuid();

const optionalTextSchema = (max: number) => z.string().trim().max(max).optional();

export const createSiteAccountInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  note: optionalTextSchema(1000),
  authId: z.uuid().nullable().optional(),
});

export const createSiteInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: platformTypeSchema,
  baseUrl: z.url().max(2048),
  note: optionalTextSchema(1000),
  linuxDoClientId: optionalTextSchema(256),
  routeProfile: siteRouteProfileSchema.default('modern'),
  // 该站点账户联网是否走全局 Proxy 模板；省略即默认直连，由 service 层兜底为 false。
  useProxy: z.boolean().optional(),
  firstAccount: createSiteAccountInputSchema,
});

export const updateSiteInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    platform: platformTypeSchema.optional(),
    baseUrl: z.url().max(2048).optional(),
    note: optionalTextSchema(1000),
    linuxDoClientId: optionalTextSchema(256),
    routeProfile: siteRouteProfileSchema.optional(),
    useProxy: z.boolean().optional(),
  })
  .refine(value => Object.keys(value).length > 0, 'At least one field must be provided.');

export const sitesListInputSchema = z.object({});

export const updateSiteRequestSchema = z.object({
  siteId: siteIdSchema,
  input: updateSiteInputSchema,
});

export const siteIdInputSchema = z.object({
  siteId: siteIdSchema,
});

export const addSiteAccountInputSchema = z.object({
  siteId: siteIdSchema,
  account: createSiteAccountInputSchema,
});

export const knownPageSchema = z.enum(['home', 'userCenter', 'usage', 'token', 'login']);

export const loginModeSchema = z.enum(['manual', 'linuxdo']);

export const createAccountInputSchema = z.object({
  siteId: siteIdSchema,
  displayName: z.string().trim().min(1).max(120),
  note: optionalTextSchema(1000),
  authId: z.uuid().nullable().optional(),
});

export const updateAccountInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    note: optionalTextSchema(1000),
  })
  .refine(value => Object.keys(value).length > 0, 'At least one field must be provided.');

export const removeAccountInputSchema = z.object({
  accountId: accountIdSchema,
});

export const refreshAccountInputSchema = z.object({
  accountId: accountIdSchema,
});

export const copyAccountInputSchema = z.object({
  accountId: accountIdSchema,
});

export const detectPlatformInputSchema = z.object({
  baseUrl: z.url().max(2048),
  // 新建 Site 时用表单当前 useProxy 探测；缺省 direct（默认出口不变）。
  useProxy: z.boolean().optional(),
});

export const getCapabilitiesInputSchema = z.object({
  accountId: accountIdSchema,
});

export const getSnapshotsInputSchema = z.object({
  accountId: accountIdSchema,
});

export const dashboardOverviewInputSchema = z.object({});

export const authStatusInputSchema = z.object({});

export const unlockInputSchema = z.object({
  masterPassword: z.string().min(8).max(1024),
});

export const lockInputSchema = z.object({});

export const openLoginInputSchema = z.object({
  accountId: accountIdSchema,
  mode: loginModeSchema,
});

export const clearSessionInputSchema = z.object({
  accountId: accountIdSchema,
});

export const runOneCheckInInputSchema = z.object({
  accountId: accountIdSchema,
});

export const runAllCheckInInputSchema = z.object({});

export const openKnownPageInputSchema = z.object({
  accountId: accountIdSchema,
  page: knownPageSchema,
});

export const windowCommandInputSchema = z.object({});

// 内容区几何：非负、有上限的整数像素，防止异常值触发无意义重排或滥用。
const boundsDimensionSchema = z.number().finite().min(0).max(100000);

export const contentBoundsInputSchema = z.object({
  x: boundsDimensionSchema,
  y: boundsDimensionSchema,
  width: boundsDimensionSchema,
  height: boundsDimensionSchema,
});

export const closeEmbeddedInputSchema = z.object({});

// ---- auth 身份实体（R13 演进）----

export const authIdentitiesListInputSchema = z.object({});

export const authIdSchema = z.uuid();

export const authKindSchema = z.enum(['github', 'linuxdo', 'password']);

export const authIdentityIdInputSchema = z.object({
  authId: authIdSchema,
});

export const createAuthIdentityInputSchema = z.object({
  kind: authKindSchema,
  label: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).optional(),
  // github/linuxdo 登录窗口是否走全局 Proxy 模板；password 类型忽略此项。
  useProxy: z.boolean().optional(),
});

export const updateAuthIdentityInputSchema = z
  .object({
    authId: authIdSchema,
    label: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().max(1000).optional(),
    useProxy: z.boolean().optional(),
  })
  .refine(
    value =>
      value.label !== undefined || value.note !== undefined || value.useProxy !== undefined,
    'At least one field must be provided.',
  );

// auth 身份账号密码引用：一次性输入，立即加密落盘；长度上限防滥用，绝不回传明文。
export const saveAuthCredentialInputSchema = z.object({
  authId: authIdSchema,
  username: z.string().min(1).max(512),
  password: z.string().min(1).max(1024),
});

// 账户关联/解除 auth 身份引用；authId 为 null 表示解除关联。
export const linkAccountAuthInputSchema = z.object({
  accountId: accountIdSchema,
  authId: authIdSchema.nullable(),
});

// ---- 密钥管理（阶段 1）----

// 拉取某账户的密钥列表（用账户 partition 的 Cookie 会话查询 NewAPI /api/token/）。
export const listKeysByAccountInputSchema = z.object({
  accountId: accountIdSchema,
});

// 揭示单个密钥完整明文；tokenId 为平台侧数字 id，非负整数。
export const revealKeyInputSchema = z.object({
  accountId: accountIdSchema,
  tokenId: z.number().int().min(0),
});

// 拉取某账户的模型列表（/api/pricing 定价 ∩ /api/user/models 可用性）。
export const listModelsInputSchema = z.object({
  accountId: accountIdSchema,
});

// ---- 日志管理（阶段 3）----

const optionalLogFilterTextSchema = z.preprocess(
  value => typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  z.string().trim().max(256).optional(),
);

/** 单账户分页查询 NewAPI 日志；strict 禁止 Renderer 注入 URL、header 或 partition。 */
export const listLogsByAccountInputSchema = z.object({
  accountId: accountIdSchema,
  page: z.number().int().min(1).max(10_000),
  pageSize: z.number().int().min(1).max(100),
  type: z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3),
    z.literal(4), z.literal(5), z.literal(6),
  ]).optional(),
  tokenName: optionalLogFilterTextSchema,
  modelName: optionalLogFilterTextSchema,
  startTimestamp: z.number().int().nonnegative().optional(),
  endTimestamp: z.number().int().nonnegative().optional(),
}).strict().refine(
  input => input.startTimestamp === undefined ||
    input.endTimestamp === undefined ||
    input.startTimestamp <= input.endTimestamp,
  { message: 'startTimestamp must not be greater than endTimestamp.' },
);

// ---- 文本 API 测试（阶段 4）----

const customHeadersSchema = z.record(
  z.string().trim().min(1).max(128),
  z.string().max(8192),
).refine(headers => Object.keys(headers).length <= 32, { message: 'Too many custom headers.' });

export const runTextApiTestInputSchema = z.object({
  accountId: accountIdSchema,
  tokenId: z.number().int().nonnegative(),
  modelId: z.string().trim().min(1).max(256),
  category: z.literal('text'),
  endpoint: z.enum([
    'openai_chat_completions',
    'openai_responses',
    'anthropic_messages',
    'interactions',
    'google_generate_content',
  ]),
  message: z.string().max(100_000).optional(),
  customBodyJson: z.string().max(1_000_000).optional(),
  customHeaders: customHeadersSchema.optional(),
}).strict().refine(
  input => Boolean(input.message?.trim()) || Boolean(input.customBodyJson?.trim()),
  { message: 'A test message or custom request body is required.' },
);

// ---- 网络设置（阶段 6）----

/**
 * 严格 Secure DNS 输入。secure 必须携带至少一个 DoH 模板（https 由领域层再校验）；
 * off / automatic 不接受任何多余字段。逐成员 .strict() 拒绝额外注入。
 */
const secureDnsInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('off') }).strict(),
  z.object({ mode: z.literal('automatic') }).strict(),
  z
    .object({
      mode: z.literal('secure'),
      servers: z.array(z.string().trim().min(1).max(2048)).min(1).max(8),
    })
    .strict(),
]);

/**
 * 严格 Proxy 模板输入。仅结构化 http/https/socks5 + host + port；
 * 逐成员 .strict() 拒绝 PAC、认证、bypass、fallback 或任意 raw proxyRules 字段。
 */
const proxyTemplateInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('direct') }).strict(),
  z.object({ mode: z.literal('system') }).strict(),
  z
    .object({
      mode: z.literal('fixed'),
      scheme: z.enum(['http', 'https', 'socks5']),
      host: z.string().trim().min(1).max(255),
      port: z.number().int().min(1).max(65535),
    })
    .strict(),
]);

export const getNetworkSettingsInputSchema = z.object({}).strict();

export const updateNetworkSettingsInputSchema = z
  .object({
    secureDns: secureDnsInputSchema,
    proxy: proxyTemplateInputSchema,
  })
  .strict();

export type UpdateNetworkSettingsInput = z.infer<typeof updateNetworkSettingsInputSchema>;

export type ContentBoundsInput = z.infer<typeof contentBoundsInputSchema>;
export type CreateSiteInput = z.infer<typeof createSiteInputSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;
export type CreateSiteAccountInput = z.infer<typeof createSiteAccountInputSchema>;
export type AddSiteAccountInput = z.infer<typeof addSiteAccountInputSchema>;
export type CreateAuthIdentityInput = z.infer<typeof createAuthIdentityInputSchema>;
export type UpdateAuthIdentityInput = z.infer<typeof updateAuthIdentityInputSchema>;
export type SaveAuthCredentialInput = z.infer<typeof saveAuthCredentialInputSchema>;
export type LinkAccountAuthInput = z.infer<typeof linkAccountAuthInputSchema>;

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;
export type UnlockInput = z.infer<typeof unlockInputSchema>;
export type OpenLoginInput = z.infer<typeof openLoginInputSchema>;
export type OpenKnownPageInput = z.infer<typeof openKnownPageInputSchema>;
