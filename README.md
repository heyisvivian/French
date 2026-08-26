# 🇫🇷 法语语法练习 · Grammaire française

A free, installable web app (PWA) for daily **French grammar training (B1 → B2-C1)**.
每天约 45 分钟：错题重练 → 双语法主题 → 动词变位 → 双篇语法阅读。
讲解用**中文**，内容用法语。进度保存在你手机本地（localStorage）。

> 当前难度：**B2 为主，部分 C1**。虚拟式过去时、时态呼应、分词配合、被动语态、复合关系代词、ne explétif……新内容排在轮换队列前部，会最先练到。

---

## 📅 每次 session 的结构

| 板块 | 内容 | 量 |
|---|---|---|
| 📕 错题重练 | 之前做错的题，**连对 2 次**才移出错题本 | ≤12 |
| ✍️ 语法主题 ×2 | 中文讲解 + 每课约 8 道练习 | ~16 题 |
| 🔤 动词变位 ×4 组 | 打字填空，含虚拟式/条件式过去/先将来时等 | ~24 题 |
| 📖 语法阅读 ×2 | 300 词左右 B2-C1 文章，语法点高亮可点击，7 题混合（细节/推断/语法分析/词汇） | ~14 题 |

一次 session 共 **50-65 题**，明天自动轮换到下一批内容。

## 🧠 App 如何「了解」你的学习

- **错题本**：答错的每道题自动入本，之后每次 session 开场重练，连对 2 次才算掌握。
- **主题正确率**：每道题都归属一个主题（语法课名 / 时态 / 题型），终身累计正确率。
- **学习报告**（首页按钮）：薄弱主题排行、错题清单、总数据。

## 🤖 自我进化循环（重要）

App 是纯静态的，不会自己变聪明。进化方式：

1. 练一段时间后，打开 **学习报告 → 「复制给 Claude 的更新指令」**
2. 把剪贴板内容粘贴给 Claude（Claude Code 或 claude.ai，需要能访问这个仓库）
3. Claude 会根据你的薄弱主题和错题，生成**针对性的新课程、新变位组、错题变体和新阅读**，提交 PR
4. 合并 PR 后，App 下次联网打开时自动拉到新内容（数据文件走网络优先策略）

建议每 1-2 周做一次。

## 💾 我的数据在哪里？

- **学习进度**（错题本、正确率、连续天数）：只存在**当前设备当前浏览器**的 localStorage 里。不换设备、不清浏览器数据就一直在；**清 Safari 网站数据或卸载 PWA 会丢**。
- **练习内容**：在这个 GitHub 仓库的 `data/*.json` 里，所有设备共享。
- **换设备/防丢失**：学习报告 → 「导出备份」复制 JSON → 新设备「导入备份」粘贴即可。

## 📲 手机安装（一次性）

1. 用 **Safari** 打开 GitHub Pages 地址（Settings → Pages 里可见，形如 `https://heyisvivian.github.io/French-daily/`）
2. 分享按钮 → **添加到主屏幕**
3. 主屏幕出现「法语语法」图标，点开即用，可离线

## 🗂️ 内容文件（Claude 更新的对象）

- `data/grammar.json` — 语法课（title/explain_zh/examples/exercises），新课放数组**前部**
- `data/conjugation.json` — 变位组（tense_zh/rule_zh/items，打字填空），新组放**前部**
- `data/reading.json` — 语法阅读（text_fr/grammar_focus/questions）；`grammar_focus[].quote` 必须与原文**逐字一致**（含撇号），否则高亮不生效
- `data/knowledge.json` — 知识库主题（可随时在 App 内查阅）
- `data/vocab.json` — 旧词卡（仅用于到期复习，不再引入新词）
- 改完数据请 bump `sw.js` 里的 `CACHE` 版本号

## 🛠️ 本地预览

```bash
cd French-daily
python3 -m http.server 8099
# 浏览器打开 http://127.0.0.1:8099
```

（不要直接双击 `index.html`，浏览器会因安全限制无法加载 JSON。）

## 隐私

没有服务器、没有账号、不收集数据。学习进度只存在你自己的设备上。
