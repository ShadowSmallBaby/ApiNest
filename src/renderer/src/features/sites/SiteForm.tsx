import { useState } from 'react';
import { Switch } from '@headlessui/react';
import type {
  AuthIdentity,
  OAuthProvider,
  PlatformDetectionResult,
  PlatformType,
  SiteRouteProfile,
} from '../../../../shared/ipc/bridge';
import { filterAuthIdentitiesForSite } from '../accounts/account-form';
import {
  SiteFormValues,
  PLATFORM_OPTIONS,
  OAUTH_PROVIDER_OPTIONS,
  authOptions,
  describeDetectionResult,
  oauthProviderLabel,
  validateSiteForm,
  type SiteFormOAuthConfig,
} from './site-form';

interface SiteFormProps {
  submitLabel: string;
  initialValues: SiteFormValues;
  authIdentities: AuthIdentity[];
  includeFirstAccount: boolean;
  isBusy: boolean;
  onDetect: (baseUrl: string, useProxy: boolean) => Promise<PlatformDetectionResult>;
  onSubmit: (values: SiteFormValues) => void;
  onCancel: () => void;
}

/**
 * 站点新增/编辑表单。
 *
 * 核心流程：先输入 URL → 识别 → 成功回填站名/类型，失败则手动填写。
 * OAuth 配置为站点级多提供商列表（GitHub / LinuxDo），账户认证方式独立选择。
 */
