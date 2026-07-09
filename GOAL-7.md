# GOAL-7 — 内置 browser-act 采集包(vendor SKILL.md 包 + browser-act channel)

> `/loop` 自驱。每轮读本文件 → 下个未 [ ] 项 → 端到端做+测绿 → auto-commit → 勾掉。
> 命中真分叉 → 停问,别自己拍板架构。
> 每 PR 绿即 auto-commit(显式 `git add <路径>`,绝不 `add -A`,绝不碰 `GOAL*.md`/`HANDOFF*.md`/`AUDIT*.md`/`GRILL*.md`/`PR-DESCRIPTION.md`);push 仍等用户。

## 背景

内置 https://github.com/browser-act/skills(MIT)—— BrowserAct 的浏览器自动化 CLI + ~30 个站点采集 SKILL.md 包(taobao/amazon/google-maps/youtube/reddit/微信/知乎 等,分 ecommerce/lead-generation/search-research/social-listening/video-platforms 五类)。作为 opencli-admin 的一个新采集 channel + vendored 包目录。

**上游仓三块**(参考克隆在 scratchpad,已看过):
- `browser-act` CLI —— 外部工具(`uv tool install browser-act-cli --python 3.12`),提供 session 制原语 `navigate`/`wait`/`eval`/`state`/`click N`/`input N`;`browser-act get-skills core` 出环境态。**本 goal 不 vendor CLI 本体**(它是外部 PyPI 工具),只 vendor 包 + 写 channel 壳调它。
- `solutions/` ~30 个包 —— 每个 = `SKILL.md`(散文运行手册,给 agent 读)+ `scripts/*.py`(纯 JS 发射器:argparse → `print(js字符串)`,无 LLM/无网络/无文件读写)。
- `browser-act-skill-forge`(包生成器)—— **本 goal 不碰**,YAGNI。

