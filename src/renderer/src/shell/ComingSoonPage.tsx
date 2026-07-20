interface ComingSoonPageProps {
  title: string;
}

/**
 * 未实现能力的占位页。明确标注「即将推出」，不伪造任何数据或可点击操作，
 * 与「适配器不支持能力时不得伪造成功」保持一致。
 */
export function ComingSoonPage({ title }: ComingSoonPageProps): React.JSX.Element {
  return (
    <section className="content-page coming-soon">
      <div className="content-header">
        <p className="eyebrow">即将推出</p>
        <h2>{title}</h2>
      </div>
      <p className="empty-state">
        该功能尚未在当前版本实现。浮浮酱会在后续版本接入真实能力后启用此页面喵～
      </p>
    </section>
  );
}
