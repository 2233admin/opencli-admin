# GOAL-2 — opencli-admin Phase 2/3: AuthManager + session affinity 泛化

> `/loop` 自驱（接 strangler-fig GOAL 完成 `09e4860` 后的新里程碑）。同纪律：
> 每轮读本文件 → 下个未完 PR → 端到端做+测绿 → 自检 staged → auto-commit → 勾掉。
> 命中真分叉 → 停问，别 big-bang。
> 用户 2026-07-01 授权**每 PR 绿即 auto-commit**（仅限此 goal，显式 add 路径，push 等用户）。

## 坐标
- repo `D:\projects\opencli-admin` 分支 `refactor/thin-channel-thick-runner`（接 `09e4860`）
- 测试闸 `uv run pytest tests/unit --no-cov -q`（基线 **379**）；PowerShell 跑
- ⚠️ 永不 stage：`backend/api/v1/chat.py`、`PR-DESCRIPTION.md`、`HANDOFF-strangler-fig.md`、`GOAL.md`、`GOAL-2.md`

## Track 1 — session affinity 泛化（Phase 3，低风险）
- [x] **PR-A** — pipeline 绑定 gate 改读 `capabilities.session_affinity`；opencli+skill 声明 `Capabilities(session_affinity=True)`（`073d391`，382 passed，行为零变）。
- [x] **PR-B** `6e08d41`（404 passed）— 按域名并发上限 = **task 层进程内**（option ②，用户拍板）：`domain_limiter.domain_of(source)` 取 host + `domain_slot()` per-domain semaphore(`PER_DOMAIN_CONCURRENCY` 默认 3，registry 按 `(loop,domain)` 键)，runner Phase3 外套。全渠道覆盖（含 opencli/skill）。跨 worker 严格限 = 换 Redis（同插入点，缓）。

> ✅ **GOAL-2 完成**（2026-07-01）：Track-1(PR-A+PR-B) + Track-2(PR-C) 全落，379→**404 passed**，零回归，**已 push fork**（`09e4860..6e08d41`）。

## Track 2 — AuthManager + 加密凭据（Phase 2）✅ **DONE**
- [x] **PR-C** `d4aa324`（397 passed）— Fernet 加密凭据存储(`source_credentials` 表 + migration `q7l8m9n0o1p2`) + `AuthManager`(store/resolve/`resolve_context→AuthContext`) + channel_runner 注入 AuthContext(替占位) + api_channel 内联明文 **deprecation warning**。`cryptography` 提为直接依赖。已选方案=Fernet + env `CREDENTIAL_ENCRYPTION_KEY` + 表；接线深度到 AuthManager（未强迁 api_channel→`fetch()`=follow-up）。
  <details>原决策记录（已决议）：
  1. 加密方案：Fernet/AES（`cryptography` 依赖在否待查）
  2. master key 来源：env var
  3. 存储：新 `source_credentials` 表 / `DataSource` 字段
  4. 迁移现有内联 secret
  5. 接线深度：api_channel 还没上 `fetch()`，`AuthContext` 走 runner 注入需 api_channel 迁厚契约（run_channel 已建 `AuthContext(kind=cap.auth_kind)` 占位）

## 每 PR 验收 / 停止条件 / 提交策略 = 同 `GOAL.md`
行为零变（旧路径）、全 tests/unit 绿、显式 stage、auto-commit、真分叉停。
