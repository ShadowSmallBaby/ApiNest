import { useEffect, useRef, useState } from 'react';
import type { AuthIdentity, AuthKind, AuthLoginTarget } from '../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../lib/error-message';
import { ConfirmSlideOver, SlideOver } from '../components/SlideOver';
import { OAuthCard } from './OAuthCard';
import { KIND_HINTS, KIND_LABELS } from './oauth-card-view';

interface OAuthPageProps {
  isBusy: boolean;
}

const CREATE_KINDS: AuthKind[] = ['github', 'linuxdo', 'password'];

/** 右侧 slide-over 承载的表单类型。 */
type Panel =
  | { kind: 'create' }
  | { kind: 'edit'; id: string };

/**
 * 认证身份管理页（卡片化改造）。
 *
 * 主区为卡片网格：每个身份一张卡（类型·名称 / 站点 URL 或说明 / 创建时间 + 代理开关），
 * 三点菜单提供编辑、（linuxdo）主站/Credit 登录、删除。新增/编辑在右侧 slide-over 内完成，
 * 删除用 ConfirmSlideOver 确认。password 凭据明文绝不回传 renderer，只显示已保存/未保存。
 */
export function OAuthPage({ isBusy }: OAuthPageProps): React.JSX.Element {
  const [identities, setIdentities] = useState<AuthIdentity[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AuthIdentity | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 新增表单字段
  const [newKind, setNewKind] = useState<AuthKind>('github');
  const [newLabel, setNewLabel] = useState('');
  const [newUseProxy, setNewUseProxy] = useState(false);

  // 编辑表单字段
  const [editLabel, setEditLabel] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const lastPanel = useRef<Panel | null>(null);
  if (panel) lastPanel.current = panel;
  const renderedPanel = panel ?? lastPanel.current;

  const editing = renderedPanel?.kind === 'edit' ? identities.find(item => item.id === renderedPanel.id) ?? null : null;

  const loadIdentities = async (): Promise<void> => {
    setIdentities(await window.apinest.authIdentities.list());
  };

  useEffect(() => {
    loadIdentities().catch(error => setErrorMessage(getSafeErrorMessage(error)));
  }, []);

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

  const busy = isBusy || pending;

  const openCreate = (): void => {
    setNewKind('github');
    setNewLabel('');
    setNewUseProxy(false);
    setPanel({ kind: 'create' });
  };

  const openEdit = (identity: AuthIdentity): void => {
    setEditLabel(identity.label);
    setUsername('');
    setPassword('');
    setPanel({ kind: 'edit', id: identity.id });
  };

  const handleCreate = (): void => {
    if (newLabel.trim().length === 0) return;
    void runAction(async () => {
      const created = await window.apinest.authIdentities.create({
        kind: newKind,
        label: newLabel.trim(),
        useProxy: newKind === 'password' ? undefined : newUseProxy,
      });
      await loadIdentities();
      setPanel(null);
      setMessage(`已创建认证身份「${created.label}」。`);
    });
  };

  const handleSaveEdit = (): void => {
    if (!editing || editLabel.trim().length === 0) return;
    void runAction(async () => {
      await window.apinest.authIdentities.update(editing.id, { label: editLabel.trim() });
      await loadIdentities();
      setPanel(null);
      setMessage('已保存修改。');
    });
  };

  const handleSaveCredential = (): void => {
    if (!editing || username.trim().length === 0 || password.length === 0) return;
    void runAction(async () => {
      await window.apinest.authIdentities.saveCredential(editing.id, {
        username: username.trim(),
        password,
      });
      setUsername('');
      setPassword('');
      await loadIdentities();
      setMessage('已保存账号密码引用（加密存储，界面不展示明文）。');
    });
  };

  const performRemove = (): void => {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    void runAction(async () => {
      await window.apinest.authIdentities.remove(target.id);
      await loadIdentities();
      setMessage('已删除认证身份。');
    });
  };

  const openLogin = (identity: AuthIdentity, target: AuthLoginTarget): void => {
    void runAction(async () => {
      await window.apinest.authIdentities.openLogin(identity.id, target);
      setMessage('已打开登录窗口，请在官方页面完成认证。');
    });
  };

  const toggleProxy = (identity: AuthIdentity, useProxy: boolean): void => {
    void runAction(async () => {
      await window.apinest.authIdentities.update(identity.id, { useProxy });
      await loadIdentities();
      setMessage(useProxy ? '已启用全局 Proxy。' : '已关闭全局 Proxy（改为直连）。');
    });
  };

  const panelTitle = renderedPanel?.kind === 'create' ? '新增认证身份' : '编辑认证身份';
  const panelSubtitle = renderedPanel?.kind === 'edit' && editing ? `${KIND_LABELS[editing.kind]} · ${editing.label}` : undefined;

  const renderPanel = (): React.ReactNode => {
    if (renderedPanel?.kind === 'create') {
      return (
        <div className="oauth-create-form">
          <label htmlFor="new-auth-kind">类型</label>
          <select id="new-auth-kind" value={newKind} disabled={busy} onChange={event => setNewKind(event.target.value as AuthKind)}>
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
              <input type="checkbox" checked={newUseProxy} disabled={busy} onChange={event => setNewUseProxy(event.target.checked)} />
              使用全局 Proxy（登录窗口联网走系统设置中的 Proxy）
            </label>
          ) : null}
          <button type="button" onClick={handleCreate} disabled={busy || newLabel.trim().length === 0}>
            创建
          </button>
        </div>
      );
    }

    if (!editing) return null;

    return (
      <div className="oauth-create-form">
        <p className="hint">{KIND_HINTS[editing.kind]}</p>
        <label htmlFor="edit-auth-label">名称</label>
        <input
          id="edit-auth-label"
          type="text"
          value={editLabel}
          disabled={busy}
          onChange={event => setEditLabel(event.target.value)}
          placeholder="身份名称"
        />
        <button type="button" onClick={handleSaveEdit} disabled={busy || editLabel.trim().length === 0}>
          保存名称
        </button>

        {editing.kind === 'password' ? (
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
            <button
              type="button"
              onClick={handleSaveCredential}
              disabled={busy || username.trim().length === 0 || password.length === 0}
            >
              {editing.hasCredential ? '更新凭据' : '保存凭据'}
            </button>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <section className="content-page oauth-page">
        <div className="content-header">
          <p className="eyebrow">认证身份管理</p>
          <h2>OAuth 与登录</h2>
        </div>

        {message ? <p className="hint">{message}</p> : null}
        {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

        <div className="oauth-grid">
          {identities.map(identity => (
            <OAuthCard
              key={identity.id}
              identity={identity}
              isBusy={busy}
              onOpenLogin={target => openLogin(identity, target)}
              onEdit={() => openEdit(identity)}
              onRemove={() => setRemoveTarget(identity)}
              onToggleProxy={useProxy => toggleProxy(identity, useProxy)}
            />
          ))}
          <button type="button" className="oauth-add-card" onClick={openCreate} disabled={busy}>
            ＋ 新增身份
          </button>
        </div>
      </section>

      <SlideOver open={panel !== null} onClose={() => setPanel(null)} title={panelTitle} subtitle={panelSubtitle} width="md">
        {renderPanel()}
      </SlideOver>

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
