import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountRecord, ApiKeyRecord, ModelRecord, SiteRecord, TextApiEndpoint, TextApiTestResult } from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../../lib/error-message';
import { TEXT_ENDPOINTS, accountsForSite, availableModels, endpointsForModel, formatResponseBody, testCapableSites } from './api-test-view';

export function TextApiTestPage(): React.JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [siteId, setSiteId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [modelId, setModelId] = useState('');
  const [endpoint, setEndpoint] = useState<TextApiEndpoint>('openai_chat_completions');
  const [message, setMessage] = useState('请回复：API 测试成功');
  const [headersJson, setHeadersJson] = useState('');
  const [bodyJson, setBodyJson] = useState('');
  const [result, setResult] = useState<TextApiTestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.apinest.sites.list(), window.apinest.accounts.list()])
      .then(([nextSites, nextAccounts]) => {
        if (!cancelled) { setSites(testCapableSites(nextSites)); setAccounts(nextAccounts.filter(a => a.platform === 'newapi')); }
      })
      .catch(error => { if (!cancelled) setErrorMessage(getSafeErrorMessage(error)); });
    return () => { cancelled = true; };
  }, []);

  const visibleAccounts = useMemo(() => accountsForSite(accounts, siteId), [accounts, siteId]);
  const selectableModels = useMemo(() => availableModels(models), [models]);
  const selectedModel = selectableModels.find(model => model.modelName === modelId);
  const endpointIds = endpointsForModel(selectedModel);

  useEffect(() => {
    requestVersion.current += 1;
    setKeys([]); setModels([]); setTokenId(''); setModelId(''); setResult(null);
    if (!accountId) return;
    let cancelled = false;
    setIsBusy(true);
    Promise.all([window.apinest.keys.listByAccount(accountId), window.apinest.models.listByAccount(accountId)])
      .then(([nextKeys, nextModels]) => {
        if (!cancelled) { setKeys(nextKeys.filter(key => key.status === 1)); setModels(nextModels); }
      })
      .catch(error => { if (!cancelled) setErrorMessage(getSafeErrorMessage(error)); })
      .finally(() => { if (!cancelled) setIsBusy(false); });
    return () => { cancelled = true; };
  }, [accountId]);

  useEffect(() => {
    if (!endpointIds.includes(endpoint)) setEndpoint(endpointIds[0] ?? 'openai_chat_completions');
    setResult(null);
  }, [modelId]);

  const runTest = async (): Promise<void> => {
    if (!accountId || !tokenId || !modelId) return;
    let customHeaders: Record<string, string> | undefined;
    try {
      if (headersJson.trim()) {
        const parsed = JSON.parse(headersJson) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) {
          throw new Error('自定义请求头必须是值均为字符串的 JSON 对象。');
        }
        customHeaders = parsed as Record<string, string>;
      }
    } catch (error) { setErrorMessage(getSafeErrorMessage(error)); return; }

    const version = ++requestVersion.current;
    try {
      setIsBusy(true); setErrorMessage(null); setResult(null);
      const nextResult = await window.apinest.apiTest.runText({
        accountId, tokenId: Number(tokenId), modelId, category: 'text', endpoint,
        message, ...(headersJson.trim() ? { customHeaders } : {}),
        ...(bodyJson.trim() ? { customBodyJson: bodyJson } : {}),
      });
      if (requestVersion.current === version) setResult(nextResult);
    } catch (error) {
      if (requestVersion.current === version) setErrorMessage(getSafeErrorMessage(error));
    } finally { if (requestVersion.current === version) setIsBusy(false); }
  };

  return (
    <section className="content-page api-test-page">
      <div className="content-header"><p className="eyebrow">API 测试</p><h2>文本请求</h2></div>
      <div className="api-test-selection-grid">
        <label>站点<select value={siteId} disabled={isBusy} onChange={e => { setSiteId(e.target.value); setAccountId(''); setResult(null); }}><option value="">选择站点</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>账号<select value={accountId} disabled={!siteId || isBusy} onChange={e => setAccountId(e.target.value)}><option value="">选择账号</option>{visibleAccounts.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select></label>
        <label>API Key<select value={tokenId} disabled={!accountId || isBusy} onChange={e => { setTokenId(e.target.value); setResult(null); }}><option value="">选择 Key</option>{keys.map(k => <option key={k.id} value={k.id}>{k.name || `#${k.id}`} · {k.maskedKey}</option>)}</select></label>
        <label>模型<select value={modelId} disabled={!accountId || isBusy} onChange={e => setModelId(e.target.value)}><option value="">选择可用模型</option>{selectableModels.map(m => <option key={m.modelName} value={m.modelName}>{m.modelName}</option>)}</select></label>
        <label>调用分类<select value="text" disabled><option value="text">文本</option></select></label>
        <label>端点<select value={endpoint} disabled={!modelId || isBusy} onChange={e => { setEndpoint(e.target.value as TextApiEndpoint); setResult(null); }}>{TEXT_ENDPOINTS.filter(item => endpointIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>

      <div className="api-test-editor-grid">
        <label className="api-test-field">测试消息<textarea value={message} maxLength={100000} onChange={e => setMessage(e.target.value)} placeholder="自定义 Body 为空时用于生成内置请求体" /></label>
        <label className="api-test-field">自定义请求头（JSON，可选）<textarea className="api-test-json-editor" value={headersJson} onChange={e => setHeadersJson(e.target.value)} placeholder={'{"x-custom-header":"value"}'} /></label>
        <label className="api-test-field api-test-body-field">自定义请求体（JSON object，可选；填写后完整替换内置正文）<textarea className="api-test-json-editor" value={bodyJson} onChange={e => setBodyJson(e.target.value)} placeholder="留空时使用端点内置参数" /></label>
      </div>
      <div className="api-test-actions"><button type="button" className="primary-button" disabled={isBusy || !accountId || !tokenId || !modelId} onClick={() => void runTest()}>{isBusy ? '请求中…' : '发送请求'}</button><span className="hint">仅非流式文本请求；密钥明文只在主进程短暂使用。</span></div>
      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
      {result ? <div className="api-test-response"><div className="api-test-response-meta"><span className={result.ok ? 'api-test-ok' : 'api-test-failed'}>{result.status} {result.ok ? '成功' : '失败'}</span><span>{result.latencyMs}ms</span>{result.contentType ? <span>{result.contentType}</span> : null}{result.requestId ? <span>Request ID: {result.requestId}</span> : null}</div>{result.truncated ? <p className="api-test-truncated">响应超过安全上限，以下内容已截断。</p> : null}<pre className="api-test-response-body">{formatResponseBody(result.bodyText, result.contentType)}</pre></div> : <p className="empty-state">选择站点、账号、Key、模型和端点后发送测试请求。</p>}
    </section>
  );
}
