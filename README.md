# 🇫🇷 French B2 · 每日法语 (Phase 1)

A free, installable web app (PWA) to train daily for the **DELF/B2** French exam.
约 30 分钟/天：记忆复习 → 新高频词 → 语法 → 阅读 → 听力。
讲解用**中文**，内容用法语。进度保存在你手机本地（localStorage）。

> 当前级别校准：**A2+ → B1**，重点修复基础准确度（动词变位、性数一致、de+le 缩合、否定 ne…pas）并搭建 B1→B2 的桥梁（关系代词、虚拟式、si 条件句、被动语态）。

---

## 📲 怎么用（手机上，全程免费）

### 第 1 步 — 打开 GitHub Pages（一次性，约 2 分钟）
1. 在浏览器打开这个仓库：`heyisvivian/French`
2. 点 **Settings**（设置）→ 左侧 **Pages**
3. **Build and deployment → Source** 选 **Deploy from a branch**
4. **Branch** 选 `claude/french-b2-learning-tool-PRb0G`，文件夹选 `/ (root)`，点 **Save**
5. 等 1–2 分钟，页面顶部会出现一个网址，形如：
   `https://heyisvivian.github.io/French/`

> 之后把内容合并到 `main` 时，把 Pages 的分支改成 `main` 即可。

### 第 2 步 — 装到 iPhone 主屏幕（像 App 一样）
1. 用 **Safari** 打开上面的网址
2. 点底部「分享」按钮 → **添加到主屏幕 (Add to Home Screen)**
3. 主屏幕会出现「French B2」图标 🇫🇷，点开即用，**可离线、保存进度**

> Android：用 Chrome 打开 → 菜单 → **添加到主屏幕**。

### 第 3 步 — 每天打卡
点「开始今日学习」，跟着 5 个板块走完即可。明天的复习会**自动安排**。

---

## 🧠 功能（Phase 1）
- **记忆复习**：间隔重复算法（类似 Anki 的 SM-2），记得牢的词间隔变长，忘了的词很快再出现。
- **新高频词**：每天 8 个，带例句 + 🔊 法语发音（浏览器自带 TTS，免费）。
- **语法**：每天 1 个语法点，中文讲解 + 即时判分的小练习。
- **阅读 / 听力**：短文 + 理解题；听力用法语朗读，可慢速、可看原文。
- **连续打卡 🔥 + 进度统计**。

## 🗂️ 内容怎么扩充
所有内容都是 `data/` 下的 JSON，直接加条目即可，无需改代码：
- `data/vocab.json` — 单词卡（fr / zh / 例句）
- `data/grammar.json` — 语法课 + 练习
- `data/reading.json` — 阅读短文 + 题目
- `data/listening.json` — 听力文本 + 题目

## 🛠️ 本地预览（可选）
```bash
cd French
python3 -m http.server 8099
# 浏览器打开 http://127.0.0.1:8099
```
（不要直接双击 `index.html`，浏览器会因安全限制无法加载 JSON。）

## 🔜 接下来（Phase 2 / 3）
- 扩到 ~12 周完整课程：大词库 + B2 语法大纲 + 阅读/听力题库
- 每两周自动「重新测级」，难度随你水平上升
- 推送提醒、统计面板、DELF B2 模拟考模式

## 隐私
没有服务器、没有账号、不收集数据。学习进度只存在你自己的设备上。
