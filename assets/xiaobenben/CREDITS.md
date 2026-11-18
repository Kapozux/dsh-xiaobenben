# 小本本鲸鱼娘 · 署名

| 文件 | 内容 | 作者 |
|---|---|---|
| `turnaround.png` | 三视图原画（正面 / 侧面 / 背面，透明背景） | Kapozux，用 ChatGPT 的图像生成绘制 |
| `flip-sheet.png` | 翻本子的 6 帧原画（一张横排） | 同上 |
| `flip-1.png` … `flip-6.png` | 从 `flip-sheet.png` 切出的单帧，统一成 480×680、按脚底对齐（后来又整体改成 576×680 的矮胖版，见表格下面） | 同上（切图、对齐：本插件） |
| `poses-1-sheet.png` | 6 个专属姿势原画（一张横排） | 同上 |
| `write` `count` `hide` `accuse` `spout` `bow` `.png` | 从 `poses-1-sheet.png` 切出：记账、数饭碗、本子挡脸、翻本子质问、喷水欢呼、鞠躬 | 同上（切图、对齐：本插件） |
| `poses-2-sheet.png` | 6 个桌宠动作原画（一张横排） | 同上 |
| `dangle` `land` `sit` `sleep` `sulk` `wave` `.png` | 从 `poses-2-sheet.png` 切出：被拎起、落地、坐着翻本子、趴本子睡着、背对生闷气、挥手 | 同上（切图、对齐：本插件） |
| `walk-sheet.png` | 向右走路 4 帧原画 | 同上 |
| `walk-1` … `walk-4` `.png` | 从 `walk-sheet.png` 切出，同一比例、同一脚底线，头对齐（往左走时程序镜像） | 同上（切图、对齐：本插件） |
| `head.png` | 收起后的小圆头像：从 `happy.png` 截头部、加浅蓝圆底 | 同上（截图：本插件） |
| `expressions-sheet.png` | 9 种表情原画（一张横排） | 同上 |
| `happy` `sad` `surprised` `sleepy` `shy` `thinking` `eat` `pout` `proud` `.png` | 从 `expressions-sheet.png` 切出的单帧，缩放到和 `normal.png` 同样身高、按脚底对齐 | 同上（切图、对齐：本插件） |
| `normal.png` | 平时站着的样子，就是 `flip-1.png` | 同上 |
| `blink.png` | 闭眼帧：在 `normal.png` 的眼睛位置改画成闭眼 | 同上（改画：本插件） |

**矮胖版（2026-11-18）**：所有 480×680 的单帧都做过同一道处理（本插件）：从上往下第 411 行以下（大约脖子往下）竖直压到 0.62 倍、头不动，再整体等比放大回 680 高，画布加宽到 576 居中。头身比更接近 Q 版，脸不变形。各张原图在 git 历史里，原画 `*-sheet.png` / `turnaround.png` 没动。

本文件夹里的图片按 **CC BY-NC-SA 4.0**（署名—非商业性使用—相同方式共享）授权，全文见同目录 `LICENSE`，
也可在 https://creativecommons.org/licenses/by-nc-sa/4.0/ 查看。

- 转载、改编请署名：「小本本鲸鱼娘 © Kapozux，CC BY-NC-SA 4.0」，并注明是否做过修改。
- 不得用于商业目的；改编后的作品要用同样的协议发布。
- 这份授权只管本文件夹里的图片。插件代码是 MIT（见仓库根目录 `LICENSE`），字体是 SIL OFL 1.1（见 `../fonts/`）。

## 想加表情图？

同目录放这些名字的透明 PNG（和 `normal.png` 同尺寸 576×680、脚底贴着下边、左右居中）就会自动换上，缺哪张就用 `normal.png` 加代码画的漫画符号：
`happy.png` `sad.png` `surprised.png` `sleepy.png` `shy.png` `thinking.png` `eat.png` `pout.png` `proud.png`。
