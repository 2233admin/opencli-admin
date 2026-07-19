# PLAN: 适配器生态 + 自愈 (调研综合, 2026-07-19)

两路调研 (采集生态参照 / 自愈) 综合。核心结论: **自愈的核心已存在**, 适配器生态的注册骨架也已有雏形 —— 缺的是补齐, 不是从零。

## 一、既有资产 (别重造)

### 两套自愈系统已在
1. **skill 层** (`backend/skills/`, agentic 通道): perception 每步现场重导元素 ref → **天然抗 selector 漂移** (无持久 selector 可烂); correction=re_distill (整体重生+版本化+回滚, ADR-0003); `maybe_propose_correction` 连续 3 次真失败 propose-only; 完整 API `/skills/{id}/redistill|dismiss|rollback`
2. **control-theory 层** (`backend/control/`, 19 文件, ADR-0004/5/7, **通道无关**): coverage 传感器诚实门 → recorder/aggregation (每 run 一 SourceMeasurement→Trend) → error_kinds (映射 error_taxonomy, 含 SCHEMA_DRIFT) → evaluator 状态机 → policies 反馈律 → gate 安全门 (默认 advisory) → actuator 3 白名单可逆动作 (increase_interval/pause/require_review) → outcomes 恢复率经验闭环 → cycle 独立 tick。**8 个 channel 统一走这套**

### 适配器注册雏形已在
- `browser_act_packs/{manifest.py,catalog.py}`: PackManifest (param_schema/pagination/success) + PackCatalog._scan() **扫描式声明目录** —— 已是声明式注册的工作原型, 只是圈在 browser_act 一个通道
- `channels/base.py`: AbstractChannel + Capabilities (incremental/paginated/auth_kind/...) 契约已好
- `auth/manager.py` + source_credential: 加密凭证存储已有 (缺的是声明式 auth_schema)

## 二、最高 ROI: schema-drift 传感器 (Gap 1)

control 层的 **SCHEMA_DRIFT 状态/policy/ledger/actuator 全建好在等, 但没有任何 channel 产生这个信号**。selector/schema 烂了今天是"更少/更空 items 无 error" → 假 HEALTHY (DEAD 要零接受+真 error; DEGRADED 要 error 率上升; 都不触发)。**80% 机器已有, 只缺传感器。**

- **Step A (传感器, 最省)**: 各内容通道 (web_scraper/crawl4ai CSS/api result_path/rss) 比对字段填充率 vs 滚动 baseline, 骤降 (>50% 相对, 或验证非空页面上归零) → `ChannelResult.fail(error_type="SchemaDriftError")`。下游**零改动** (error_taxonomy→error_kinds→evaluator→policies→actuator 全已处理)。几乎纯 channel 层追加
- **Step B (提议修复)**: 复制 skill re_distill 模式到 `DataSource.channel_config`: last_failing_sample 存失败页 → 复用 distill.call_llm 重生 selector/schema → **dry-run 验证匹配率恢复后才 surface** → 版本化 diff → 人审 apply (revision 乐观锁 ADR-0025)。cheap 前置: Healenium 式 LCS selector 相似度重匹配, 省 LLM 调用
- Gap 3 (auth): 401 → 强刷 cookie 重试一次再升级 pause (channel/http_client 层小改)
- Gap 5 (证据流): skill evidence + control ledger 两条, 缺统一 inbox (ADR-0024 已设计未实现) — 最小: skill correction_proposed 也发 require_review 进 control ledger

护栏 (repo 已有原则): LLM 产出是提议非权威 (ADR-0003 D7/D8 + ADR-0004 数据变更排除自动白名单); 验证先于 surface; 单一 kill_switch/control_mode 门; PIT 安全 (只改未来抓取, 历史 CollectedRecord 不可变)

## 三、适配器生态补全 (调研 A backlog, value/effort 排序)

1. **声明式 channel 注册** — 把 PackCatalog 的 manifest+scan 从 browser_act 推广成仓库级 channel 注册, 替 registry.py 硬编码 8 import (= PLAN_plugin_system.md「最小起步」, 消"改一次动三处")
2. **trigger_kind 字段 + polling-diff trigger** (changedetection.io 式快照 diff, 层叠现有 fetch) — "监测页面变化"最高频缺口
3. **inbound webhook trigger** (generic /webhooks/<id> → 起 run, Dify Trigger/n8n Webhook)
4. **声明式 auth_schema** (挂现有 AuthManager, n8n ICredentialType 式) — catalog 配置表单前提
5. cloud-storage/drive datasource; 6. TurboPush sink 泛化成 Extension 类; 7. 通知走 Apprise (照 EXTERNAL_WHEEL_AUDIT 先例); 8. schedule trigger 首类目录项; 9. DB/sheet source; 10. skill agent-strategy 泛化

## 四、分阶段

- **P1 (最高 ROI, 最省)**: schema-drift 传感器 Step A (点亮已建好的 control SCHEMA_DRIFT 全链) + 声明式 channel 注册 (生态骨架)
- **P2**: Step B 提议修复 (skill 模式复制到 channel_config) + polling-diff/webhook trigger + auth_schema
- **P3**: 统一 recovery inbox (ADR-0024 落地) + datasource 广度 + Extension/通知泛化

分类映射 Dify 六类型 (Model 除外): Tool/Datasource/Trigger/Extension/AgentStrategy, 对齐前端 node-catalog.ts 已有 category enum + epic #25 统一插件中心。

## 参照
Airbyte (schema-change 分级/connector catalog), changedetection.io (polling-diff), Dify (插件类型/Trigger/Marketplace), n8n (trigger vs credential), RSSHub (PR-式自描述路由=本仓 PackCatalog 已证), ScrapeGraphAI/Firecrawl (LLM 重生 extraction), Healenium (非 LLM selector 重匹配), Skyvern/browser-use (验证 skill perception 的无持久 selector 选择是业界共识)。
