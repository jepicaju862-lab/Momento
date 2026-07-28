# Momento (拾光)

<p align="center">
  <img src="https://img.shields.io/badge/Obsidian-v0.15.0%2B-purple?style=flat-square&logo=obsidian" alt="Obsidian Version">
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square" alt="License: GPLv3">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome">
</p>

<p align="center">
  <a href="#english">English</a> • <a href="#简体中文">简体中文</a>
</p>

---

<a name="english"></a>
## English

### Overview
**Momento (拾光)** is a local-first life logging and memory vault plugin for Obsidian. It seamlessly integrates text notes, photos, videos, voice recordings, attachments, timeline feeds, calendar overviews, media galleries, 3D nebula memory roaming, speech-to-text (STT), and mobile LAN capture into a unified Obsidian view.

> **Core Philosophy:** *Capture immediately, organize effortlessly.*

---

### Key Features
- 📅 **Timeline View**: Chronological feed of all your life moments. Easily filter by text, photos, videos, voice recordings, attachments, or favorites.
- 📥 **Inbox & Quick Capture**: Dedicated sidebar panel for rapid capture of thoughts, voice memos, screenshots, and tags with `Ctrl/Cmd + Enter` shortcut support.
- 📆 **Calendar View**: Visual monthly overview showing daily record frequency and media indicators. Click any date to jump straight to its timeline entry.
- 🖼️ **Media Gallery**: Centralized vault resource browser for images, videos, audio clips, and documents.
- 🌌 **3D Nebula Memory Roaming**: Transform your photo memories into interactive starfields! Explore across 3D Spiral Galaxy, Nebula Disk, and Universe space modes, or launch a fullscreen **Memory Walk** slideshow.
- 🎙️ **Voice Recording & Local STT**: Record audio directly within Obsidian and auto-transcribe audio notes using local `faster-whisper` STT services.
- 📱 **Mobile LAN Quick Capture**: Lightweight local HTTP server enabling quick record creation from iOS Shortcuts or Android (Tasker/MacroDroid) without opening the Obsidian app.
- 📄 **Markdown Export**: Export selected records to structured Markdown files complete with embedded media links, comments, and transcripts.
- 🤖 **Agent & CLI Integration**: Built-in CLI tool (`cli/shiguang.js`) allowing AI agents to capture, search, comment, like, and export records.

---

### Installation

#### Obsidian Community Plugin Store (Pending Submission)
1. Open **Obsidian Settings** > **Community plugins**.
2. Click **Browse** and search for `Momento`.
3. Click **Install**, then **Enable**.

#### Manual Installation
1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Create a folder named `.obsidian/plugins/Momento/` inside your Obsidian vault.
3. Copy the downloaded files into `.obsidian/plugins/Momento/`.
4. Reload Obsidian and enable **Momento** in **Community plugins**.

---

### Quick Start

1. Click the **Momento** icon on the left ribbon or execute the command `Momento: Open Momento` (打开拾光).
2. Click the `+` button in the top bar or use the Inbox sidebar to quickly log thoughts or media.
3. Switch between **Timeline**, **Calendar**, **Gallery**, and **3D Roaming** tabs to browse and search your entries.

#### Local Speech-to-Text (STT) Setup
Momento supports transcription via a local HTTP server (default: `http://127.0.0.1:8765/transcribe`).
Start the included Python `faster-whisper` server:
```powershell
python tools/stt_server.py
```

#### Mobile LAN Capture Setup
Capture memories from your mobile device without opening Obsidian:
```powershell
node tools/capture_server.js --data "<vault>\.obsidian\plugins\Momento\data.json" --vault "<vault>"
```
Configure iOS Shortcuts or Android (Tasker / MacroDroid) to send POST requests to `http://<LAN-IP>:8766/capture` or `/voice`.

---

