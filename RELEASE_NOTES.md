# Momento (拾光) v1.0.7

This release resolves all blocking issues reported by Obsidian's automated review for v1.0.6.

- Replaced direct style assignments with Obsidian's `setCssProps` helper.
- Rendered Markdown with a dedicated short-lived `Component` to prevent lifecycle leaks.
- Replaced user-agent platform detection with Obsidian's `Platform` API.
- Adopted official settings headings and removed unsafe `innerHTML` assignments.
- Raised the declared minimum Obsidian version to 1.13.0 for the APIs used by Momento.
- Added the official `eslint-plugin-obsidianmd` review rules to local validation.
- Preserved GitHub artifact attestations for `main.js`, `styles.css`, and `manifest.json`.

---

# Momento (拾光) v1.0.0 - Initial Public Release 🎉

[English](#english) | [简体中文](#简体中文)

---

<a name="english"></a>
## 🇬🇧 English

We are excited to announce the first official release of **Momento (拾光) v1.0.0**!

Momento is a local-first life logging and memory vault plugin designed for Obsidian. It seamlessly unifies text notes, photos, videos, audio recordings, files, timeline views, calendar overviews, media galleries, 3D nebula memory roaming, local speech-to-text (STT), and mobile quick capture into a single, beautiful Obsidian experience.

### ✨ Highlights & Features

- 📅 **Timeline View**: Chronological feed of your daily logs. Filter instantly by text, photos, videos, voice recordings, attachments, or favorites.
- 📥 **Inbox & Quick Capture**: Sidebar panel for rapid entry of thoughts, voice memos, screenshots, and tags with `Ctrl/Cmd + Enter` shortcut.
- 📆 **Calendar Overview**: Visual monthly calendar displaying daily record counts and media icons. Click any date to jump straight to its timeline entry.
- 🖼️ **Media Gallery**: Centralized vault resource browser for images, videos, audio clips, and documents stored locally in your vault (`life-media`).
- 🌌 **3D Nebula Memory Roaming**: Transform your photos into interactive starfields! Explore memories across 3D Spiral Galaxy, Nebula Disk, and Universe space views, or start a fullscreen **Memory Walk** slideshow.
- 🎙️ **Voice Recording & Local STT**: Record voice memos directly inside Obsidian and transcribe them automatically or on-demand using local `faster-whisper` STT services (`tools/stt_server.py`).
- 📱 **Mobile LAN Capture**: Includes a standalone HTTP capture server (`tools/capture_server.js`) allowing quick record creation from iOS Shortcuts or Android (Tasker/MacroDroid) without opening Obsidian.
- 📄 **Markdown Exporter**: Batch-select entries and export them into structured Markdown files complete with embedded media links, comments, and transcripts.
- 🤖 **Agent & CLI Automation**: Comes with a CLI tool (`cli/shiguang.js`) enabling AI agents to capture, search, comment, like, and export memories programmatically.

### 📦 Installation Assets

For manual installation, download the following files from this release and place them into your vault at `.obsidian/plugins/Momento/`:
- `manifest.json`
- `main.js`
- `styles.css`

### 🌐 Recommended Ecosystem
Explore featured Obsidian tools and extensions at [Peyote Official Website](https://peyote.info/).

### ⚖️ License
This release is licensed under the **GNU General Public License v3.0 (GPLv3)**.

---

<a name="简体中文"></a>
## 🇨🇳 简体中文

我们非常高兴地宣布 **拾光 (Momento) v1.0.0** 首个正式版本发布！

拾光是一款面向 Obsidian 的本地优先生活记录与回忆沉淀插件。它将文字、照片、视频、录音、普通文件、时间线、日历、资源库、3D 星云漫游、语音转写和手机局域网快录整合到一个独立高效的 Obsidian 视图中。

### ✨ 核心功能与亮点

- 📅 **时间线视图**：按日期串联日常记录，支持按文字、图片、视频、录音、文件、纯文字和喜欢精准筛选。
- 📥 **Inbox 快速采集**：侧栏快捷录入面板，支持文字、图片粘贴、拍照、录音与标签打选，按 `Ctrl/Cmd + Enter` 即可快速发送。
- 📆 **日历视图**：以月历展示每日记录频次与媒体分布，点击任意日期直接跳转时间线。
- 🖼️ **资源库视图**：集中管理仓库（默认 `life-media`）内的照片、视频、音频和文档，支持关键词与标签搜索。
- 🌌 **3D 星云漫游**：将所有照片映射为浩瀚星空中的闪耀星点，支持螺旋星系、星云盘面、宇宙视角沉浸穿梭，并提供全屏「拾光漫步」照片轮播播放。
- 🎙️ **语音录制与本地 STT**：内置录音功能，支持对接本地 `faster-whisper` 服务（`tools/stt_server.py`）进行自动或手动的语音转文字。
- 📱 **手机局域网快录后台**：内置独立 HTTP 服务（`tools/capture_server.js`），支持通过 iOS 快捷指令或 Android 自动化工具在不打开 Obsidian 的情况下快速推送文字与语音。
- 📄 **Markdown 导出**：可自由勾选多条记录导出为标准的 Obsidian Markdown 笔记，完整包含媒体链接、评论与转写文本。
- 🤖 **CLI 与 Agent 自动化**：内置 CLI 工具（`cli/shiguang.js`），方便 AI Agent 进行数据采集、检索、点赞、评论和数据导出。

### 📦 安装资产

如需手动安装，请下载本 Release 提供的以下文件并放入仓库目录 `.obsidian/plugins/Momento/` 中：
- `manifest.json`
- `main.js`
- `styles.css`

### 🌐 推荐生态与拓展
访问 [Peyote 官网 (peyote.info)](https://peyote.info/) 探索更多精选 Obsidian 插件与实用工具。

### ⚖️ 开源协议
本项目采用 **GNU General Public License v3.0 (GPLv3)** 开源协议。
