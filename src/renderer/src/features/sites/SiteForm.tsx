import { useState } from 'react';
import type { AuthIdentity, PlatformDetectionResult, PlatformType, SiteRouteProfile } from '../../../../shared/ipc/bridge';
import {
  SiteFormValues,
  PLATFORM_OPTIONS,
  authOptions,
  describeDetectionResult,
  validateSiteForm,
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
 * 站点新增/编辑表单（承载于右侧 slide-over）。
 * 标题由 slide-over header 提供，故本组件不再自带 `<h2>`；
 * 校验/转换沿用 site-form.ts 纯函数，业务契约不变。
 */
export function SiteForm(props: SiteFormProps): React.JSX.Element {
  const [values, setValues] = useState(props.initialValues);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectionMessage, setDetectionMessage] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const detect = async (): Promise<void> => {
    if (!/^https?:\/\//i.test(values.baseUrl.trim())) {
      setDetectionMessage('请先填写有效的 HTTP(S) 站点 URL。');
      return;
    }
    setDetecting(true);
    try {
      const result = await props.onDetect(values.baseUrl.trim(), values.useProxy);
      setDetectionMessage(describeDetectionResult(result));
      if (result.confidence === 'high') {
        setValues(current => ({ ...current, platform: result.platform }));
      }
    } catch {
      setDetectionMessage('检测请求失败，你仍可手动选择站点类型并继续。');
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

  return (
    <form className="site-form account-form-panel" onSubmit={submit}>
      <div className="site-form-grid">
        <label>站名<input value={values.name} disabled={busy} onChange={e => set('name', e.target.value)} /></label>
        <label>站点类型<select value={values.platform} disabled={busy} onChange={e => set('platform', e.target.value as PlatformType)}>
          {PLATFORM_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      </div>
      <label>站点 URL</label>
      <div className="site-url-row">
        <input value={values.baseUrl} disabled={busy} placeholder="https://example.com" onChange={e => set('baseUrl', e.target.value)} />
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void detect()}>{detecting ? '检测中…' : '检测类型'}</button>
      </div>
      {detectionMessage ? <p className="hint">{detectionMessage}</p> : null}
      <label>站点备注（可选）<textarea rows={2} value={values.note} disabled={busy} onChange={e => set('note', e.target.value)} /></label>

      <label className="proxy-toggle">
        <input
          type="checkbox"
          checked={values.useProxy}
          disabled={busy}
          onChange={e => set('useProxy', e.target.checked)}
        />
        使用全局 Proxy（在系统设置中配置；关闭则该站点账户直连）
      </label>

      <label className="proxy-toggle">
        <input
          type="checkbox"
          checked={values.enabled}
          disabled={busy}
          onChange={e => set('enabled', e.target.checked)}
        />
        启用该站点（关闭后默认从站点广场「仅启用」视图中隐藏）
      </label>

      <label>站点标签（可选，回车添加，至多 12 个）</label>
      <TagInput tags={values.tags} disabled={busy} onChange={next => set('tags', next)} />

      {values.platform === 'newapi' ? (
        <>
          <label>LinuxDo Client ID（可选）<input value={values.linuxDoClientId} disabled={busy} onChange={e => set('linuxDoClientId', e.target.value)} /></label>
          <label className="compatibility-toggle">
            <input
              type="checkbox"
              checked={values.routeProfile !== 'modern'}
              disabled={busy}
              onChange={e => set('routeProfile', (e.target.checked ? 'classic' : 'modern') as SiteRouteProfile)}
            />
            兼容旧版 NewAPI UI
          </label>
          {values.routeProfile === 'legacy-panel' ? <p className="warning-text">该站点来自历史数据，当前使用 Panel 路由；切换开关后将改用官方新版或 classic 路由。</p> : null}
        </>
      ) : null}

      {props.includeFirstAccount ? (
        <fieldset className="site-first-account">
          <legend>首个账号</legend>
          <label>账号显示名<input value={values.firstAccountName} disabled={busy} onChange={e => set('firstAccountName', e.target.value)} /></label>
          <label>账号备注（可选）<textarea rows={2} value={values.firstAccountNote} disabled={busy} onChange={e => set('firstAccountNote', e.target.value)} /></label>
          <label>绑定认证身份（可选）<select value={values.firstAuthId} disabled={busy} onChange={e => set('firstAuthId', e.target.value)}>
            <option value="">不绑定</option>
            {authOptions(props.authIdentities).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
        </fieldset>
      ) : null}

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={props.onCancel} disabled={busy}>取消</button>
        <button type="submit" disabled={busy}>{props.submitLabel}</button>
      </div>
    </form>
  );
}

interface TagInputProps {
  tags: string[];
  disabled: boolean;
  onChange: (tags: string[]) => void;
}

/**
 * 标签胶囊输入（纯前端小组件，无第三方依赖）。回车/逗号提交新标签，
 * 点击胶囊上的 × 删除。单标签去空白后 1–24 字符、去重、至多 12 个，
 * 与后端 schema/清洗上限一致；超限或重复静默忽略，不打断输入流。
 */
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
              <button type="button" className="site-tag-remove" disabled={disabled} aria-label={`删除标签 ${tag}`} onClick={() => remove(tag)}>×</button>
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
