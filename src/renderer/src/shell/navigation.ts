export type NavKey =
  | 'dashboard'
  | 'sites'
  | 'keys'
  | 'models'
  | 'logs'
  | 'test'
  | 'oauth'
  | 'settings';

export interface NavItem {
  key: NavKey;
  label: string;
  /** 一期已实现真实能力；false 表示仅占位，点击进入「即将推出」页。 */
  implemented: boolean;
}

/**
 * 左侧导航项。全部显示，未实现能力进入占位页而非隐藏，
 * 使信息架构完整但不伪造尚不可用的功能。
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '仪表盘', implemented: true },
  { key: 'sites', label: '站点', implemented: true },
  { key: 'keys', label: '密钥', implemented: true },
  { key: 'models', label: '模型', implemented: true },
  { key: 'logs', label: '日志', implemented: true },
  { key: 'test', label: '测试', implemented: true },
  { key: 'oauth', label: 'OAuth', implemented: true },
  { key: 'settings', label: '系统设置', implemented: true },
];
