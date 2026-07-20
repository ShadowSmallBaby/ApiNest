import type { EmbeddedRequest } from '../../shell/AppShell';
import { SitesPage } from '../sites/SitesPage';

interface AccountsPageProps {
  onOpenEmbedded: (request: EmbeddedRequest) => void;
}

/** @deprecated 站点管理已迁移到 SitesPage；保留导出用于旧引用平滑过渡。 */
export function AccountsPage(props: AccountsPageProps): React.JSX.Element {
  return <SitesPage {...props} />;
}
