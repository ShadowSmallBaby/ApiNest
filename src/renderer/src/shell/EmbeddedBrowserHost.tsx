import { useEffect, useRef, useState } from 'react';
import type {
  EmbeddedPageLoadState,
  KnownPage,
  NavigationErrorView,
  ViewBounds,
} from '../../../shared/ipc/bridge';
import { boundsEqual, rectToBounds } from './content-bounds';

interface EmbeddedBrowserHostProps {
  accountId: string;
  page: KnownPage;
  title: string;
  onBack: () => void;
}

/**
 * 内嵌浏览宿主（R11）。
 *
 * 全局单例：右侧内容区在打开站点页面时整块切换为本宿主。
 * 顶部工具栏是 renderer DOM，位于原生视图 bounds 之外，始终可见可点；
 * 下方 viewport 占位由主进程的 WebContentsView 精确填充。
 *
 * 生命周期：
 *  - 挂载：先按 viewport 实时几何上报 bounds（更新主进程定位基准），再打开内嵌视图；
 *  - 跟随：ResizeObserver + window resize 持续上报 bounds，随窗口缩放贴合；
 *  - 卸载：closeEmbedded 通知主进程销毁 WebContents，避免泄漏（返回或切换导航都会触发）。
 *
 * 加载反馈：
 *  - loading：主进程隐藏原生视图，本宿主显示转圈；
 *  - ready：原生视图显现，覆盖层消失；
 *  - error：保持原生视图隐藏，展示错误码与排查提示（如 Secure DNS + TUN）。
 */
export function EmbeddedBrowserHost({
  accountId,
  page,
  title,
  onBack,
}: EmbeddedBrowserHostProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // 打开即视为加载中，避免 openInApp 返回前与主进程事件到达之间的空白窗口。
  const [loadState, setLoadState] = useState<EmbeddedPageLoadState>({ status: 'loading' });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    let disposed = false;
    let lastReported: ViewBounds | null = null;
    setLoadState({ status: 'loading' });

    const unsubscribeLoadState = window.apinest.pages.onLoadStateChange(next => {
      if (!disposed) {
        setLoadState(next);
      }
    });

    const report = (): void => {
      const bounds = rectToBounds(element.getBoundingClientRect());
      if (boundsEqual(bounds, lastReported)) {
        return;
      }
      lastReported = bounds;
      void window.apinest.pages.reportContentBounds(bounds);
    };

    // 先按 viewport 实时几何上报 bounds，再打开内嵌视图，
    // 确保挂载时主进程使用的是当前 viewport 精确几何，而非缓存或默认值。
    const start = async (): Promise<void> => {
      const bounds = rectToBounds(element.getBoundingClientRect());
      lastReported = bounds;
      await window.apinest.pages.reportContentBounds(bounds);
      if (!disposed) {
        try {
          await window.apinest.pages.openInApp(accountId, page);
        } catch (error) {
          if (!disposed) {
            setLoadState({
              status: 'error',
              error: {
                code: -1,
                description: 'OPEN_FAILED',
                url: '',
                title: '无法打开页面',
                message: error instanceof Error ? error.message : '打开内嵌页面失败。',
                tips: ['返回后重试。', '确认账户与站点配置有效。'],
              },
            });
          }
        }
      }
    };

    void start();

    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);

    return () => {
      disposed = true;
      unsubscribeLoadState();
      observer.disconnect();
      window.removeEventListener('resize', report);
      // 卸载即销毁内嵌视图（单例生命周期，防止泄漏）。
      void window.apinest.pages.closeEmbedded();
    };
  }, [accountId, page]);

  const loading = loadState.status === 'loading';
  const error = loadState.status === 'error' ? loadState.error : null;

  return (
    <section className="embedded-host">
      <div className="embedded-host-bar">
        <button type="button" className="secondary-button" onClick={onBack}>
          ← 返回
        </button>
        <span className="embedded-host-title">{title}</span>
        {loading ? (
          <span className="embedded-host-status" aria-live="polite">
            <span className="embedded-spinner" aria-hidden="true" />
            加载中…
          </span>
        ) : null}
        {error ? (
          <span className="embedded-host-status embedded-host-status--error" aria-live="assertive">
            加载失败
          </span>
        ) : null}
      </div>
      <div className="embedded-host-viewport" ref={viewportRef}>
        {loading ? (
          <div className="embedded-loading-overlay" aria-busy="true">
            <span className="embedded-spinner embedded-spinner--lg" aria-hidden="true" />
            <p>正在打开站点页面…</p>
            <p className="hint">代理或慢网下可能需要几秒，请稍候</p>
          </div>
        ) : null}
        {error ? <EmbeddedErrorPanel error={error} onBack={onBack} /> : null}
      </div>
    </section>
  );
}

function EmbeddedErrorPanel({
  error,
  onBack,
}: {
  error: NavigationErrorView;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="embedded-error-overlay" role="alert">
      <div className="embedded-error-card">
        <span className="embedded-error-badge">加载失败</span>
        <h2>{error.title}</h2>
        <p>{error.message}</p>
        <p className="embedded-error-meta">
          <code>{error.description}</code>
          <span>·</span>
          <code>{error.code}</code>
        </p>
        {error.url ? <p className="embedded-error-url">{error.url}</p> : null}
        <ol className="embedded-error-tips">
          {error.tips.map(tip => (
            <li key={tip}>{tip}</li>
          ))}
        </ol>
        <div className="embedded-error-actions">
          <button type="button" className="secondary-button" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
