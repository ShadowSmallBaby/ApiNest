import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';

/** slide-over 宽度分档。 */
export type SlideOverWidth = 'sm' | 'md' | 'lg';

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 标题下的次要说明(如站点 URL)。 */
  subtitle?: string;
  width?: SlideOverWidth;
  /** 底部操作区(通常是取消/提交按钮)。 */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 右侧滑入面板(Windows Fluent flyout 观感)。
 *
 * 基于 headlessui Dialog:自带焦点陷阱、ESC 关闭、点击面板外关闭、可访问性标注。
 * 进出场动画由 `transition` prop 配合 CSS 的 `[data-closed]` 完成(见 styles.css)。
 * 承载新增/编辑/详情/确认等一切次级交互——本应用不再使用中央弹出确认框。
 */
export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  footer,
  children,
}: SlideOverProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop transition className="slideover-backdrop" />
      <div className="slideover-viewport">
        <DialogPanel transition className={`slideover-panel slideover-${width}`}>
          <div className="slideover-header">
            <div>
              <DialogTitle className="slideover-title">{title}</DialogTitle>
              {subtitle ? <p className="slideover-subtitle">{subtitle}</p> : null}
            </div>
            <button type="button" className="slideover-close" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
          <div className="slideover-body">{children}</div>
          {footer ? <div className="slideover-footer">{footer}</div> : null}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

interface ConfirmSlideOverProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** 主说明文本。 */
  message: React.ReactNode;
  /** 额外的强调/警示说明(可选)。 */
  detail?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作(删除等)用红色确认按钮 + 红色图标。 */
  danger?: boolean;
  tone?: 'danger' | 'warning' | 'accent';
  busy?: boolean;
}

const CONFIRM_ICON: Record<'danger' | 'warning' | 'accent', string> = {
  danger: '⚠',
  warning: '⚠',
  accent: '?',
};

/**
 * 确认交互——同样在右侧侧边栏内完成(不使用 window.confirm 或中央对话框)。
 */
export function ConfirmSlideOver({
  open,
  onClose,
  onConfirm,
  title,
  message,
  detail,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  tone,
  busy = false,
}: ConfirmSlideOverProps): React.JSX.Element {
  const iconTone = tone ?? (danger ? 'danger' : 'accent');
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'danger-button' : undefined}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        <div className={`confirm-icon ${iconTone}`} aria-hidden>
          {CONFIRM_ICON[iconTone]}
        </div>
        <p>{message}</p>
        {detail ? <p className="warning-text">{detail}</p> : null}
      </div>
    </SlideOver>
  );
}
