# 大规模“成果与数据”双链图谱：Sigma.js/Graphology 与 Cytoscape.js 选型

> 研究范围：为 OpenCLI Admin 的项目级成果与数据页面选择一个接近 Obsidian Graph View 的图谱实现。底层项目可能包含 1 万到 10 万条采集记录，但页面的目标是“可理解的项目预览与按需探索”，不是把数据库中的所有记录一次性画成毛线团。
>
> 资料日期：2026-07-18。只采用官方文档、官方 GitHub 仓库和官方示例。GitHub 链接尽量固定到本次检索的 commit。

## 结论

推荐采用 **Sigma.js 3.x + Graphology + `@react-sigma/core` 5.x**，以 Sigma 官方 React Demo 为界面和交互基线；不要采用 Sigma v4 alpha，也不要把 10 万条记录全部送到浏览器。

选择 Sigma 的原因：

1. Sigma 的产品边界就是“用 WebGL 在浏览器中展示数千节点和边”，Graphology 是它的官方数据后端；稳定仓库当前包版本为 3.0.3，MIT 许可。[Sigma README](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/README.md) [Sigma package.json](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/sigma/package.json)
2. 官方仓库自带完整 React 应用，不只是一个空白画布。它已经实现了聚类/标签筛选、搜索定位、节点点击与悬停、邻居高亮、缩放和全屏控制，适合作为本项目的改造模板。[React Demo 入口](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo/src/views/Root.tsx) [事件控制器](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo/src/views/GraphEventsController.tsx) [邻居高亮](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo/src/views/GraphSettingsController.tsx)
3. 官方大图示例使用 WebGL renderer、CirclePack 初始布局、ForceAtlas2 Web Worker，并可切换更便宜的边渲染器，和本项目需要的“聚合预览 + 局部展开”高度匹配。[Large graphs 示例](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/storybook/stories/2-advanced-usecases/large-graphs/index.ts)
4. Graphology 支持序列化导入/导出以及节点、边增删事件；Sigma 监听这些事件并自动重新处理/渲染，适合把服务器返回的局部图分片合并到当前图中。[Graphology serialization](https://graphology.github.io/serialization.html) [Graphology events](https://graphology.github.io/events.html) [Sigma lifecycle](https://www.sigmajs.org/docs/advanced/lifecycle/)

Cytoscape.js 是更强的“客户端图论工作台”，但本项目当前需要的是快速、清晰的大图预览，不是复杂的客户端图算法、compound nodes 或富边样式。它可以保留为以后“可视化建模/图编辑器”场景的候选。

## 不能把“10 万条记录”理解成“10 万个同时可见节点”

两个官方项目都没有承诺在普通浏览器中把 10 万节点及其全部边作为一个持续交互的力导向图稳定展示。

- Sigma 官方稳定文档的措辞是“thousands of nodes and edges”；官方稳定大图 Story 默认 5,000 个节点，v4 网站展示的是 9,000 篇论文网络。[Sigma 文档](https://www.sigmajs.org/docs/) [Sigma large-graphs 示例](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/storybook/stories/2-advanced-usecases/large-graphs/stories.ts) [Sigma v4 demo](https://v4.sigmajs.org/)
- Cytoscape 官方 WebGL 预览测试中，约 1,200 节点/16,000 边可从约 20 FPS 提升到 100 FPS 以上；约 3,200 节点/68,000 边从约 3 FPS 提升到约 10 FPS。官方也明确指出结果受样式、硬件和浏览器影响。[Cytoscape WebGL Renderer Preview](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)
- Cytoscape 的性能指南明确说明性能会随元素数量下降，边尤其昂贵，并建议减少复杂样式、compound nodes、像素比及交互期间的边绘制。[Cytoscape performance](https://js.cytoscape.org/#performance)

因此，“支持 10 万条记录”的正确含义应是：

- 服务器可以索引、聚合和检索 10 万条及更多记录；
- 浏览器先显示一个有上限的项目级多分辨率预览；
- 用户点击项目分组、聚类或某条记录时，再加载它的局部邻居；
- 页面任何时刻只保留当前探索所需的可见子图。

WebGL 只解决绘制吞吐，并不自动解决 JSON 传输、内存、图布局、搜索、去重和“毛线团没有语义”这些问题。

## 对比

| 维度 | Sigma.js + Graphology | Cytoscape.js |
| --- | --- | --- |
| 主要定位 | WebGL 图谱渲染器 + 独立图数据模型 | 图论模型、查询、算法、布局和渲染的一体化库 |
| 默认渲染路径 | 节点和边用 WebGL；标签等分层处理。[Renderers](https://www.sigmajs.org/docs/advanced/renderers/) [Layers](https://www.sigmajs.org/docs/advanced/layers/) | 默认 Canvas；3.31 起提供 WebGL 加速模式，仍复用 Canvas 的样式、事件和部分层。[WebGL 预览](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/) |
| 大图证据 | 官方 large-graphs Story 可调节点/边数量，提供快速边 renderer 和 FA2 worker。[示例源码](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/storybook/stories/2-advanced-usecases/large-graphs/index.ts) | 官方有 6,000 elements、performance tuning、GPU 三套示例。[6,000 elements](https://github.com/cytoscape/cytoscape.js/tree/c656009bdea1cc84504faf4e6b12033635a07559/documentation/demos/6000-elements) [performance tuning](https://github.com/cytoscape/cytoscape.js/tree/c656009bdea1cc84504faf4e6b12033635a07559/documentation/demos/performance-tuning) [GPU](https://github.com/cytoscape/cytoscape.js/tree/c656009bdea1cc84504faf4e6b12033635a07559/documentation/demos/gpu) |
| React 模板 | Sigma 官方仓库的完整 demo 本身就是 React，并使用 `@react-sigma/core`。[Demo README](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo/README.md) | 官方核心仓库以原生 JS 初始化示例为主；React 中可在 effect 内创建/销毁实例，但官方核心没有等价的完整 React 模板。 |
| 增量更新 | Graphology 事件会触发 Sigma 更新；`refresh` 还支持只重处理指定 nodes/edges。[Lifecycle](https://www.sigmajs.org/docs/advanced/lifecycle/) [Sigma API](https://www.sigmajs.org/docs/typedoc/sigma/src/classes/Sigma/#refresh) | `cy.add()` 支持加元素，`cy.batch()` 可把大量状态变更压缩到一次样式计算和最多一次重绘。[Graph manipulation](https://js.cytoscape.org/#core/graph-manipulation) |
| 交互/样式 | 简单、性能优先；reducers 很适合焦点、淡化、选中邻居 | 样式、selector、compound node、客户端图算法更丰富 |
| 当前风险 | 需要自己定义服务端聚合和项目图 API；复杂节点外观要写 WebGL program | WebGL 模式曾以 preview/provisional API 发布；富样式和大量边仍有明显代价，初次纹理构建也需要时间 |
| 对本项目适配 | **高**：消息/记录双链、项目聚类、局部探索 | 中：如果未来要做复杂图编辑和客户端分析再考虑 |

## 可直接复用的官方模板

### Sigma 主模板：`packages/demo`

建议以 Sigma 官方 [`packages/demo`](https://github.com/jacomyal/sigma.js/tree/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo) 的结构为基线，而不是复制视觉样式：

- `Root.tsx`：稳定创建一个 Graphology graph，用 `SigmaContainer` 管理 Sigma 生命周期；
- `GraphDataController.tsx`：控制可见性和分组过滤；
- `GraphEventsController.tsx`：点击、hover、stage 事件；
- `GraphSettingsController.tsx`：用 `nodeReducer`/`edgeReducer` 做 Obsidian 式邻居高亮和其余节点淡化；
- `SearchField.tsx`：相机飞到搜索结果；
- `ClustersPanel.tsx` / `TagsPanel.tsx`：项目内分组与关系类型过滤。

注意：官方 Demo 的搜索会遍历当前 graph 的全部节点。[SearchField](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo/src/views/SearchField.tsx) 在本项目只能用于已加载的可见子图；10 万记录的全量搜索必须走后端 autocomplete/search API。

### Sigma 性能模板：`large-graphs`

官方 [`large-graphs`](https://github.com/jacomyal/sigma.js/tree/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/storybook/stories/2-advanced-usecases/large-graphs) 示例值得直接提取以下做法：

- 先用 CirclePack 让 cluster 拥有稳定起始区域；
- 可选在 Worker 中运行 ForceAtlas2；
- 使用 Graphology 的 `inferSettings()`；
- 边密度高时切到更便宜的 `EdgeLineProgram`；
- unmount 时同时 `kill()` layout worker 和 renderer。

### Cytoscape 备选模板

如果之后的需求转向“复杂边样式、compound nodes、客户端查询/算法”，可从以下官方模板开始：

- [`6000-elements`](https://github.com/cytoscape/cytoscape.js/tree/c656009bdea1cc84504faf4e6b12033635a07559/documentation/demos/6000-elements)：预计算位置 + 简单样式；
- [`performance-tuning`](https://github.com/cytoscape/cytoscape.js/tree/c656009bdea1cc84504faf4e6b12033635a07559/documentation/demos/performance-tuning)：haystack 边、低像素比、交互期隐藏边；
- [`gpu`](https://github.com/cytoscape/cytoscape.js/tree/c656009bdea1cc84504faf4e6b12033635a07559/documentation/demos/gpu)：WebGL 模式。

## 建议的数据和交互架构

### 1. 项目是一级作用域

页面进入时必须先确定一个 `project_id`，请求只针对这个项目。不要默认把所有项目、所有记录拼成一个全局图。

建议初始接口：

```text
GET /api/projects/{project_id}/record-graph/preview
  ?group_by=source,workflow,time_bucket,entity
  &max_nodes=2000
  &max_edges=8000
```

响应必须包含：

```ts
type GraphPreview = {
  scope: { projectId: string; version: string };
  totals: { records: number; rawEdges: number };
  projection: {
    nodesReturned: number;
    edgesReturned: number;
    aggregated: boolean;
    truncated: boolean;
  };
  nodes: Array<{
    id: string;
    kind: "project" | "source" | "workflow" | "time" | "entity" | "record";
    label: string;
    count: number;
    x: number;
    y: number;
    expandable: boolean;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    kind: string;
    weight: number;
  }>;
};
```

### 2. 使用三层分辨率，而不是一个全量图

| 层级 | 用途 | 建议可见规模 |
| --- | --- | --- |
| L0 项目预览 | 项目 → 数据源/工作流/时间桶/核心实体，显示数量和聚类 | 50–500 nodes |
| L1 聚类展开 | 点击一个来源、工作流、时间桶或实体，显示代表记录和子聚类 | 500–2,000 nodes |
| L2 单条记录局部图 | 当前记录的入链、出链和一至二跳邻居 | 100–1,000 nodes |

Obsidian 本身也把“全局图”和“当前笔记的 Local Graph”分开，Local Graph 通过 depth 控制逐层邻居，这是比全量铺开更可用的交互模型。[Obsidian Graph view](https://obsidian.md/help/Plugins/Graph%2Bview)

建议局部接口：

```text
GET /api/projects/{project_id}/record-graph/neighborhood
  ?node_id={node_id}
  &direction=both
  &depth=1
  &limit=500
  &cursor={cursor}

GET /api/projects/{project_id}/record-graph/clusters/{cluster_id}
  ?limit=500
  &cursor={cursor}
```

展开结果通过 Graphology 的 merge/import 或 addNode/addEdge 合并；关闭聚类时从当前可见 graph 移除该分片，不在前端长期缓存 10 万节点。

### 3. 聚合策略

初始预览可同时使用四种可解释聚合：

1. `source_id` / 数据源；
2. `workflow_id` 或采集任务；
3. 日/周/月时间桶；
4. 已抽取实体、标签、域名或显式链接目标。

节点大小使用 `log1p(count)` 或 `sqrt(degree)`，边宽使用 `log1p(weight)`，避免极大 hub 把其余节点压扁。只给项目节点、选中节点、高权重聚类和 hover 节点显示标签；这与 Sigma 官方 Demo 的 `labelDensity`、`labelRenderedSizeThreshold` 和 hover reducer 做法一致。[Demo settings](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/demo/src/views/Root.tsx)

### 4. 布局策略

- L0/L1 的坐标应在后端或后台任务中按 `project_id + graph_version` 预计算并持久化，前端首屏直接用 `x/y`，避免每次打开都重跑力导向。
- 对一次展开新增的少量节点，以父聚类坐标为中心加小范围确定性扰动。
- ForceAtlas2 只对当前可见子图短时运行，必须在 Web Worker；Graphology 的实现支持 worker，Barnes-Hut 可把斥力计算从 `O(n²)` 近似到 `O(n log n)`。[Graphology ForceAtlas2](https://graphology.github.io/standard-library/layout-forceatlas2.html)
- 不要对全量 10 万节点持续动画。布局计算、渲染和数据规模是三个不同瓶颈。

### 5. Next.js/React 接入

推荐实现为一个真正的 client-only 图谱岛：

```tsx
"use client";

import dynamic from "next/dynamic";

const RecordGraphCanvas = dynamic(
  () => import("./record-graph-canvas"),
  { ssr: false },
);
```

React Sigma 官方 FAQ 明确说明 Next.js 只能客户端渲染，并建议动态导入；Next.js 官方也建议对依赖 `window`/`document` 的第三方库使用 Client Component 和 `next/dynamic(..., { ssr: false })`。[React Sigma FAQ](https://sim51.github.io/react-sigma/docs/faq/#is-it-possible-to-use-this-project-with-nextjs) [Next.js client-only guidance](https://nextjs.org/docs/app/guides/single-page-applications#rendering-components-only-in-the-browser)

Graph 实例与 Sigma settings 必须使用模块常量或 `useMemo` 保持引用稳定。React Sigma 文档明确提醒，更新 `SigmaContainer` 的 `graph` 或 `settings` props 会销毁并重建 Sigma，重图下会产生明显性能问题。[React Sigma introduction](https://sim51.github.io/react-sigma/docs/start-introduction/)

### 6. 资源和生命周期

- 项目切换：杀掉旧 renderer/layout worker，清空旧图，再加载新项目 L0；
- 局部展开：分页合并，批量修改，避免逐条触发大量重处理；
- 筛选：只操作当前可见子图；
- 页面离开：调用 Sigma `kill()`、FA2 worker `kill()`，中止未完成 fetch；
- 图版本变化：保留相机位置的前提下重载对应 project graph version。

Sigma 官方 lifecycle 文档说明 `kill()` 会释放绑定和资源；官方 large-graphs 示例也在 cleanup 中同时终止 worker 和 renderer。[Sigma lifecycle](https://www.sigmajs.org/docs/advanced/lifecycle/) [large-graphs cleanup](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/packages/storybook/stories/2-advanced-usecases/large-graphs/index.ts)

## 建议依赖

稳定方案：

```text
sigma@3
graphology@0.25
@react-sigma/core@5
graphology-layout@0.6
graphology-layout-forceatlas2@0.10
```

首版可以只装前三个，使用后端预计算坐标；需要客户端短时布局时再增加后两个。不要选用 Sigma v4 alpha 作为 MVP 基线；稳定文档已经明确提示 v4 仍是 alpha。[Sigma stable docs](https://www.sigmajs.org/docs/)

## MVP 验收建议

1. 项目选择器切换后，只请求当前项目的 graph preview。
2. 用 10 万条模拟底层记录生成聚合结果，前端首屏仍不超过 `max_nodes/max_edges`。
3. 首屏能看到项目、来源/工作流/时间/实体聚类及各自数量。
4. Hover 只高亮当前节点的一跳邻居，其余节点淡化。
5. 点击聚类按 cursor 加载下一层，不整图刷新；点击记录打开详情与入链/出链面板。
6. 单条记录支持 `depth=1`，可手动展开到 `depth=2`。
7. 项目切换和页面离开后没有遗留 WebGL context、worker 或未完成请求。
8. Chrome 中分别记录 500、2,000、5,000 可见节点时的加载时间、交互 FPS、JS heap 和 GPU memory；达到阈值后自动降低标签密度或退回更高层聚合。

## 最终建议

采用 Sigma 官方 React Demo 的结构，保留它的图谱交互骨架，替换为本项目自己的“项目选择 → 聚合预览 → 局部展开 → 记录详情/双链”数据协议。

关键不是寻找一个能“硬画 10 万点”的模板，而是把产品做成和 Obsidian 一样的 **全局可概览、局部可深入**：项目级图谱用于发现结构，单条记录 Local Graph 用于理解连接，列表/搜索用于精确查找。Sigma.js/Graphology 更适合承担这个 WebGL 浏览层；10 万记录的聚合、检索和邻域裁剪必须由后端承担。
