import { segmentTypeHints, narrativeOrderHints } from '../lib/glossary'

// 给不懂编剧的用户的应用内指南:怎么读这份拉片笔记 + 术语速查
export function BeginnerGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="markdown-preview">
      <div className="markdown-preview-panel beginner-guide-panel">
        <div className="markdown-preview-header">
          <strong>新手怎么拉片</strong>
          <div>
            <button onClick={onClose}>关闭</button>
          </div>
        </div>

        <div className="beginner-guide-body">
          <h4>拉片是什么</h4>
          <p>
            把一部电影一段一段拆开，看它「为什么好看」：哪里抓住了你，是怎么做到的。
            不需要懂编剧，你已经会看电影，拉片只是把感受变成看得见的结构。
          </p>

          <h4>拿到 AI 结果后，按这个顺序读</h4>
          <ol>
            <li><strong>先看「结构段落带」</strong>（泳道图最上面一行）：全片分几大块，每块在干什么。这是电影的骨架。</li>
            <li><strong>再看「观众体验曲线」</strong>：峰是最抓人的地方，谷是低潮。找到峰对应的段落，问自己「它是怎么把我调动起来的」——这就是拉片最核心的一问。</li>
            <li><strong>挑 2 到 3 个你印象最深的段落</strong>，点开看 AI 的分析，再用「只导出本段给 AI」拆到镜头级。全片平均用力不如把最打动你的地方拆透。</li>
            <li><strong>把你自己的感受写进去</strong>：AI 写的只是底稿，你在段落里改写、补充的那些话，才是这次拉片真正的收获。</li>
          </ol>

          <h4>段落类型速查</h4>
          <dl className="glossary-list">
            {Object.entries(segmentTypeHints).map(([term, hint]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{hint}</dd>
              </div>
            ))}
          </dl>

          <h4>叙事顺序速查</h4>
          <dl className="glossary-list">
            {Object.entries(narrativeOrderHints).map(([term, hint]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