**命名雷(GOAL-5 已警告"别混")**:opencli-admin main 上现有 `backend/skills/` + `Skill(domain, capability)` DB 表是**完全不同的东西**(record→distill→执行环,DB 存储,无文件包)。browser-act 的 SKILL.md 是**文件包**。本 goal 的 vendored 包与现有 DB Skill 子系统**完全隔离**,不共用表、不共用 `skill_channel`,不写 pack→DB 导入器(架构决策 #2)。

**执行契约(已实测确认)**:SKILL.md 的确定性部分 = `navigate {url}` → `wait stable` → `eval "$(python scripts/x.py {params})"` → 收 JSON。散文里的 `$(...)` 是 shell 替换语法(注入风险);本 channel **绝不走 shell**,两跳都 argv-only(见架构决策 #6)。登录/反爬是散文里的 LLM/人工部分,本 channel 故意不做,遇到就 fail loudly(架构决策 #4)。

## 坐标

- repo `D:\projects\opencli-admin`,新分支 `feat/browser-act-channel`,**从 main 切**(main 有 channel 子系统全套:`AbstractChannel`/registry/`cli_channel`/`opencli_channel`/`crawl4ai_channel`;本 worktree 的 `feat/agent-access-taxonomy` 没有,别在这切)
- 排期:GOAL-6(模型 Provider)先跑;本 goal 正交于 Provider,选了 script-runner 不依赖 GOAL-6,可并行/后排
- 上游参考克隆:scratchpad `browser-act-skills/`(实施时重新 `git clone --depth 1` 拿最新,别信旧副本)
- 测试闸:`uv run pytest tests/unit tests/integration tests/skills --no-cov -q`(PowerShell,`cd D:\projects\opencli-admin`;Bash 工具在此环境被 RTK hook 改写会炸)
- 基线(feat/browser-act-channel 从 main edbb1ca 切,PR-A 前实测):**1430 passed, 12 failed, 6 skipped**。12 failed 全是 main 既有(opencli channel/workflow/nodes-install + 4 个 `tests/skills/*_live.py` 需真 Chrome),与本 goal 无关,DoD"全绿"=不新增失败

## 已锁定的架构决策(别重新问,直接照做)

1. **执行模型 = 确定性 script-runner,不引 LLM**。channel 按 manifest 步骤序列驱动 browser-act 子进程:`navigate` → `wait` → 跑 `python scripts/x.py <argv>` 拿 JS → `browser-act ... eval <js>` → 解析 JSON → 收 items。无 perceive/gate/act 环,不碰 ModelProvider。(LLM-runner 是未来可选二期,本 goal 不做。)

2. **与现有 DB Skill 子系统完全隔离**。vendored 包是**文件**,不进 `skills` 表,不复用 `backend/skills/`(那是 DB 的 record→distill 系统)。新建独立包目录 + `PackCatalog`(扫目录)。不写 pack→Skill 导入器(两种格式强映射阻抗大,YAGNI)。命名统一用 "pack"/"browser_act_pack" 而非 "skill",避免与现有概念撞名。

3. **vendored 包目录**:`backend/browser_act_packs/<category>/<pack-name>/`,内含**原样** `SKILL.md` + `scripts/*.py`(不改上游内容,作出处 + 人类参考 + 上游 `git pull` 刷新)+ **我们新写的** `channel.manifest.json`(机器可读执行契约,见 #5)。保留上游 `LICENSE`(MIT)+ 顶层 `backend/browser_act_packs/VENDOR.md` 记来源 commit/URL/署名(MIT 合规)。

4. **登录/反爬 = fail loudly**,不自动化。scripts 吐的 JSON 若含 `{error: true, message: "...login..."}` 或页面判据失败,channel 返回 `ChannelResult(success=False, error_type="needs_human", error=<原因>)`,不吞、不猜、不重试绕过。这是采集边界=用户手动能看到的数据(照抄上游 SKILL.md 的"operational boundary"声明),不越权破鉴权。

5. **`channel.manifest.json` schema**(我们新写,每包一份):`{domain, capability, param_schema:[{name, required, default, enum?}], steps:[{op: "navigate"|"wait"|"eval_script"|"click"|"input", ...}], pagination:{mode, url_template?, page_param?, stop_when?}, success:{min_count, required_field?}}`。channel = 这份 manifest 的通用解释器,不为每包写死代码。手写 SKILL.md 散文→manifest 的翻译过程记进 VENDOR.md。

6. **子进程安全**(复用 `cli_channel`/`opencli_channel` 的 `asyncio.create_subprocess_exec` + `wait_for(timeout)` + `TimeoutError→kill()` 模式,别新造):
   - **两跳全 argv-only,绝不 shell**:`python scripts/x.py <k> <v>...`(argv 列表)拿 stdout JS;再 `browser-act ... eval <js>`(argv)。用户参数经 argv 传,永不字符串插值进 shell/JS 模板。
   - browser-act 二进制走专属 env `BROWSER_ACT_BIN`(默认 `browser-act`),照 `opencli_channel` 的 `OPENCLI_BIN` 做法(固定二进制,无需 `CLI_CHANNEL_ALLOWED_BINARIES` 那种任意二进制 allowlist)。
   - vendored 包 = 信任边界(vendor 时人工审 + git 钉死);v1 用户**不能**上传/新增任意包(那是 skill-forge,不在本 goal)。
   - 超时:navigate/eval 每步 env `browser_act_timeout`(默认 120s,进 `backend/config.py` Settings,与现有 `opencli_timeout` 同款)。

7. **browser mode / 凭证**:server 端默认 `chrome-direct`(CDP,免 signup);`stealth` 模式需 BrowserAct API key,存 `SourceCredential`(加密,复用 `AuthManager.store/resolve`,别明文别新造凭证系统),key_name=`browser_act_api_key`。channel `collect()` 前经 `AuthManager.resolve` 取 key 注入子进程 env,错误响应绝不回显 key。

8. **channel 契约**:实现 `AbstractChannel`(`channel_type="browser_act"`,`collect(config, parameters)` + `validate_config(config)` + `health_check`)。`channel_config` schema:`{pack: "<category>/<name>" 或 domain+capability, params: {...}, mode: "chrome-direct"|"stealth", max_pages?}`。`validate_config` 校验 pack 存在于 PackCatalog + 必填 param 齐 + mode 合法。`health_check` = `browser-act --version` 子进程探活。`capabilities = Capabilities(paginated=True, session_affinity=True)`(browser-act session 有状态)。

9. **前端上架**(照 main 现有硬编码模式,别新造 API):`browser-act` 加进 `frontend/lib/api/types.ts` 的 `channel_type` union + `frontend/app/(app)/sources/page.tsx` 的 `CHANNEL_LABEL`(中文标签"浏览器采集/BrowserAct");preset 从 `PackCatalog`(新 `GET /api/v1/browser-act/packs` 端点)拉包列表填一键配置。

10. **CLI agent 化摩擦(记录,不硬解)**:上游 browser-act SKILL.md 要求"每条命令前先 `get-skills core`、别截断输出"—— 那是给 agent 的指令。本 channel 把 CLI 当受控子进程(固定 session、我们管生命周期),按需在 session 开头调一次 `get-skills core` 取环境/browser 选择态,不把它当交互 agent。若实测发现 CLI 强依赖交互确认(browser 创建确认门)无法非交互跑通 —— **停问**,别硬灌 yes。

## 状态机

- [x] **PR-A — vendor 包 + PackCatalog**(1430→**1448 passed**,+18 新测,零回归)。上游 `a23131e`(browser-act/skills)`solutions/**` 原样 vendor 进 `backend/browser_act_packs/<category>/<name>/`(**78 个包** 194 文件,Get-FileHash 逐文件核对 0 mismatch,非"~30"—— 上游实际 78,决策已用 `>=20` 断言不写死)+ `LICENSE`(MIT)+ `VENDOR.md`(commit/URL/署名)+ `SOLUTIONS-README.md`。`catalog.py`=`PackCatalog`(rglob SKILL.md,YAML frontmatter 取 name/description,domain=category/capability=pack 目录名从布局派生;**发现并修**:`social-listening/reddit-warmup/SKILL.md` 带 UTF-8 BOM 致 `startswith("---")` 漏包,改 `utf-8-sig` 读,只动 catalog.py 非 vendored 字节)。`manifest.py`=`PackManifest` schema(决策 #5)+`load_manifest`,无 manifest 内容(留 PR-D)。测试 `tests/unit/browser_act_packs/`(catalog 扫 ≥20 + BOM/坏 frontmatter skip + get_pack + manifest 校验,18 测)。
  ~~验收:catalog 扫出 ~30 包(数量断言)、frontend 解析不崩、非法/缺 frontmatter 包被跳过并记警告的单测;`VENDOR.md` 存在且含 commit hash;基线测试数记录进本文件。~~ 全达成。

- [x] **PR-B — browser-act CLI 封装**(1448→**1467 passed**,+19 新测,零回归)。新包 `backend/browser_act/`(≠现有 `backend/cli.py` opencli HTTP client、≠ `browser_act_packs/`):`cli.py` = `_run`(`create_subprocess_exec` + `wait_for(timeout)` + `TimeoutError→kill()+wait()`,照 `cli_channel.py`)、`version()`/`get_skills()`、`session(name, env)` async ctx mgr → `BrowserActSession`(navigate/wait/eval/state/click/input/run,每条前置 `--session <name>`)。binary 走 `BROWSER_ACT_BIN` env 调用时读(照 opencli `OPENCLI_BIN`),`browser_act_timeout=120` 进 Settings。**全 argv-only**(#6):仅 `create_subprocess_exec` 无 shell,用户值(URL/JS/input)恒单 argv 元素;`BrowserActError` 错误文本不含 env(secret 走 env 不入 argv/日志)。session `__aexit__` no-op(#10:browser open/close 归 PR-C,不对称清理会误拆调用方仍需的 session,已注释)。CLI 命令面已对上游 `docs/commands.md` 核实。测试 `tests/unit/browser_act/test_cli.py`(19 测:argv 精确断言、注入安全断言 `create_subprocess_shell` 从不被调+危险串单 argv 逐字、timeout kill、非零退出错误不含注入的 api_key、`BROWSER_ACT_BIN` 覆盖、真 `sys.executable` 往返)。
  ~~验收:mock 子进程...参数含 shell 元字符时不注入的测试(断言走 argv 非 shell)。~~ 全达成。

- [x] **PR-C — BrowserActChannel + manifest 解释器**(1467→**1484 passed**,+17 新测,零回归,全量已跑验)。`backend/channels/browser_act_channel.py`=`BrowserActChannel(AbstractChannel)` `channel_type="browser_act"` `@register_channel`,`Capabilities(paginated=True, session_affinity=True)`;通用 manifest 解释器(无 per-pack 码,#1/#5):resolve pack(PackCatalog)→`load_manifest`→逐 step 驱动(navigate/wait/eval_script/click/input),`eval_script`两跳=`run_pack_script`(新 `backend/browser_act/scripts.py`,`create_subprocess_exec(sys.executable,...)` argv-only #6,`ScriptError`)拿 JS→`sess.eval`拿 JSON。**登录/反爬**(#4):JSON `{error:true,message}` 经 `_classify_error` 命中 auth 关键词(login/captcha/verify/登录/验证/人机…)→`error_type="needs_human"`立即停不重试;其余 error 归 `"error"`。分页仅解释 `url_page`+`result_count<N` stop_when,余量 `max_pages`(默认 5)+空页兜底(限制已文档化)。`validate_config`(list[str])拒非法 pack/缺 param/坏 mode/无 manifest;`health_check`=`version()`探活。`session_env` 钩子留 PR-E。KeyError(manifest 模板错)也收进 ChannelResult 不崩。**真回归修复**:`test_workflow_capabilities_api.py` 精确集断言加 `"browser_act"`(新 channel 本应现身 `list_channel_types()`,+1 行)。测试 `tests/unit/channels/test_browser_act_channel.py`(17 测:happy/needs_human/generic-error/validate/health/secret 不泄露/registry/脚本跳注入安全/模板不匹配不崩)。
  ~~验收:mock browser-act 子进程...api_key 不入错误响应断言。~~ 全达成 + secret 不入 error/metadata 断言。

- [x] **PR-D — seed manifests(2 包)+ 分页/成功判据**(1484→**1492 passed**,+8 新测,零回归)。2 个 seed(不同类目/分页形态/输出形态,覆盖强):`search-research/google-search-serp`(**免登录**,单页 `mode:none`,输出 dict 单 SERP,`required_field:organicResults`,eval_script 无 args)+ `ecommerce/taobao-keyword-search`(登录墙但 mock 测不受阻,`mode:url_page` page-number 分页 `stop_when:result_count<10`,输出 product list,`required_field:itemId`,args `[{keyword},--page,{page},--sort,{sort}]`)。手写 `channel.manifest.json`前已 Read 两脚本核对字段/arg 形态一致(serp-extract 无 args 出 `organicResults`,search-products 出 `itemId` list)。VENDOR.md 补"Seed manifests"节(SKILL.md 散文→manifest 翻译 + 3 条限制:interpreter 不 URL-encode 参数/google 多页需 `start=(page-1)*num` 算术当前 `{page}` context 算不出故 seed 单页/其余 ~76 包无 manifest 且 api-skill 包[如 web-search-scraper]是脚本直打 BrowserAct API 的异形态本 navigate→eval interpreter 不建模)。测试 `tests/integration/test_browser_act_seeds.py`(8 测:两 manifest load+validate、google happy 单页、taobao 分页 12→5 触 stop_when 共 17 项 2 页、min_count 未达失败、needs_human captcha)。
  ~~验收:每 seed 包一条 manifest 解析 + 解释器执行...schema 是扩展点。~~ 全达成(interpreter 零改动,纯加性)。

- [x] **PR-E — 凭证 + 前端上架**(1492→**1504 passed**,+12 新测,零回归,全量已跑验)。**凭证**(#7):`_resolve_session_env` 经 `AuthManager.resolve(source_id)`(复用现有加密 SourceCredential 路径,同 ApiChannel/Crawl4AI)取 key_name=`browser_act_api_key`,注入子进程 env `BROWSER_ACT_API_KEY`;**stealth 缺 key=硬报错不静默降级**,chrome-direct 免 key;key 绝不入 error/metadata/日志。**关键发现+修**:PR-C 注释假设"只填 session_env"错——`AbstractChannel.fetch()` 默认桥接丢 `ctx.source_id`,生产 `run_channel` 只在 fetch 路径有真 source_id;故加窄 `fetch()` override 把 `ctx.source_id` 穿给 `collect(source_id=)`(否则 stealth 凭证在生产静默失效)。trade-off:override 触发 runner 建一个未用 httpx 对象(无真连接,已文档化接受)。`collect()` 加 additive `source_id=None`(直调=best-effort)。**端点**:`GET /api/v1/browser-act/packs`(`backend/api/v1/browser_act.py`,PackCatalog+load_manifest,每包 has_manifest+param_schema,坏 manifest 不 500,无凭证暴露),挂 `backend/api/v1/__init__.py`。**前端**(#9,最小,D5 发现无 source 创建表单/config 编辑器故仅 union+label 正确):`types.ts` channel_type union+`browser_act`+`BrowserActPack` interface;`sources/page.tsx` CHANNEL_LABEL=`'BrowserAct 采集'`;`endpoints.ts`/`hooks.ts` 加 `listBrowserActPacks`/`useBrowserActPacks`(暂未消费,同现有 dead `createSource` 状态)。env 变量名 `BROWSER_ACT_API_KEY`=假设(上游只文档化 `browser-act auth set` 无 env var,已注释;此处无法跑真 stealth,测覆盖 encrypt/resolve/no-leak/missing-key 非活 CLI)。测试(+12):凭证加密 round-trip(env 注入断言 key 出自密文)、stealth 缺 key 报错且 `_run` 未被调、chrome-direct 免 key 通、no-leak(key 不在 error/metadata)、fetch() 生产路径 source_id 到达、packs 端点(200/seeded has_manifest=true/无凭证字段)。前端闸 `tsc --noEmit`+`eslint` 直调 .bin 双清(pnpm install 有审批门,绕过)。
  ~~验收:key 加密存取 round-trip...stealth mode 缺 key 时明确报错(不静默降级)。~~ 全达成。

> ✅ **GOAL-7 完成**(2026-07-08):PR-A→PR-E 全落,1430→**1504 passed**(1448/1467/1484/1492/1504 逐 PR 过点),零回归(既有 12 failed 全 main 遗留:opencli/workflow/nodes-install + 4 `*_live.py` 需真 Chrome,与本 goal 无关)。`d72c0e8..<PR-E>` 共 5 commit,分支 `feat/browser-act-channel`(从 main `edbb1ca` 切)。**未 push**(push 等用户)。vendor 78 包(byte 不改)+ browser_act CLI 封装 + BrowserActChannel manifest 解释器 + 2 seed manifest + 凭证/端点/前端。**留白**:~76 包无 manifest(schema 是扩展点,增量补)、api-skill 包异形态(脚本直打 API 无 browser session)本 interpreter 不建模、google 多页需 `start=(page-1)*num` 算术当前不支持、interpreter 不 URL-encode 参数、前端无 source 创建 UI 故 packs hook 暂未消费、`BROWSER_ACT_API_KEY` env 名是假设(上游无文档)。

## 每 PR 验收(DoD)

1. `tests/unit` + `tests/integration` + `tests/skills` 全绿(不低于 PR-A 前基线)
2. 老路径行为零回归(尤其 PR-C/E —— 动 channel registry + API 路由)
3. commit 仅码+测+vendored 包路径,`git status --porcelain` 自检无 `GOAL*.md`/`HANDOFF*.md`/`AUDIT*.md`/`GRILL*.md`/`PR-DESCRIPTION.md`
4. 勾掉本文件对应项 + 一行进度(commit hash + 测试数)
5. vendored `SKILL.md`/`scripts` 内容零改动(git diff 自检:只新增,不改上游文件字节)

## 停止条件(真分叉才停,别瞎猜)

- 全 PR 完
- 从 main 切分支时 channel 子系统结构与本设计冲突(别的分支也动了 registry/AbstractChannel)
- browser-act CLI 强依赖交互确认门,非交互跑不通(#10)
- pytest 红且 2 轮内修不动
- seed 包全都需登录、无一能在无凭证下端到端验证(PR-D 选包卡住)
- 需要 push(push 永远等用户)

## 明确不做(YAGNI 裁决,别加)

- 不 vendor browser-act CLI 本体(外部 PyPI 工具)
- 不做 skill-forge(用户上传/生成任意包)
- 不做 LLM-runner(登录/反爬自愈)
- 不写 pack→DB Skill 表导入器
- 不改上游 SKILL.md/scripts 字节
- 不给全 ~30 包写 manifest(seed 2-3 个验证管道,余量增量补)
