import { useEffect, useState } from 'react';
import type { AuthIdentity, AuthKind } from '../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../lib/error-message';
import { ConfirmSlideOver } from '../components/SlideOver';

interface OAuthPageProps {
  isBusy: boolean;
}

const KIND_LABELS: Record<AuthKind, string> = {
  github: 'GitHub',
  linuxdo: 'LinuxDo',
  password: '账号密码',
};

const KIND_HINTS: Record<AuthKind, string> = {
  github: '在 auth 专属会话中打开 GitHub 官方页面登录一次；应用不采集账号密码，不绕过验证码或授权确认。',
  linuxdo: '在 auth 专属会话中打开 LinuxDo 官方页面登录一次；应用不采集账号密码，不绕过验证码或授权确认。',
  password: '保存账号密码为加密凭据，可被多个账户引用，仅在你主动发起登录时用于目标站点原生登录表单。',
};

const CREATE_KINDS: AuthKind[] = ['github', 'linuxdo', 'password'];

/**
 * 认证身份管理页（R13 演进）。
 *
 * auth 身份是独立一等实体：github/linuxdo 为可各自登录一次的身份（登录态持久在 auth 专属会话），
 * password 为可被多个账户引用的加密账密凭据。本页做身份 CRUD、password 凭据存/清、
 * github/linuxdo 登录；账密明文绝不回传 renderer，只显示"已保存/未保存"。
 *
 * 删除确认在右侧 slide-over 内完成，不使用原生 window.confirm。
 */
