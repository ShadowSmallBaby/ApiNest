import { useEffect, useState } from 'react';
import type { AccountRecord, NetworkSettingsView } from '../../../shared/ipc/bridge';
import type { UpdateNetworkSettingsInput } from '../../../shared/ipc/schemas';
import { getSafeErrorMessage } from '../lib/error-message';
import { ConfirmSlideOver } from '../components/SlideOver';

interface SettingsPageProps {
  version: string;
  isBusy: boolean;
  onLock: () => void;
}

type ProxyMode = 'direct' | 'system' | 'fixed';
type FixedProxyScheme = 'http' | 'https' | 'socks5';

/** 网络设置的扁平表单态（贴合输入控件）；提交/回填时与嵌套 View 双向转换。 */
interface NetworkFormState {
  secureDnsEnabled: boolean;
  /** 始终保留用户填写的 DoH 文本，开关关闭也不清空。 */
  secureDnsServers: string;
  proxyMode: ProxyMode;
  fixedProxyScheme: FixedProxyScheme;
  fixedProxyHost: string;
  fixedProxyPort: string;
}

const EMPTY_NETWORK_FORM: NetworkFormState = {
  secureDnsEnabled: true,
  secureDnsServers: '',
  proxyMode: 'direct',
  fixedProxyScheme: 'http',
  fixedProxyHost: '',
  fixedProxyPort: '',
};

function viewToForm(view: NetworkSettingsView): NetworkFormState {
  return {
    secureDnsEnabled: view.secureDns.mode !== 'off',
    // 始终回填 servers（关闭时也保留）。
    secureDnsServers: (view.secureDns.servers ?? []).join('\n'),
    proxyMode: view.proxy.mode,
    fixedProxyScheme: view.proxy.mode === 'fixed' ? view.proxy.scheme : 'http',
    fixedProxyHost: view.proxy.mode === 'fixed' ? view.proxy.host : '',
    fixedProxyPort: view.proxy.mode === 'fixed' ? String(view.proxy.port) : '',
  };
}

/**
 * 安全 DNS 表单态 → 更新输入。
 * - 开关关：mode=off，但 servers 仍提交（持久化保留）
 * - 开关开 + 有 DoH：mode=secure
 * - 开关开 + 空 DoH：mode=automatic
 */
function toSecureDnsInput(form: NetworkFormState): UpdateNetworkSettingsInput['secureDns'] {
  const servers = form.secureDnsServers
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (!form.secureDnsEnabled) {
    return { mode: 'off' as const, servers };
  }
  return servers.length > 0
    ? { mode: 'secure' as const, servers }
    : { mode: 'automatic' as const, servers: [] };
}

function formToInput(form: NetworkFormState): UpdateNetworkSettingsInput {
  const secureDns = toSecureDnsInput(form);
  const proxy =
    form.proxyMode === 'fixed'
      ? {
          mode: 'fixed' as const,
          scheme: form.fixedProxyScheme,
          host: form.fixedProxyHost.trim(),
          port: Number(form.fixedProxyPort.trim()),
        }
      : { mode: form.proxyMode };
  return { secureDns, proxy };
}

/**
 * 系统设置页。提供：桥接版本展示、手动锁定、按账户会话清理，
 * 以及全局 Secure DNS 与 Proxy 网络设置。
 * Secure DNS 保存后热应用（configureHostResolver）；关闭开关不清除已填 DoH。
 */
