import { useEffect, useState } from 'react';
import type { AuthStatus } from '../../shared/ipc/bridge';
import { getSafeErrorMessage } from './lib/error-message';
import { AppShell } from './shell/AppShell';

const INITIAL_STATUS: AuthStatus = {
  initialized: false,
  unlocked: false,
};

export function App(): React.JSX.Element {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(INITIAL_STATUS);
  const [masterPassword, setMasterPassword] = useState('');
  const [isBusy, setIsBusy] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshAuthStatus = async (): Promise<void> => {
    const status = await window.apinest.auth.status();
    setAuthStatus(status);
  };

  useEffect(() => {
    refreshAuthStatus()
      .catch(() => {
        setErrorMessage('无法读取应用锁定状态。');
      })
      .finally(() => {
        setIsBusy(false);
      });
  }, []);

  const handleUnlock = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsBusy(true);
    setErrorMessage(null);

    try {
      await window.apinest.auth.unlock(masterPassword);
      setMasterPassword('');
      await refreshAuthStatus();
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleLock = async (): Promise<void> => {
    setIsBusy(true);
    setErrorMessage(null);

    try {
      await window.apinest.auth.lock();
      await refreshAuthStatus();
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  if (!authStatus.unlocked) {
    const title = authStatus.initialized ? '解锁 ApiNest' : '设置主密码';
    const description = authStatus.initialized
      ? '请输入主密码解锁本地凭据库。登录、刷新、签到和已认证页面会在解锁后启用。'
      : '首次使用需要设置主密码。主密码不会保存到本地，遗失后只能清空加密资料重新初始化。';

    return (
      <main className="app-shell">
        <section className="hero-card auth-card">
          <p className="eyebrow">ApiNest Local Vault</p>
          <h1>{title}</h1>
          <p className="description">{description}</p>
          <form className="auth-form" onSubmit={handleUnlock}>
            <label htmlFor="master-password">主密码</label>
            <input
              id="master-password"
              minLength={8}
              type="password"
              value={masterPassword}
              disabled={isBusy}
              autoComplete={authStatus.initialized ? 'current-password' : 'new-password'}
              onChange={event => setMasterPassword(event.target.value)}
              placeholder="至少 8 个字符"
              required
            />
            {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
            <button type="submit" disabled={isBusy || masterPassword.length < 8}>
              {isBusy ? '处理中…' : authStatus.initialized ? '解锁' : '设置并解锁'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <AppShell
      version={window.apinest.system.version}
      isBusy={isBusy}
      onLock={handleLock}
    />
  );
}
