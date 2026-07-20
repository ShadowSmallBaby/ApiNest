import { useEffect, useState } from 'react';

/**
 * 无边框外壳的自绘标题栏（R12）。
 *
 * 中部为可拖拽区（-webkit-app-region: drag），品牌与窗口控件标注 no-drag。
 * 窗口控制只经受限 window 桥接触发，Renderer 不持有通用窗口/系统能力。
 */
export function TitleBar(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;

    window.apinest.window
      .isMaximized()
      .then(value => {
        if (active) {
          setIsMaximized(value);
        }
      })
      .catch(() => {
        /* 查询失败不影响标题栏渲染，保持默认还原态图标。 */
      });

    const unsubscribe = window.apinest.window.onMaximizeChange(value => {
      setIsMaximized(value);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleToggleMaximize = (): void => {
    window.apinest.window
      .toggleMaximize()
      .then(setIsMaximized)
      .catch(() => {
        /* 忽略：状态最终由 onMaximizeChange 事件校正。 */
      });
  };

  return (
    <header className="app-titlebar">
      <div className="app-titlebar-brand">
        <span className="app-titlebar-mark">ApiNest</span>
      </div>
      <div className="app-titlebar-drag" />
      <div className="app-titlebar-controls">
        <button
          type="button"
          className="titlebar-button"
          aria-label="最小化"
          onClick={() => void window.apinest.window.minimize()}
        >
          <span aria-hidden>─</span>
        </button>
        <button
          type="button"
          className="titlebar-button"
          aria-label={isMaximized ? '还原' : '最大化'}
          onClick={handleToggleMaximize}
        >
          <span aria-hidden>{isMaximized ? '❐' : '☐'}</span>
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-close"
          aria-label="关闭"
          onClick={() => void window.apinest.window.close()}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
    </header>
  );
}
