import type { AuthIdentity, AuthKind, AuthLoginTarget } from '../../../shared/ipc/bridge';

/** 各认证身份类型的展示标签。 */
export const KIND_LABELS: Record<AuthKind, string> = {
  github: 'GitHub',
  linuxdo: 'LinuxDo',
  password: '账号密码',
};

/** 新增/详情表单里对各类型的说明文案。 */
export const KIND_HINTS: Record<AuthKind, string> = {
  github: '在 auth 专属会话中打开 GitHub 官方页面登录一次；应用不采集账号密码，不绕过验证码或授权确认。',
  linuxdo: '在 auth 专属会话中打开 LinuxDo 官方页面登录一次；应用不采集账号密码，不绕过验证码或授权确认。',
  password: '保存账号密码为加密凭据，可被多个账户引用，仅在你主动发起登录时用于目标站点原生登录表单。',
};

/** 卡片第二行「站点 URL」点击后打开登录窗体时使用的默认目标显示串。 */
const KIND_PRIMARY_HOST: Partial<Record<AuthKind, string>> = {
  github: 'github.com',
  linuxdo: 'connect.linux.do',
};

/** 卡片三点菜单中的一个「打开登录」动作项。 */
export interface OAuthCardLoginAction {
  key: string;
  label: string;
  target: AuthLoginTarget;
}

export interface OAuthCardView {
  /** 第一行标题：类型 · 名称。 */
  title: string;
  kindLabel: string;
  /** 第二行主文本：可点 URL（host）或说明文字。 */
  secondaryText: string;
  /** 第二行是否为可点击的登录 URL（false 表示纯说明，如 password）。 */
  secondaryClickable: boolean;
  /** 点击第二行 URL 打开登录窗体时的目标（仅 clickable 时有意义）。 */
  primaryLoginTarget: AuthLoginTarget;
  /** 三点菜单中的额外「打开登录」项（如 LinuxDo 主站/Credit）；不含默认第二行那次。 */
  loginActions: OAuthCardLoginAction[];
  /** 是否显示全局 Proxy 开关（password 类型不显示）。 */
  showProxyToggle: boolean;
  /** password 类型是否已保存凭据；非 password 时为 null。 */
  credentialSaved: boolean | null;
  /** 创建时间的本地化展示串。 */
  createdAtText: string;
}

/** 把 ISO 创建时间转成本地日期时间；无效值回退原串。 */
export function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

/**
 * 由 AuthIdentity 派生卡片展示模型（纯函数，便于单测）。
 *
 * - github / linuxdo：第二行是可点登录 URL（主 host）；linuxdo 额外在菜单提供主站/Credit。
 * - password：第二行是说明文字（不可点），显示已保存/未保存，无 Proxy 开关。
 */
export function buildOAuthCardView(identity: AuthIdentity): OAuthCardView {
  const kindLabel = KIND_LABELS[identity.kind];
  const base: Omit<OAuthCardView, 'secondaryText' | 'secondaryClickable' | 'primaryLoginTarget' | 'loginActions' | 'showProxyToggle' | 'credentialSaved'> = {
    title: `${kindLabel} · ${identity.label}`,
    kindLabel,
    createdAtText: formatCreatedAt(identity.createdAt),
  };

  if (identity.kind === 'password') {
    return {
      ...base,
      secondaryText: '账密凭据 · 供账户引用',
      secondaryClickable: false,
      primaryLoginTarget: 'default',
      loginActions: [],
      showProxyToggle: false,
      credentialSaved: identity.hasCredential,
    };
  }

  const loginActions: OAuthCardLoginAction[] =
    identity.kind === 'linuxdo'
      ? [
          { key: 'linuxdoMain', label: '打开主站 linux.do', target: 'linuxdoMain' },
          { key: 'linuxdoCredit', label: '打开 Credit 站', target: 'linuxdoCredit' },
        ]
      : [];

  return {
    ...base,
    secondaryText: KIND_PRIMARY_HOST[identity.kind] ?? '',
    secondaryClickable: true,
    primaryLoginTarget: 'default',
    loginActions,
    showProxyToggle: true,
    credentialSaved: null,
  };
}
