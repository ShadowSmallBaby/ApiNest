import type { NavKey } from '../shell/navigation';

/** Fluent 线性风格导航图标(24 视框,currentColor 描边)。 */
const NAV_PATHS: Record<NavKey, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  sites: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
    </>
  ),
  keys: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M21 12v2.5" />
    </>
  ),
  models: (
    <>
      <path d="M12 3 21 8v8l-9 5-9-5V8z" />
      <path d="M12 12v9M12 12 3 8M12 12l9-4" />
    </>
  ),
  logs: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  test: <path d="M9 3h6M10 3v5.5L5 16.5A2 2 0 0 0 7 20h10a2 2 0 0 0 2-3.5L14 8.5V3M8 14h8" />,
  oauth: (
    <>
      <path d="M12 3 4 6v6c0 5 3.5 7.6 8 9 4.5-1.4 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavKey }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {NAV_PATHS[name]}
    </svg>
  );
}

export function LockIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