export function SiteForm(props: SiteFormProps): React.JSX.Element {
  const [values, setValues] = useState(props.initialValues);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectionMessage, setDetectionMessage] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [newProvider, setNewProvider] = useState<OAuthProvider | ''>('');
  const [newClientId, setNewClientId] = useState('');

  const detect = async (): Promise<void> => {
    const url = values.baseUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      setDetectionMessage('请先填写有效的 HTTP(S) 站点 URL');
      return;
    }
    setDetecting(true);
    setDetectionMessage(null);
    try {
      const result = await props.onDetect(url, values.useProxy);
      setDetectionMessage(describeDetectionResult(result));
      if (result.confidence === 'high') {
        setValues(current => ({ ...current, platform: result.platform }));
      }
    } catch {
      setDetectionMessage('检测请求失败，请手动选择站点类型');
    } finally {
      setDetecting(false);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const error = validateSiteForm(values, props.includeFirstAccount);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setErrorMessage(null);
    props.onSubmit(values);
  };

  const busy = props.isBusy || detecting;
  const set = <K extends keyof SiteFormValues>(key: K, value: SiteFormValues[K]): void =>
    setValues(current => ({ ...current, [key]: value }));

  const availableProviders = OAUTH_PROVIDER_OPTIONS.filter(
    option => !values.oauthConfigs.some(config => config.provider === option.value),
  );

  const firstAccountAuthFilter = filterAuthIdentitiesForSite(props.authIdentities, {
    autoLogin: values.autoLogin,
    configuredProviders: values.oauthConfigs.map(config => config.provider),
  });

  const addOAuthConfig = (): void => {
    if (!newProvider || !newClientId.trim()) return;
    if (values.oauthConfigs.some(config => config.provider === newProvider)) return;
    const next: SiteFormOAuthConfig = {
      provider: newProvider,
      clientId: newClientId.trim(),
    };
    set('oauthConfigs', [...values.oauthConfigs, next]);
    setNewProvider('');
    setNewClientId('');
  };

  const removeOAuthConfig = (provider: OAuthProvider): void => {
    set(
      'oauthConfigs',
      values.oauthConfigs.filter(config => config.provider !== provider),
    );
  };

  const updateOAuthClientId = (provider: OAuthProvider, clientId: string): void => {
    set(
      'oauthConfigs',
      values.oauthConfigs.map(config =>
        config.provider === provider ? { ...config, clientId } : config,
      ),
    );
  };

  return (
    <form className="site-form account-form-panel" onSubmit={submit}>
      <section className="site-form-section">
        <h3 className="site-form-section-title">站点信息</h3>

        <label>站点 URL</label>
        <div className="site-url-row">
          <input
            value={values.baseUrl}
            disabled={busy}
            placeholder="https://example.com"
            onChange={e => set('baseUrl', e.target.value)}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void detect()}
          >
            {detecting ? '识别中…' : '识别'}
          </button>
        </div>
        {detectionMessage ? <p className="hint">{detectionMessage}</p> : null}

        <div className="site-form-grid">
          <label>
            站名
            <input
              value={values.name}
              disabled={busy}
              placeholder="如：主站"
              onChange={e => set('name', e.target.value)}
            />
          </label>
          <label>
            站点类型
            <select
              value={values.platform}
              disabled={busy}
              onChange={e => set('platform', e.target.value as PlatformType)}
            >
              {PLATFORM_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label>
          站点备注（可选）
          <textarea
            rows={2}
            value={values.note}
            disabled={busy}
            placeholder="如：主要用于测试环境"
            onChange={e => set('note', e.target.value)}
          />
        </label>
      </section>

      <section className="site-form-section">
        <div className="site-form-switch-row">
          <div className="site-form-switch-label">
            <span className="site-form-switch-title">启用该站点</span>
            <span className="site-form-switch-hint">关闭后默认从站点广场「仅启用」视图中隐藏</span>
          </div>
          <Switch
            checked={values.enabled}
            onChange={checked => set('enabled', checked)}
            disabled={busy}
            className={`site-form-switch ${values.enabled ? 'site-form-switch--on' : 'site-form-switch--off'}`}
          >
            <span className="site-form-switch-thumb" />
          </Switch>
        </div>
      </section>

      <section className="site-form-section">
        <div className="site-form-switch-row">
          <div className="site-form-switch-label">
            <span className="site-form-switch-title">使用全局 Proxy</span>
            <span className="site-form-switch-hint">在系统设置中配置；关闭则该站点账户直连</span>
          </div>
          <Switch
            checked={values.useProxy}
            onChange={checked => set('useProxy', checked)}
            disabled={busy}
            className={`site-form-switch ${values.useProxy ? 'site-form-switch--on' : 'site-form-switch--off'}`}
          >
            <span className="site-form-switch-thumb" />
          </Switch>
        </div>
      </section>

      <section className="site-form-section">
        <div className="site-form-switch-row">
          <div className="site-form-switch-label">
            <span className="site-form-switch-title">自动登录</span>
            <span className="site-form-switch-hint">
              参与站点广场一键登录；开启后账号须绑定本站已配置的 OAuth 身份
            </span>
          </div>
          <Switch
            checked={values.autoLogin}
            onChange={checked => {
              if (checked && values.oauthConfigs.length === 0) {
                setErrorMessage('启用自动登录前请先配置至少一个 OAuth Client ID。');
                return;
              }
              setErrorMessage(null);
              set('autoLogin', checked);
              if (checked && !values.firstAuthId) {
                // 禁止 CK：若当前是 CK 则清空，提交时再校验
                set('firstAuthId', '');
              }
            }}
            disabled={busy}
            className={`site-form-switch ${values.autoLogin ? 'site-form-switch--on' : 'site-form-switch--off'}`}
          >
            <span className="site-form-switch-thumb" />
          </Switch>
        </div>
      </section>

      <section className="site-form-section">
        <div className="site-form-switch-row">
          <div className="site-form-switch-label">
            <span className="site-form-switch-title">自动签到</span>
            <span className="site-form-switch-hint">
              {values.checkInSiteUrl.trim()
                ? '已配置额外签到站，暂不支持自动签到'
                : '参与站点广场一键 API 签到（非外部签到站）'}
            </span>
          </div>
          <Switch
            checked={values.autoCheckIn && !values.checkInSiteUrl.trim()}
            onChange={checked => set('autoCheckIn', checked)}
            disabled={busy || Boolean(values.checkInSiteUrl.trim())}
            className={`site-form-switch ${values.autoCheckIn && !values.checkInSiteUrl.trim() ? 'site-form-switch--on' : 'site-form-switch--off'}`}
          >
            <span className="site-form-switch-thumb" />
          </Switch>
        </div>
        <label>
          签到站地址（可选）
          <input
            value={values.checkInSiteUrl}
            disabled={busy}
            placeholder="https://checkin.example.com（额外签到站时填写）"
            onChange={e => {
              const next = e.target.value;
              setValues(current => ({
                ...current,
                checkInSiteUrl: next,
                // 填写额外签到站时强制关闭自动签到
                autoCheckIn: next.trim() ? false : current.autoCheckIn,
              }));
            }}
          />
        </label>
        <p className="hint">
          配置后，点签到将在账户会话中打开该地址由用户手动完成；暂不支持一键/自动签到。
        </p>
      </section>

      <section className="site-form-section">
        <label>站点标签（可选，回车添加，至多 12 个）</label>
        <TagInput tags={values.tags} disabled={busy} onChange={next => set('tags', next)} />
      </section>

      <section className="site-form-section">
        <h3 className="site-form-section-title">OAuth 配置（可选）</h3>
        <p className="site-form-auth-note">
          同一站点可配置多种 OAuth 提供商；不同账号可分别选择 GitHub / LinuxDo 等方式登录。
        </p>

        {values.oauthConfigs.length > 0 ? (
          <div className="site-oauth-list">
            {values.oauthConfigs.map(config => (
              <div key={config.provider} className="site-oauth-row">
                <span className="site-oauth-provider">{oauthProviderLabel(config.provider)}</span>
                <input
                  value={config.clientId}
                  disabled={busy}
                  placeholder="Client ID"
                  onChange={e => updateOAuthClientId(config.provider, e.target.value)}
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => removeOAuthConfig(config.provider)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">尚未配置 OAuth；账号可使用 CK 认证或 Password 凭据。</p>
        )}

        {availableProviders.length > 0 ? (
          <div className="site-oauth-add-row">
            <select
              value={newProvider}
              disabled={busy}
              onChange={e => setNewProvider(e.target.value as OAuthProvider | '')}
            >
              <option value="">选择 OAuth 提供商</option>
              {availableProviders.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              value={newClientId}
              disabled={busy || !newProvider}
              placeholder="Client ID"
              onChange={e => setNewClientId(e.target.value)}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !newProvider || !newClientId.trim()}
              onClick={addOAuthConfig}
            >
              添加
            </button>
          </div>
        ) : null}
      </section>

      {values.platform === 'newapi' ? (
        <section className="site-form-section">
          <h3 className="site-form-section-title">NewAPI 配置</h3>
          <div className="site-form-switch-row">
            <div className="site-form-switch-label">
              <span className="site-form-switch-title">兼容旧版 NewAPI UI</span>
              <span className="site-form-switch-hint">开启后使用 classic 路由，关闭使用 modern 路由</span>
            </div>
            <Switch
              checked={values.routeProfile !== 'modern'}
              onChange={checked => set('routeProfile', (checked ? 'classic' : 'modern') as SiteRouteProfile)}
              disabled={busy}
              className={`site-form-switch ${values.routeProfile !== 'modern' ? 'site-form-switch--on' : 'site-form-switch--off'}`}
            >
              <span className="site-form-switch-thumb" />
            </Switch>
          </div>
          {values.routeProfile === 'legacy-panel' ? (
            <p className="warning-text">该站点来自历史数据，当前使用 Panel 路由；切换开关后将改用官方新版或 classic 路由。</p>
          ) : null}
        </section>
      ) : null}

      {props.includeFirstAccount ? (
        <fieldset className="site-first-account">
          <legend>首个账号配置</legend>
          <label>
            账号显示名
            <input
              value={values.firstAccountName}
              disabled={busy}
              placeholder="如：主账号"
              onChange={e => set('firstAccountName', e.target.value)}
            />
          </label>
          <label>
            账号备注（可选）
            <textarea
              rows={2}
              value={values.firstAccountNote}
              disabled={busy}
              placeholder="如：用于日常使用"
              onChange={e => set('firstAccountNote', e.target.value)}
            />
          </label>
          <label>
            认证方式
            <select
              value={values.firstAuthId}
              disabled={busy}
              onChange={e => set('firstAuthId', e.target.value)}
            >
              {firstAccountAuthFilter.allowCookie ? <option value="">CK 认证</option> : null}
              {authOptions(firstAccountAuthFilter.identities).map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="hint">
              {values.autoLogin
                ? '已启用自动登录：仅可选择本站已配置 OAuth 对应的身份，不可使用 CK。'
                : 'CK 认证可在账户详情页导入 Cookie；选择 OAuth 身份前请先在上方配置对应 Client ID。'}
            </p>
          </label>
        </fieldset>
      ) : null}

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={props.onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" disabled={busy}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

interface TagInputProps {
  tags: string[];
  disabled: boolean;
  onChange: (tags: string[]) => void;
}

function TagInput({ tags, disabled, onChange }: TagInputProps): React.JSX.Element {
  const [draft, setDraft] = useState('');

  const commit = (): void => {
    const tag = draft.trim();
    if (tag.length === 0 || tag.length > 24 || tags.includes(tag) || tags.length >= 12) {
      setDraft('');
      return;
    }
    onChange([...tags, tag]);
    setDraft('');
  };

  const remove = (target: string): void => {
    onChange(tags.filter(tag => tag !== target));
  };

  return (
    <div className="site-tag-input">
      {tags.length > 0 ? (
        <div className="site-tag-input-chips">
          {tags.map(tag => (
            <span key={tag} className="site-tag-chip">
              {tag}
              <button
                type="button"
                className="site-tag-remove"
                disabled={disabled}
                aria-label={`删除标签 ${tag}`}
                onClick={() => remove(tag)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        value={draft}
        disabled={disabled || tags.length >= 12}
        placeholder={tags.length >= 12 ? '已达标签上限' : '输入标签后回车添加'}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && draft.length === 0 && tags.length > 0) {
            remove(tags[tags.length - 1]);
          }
        }}
      />
    </div>
  );
}