export function SettingsPage({ version, isBusy, onLock }: SettingsPageProps): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const [networkForm, setNetworkForm] = useState<NetworkFormState>(EMPTY_NETWORK_FORM);
  const [networkPending, setNetworkPending] = useState(false);
  const [networkMessage, setNetworkMessage] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const loadAccounts = async (): Promise<void> => {
    const list = await window.apinest.accounts.list();
    setAccounts(list);
    setSelectedId(current => (current && list.some(a => a.id === current) ? current : list[0]?.id ?? ''));
  };

  useEffect(() => {
    loadAccounts().catch(error => setErrorMessage(getSafeErrorMessage(error)));
    window.apinest.network
      .getSettings()
      .then(view => setNetworkForm(viewToForm(view)))
      .catch(error => setNetworkError(getSafeErrorMessage(error)));
  }, []);

  const selectedAccount = accounts.find(account => account.id === selectedId) ?? null;

  const handleClearSession = (): void => {
    if (!selectedAccount) {
      return;
    }
    setConfirmClear(true);
  };

  const performClearSession = async (): Promise<void> => {
    setConfirmClear(false);
    if (!selectedAccount) {
      return;
    }
    setPending(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      await window.apinest.auth.clearSession(selectedAccount.id);
      setMessage(`已清理账户「${selectedAccount.displayName}」的会话。`);
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const handleSaveNetwork = async (): Promise<void> => {
    setNetworkPending(true);
    setNetworkMessage(null);
    setNetworkError(null);
    try {
      const updated = await window.apinest.network.updateSettings(formToInput(networkForm));
      setNetworkForm(viewToForm(updated));
      if (updated.dnsApplyError) {
        setNetworkError(`Secure DNS 应用失败：${updated.dnsApplyError}`);
        setNetworkMessage('网络设置已保存，但 Secure DNS 热应用未成功。');
      } else if (updated.dnsApplied === true) {
        setNetworkMessage('网络设置已保存；Secure DNS 已热应用（无需重启）。');
      } else {
        setNetworkMessage('网络设置已保存。');
      }
    } catch (error) {
      setNetworkError(getSafeErrorMessage(error));
    } finally {
      setNetworkPending(false);
    }
  };

  const networkBusy = isBusy || networkPending;

  return (
    <>
      <section className="content-page settings-page">
        <div className="content-header">
          <p className="eyebrow">系统设置</p>
          <h2>应用与安全</h2>
        </div>

        <dl className="detail-grid">
          <div>
            <dt>桥接版本</dt>
            <dd>v{version}</dd>
          </div>
        </dl>

        <section className="settings-section">
          <h3>应用锁定</h3>
          <p className="hint">手动锁定后需要重新输入主密码才能使用敏感能力。</p>
          <button type="button" className="secondary-button" onClick={onLock} disabled={isBusy}>
            手动锁定
          </button>
        </section>

        <section className="settings-section">
          <h3>安全 DNS（Secure DNS）</h3>
          <p className="hint">
            应用级全局设置，保存后<strong>即时热应用</strong>（无需重启）；仅影响应用内联网，不改变系统 DNS。
            关闭开关会隐藏 DoH 输入框，但不会清除已填写的地址，再次开启仍可回显。
          </p>
          <p className="hint">
            若系统开启 Clash 等 <strong>TUN 模式</strong>（尤其 fake-ip），建议关闭安全 DNS 或改用固定代理指向
            Clash 本地端口；否则 DoH 解析的真实 IP 与 TUN 的 fake-ip 路径分裂，容易出现
            ERR_CONNECTION_CLOSED / 页面打不开。
          </p>
          <label className="proxy-toggle">
            <input
              type="checkbox"
              checked={networkForm.secureDnsEnabled}
              disabled={networkBusy}
              onChange={event =>
                // 关闭仅隐藏输入框，不清理 secureDnsServers（再开启仍回显）。
                setNetworkForm(form => ({ ...form, secureDnsEnabled: event.target.checked }))
              }
            />
            启用安全 DNS（关闭则仅使用普通 DNS；已填地址会保留）
          </label>
          {networkForm.secureDnsEnabled ? (
            <div className="settings-field">
              <label htmlFor="secure-dns-servers">
                DoH 服务器（每行一个 https 地址；留空则自动跟随系统）
              </label>
              <textarea
                id="secure-dns-servers"
                rows={3}
                value={networkForm.secureDnsServers}
                placeholder="https://cloudflare-dns.com/dns-query"
                disabled={networkBusy}
                onChange={event =>
                  setNetworkForm(form => ({ ...form, secureDnsServers: event.target.value }))
                }
              />
              <p className="hint">
                填写则强制走这些加密 DoH；留空则自动（系统已配置 DoH 时自动启用）。关闭开关会隐藏本输入框，但不会清除已填地址。不接受含账号密码或非 HTTPS 的地址。
              </p>
            </div>
          ) : null}
        </section>

        <section className="settings-section">
          <h3>代理（Proxy）</h3>
          <p className="hint">
            仅作用于显式开启<strong>「使用全局 Proxy」</strong>的站点与 GitHub/LinuxDo 身份，其余保持直连。
            应用外部浏览器打开的页面由系统默认浏览器处理，<strong>不受本应用代理控制</strong>。
          </p>
          <div className="settings-field">
            <label htmlFor="proxy-mode">模式</label>
            <select
              id="proxy-mode"
              value={networkForm.proxyMode}
              disabled={networkBusy}
              onChange={event =>
                setNetworkForm(form => ({ ...form, proxyMode: event.target.value as ProxyMode }))
              }
            >
              <option value="direct">直连（不使用代理）</option>
              <option value="system">跟随系统代理</option>
              <option value="fixed">固定代理服务器</option>
            </select>
          </div>
          {networkForm.proxyMode === 'fixed' ? (
            <>
              <div className="settings-field">
                <label htmlFor="proxy-scheme">协议</label>
                <select
                  id="proxy-scheme"
                  value={networkForm.fixedProxyScheme}
                  disabled={networkBusy}
                  onChange={event =>
                    setNetworkForm(form => ({
                      ...form,
                      fixedProxyScheme: event.target.value as FixedProxyScheme,
                    }))
                  }
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div className="settings-field">
                <label htmlFor="proxy-host">主机</label>
                <input
                  id="proxy-host"
                  type="text"
                  value={networkForm.fixedProxyHost}
                  placeholder="127.0.0.1"
                  disabled={networkBusy}
                  onChange={event =>
                    setNetworkForm(form => ({ ...form, fixedProxyHost: event.target.value }))
                  }
                />
              </div>
              <div className="settings-field">
                <label htmlFor="proxy-port">端口</label>
                <input
                  id="proxy-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={networkForm.fixedProxyPort}
                  placeholder="7890"
                  disabled={networkBusy}
                  onChange={event =>
                    setNetworkForm(form => ({ ...form, fixedProxyPort: event.target.value }))
                  }
                />
              </div>
              <p className="hint">
                仅支持结构化 http/https/socks5 + 主机 + 端口；不支持 PAC、自动检测、认证代理或自定义 bypass。
              </p>
            </>
          ) : null}
          <div className="detail-actions">
            <button
              type="button"
              onClick={() => void handleSaveNetwork()}
              disabled={networkBusy}
            >
              {networkPending ? '保存中…' : '保存网络设置'}
            </button>
          </div>
          {networkMessage ? <p className="hint">{networkMessage}</p> : null}
          {networkError ? <p className="error-message">{networkError}</p> : null}
        </section>

        <section className="settings-section">
          <h3>会话清理</h3>
          <p className="hint">按账户清理应用内会话（Cookie / 缓存）；不会影响其他账户。</p>
          <div className="settings-field">
            <label htmlFor="clear-session-account">账户</label>
            <select
              id="clear-session-account"
              value={selectedId}
              disabled={isBusy || pending || accounts.length === 0}
              onChange={event => setSelectedId(event.target.value)}
            >
              {accounts.length === 0 ? <option value="">暂无账户</option> : null}
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.displayName}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="danger-button"
            onClick={handleClearSession}
            disabled={isBusy || pending || !selectedAccount}
          >
            清理所选账户会话
          </button>
          {message ? <p className="hint">{message}</p> : null}
          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
        </section>
      </section>

      <ConfirmSlideOver
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void performClearSession()}
        title="清理会话"
        message={
          selectedAccount
            ? `确定清理账户「${selectedAccount.displayName}」的应用内会话吗？`
            : '确定清理会话吗？'
        }
        danger
        confirmLabel="清理"
        busy={pending}
      />
    </>
  );
}
