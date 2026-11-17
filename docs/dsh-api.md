# dsh 插件 API 笔记（Agent 年度回顾用）

> 写功能之前先把要用的 API 钉死。每条都带出处；**没核实的单独列在最后，写代码时不许用**。
> 写于 2026-11-17。

## 0. 钉死的版本

| | 版本 | 说明 |
|---|---|---|
| 本机装的 dsh | **0.2.0-rc.2**（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`） | 插件对着它开发、对着它测 |
| 读的源码 | `deepseek-harness` tag **`dsh-v0.2.0-rc.2`** | 和本机一致。master 已经到 0.2.2-rc.3，**不看 master** |
| peerDependencies | `@deepseek-ai/dsh-*: 0.2.0-rc.2`（精确） | 升级 dsh 时手动核一遍这份文档再放宽 |

下文出处：`src:` = 那个 tag 下的 deepseek-harness 仓库；`ref:` = 三个参考插件的 npm 包（dsh-session-export 1.11.0 / dsh-usage 0.2.5 / dsh-usage-calendar 0.1.4）。

本机现状：**`~/.dsh` 不存在**，即这台电脑还没跑过 dsh，dsh 自己的会话是 0 条。「默认数据源 = dsh 会话日志」在你这台机器上暂时是空的，所以测试数据的第二份（手造的 dsh 轻度数据）是必需的，不是可选。

---

## 1. 读历史会话：`ctx.sessionQuery`

### 1.1 用哪个服务

`ctx.sessionQuery` 是 `SessionQueryEngine`（`src: packages/session-query/session-query/src/index.ts:98`）。插件 `export const inject = ['sessionQuery']`。
dsh-session-export 就是这么用的（`ref: dsh-session-export lib/index.js:3295` `inject = ["commands","sessionQuery"]`）。

| 方法 | 签名 | 出处 |
|---|---|---|
| `listSessions(signal?)` | → `SessionRecord[]`，全量、新的在前，**不分页** | `index.ts:174`；`docs/subsystems/session-query.md:411` |
| `filterSessions(filters, signal?)` | filter 种类：`created-at`（闭区间）/ `cwd` / `parent` / `id` / `availability` | `index.ts:206`；`session-query.md:116-122,427` |
| `readSession(id)` | → `{ session: SessionHeader, inheritedEventCount, events }` 整条原始事件 | `index.ts:184` |
| `readTitleSnapshots(ids)` | 批量读标题，单个失败不连累别的 | `index.ts:251`；`session-query.md:454` |
| `listEvents(id)` | → `{sessionId, seq, type, time, surface}[]`（不带内容） | `index.ts:269` |
| `searchSessions / searchEvents` | **不用**：web 配置里全文索引 `openAt: never`，调了报 `SESSION_QUERY_SEARCH_DISABLED` | `src: packages/bundle/base/cordis.patch.yml:141-153` |

### 1.2 JSONL 和 SQLite 两种后端

它们不是二选一的两套接口，是两层：

- **存储**永远是 `dsh-session-persistence-jsonl`，`root = ~/.dsh/sessions`（`base/cordis.patch.yml:130-133`），文件形如 `~/.dsh/sessions/--<cwd>--/<id>/session.vN.jsonl[.zstd]`，默认压缩（`session-persistence-jsonl/README.md:59-70`）。
- **SQLite**（`dsh-session-query-sqlite`）只是在同一个 `ctx.sessionQuery` 上加全文索引：`class SqliteSessionQueryEngine extends SessionQueryEngine`（`session-query-sqlite/src/index.ts:203`），`listSessions / readSession` 都是基类实现（`session-query/src/index.ts:174-197`）。

**结论**：插件只调 `listSessions + filterSessions + readSession + readTitleSnapshots`，两种配置下行为一致；**不直接读 jsonl 文件**（有压缩、有格式版本迁移）。参考插件也都没有按后端分支（`ref: session-export lib/index.js:3307`「any backend, incl. SQLite」）。
测试要求「两种后端都要支持」→ 用 dsh 的测试夹具各起一次（JSONL 默认 / 加装 sqlite 引擎）跑同一组断言。

### 1.3 数据形状

- `SessionRecord = { header, live, persisted }`（`session-query.md:20-27`）
- `SessionHeader`（`src: packages/core/session/src/types.ts:94-125`）：`id`、`createdAt`（epoch ms）、`cwd?`、`parentSession?`、`isSeeded`、`origin?: 'subagent'`、`agentPreset?`。**没有 title**。
  → `origin === 'subagent'` 的跳过（不是用户开的会话）。
- 事件信封：`{ type, seq, time /* epoch ms */, data, ignorable? }`（`types.ts:493-516`）。
- **用户说的话**：`type === 'user/message'` **且** `data.source.kind === 'user'`。同一种事件也用来塞注入的上下文（`types.ts:303-309`），所以必须看 `source.kind`。dsh-usage-calendar 也是这么判的（`ref: calendar src/activity.ts:409`）。消息体 `{id, content: ContentBlock[], source}`（`src: packages/llm/llm/src/message.ts:138-169`），文字取 `content` 里 `type==='text'` 的块。
- **agent 回复**：`type === 'assistant/message'`，`data = { turn, step, message, stream, usage?, interrupted? }`（`types.ts:341-348`）。本插件只拿它数轮次，不碰内容。
- **轮次**：`turn/start` / `turn/end`（`ref: calendar src/activity.ts:315-417` 折叠时就数这两个）。
- **模型**：`request/header` 的 `data.header.config.{provider, model}`，只在变化时记一条（`types.ts:240-243,387-392`；`ref: dsh-usage lib/projection.js:160-164`）。
- **标题**：不在 header 里，用 `readTitleSnapshots`；快照 `{title, messageSeqs, source, eventSeq, updatedAt}`（`src: packages/session/session-title/src/types.ts:39-56`）。没标题 → 按需求显示第一句前 20 字。
- **时间**：`event.time` 是 epoch ms；按**本地时区**切日（dsh-usage-calendar 用本地，`activity.ts:83-89`；dsh-usage 用 UTC，`docs/accounting.md:36`——凌晨统计必须本地时区，我们跟 calendar）。

### 1.4 性能

`readSession` 每次读整条日志并校验，一年的会话全读会慢（未实测）。做法：
每个会话算完的**摘要**（用户原话候选、按天计数、轮次数）存进插件自己的 storage，键 = `会话 id + 事件数`，事件数没变就不重读。

---

## 2. 在 dsh web 里挂页面

### 2.1 浏览器那一半怎么被加载

- `package.json` 里 `exports["."]` = host 端，`exports["./client"]` = 浏览器端，再声明 `"dsh": { "client": { "platform": "web", "inject": [...] } }`（`src: docs/cookbook/adding-a-settings-card.md:56-70`；`packages/client/modules/README.md`「Declaring a client plugin」）。
- 浏览器端只挂在 **Loader 行的 name 等于包名本身** 的那一行上（`adding-a-settings-card.md:58`）。
- `lib/client.js` 必须是 module system 的 **lazy-CJS factory 格式**：`window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {...} })`，外部依赖（React、Cordis 等）通过注入的 `require` 拿（`src: packages/client/tsdown.client.ts:1-11`）。
- 生成这个格式的 tsdown 预设 **不在任何发布的包里**，「仓库外的包要自己复刻这个构建」（`adding-a-settings-card.md:60`）。dsh-usage-calendar 就是自己写了 `tsdown.client.config.ts`，产物开头就是 `window.__ModuleLoader__.load({ id: "dsh-usage-calendar", factory: (require) => {` ——**照它做**。
- 可用的外部模块只有 shell 的 `PLATFORM_MODULES`（React、Cordis、静态 UI 库）；别的要在 `dsh.client.external` 里点名（`modules/README.md`「Sharing modules」）。所以 PNG 渲染**自己用 canvas 写，不引第三方截图库**。
- React `^18.2.0`（两个 UI 参考插件的 peer）。

### 2.2 挂在哪

用法：`ctx.slots.inject(key, () => ctx.slots.register({name, id|key, order, locale, label, inject}, Component))`，`inject = ['slots']`；组件拿不到 `ctx`，要的服务从 `inject` 工厂传（`src: docs/subsystems/slots.md:21-43,77,101-103`）。

打算用的两个位置：

| 位置 | 用途 | 照着抄 |
|---|---|---|
| `main` + `sidebar.panellist` | 左边栏一个图标，点开整页「年度回顾」 | `src: packages/client/ui-schedule/src/client/index.ts:168-184`（已核对） |
| `settings.section` | 设置里一页「数据来源」：勾选 ~/.claude、~/.codex、Cursor | `ref: calendar src/client/index.ts:25-67`（`id:'calendar', order:40`）；slot 契约 `{kind:'list'; scope:'root'}`（`src: client/ui-settings/src/client/contract/slots.ts:57`） |

### 2.3 浏览器 → host 怎么通信

- 文档里的类型化 `ctx.remote`（`TypertRemoteService` + `@Remote`）要在 dsh 仓库内做代码生成（`docs/api-gateway.md:78-80`），**第三方包能不能用没核实 → 不用**。
- 用 **host fetch 路由**：`ctx.connection.fetch.register({ path, methods: ['GET'|'HEAD'|'POST'], requestBody: 'buffered'|'streaming', fetch: (req: Request) => Promise<Response> })`（`src: packages/client/connection/src/rpc.ts:138-156`，已核对）。路径在 `/api` 下，进来前已过鉴权；重名会抛错。
  dsh 自己的 `dsh-session-log-export` 就这么做：host `inject = ['commands','connection']`（`session-log-export/src/index.ts:41,87-102`），浏览器 `fetch('api/session.export?...')` 用相对路径（`client/controller.ts:113`）。

打算的路由（全部只读本机，写只写插件自己的 storage）：

```
GET  /api/agent-year.sources     各数据源：路径、是否存在、是否已勾选
POST /api/agent-year.sources     勾选/取消（只改插件 storage）
POST /api/agent-year.stats       统计 + 原话候选（确定性，不调模型）
POST /api/agent-year.quote       报价：要发的全文、预计 token、模型、服务商、费用或「未计价」
POST /api/agent-year.write       用户点头后才调模型；结果缓存
GET  /api/agent-year.cache       读缓存（启动不重跑）
```

---

## 3. 调模型

- `ctx.llm`（`LlmRuntime`，`src: packages/llm/llm/src/index.ts:342`），`inject = ['llm']`。
- `ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>`（`index.ts:1135`，已核对）。失败不抛，最后一个 `finish` chunk 带错误原因。
- `GenerateOptions`（`types.ts:511-570`，已核对）：`provider`、`model`、`messages`、`system?`、`maxTokens?`、`temperature?`、`signal?`、`sessionId?`、`reasoningEffort?`。`purpose` 是封闭联合 `'compaction'|'session-title'`，**不填**。
- chunk：`text-delta`、`block-end`、`{type:'usage', usage}`（在 finish 之前）、`{type:'finish', reason}`（`types.ts:452-464`）。
- 用量 `TokenUsage {inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?}`，`inputTokens` 不含缓存命中部分（`types.ts:175-189`）。
- 照抄的范本：`src: packages/session/session-title-llm/src/index.ts:233-306`（`createUserMessage`、`BlockAssembler`、截止时间 signal、`finishError`）。参考插件**都没调过模型**，这块只能照 dsh 自己的标题生成。

**当前配置的模型**：`ctx.agentDefaultModel.currentSelection() → {provider, model, reasoningEffort?}`（`src: packages/core/agent-default-model/src/index.ts:67`，已核对）；base 默认 `deepseek-official / deepseek-flash`（`base/cordis.patch.yml:80-86`）。
**「这次单独选一个模型」**：`ctx.llm.listProviders()` + `ctx.llm.listModels(provider) → {provider, id, name, description?}[]`（`index.ts:478,702`）。

**价格**：dsh 的模型配置里**没有任何价格字段**（源码里 grep cost/price/currency/USD 无结果）；`dsh-token-meter` 的 "pricing" 是 token 估算，不是钱（`docs/subsystems/token-meter.md:29`）。dsh-usage 的价格表是它自己插件配置里手填的（`ref: dsh-usage lib/pricing.js:24-33`）。
→ 按你的规矩「读不到就只显示 token，不猜价」：**默认只显示 token**。插件配置留一个可选 `prices` 表（用户自己填，格式照 dsh-usage：`{provider, model, input, output}` 每百万 token），填了才显示钱。
「当前模型很贵」的判断也只能靠这张表；没填价格就不提示。

**估 token**：发送前算。dsh 没有公开的「数 token」API 可直接给插件用（未核实 `dsh-token-meter` 的对外接口 → 不用），用字符数估：中文 1 字≈1 token、其它 4 字符≈1 token，界面标「估算」。发完以 `usage` chunk 的真实数为准、写进缓存。

---

## 4. 配置和存储

- 配置：`export interface Config` + `export const Config = Schema.object({...})`（`@deepseek-ai/schemastery`），默认值写在字段上（`src: docs/user/develop/basic/config.md:9-45`）。要在设置页实时改的字段加 `.volatile()`，用 `config.x.get()` 读（`adding-a-settings-card.md:13-36`）。
- 插件自己的持久数据：`ctx.storageDomain.open(defineDomain({ name, version, tables: { t: domainTable<K,V>(zod) }, global? }))`，`.table(name).get/put/delete`、`.global.get/set`，`close()` 放进 `ctx.effect`（`src: docs/subsystems/storage.md:51-126`）。默认后端是 JSON，落在 `~/.dsh/storages`（`base/cordis.patch.yml:161-175`）。dsh-usage 就这么存状态（`ref: dsh-usage lib/community/state.js:48-60`）。
  存：数据源勾选、每会话摘要、AI 结果缓存、卡片隐藏状态。

---

## 5. 打包、安装、发布

- `package.json`：`"type": "module"`、`main`、`files`、`"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": {...} }`、keywords 带 `dsh-plugin`（`src: docs/user/develop/basic/publish.md:35-44`；三个参考插件一致）。
- 要和 host 共享的 dsh 包同时写进 `peerDependencies` 和 `devDependencies`，第三方库进 `dependencies`（`publish.md:103`）。
- `cordis.patch.yml`（`publish.md:58-62`）：
  ```yaml
  - insert:
      - id: agent-year
        name: dsh-agent-year
        config: {}
  ```
- 安装：`dsh plugin --profile web add <包名或 ./本地目录>`，交给 pnpm 装进 `~/.dsh/profiles/web`，自动追加到该 profile 的 `dsh.profile.bundles`；装完重启 `dsh web`（`publish.md:77-101`；calendar `README.md:89`）。卸载 `dsh plugin --profile web remove <pkg>`（`publish.md:116`）。核对 `dsh --profile web --dump-config`（`publish.md:112`）。
- 从 git 装要 `prepare` 脚本 + profile 的 `allowBuilds`（`publish.md:159-184`）；发 npm 或 `pnpm pack` 出 tarball 就没这事。**先只做本地 tarball，发不发 npm 你决定。**

---

## 6. 三个参考插件各自学什么、不学什么

| 插件 | 学 | 不学 |
|---|---|---|
| dsh-session-export 1.11.0 | `sessionQuery.listSessions/readSession` 的读法；`isAppendSurfaceEvent / deriveEventMessage` 判断 user / assistant / tool-result（`lib/index.js:1785`） | — |
| dsh-usage-calendar 0.1.4 | 客户端外部构建（`tsdown.client.config.ts` 产出 factory 格式）；`settings.section` 注册；本地时区切日；`source.kind==='user'` | 它的 peer 钉在 0.1.1-rc.1；投影（projection）那套我们不需要——一年一次的统计按需算，不常驻折叠 |
| dsh-usage 0.2.5 | 价格表由用户配置、按 provider+model 精确匹配；`storageDomain` 存状态 | **它的投影定义是旧契约**（`{key, schema, init, apply, view}`，`lib/projection.js:225-240`），0.2.0-rc.2 要 `stateSchema / init(header, inheritedEventCount) / wire`（`src: session/session-projection/src/index.ts:53-84`）。不照抄形状 |

---

## 7. 外部数据源（可选，逐个勾选才读）

不经过 dsh 的 API，host 端用 Node `fs` 只读。我在本机看过的结构（只看字段名，没读内容）：

| 来源 | 位置 | 本机规模 | 用户原话 | 轮次 / 标题 / 时间 |
|---|---|---|---|---|
| Claude Code | `~/.claude/projects/*/*.jsonl` | 6091 个文件、2.9G | `type:'user'`、`isSidechain` 非真、`isMeta` 非真、`message.content` 是字符串（是数组时只取 text 块，跳过 `tool_result`） | `type:'assistant'` 数轮次；标题 `type:'ai-title'.aiTitle`；`timestamp` ISO |
| Codex | `~/.codex/sessions/**/*.jsonl` | 12 个、42M | `type:'event_msg'` 且 `payload.type:'user_message'` → `payload.message`（`response_item/message/user` 里混有注入的说明，不用） | `event_msg/agent_message` 数轮次；`session_meta.payload.cwd`；`turn_context.payload.model` |
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`（56M） | `cursorDiskKV` 里 `composerData:*`（会话）+ `bubbleId:*`（消息） | **先复制到临时目录再只读打开**，读完删副本 | 字段还没细看，写这一块时再补核对 |

> 这三种格式是这些工具的私有格式，不是公开 API，随版本会变。解析器对认不出的行**跳过并计数**，界面上显示「跳过 N 行」，不静默吞。

Node 读 SQLite：Node 22.5+ 自带 `node:sqlite`（Cursor 那份用它，不加原生依赖）。dsh 0.2.0-rc.2 的 package.json 没写 `engines`；本机是 Node 26.4，够用。插件自己声明 `engines.node >=22.18`（同 dsh-usage）。

---

## 8. 没核实的 → 实测结果（2026-11-17，dsh 0.2.0-rc.2）

写完后在真的 dsh 里装上跑过（单独的 DSH_HOME，无头浏览器）：

1. 类型化 `ctx.remote` → 没用；`ctx.connection.fetch.register` 的 POST 路由工作正常，页面用相对路径 `fetch('api/agent-year.view')` 就带上了鉴权。
2. `ctx.connection` 照 log-export 用 `Reflect.get` 取 → 可用。
3. `settings.section` → 组件不用任何 props 也能挂上，设置页左栏出现「年度回顾」。
4. `shell.overlay` → 没用。
5. `readSession` 读 30 个会话瞬间完成；用户的真数据 dsh 部分还很少，一年量级的耗时还没测。
6. 数 token → 仍用字符估算，标「估算」。
7. Cursor：`bubbleId:<会话>:<消息>` 的 `type` 1 = 用户、2 = 助手，`text` 是正文，`createdAt` 是 ISO 时间；`composerData:<会话>.name` 是标题。
8. 两种后端：用手造的轻度数据，默认配置（SQLite `openAt: never`）和 `--patch` 打开 SQLite 索引（`openAt: startup` + 文件路径）各跑一次，统计、原话、材料指纹完全一致，后者确实建了索引文件。
9. `main` + `sidebar.panellist`（`key` / `id` 相同）→ 左边栏出现图标，点开是整页。
10. `--patch` 是启动器参数，要写在 `web` 前面：`dsh --profile web --patch x.yml --port …`。
