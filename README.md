# 小本本（dsh-xiaobenben）

DeepSeek Harness（dsh）插件，两件事：「年度回顾」和「翻旧账」。

年度回顾：看过去一年你和各个 coding agent 一起做了什么、说了什么，导出分享图。

- **统计和原话在本机算**，不调模型、不花钱。
- **AI 部分可选**：用你自己的模型额度写 3 个年度关键词、3 个奖项和 150 字以内的「这一年」。点了才跑，跑之前先报价，你点「发送」才发。
- **导出**：竖版长图 + 一组 3:4 分页卡片，都在浏览器里画成 PNG，不出本机。

对着 dsh **0.2.0-rc.2** 开发和测试。用到的每个 dsh API 都写在 [docs/dsh-api.md](docs/dsh-api.md) 里，带源码出处。

## 安装

要先装 pnpm（`npm i -g pnpm`）。装预先打好的包（不用在你电脑上构建）：

```sh
dsh plugin --profile web add https://github.com/Kapozux/dsh-xiaobenben/releases/download/v0.1.0/dsh-xiaobenben-0.1.0.tgz
```

装完把 `dsh web` 关掉重开，左边栏会多出「年度回顾」和「翻旧账」。卸载用 `dsh plugin --profile web remove dsh-xiaobenben`。

改代码时可以装本地目录（链接，改完 `pnpm run build` 再重开 dsh，不用重装）：

```sh
dsh plugin --profile web add ./dsh-xiaobenben
```

## 用法

1. 点左边栏「年度回顾」：统计和原话直接出来。
2. 想把 Claude Code / Codex / Cursor 的记录也算进去：**设置 → 年度回顾**，逐个勾选。每一项都写着会读哪个目录；只读，不上传。Cursor 的数据库会先复制一份再读，读完删掉。
3. 想要 AI 部分：点「看看要发什么」。报价页写明发给哪家、哪个模型，大概多少 token，要发的全文可以展开看。可以这一次单独换个模型，不改 dsh 的默认设置。点「发送」才发。结果存在本机，下次打开不重跑。
4. 在预览里隐藏不想放进图里的卡片，然后「下载长图」或「下载 3:4 卡片」。

## 翻旧账

一次说一件你和 agent 一起干过的真事：派的活干了多久、被你喊停、说好了却挨骂、认错、深夜加班、总账……
从会话记录里挑出来，套进「本肥鱼」口吻的模板（每类 100 条），**都在本机算，不调模型，不发任何东西出去**。
健康、感情、成绩、家庭相关的默认不说。

- **装了 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**：右键它 → 更多 → 翻旧账，它会亲口说一句，配一个对应的动作。
  只调 dsh-pet 公开的接口（菜单项、占用锁、动画、气泡），不带它的代码和素材；那只宠物的形象与授权归 dsh-pet 及原作者。
- **没装**：左边栏「翻旧账」，一页一件，「再翻一件」换下一件。

## 会发出去什么、不会发什么

只有你在报价页点了「发送」，才会发给模型。发的只有这两样：

- 会话标题；
- 每月最多抽 30 句你自己说过的短句（200 字以内）。

发之前都会打码（路径、邮箱、key、token、内网地址）。涉及健康、感情、成绩、家庭的句子默认不发。agent 的回复一句都不发。

模型回来的内容里引用的原话，会回到发过去的材料里逐字核对，对不上的删掉。整份回顾最多调用 5 次模型，失败只重试 1 次，不循环，不开子代理。

## 卡片和版式

| | 你说的话 ≥200 句（完整版） | 不到 200 句（轻量版：少放数字，多放原话） |
|---|---|---|
| 封面 | 活跃天数、会话、句数、轮次 | 一句话总结 |
| 节奏 | 最长连续天数、最忙的月份、凌晨说话最多的一天（0–5 点之间消息最多的那天）、一天的时间分布 | — |
| 各 agent | 占比，不到 1% 合并成「其他」 | 不止一个 agent 时才有 |
| 最长的会话 | 有标题显示标题，没有就显示第一句的前 20 个字 | 同左 |
| 口头禅 | 去重后重复最多的短句 | 同左 |
| 全年第一句 / 凌晨最晚的一句 | 原样，带日期和来源 agent | 同左 |
| 平时说的话 | — | 全年等间隔挑几句 |
| AI：关键词 / 奖项 / 这一年 | 跑了才有 | 同左 |

- **没跑 AI 或 AI 失败**：AI 那几张卡不出现，剩下的照样拼成一张完整的图。
- **超长消息**：单条超过 2000 字的（贴代码、贴日志）不进原话候选。
- **敏感内容**：涉及健康、感情、成绩、家庭的原话，卡片上默认藏起来；整张卡就是那一句的话，整张默认隐藏。可以手动打开。
- **图底部**都写着「统计和原话都在本机算；AI 只读了你同意发送的那部分。」

## 配置（可选）

在 profile 的 `cordis.patch.yml`（例 `~/.dsh/profiles/web/cordis.patch.yml`）里写。注意 config 是整块替换，不是合并：

```yaml
- id: xiaobenben
  config:
    prices:            # dsh 的模型配置里没有价格；不填就只显示 token，不猜价
      - { provider: deepseek-official, model: deepseek-flash, input: 1, output: 2, currency: CNY }   # 每百万 token
    expensiveOutputPrice: 10      # 输出价格高于这个就提示「可以换便宜的模型」
    sensitiveExtra:               # 额外的敏感词
      健康: [某个词]
```

插件自己的状态（勾选了哪些来源、AI 结果缓存、隐藏了哪些卡）存在 `$DSH_HOME/storages/dsh-xiaobenben/state.json`，默认是 `~/.dsh/...`。

## 开发

```sh
pnpm install
npm test                 # 单元测试：统计、打码、原话逐字核对、报价、生成（假模型），不调真模型
npm run check:local      # 拿本机 ~/.claude 和 ~/.codex 跑整条链路：不跑 AI、AI 失败两种情况（假模型，不发任何东西）
pnpm run build           # 打包网页那一半 → lib/client.js
node scripts/write-light-home.mjs <目录>   # 把手造的轻度数据（只有 dsh、三个月、150 句）写成真的 dsh 会话，给单独的 DSH_HOME 用
```

- `src/core/`：统计、原话、打码、敏感、材料、AI，都不依赖 dsh。
- `src/sources/`：dsh（经 `ctx.sessionQuery`）、Claude Code、Codex、Cursor 的读取。
- `src/review.js`：把上面串起来。
- `src/index.js`：dsh host 入口，注册 `/api/xiaobenben.*` 路由。
- `src/client/`：网页那一半，包括左边栏图标、整页、设置页和 canvas 出图。