### Ecosystem & Recommended Plugins
Explore complementary plugins and official resources for Obsidian:
- 🌐 **Official Site & Recommended Plugins**: Visit [Peyote Official Website](https://peyote.info/) for featured Obsidian plugins and productivity tools.

---

### License
This project is licensed under the **GNU General Public License v3.0 (GPLv3)**. See the [LICENSE](LICENSE) file for details.

---

<a name="简体中文"></a>
## 简体中文

### 插件简介
**拾光 (Momento)** 是一款面向 Obsidian 的本地优先生活记录与记忆管理插件。它将文字、照片、视频、录音、普通文件、时间线、日历、资源库、3D 星空漫游、语音转写和手机快速录入整合到一个独立高效的 Obsidian 视图中。

> **核心理念：** *先收进来，稍后再整理。*

---

### 核心功能

- 📅 **时间线视图**：按日期串联生活记录，支持按文字、图片、视频、录音、文件、纯文字和喜欢分类筛选。
- 📥 **Inbox 快速采集**：侧栏快速输入文字、粘贴图片、拍摄照片、录制语音、打标签，支持 `Ctrl/Cmd + Enter` 快捷保存。
- 📆 **日历视图**：以月历形式查看每天记录数量与媒体类型摘要，点击任意日期即可跳转对应时间线。
- 🖼️ **资源库视图**：集中管理 Obsidian 仓库中的图片、视频、音频和文档，支持关键词与标签检索。
- 🌌 **3D 星云漫游**：把照片变成闪耀星点，在螺旋星系、星云盘面、宇宙视角间沉浸式穿梭，支持全屏「拾光漫步」照片轮播。
- 🎙️ **语音录制与本地转写**：内置录音功能，可无缝对接本地 `faster-whisper` HTTP 服务进行自动/手动语音转文字。
- 📱 **手机局域网快录**：内置轻量级后台 HTTP 服务，无需在手机上打开 Obsidian 即可通过 iOS 快捷指令或 Android 自动化工具一键推送记录与音频。
- 📄 **Markdown 导出**：可批量选择记录并导出为标准 Obsidian Markdown 文件，完整保留媒体链接、评论和语音转写。
- 🤖 **CLI 与 Agent 接口**：提供独立的 CLI 工具（`cli/shiguang.js`），方便 AI Agent 直接进行数据采集、检索、点赞、评论和数据导出。

---

### 安装说明

#### 社区插件市场安装（准备上架）
1. 打开 **Obsidian 设置** -> **第三方插件**。
2. 点击 **社区插件市场** 并搜索 `Momento` 或 `拾光`。
3. 点击 **安装**，安装完成后启用插件。

#### 手动安装
1. 从 Releases 页面下载 `manifest.json`、`main.js` 和 `styles.css`。
2. 在您的 Obsidian 仓库中创建目录 `.obsidian/plugins/Momento/`。
3. 将下载的文件放入该目录。
4. 重新加载 Obsidian 并启用 **拾光 (Momento)** 插件。

---

### 快速上手

1. 点击 Obsidian 左侧边栏的 **拾光** 图标，或执行命令 `打开拾光`。
2. 点击顶部 `+` 按钮或在侧栏 Inbox 快速采集框中录入片段与附件。
3. 在 **时间线**、**日历**、**资源库** 与 **漫游** 标签页之间自由切换，回看与检索生活回忆。

#### 本地语音转文字 (STT) 配置
插件支持调用本地语音转写服务（默认接口 `http://127.0.0.1:8765/transcribe`）。
启动配套服务：
```powershell
python tools/stt_server.py
```

#### 手机局域网录入服务
无需打开 Obsidian，通过手机快捷指令录入：
```powershell
node tools/capture_server.js --data "<vault>\.obsidian\plugins\Momento\data.json" --vault "<vault>"
```
配合 iOS 快捷指令或 Android (Tasker / MacroDroid)，发送 POST 请求至 `http://<局域网IP>:8766/capture` 或 `/voice` 即可。

---

### 推荐插件与相关生态
探索更多优秀的 Obsidian 插件与扩展工具：
- 🌐 **官网与推荐插件**：欢迎访问 [Peyote 官网 (peyote.info)](https://peyote.info/) 了解更多精选 Obsidian 插件及实用工具。

---

### 开源协议
本项目采用 **GNU General Public License v3.0 (GPLv3)** 开源协议。详情请参阅 [LICENSE](LICENSE) 文件。
