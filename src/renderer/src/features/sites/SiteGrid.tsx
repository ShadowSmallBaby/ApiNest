import type { AccountRecord, SiteRecord, SiteSummary } from '../../../../shared/ipc/bridge';
import { SiteCard } from './SiteCard';

interface SiteGridProps {
  sites: SiteRecord[];
  accounts: AccountRecord[];
  /** 站点广场聚合数据（余额合计 / 今日签到），按 siteId 索引。 */
  summaries: Map<string, SiteSummary>;
  isBusy: boolean;
  onOpen: (site: SiteRecord) => void;
  onEdit: (site: SiteRecord) => void;
  onSync: (site: SiteRecord) => void;
  onCheckIn: (site: SiteRecord) => void;
  onDelete: (site: SiteRecord) => void;
  onOpenWebsite: (site: SiteRecord) => void;
}

export function SiteGrid(props: SiteGridProps): React.JSX.Element {
  if (props.sites.length === 0) {
    return <p className="empty-state">还没有站点，点击“新增站点”创建并添加首个账号。</p>;
  }
  return (
    <div className="site-grid">
      {props.sites.map(site => (
        <SiteCard
          key={site.id}
          site={site}
          accounts={props.accounts}
          summary={props.summaries.get(site.id)}
          isBusy={props.isBusy}
          onOpen={() => props.onOpen(site)}
          onEdit={() => props.onEdit(site)}
          onSync={() => props.onSync(site)}
          onCheckIn={() => props.onCheckIn(site)}
          onDelete={() => props.onDelete(site)}
          onOpenWebsite={() => props.onOpenWebsite(site)}
        />
      ))}
    </div>
  );
}