export function OAuthPage({ isBusy }: OAuthPageProps): React.JSX.Element {
  const [identities, setIdentities] = useState<AuthIdentity[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<AuthKind>('github');
  const [newLabel, setNewLabel] = useState('');
  const [newUseProxy, setNewUseProxy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AuthIdentity | null>(null);

  const selected = identities.find(item => item.id === selectedId) ?? null;

  const loadIdentities = async (): Promise<void> => {
    const list = await window.apinest.authIdentities.list();
    setIdentities(list);
    setSelectedId(current => (current && list.some(item => item.id === current) ? current : list[0]?.id ?? ''));
  };

  useEffect(() => {
    loadIdentities().catch(error => setErrorMessage(getSafeErrorMessage(error)));
  }, []);

  // 切换选中身份时清空凭据输入，不预填任何内容。
  useEffect(() => {
    setUsername('');
    setPassword('');
    setMessage(null);
    setErrorMessage(null);
  }, [selectedId]);

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setPending(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const handleCreate = (): void => {
    if (newLabel.trim().length === 0) {
      return;
    }
    void runAction(async () => {
      const created = await window.apinest.authIdentities.create({
        kind: newKind,
        label: newLabel.trim(),
        // password 身份不使用 Proxy；github/linuxdo 按创建表单当前选择。
        useProxy: newKind === 'password' ? undefined : newUseProxy,
      });
      await loadIdentities();
      setSelectedId(created.id);
      setCreating(false);
      setNewLabel('');
      setNewKind('github');
      setNewUseProxy(false);
      setMessage(`已创建认证身份「${created.label}」。`);
    });
  };

  const handleRemove = (): void => {
    if (!selected) {
      return;
    }
    setRemoveTarget(selected);
  };

  const performRemove = (): void => {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) {
      return;
    }
    void runAction(async () => {
      await window.apinest.authIdentities.remove(target.id);
      await loadIdentities();
      setMessage('已删除认证身份。');
    });
  };

  const handleOpenLogin = (): void => {
    if (!selected) {
      return;
    }
    void runAction(async () => {
      await window.apinest.authIdentities.openLogin(selected.id);
      setMessage('已打开登录窗口，请在官方页面完成认证。');
    });
  };

  const handleSaveCredential = (): void => {
    if (!selected || username.trim().length === 0 || password.length === 0) {
      return;
    }
    void runAction(async () => {
      await window.apinest.authIdentities.saveCredential(selected.id, {
        username: username.trim(),
        password,
      });
      setUsername('');
      setPassword('');
      await loadIdentities();
      setMessage('已保存账号密码引用（加密存储，界面不展示明文）。');
    });
  };

  const handleToggleProxy = (useProxy: boolean): void => {
    if (!selected) {
      return;
    }
    void runAction(async () => {
      await window.apinest.authIdentities.update(selected.id, { useProxy });
      await loadIdentities();
      setMessage(useProxy ? '已启用全局 Proxy。' : '已关闭全局 Proxy（改为直连）。');
    });
  };

  const busy = isBusy || pending;

  return (
    <>
      <section className="content-page oauth-page">
        <div className="content-header">
          <p className="eyebrow">认证身份管理</p>
          <h2>OAuth 与登录</h2>
        </div>

        <section className="settings-section">
          <div className="snapshots-header">
            <h3>认证身份</h3>
            <button type="button" onClick={() => setCreating(value => !value)} disabled={busy}>
              {creating ? '取消新增' : '新增身份'}
            </button>
          </div>

          {creating ? (
            <div className="oauth-create-form">
              <label htmlFor="new-auth-kind">类型</label>
              <select
                id="new-auth-kind"
                value={newKind}
                disabled={busy}
                onChange={event => setNewKind(event.target.value as AuthKind)}
              >
                {CREATE_KINDS.map(kind => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              <label htmlFor="new-auth-label">名称</label>
              <input
                id="new-auth-label"
                type="text"
                value={newLabel}
                disabled={busy}
                onChange={event => setNewLabel(event.target.value)}
                placeholder="如：我的 GitHub"
              />
              <p className="hint">{KIND_HINTS[newKind]}</p>
              {newKind !== 'password' ? (
                <label className="proxy-toggle">
                  <input
                    type="checkbox"
                    checked={newUseProxy}
                    disabled={busy}
                    onChange={event => setNewUseProxy(event.target.checked)}
                  />
                  使用全局 Proxy（登录窗口联网走系统设置中的 Proxy）
                </label>
              ) : null}
              <button type="button" onClick={handleCreate} disabled={busy || newLabel.trim().length === 0}>
                创建
              </button>
            </div>
          ) : null}

          {identities.length === 0 ? (
            <p className="empty-state">尚无认证身份，点击「新增身份」创建。</p>
          ) : (
            <div className="detail-actions">
              <select
                value={selectedId}
                disabled={busy}
                onChange={event => setSelectedId(event.target.value)}
              >
                {identities.map(identity => (
                  <option key={identity.id} value={identity.id}>
                    {KIND_LABELS[identity.kind]} · {identity.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {selected ? (
          <section className="settings-section">
            <div className="oauth-card-head">
              <h3>
                {KIND_LABELS[selected.kind]} · {selected.label}
              </h3>
              {selected.kind === 'password' ? (
                <span className={`auth-badge ${selected.hasCredential ? 'auth-active' : 'auth-unknown'}`}>
                  {selected.hasCredential ? '已保存' : '未保存'}
                </span>
              ) : null}
            </div>
            <p className="hint">{KIND_HINTS[selected.kind]}</p>

            {selected.kind === 'password' ? (
              <>
                <div className="oauth-credential-form">
                  <label htmlFor="oauth-username">用户名</label>
                  <input
                    id="oauth-username"
                    type="text"
                    autoComplete="off"
                    value={username}
                    disabled={busy}
                    onChange={event => setUsername(event.target.value)}
                    placeholder="站点账号"
                  />
                  <label htmlFor="oauth-password">密码</label>
                  <input
                    id="oauth-password"
                    type="password"
                    autoComplete="off"
                    value={password}
                    disabled={busy}
                    onChange={event => setPassword(event.target.value)}
                    placeholder="仅加密保存，界面不回显"
                  />
                </div>
                <div className="detail-actions">
                  <button
                    type="button"
                    onClick={handleSaveCredential}
                    disabled={busy || username.trim().length === 0 || password.length === 0}
                  >
                    {selected.hasCredential ? '更新凭据' : '保存凭据'}
                  </button>
                  <button type="button" className="danger-button" onClick={handleRemove} disabled={busy}>
                    删除身份
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="proxy-toggle">
                  <input
                    type="checkbox"
                    checked={selected.useProxy}
                    disabled={busy}
                    onChange={event => handleToggleProxy(event.target.checked)}
                  />
                  使用全局 Proxy（登录窗口联网走系统设置中的 Proxy）
                </label>
                <div className="detail-actions">
                  <button type="button" onClick={handleOpenLogin} disabled={busy}>
                    在应用内登录
                  </button>
                  <button type="button" className="danger-button" onClick={handleRemove} disabled={busy}>
                    删除身份
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {message ? <p className="hint">{message}</p> : null}
        {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
      </section>

      <ConfirmSlideOver
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={performRemove}
        title="删除认证身份"
        message={<>确认删除认证身份「<strong>{removeTarget?.label}</strong>」？</>}
        detail="关联它的账户将解除引用；同类型其他身份不受影响。"
        danger
        confirmLabel="删除身份"
        busy={busy}
      />
    </>
  );
}
