#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PLUGIN_ID = "Momento";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".webm", ".ogg"]);

function printHelp() {
  console.log(`拾光 CLI

Usage:
  node cli/shiguang.js capture "text" [--date YYYY-MM-DD] [--tag tag1,tag2] [--json]
  node cli/shiguang.js list [--date YYYY-MM-DD] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--tag tag] [--type image|video|audio|file|text|liked] [--json]
  node cli/shiguang.js search "keyword" [filters] [--json]
  node cli/shiguang.js entry get ENTRY_ID [--json]
  node cli/shiguang.js entry update ENTRY_ID [--content text] [--date YYYY-MM-DD] [--tag tag1,tag2] [--json]
  node cli/shiguang.js comment add ENTRY_ID "comment" [--author name] [--json]
  node cli/shiguang.js comment delete ENTRY_ID COMMENT_ID [--json]
  node cli/shiguang.js like ENTRY_ID [--json]
  node cli/shiguang.js unlike ENTRY_ID [--json]
  node cli/shiguang.js media add ENTRY_ID SOURCE_PATH [--type image|video|audio|file] [--vault VAULT_PATH] [--json]
  node cli/shiguang.js transcribe ENTRY_ID [--audio AUDIO_REF_OR_NAME] [--endpoint URL] [--vault VAULT_PATH] [--json]
  node cli/shiguang.js export markdown|json --out PATH [--entry ENTRY_ID] [filters] [--json]
  node cli/shiguang.js doctor [--vault VAULT_PATH] [--json]

Options:
  --data PATH    Path to the plugin data.json. Recommended for agent calls.
  --vault PATH   Obsidian vault path, needed for media copying, transcription and media checks.
  --json         Print machine-readable JSON.

Important:
  The first version writes the plugin data.json directly. Avoid simultaneous edits in the open
  拾光 UI; reload or refresh the plugin after an external write.`);
}

function parseArgs(argv) {
  const args = [];
  const opts = {};
  const flags = new Set(["json"]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (flags.has(key) || !next || next.startsWith("--")) {
      opts[key] = true;
      continue;
    }
    if (opts[key] === undefined) {
      opts[key] = next;
    } else {
      opts[key] = Array.isArray(opts[key]) ? [...opts[key], next] : [opts[key], next];
    }
    i += 1;
  }
  return { args, opts };
}

function defaultData() {
  return {
    settings: {
      children: [],
      attachmentFolder: "life-media",
      sortOrder: "desc",
      sidebarWidth: 260,
      sttEndpoint: "http://127.0.0.1:8765/transcribe",
      sttAutoTranscribe: false,
      randomRoamEnabled: false,
      customTags: ["旅行", "学习", "日常", "健康", "工作", "票据", "重要"],
    },
    entries: [],
  };
}

function resolveDataPath(explicitPath) {
  if (explicitPath) return path.resolve(String(explicitPath));
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "data.json"),
    path.join(cwd, ".obsidian", "plugins", PLUGIN_ID, "data.json"),
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (existing) return existing;
  return path.join(cwd, "data.json");
}

function inferVaultPath(dataPath, explicitVault) {
  if (explicitVault) return path.resolve(String(explicitVault));
  const marker = `${path.sep}.obsidian${path.sep}plugins${path.sep}`;
  const index = dataPath.indexOf(marker);
  return index >= 0 ? dataPath.slice(0, index) : "";
}

function normalizeEntry(entry) {
  const normalized = {
    ...entry,
    id: entry.id,
    date: entry.date || todayDate(),
    childName: "",
    content: entry.content || "",
    images: Array.isArray(entry.images) ? entry.images : [],
    videos: Array.isArray(entry.videos) ? entry.videos : [],
    audios: Array.isArray(entry.audios) ? entry.audios : [],
    files: Array.isArray(entry.files) ? entry.files : [],
    audioTranscripts: entry.audioTranscripts || {},
    likes: Number(entry.likes || 0),
    comments: Array.isArray(entry.comments) ? entry.comments : [],
    createdAt: Number(entry.createdAt || Date.now()),
    ...(Array.isArray(entry.tags) && entry.tags.length ? { tags: entry.tags } : {}),
  };
  delete normalized.subjectName;
  delete normalized.subjectId;
  return normalized;
}

function loadData(dataPath) {
  const defaults = defaultData();
  if (!fs.existsSync(dataPath)) return defaults;
  const raw = fs.readFileSync(dataPath, "utf8").trim();
  if (!raw) return defaults;
  const data = JSON.parse(raw);
  return {
    settings: { ...defaults.settings, ...(data.settings || {}), children: [] },
    entries: Array.isArray(data.entries) ? data.entries.map(normalizeEntry) : [],
  };
}

function saveData(dataPath, data) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  const tmpPath = `${dataPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, dataPath);
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseTags(value, fallback = []) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const tags = items.flatMap((item) => String(item).split(",")).map((tag) => tag.trim()).filter(Boolean);
  return tags.length ? Array.from(new Set(tags)) : fallback;
}

function values(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function findEntry(data, entryId) {
  const entry = data.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error(`找不到记录：${entryId}`);
  return entry;
}

function createEntry(content, opts) {
  return normalizeEntry({
    id: createId(),
    date: opts.date || todayDate(),
    content,
    tags: parseTags(opts.tag || opts.tags, ["Inbox"]),
    createdAt: Date.now(),
  });
}

function mediaTypeFromName(name) {
  const extension = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === ".webm") {
    return /(^|[\\/_-])(voice|audio|record|recording|录音)([\\/_\-.]|$)/i.test(name) ? "audio" : "video";
  }
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return "file";
}

function hasMediaType(entry, type) {
  if (type === "image") return entry.images.length > 0;
  if (type === "video") return entry.videos.length > 0;
  if (type === "audio") return entry.audios.length > 0;
  if (type === "file") return entry.files.length > 0;
  if (type === "liked") return entry.likes > 0;
  if (type === "text") return !!entry.content.trim() && ![...entry.images, ...entry.videos, ...entry.audios, ...entry.files].length;
  return true;
}

function filterEntries(entries, opts, keyword = "") {
  const lowerKeyword = keyword.trim().toLowerCase();
  return entries.filter((entry) => {
    if (opts.date && entry.date !== opts.date) return false;
    if (opts.from && entry.date < opts.from) return false;
    if (opts.to && entry.date > opts.to) return false;
    if (opts.tag && !(entry.tags || []).includes(String(opts.tag))) return false;
    if (opts.type && !hasMediaType(entry, String(opts.type))) return false;
    if (!lowerKeyword) return true;
    const searchable = [
      entry.content,
      entry.date,
      ...(entry.tags || []),
      ...entry.images,
      ...entry.videos,
      ...entry.audios,
      ...entry.files,
      ...Object.values(entry.audioTranscripts || {}),
      ...(entry.comments || []).map((comment) => comment.text),
    ].join(" ").toLowerCase();
    return searchable.includes(lowerKeyword);
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function relativeMediaPath(settings, filename) {
  const folder = String(settings.attachmentFolder || "life-media").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `${folder || "life-media"}/${filename}`.replace(/\/+/g, "/");
}

function uniqueFilePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const extension = path.extname(targetPath);
  const stem = targetPath.slice(0, targetPath.length - extension.length);
  let index = 2;
  let next = `${stem}_${index}${extension}`;
  while (fs.existsSync(next)) {
    index += 1;
    next = `${stem}_${index}${extension}`;
  }
  return next;
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|#\[\]]/g, "_") || `media_${Date.now()}.bin`;
}

function addMediaToEntry(entry, type, relativePath) {
  const field = type === "image" ? "images" : type === "video" ? "videos" : type === "audio" ? "audios" : "files";
  entry[field] = Array.from(new Set([...(entry[field] || []), relativePath]));
}

function output(value, opts, text) {
  console.log(opts.json ? JSON.stringify(value, null, 2) : text);
}

function commentMarkdown(comment) {
  const author = comment.author || "我";
  return `- **${author}**：${comment.text}`;
}

function buildMarkdown(entries) {
  const lines = [
    "---",
    "source: 拾光",
    `exported: ${new Date().toISOString()}`,
    `records: ${entries.length}`,
    "---",
    "",
    "# 拾光导出",
    "",
  ];
  for (const entry of entries) {
    lines.push(`## ${entry.date}`, "");
    if (entry.tags?.length) lines.push(`- 标签：${entry.tags.map((tag) => `#${tag.replace(/\s+/g, "_")}`).join(" ")}`);
    if (entry.likes) lines.push(`- 喜欢：${entry.likes}`);
    if (entry.tags?.length || entry.likes) lines.push("");
    if (entry.content.trim()) lines.push(entry.content.trim(), "");
    const media = [
      ...entry.images.map((item) => `![[${item}]]`),
      ...entry.videos.map((item) => `![[${item}]]`),
      ...entry.audios.map((item) => `![[${item}]]`),
      ...entry.files.map((item) => `[[${item}]]`),
    ];
    if (media.length) lines.push("### 附件", "", ...media, "");
    const transcripts = Object.entries(entry.audioTranscripts || {}).filter(([, text]) => String(text).trim());
    if (transcripts.length) {
      lines.push("### 语音转写", "");
      transcripts.forEach(([audio, text]) => {
        lines.push(`**${path.basename(audio)}**`, "", ...String(text).split(/\r?\n/).map((line) => `> ${line}`), "");
      });
    }
    if (entry.comments?.length) lines.push("### 评论", "", ...entry.comments.map(commentMarkdown), "");
    lines.push("---", "");
  }
  return lines.join("\n");
}

async function transcribe(data, dataPath, entry, opts) {
  const requestedAudio = opts.audio ? String(opts.audio) : "";
  const audioName = requestedAudio
    ? entry.audios.find((audio) => audio === requestedAudio || path.basename(audio) === path.basename(requestedAudio))
    : entry.audios[0];
  if (!audioName) throw new Error("这条记录没有可转写的录音，请使用 --audio 指定录音。");
  const vaultPath = inferVaultPath(dataPath, opts.vault);
  if (!vaultPath) throw new Error("无法推断仓库路径，请提供 --vault PATH。");
  const absoluteAudio = path.resolve(vaultPath, String(audioName).replace(/\//g, path.sep));
  if (!fs.existsSync(absoluteAudio)) throw new Error(`找不到录音文件：${absoluteAudio}`);
  const endpoint = String(opts.endpoint || data.settings.sttEndpoint || "").trim();
  if (!endpoint) throw new Error("未配置语音转文字接口，请使用 --endpoint URL。");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(path.basename(audioName)),
      "X-Language": "zh",
    },
    body: fs.readFileSync(absoluteAudio),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(responseText || `接口返回 ${response.status}`);
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (_) {
    json = null;
  }
  const text = String(json?.text || json?.transcript || json?.result || responseText || "").trim();
  if (!text) throw new Error("接口未返回转写文本。");
  entry.audioTranscripts[audioName] = text;
  saveData(dataPath, data);
  return { entryId: entry.id, audio: audioName, text };
}

async function main() {
  const { args, opts } = parseArgs(process.argv.slice(2));
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  const dataPath = resolveDataPath(opts.data);
  const data = loadData(dataPath);

  if (command === "capture") {
    const content = args.slice(1).join(" ").trim();
    if (!content) throw new Error("capture 需要文字内容。");
    const entry = createEntry(content, opts);
    data.entries.push(entry);
    saveData(dataPath, data);
    output(entry, opts, `Captured: ${entry.id}`);
    return;
  }

  if (command === "list" || command === "search") {
    const keyword = command === "search" ? args.slice(1).join(" ").trim() : "";
    const entries = filterEntries(data.entries, opts, keyword);
    output(entries, opts, entries.length ? entries.map((entry) => `${entry.id}  ${entry.date}  ${entry.content.slice(0, 52)}`).join("\n") : "没有匹配记录。");
    return;
  }

  if (command === "entry") {
    const action = args[1];
    const entry = findEntry(data, args[2]);
    if (action === "get") {
      output(entry, opts, JSON.stringify(entry, null, 2));
      return;
    }
    if (action === "update") {
      if (opts.content !== undefined) entry.content = String(opts.content);
      if (opts.date !== undefined) entry.date = String(opts.date);
      if (opts.tag !== undefined || opts.tags !== undefined) {
        const tags = parseTags(opts.tag || opts.tags);
        if (tags.length) entry.tags = tags;
        else delete entry.tags;
      }
      saveData(dataPath, data);
      output(entry, opts, `Updated: ${entry.id}`);
      return;
    }
    throw new Error("entry 支持 get 或 update。");
  }

  if (command === "comment") {
    const action = args[1];
    const entry = findEntry(data, args[2]);
    if (action === "add") {
      const text = args.slice(3).join(" ").trim();
      if (!text) throw new Error("comment add 需要评论内容。");
      const comment = { id: createId(), text, author: String(opts.author || "我"), createdAt: Date.now() };
      entry.comments.push(comment);
      saveData(dataPath, data);
      output(comment, opts, `Comment added: ${comment.id}`);
      return;
    }
    if (action === "delete") {
      const commentId = args[3];
      const before = entry.comments.length;
      entry.comments = entry.comments.filter((comment) => comment.id !== commentId);
      if (before === entry.comments.length) throw new Error(`找不到评论：${commentId}`);
      saveData(dataPath, data);
      output({ entryId: entry.id, commentId, deleted: true }, opts, `Comment deleted: ${commentId}`);
      return;
    }
    throw new Error("comment 支持 add 或 delete。");
  }

  if (command === "like" || command === "unlike") {
    const entry = findEntry(data, args[1]);
    entry.likes = command === "like" ? entry.likes + 1 : Math.max(0, entry.likes - 1);
    saveData(dataPath, data);
    output({ entryId: entry.id, likes: entry.likes }, opts, `Likes: ${entry.likes}`);
    return;
  }

  if (command === "media") {
    if (args[1] !== "add") throw new Error("media 仅支持 add。");
    const entry = findEntry(data, args[2]);
    const source = args[3] ? path.resolve(args[3]) : "";
    if (!source || !fs.existsSync(source)) throw new Error("media add 需要存在的 SOURCE_PATH。");
    const vaultPath = inferVaultPath(dataPath, opts.vault);
    if (!vaultPath) throw new Error("media add 需要 --vault PATH。");
    const type = String(opts.type || mediaTypeFromName(source));
    if (!["image", "video", "audio", "file"].includes(type)) throw new Error("媒体类型应为 image、video、audio 或 file。");
    const desiredRelative = relativeMediaPath(data.settings, safeFilename(path.basename(source)));
    const destination = uniqueFilePath(path.resolve(vaultPath, desiredRelative.replace(/\//g, path.sep)));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    const relative = path.relative(vaultPath, destination).replace(/\\/g, "/");
    addMediaToEntry(entry, type, relative);
    saveData(dataPath, data);
    output({ entryId: entry.id, type, path: relative }, opts, `Media added: ${relative}`);
    return;
  }

  if (command === "transcribe") {
    const entry = findEntry(data, args[1]);
    const result = await transcribe(data, dataPath, entry, opts);
    output(result, opts, result.text);
    return;
  }

  if (command === "export") {
    const format = args[1] || "markdown";
    const outPath = opts.out ? path.resolve(String(opts.out)) : "";
    if (!outPath) throw new Error("export 需要 --out PATH。");
    let entries = filterEntries(data.entries, opts, "");
    const entryIds = values(opts.entry).map(String);
    if (entryIds.length) entries = entries.filter((entry) => entryIds.includes(entry.id));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (format === "markdown" || format === "md") {
      fs.writeFileSync(outPath, buildMarkdown(entries), "utf8");
    } else if (format === "json") {
      fs.writeFileSync(outPath, JSON.stringify({ source: "拾光", exportedAt: new Date().toISOString(), entries }, null, 2), "utf8");
    } else {
      throw new Error("export 格式应为 markdown 或 json。");
    }
    output({ path: outPath, format, entries: entries.length }, opts, `Exported ${entries.length}: ${outPath}`);
    return;
  }

  if (command === "doctor") {
    const vaultPath = inferVaultPath(dataPath, opts.vault);
    const missingMedia = [];
    for (const entry of data.entries) {
      for (const media of [...entry.images, ...entry.videos, ...entry.audios, ...entry.files]) {
        if (vaultPath && !fs.existsSync(path.resolve(vaultPath, media.replace(/\//g, path.sep)))) {
          missingMedia.push({ entryId: entry.id, media });
        }
      }
    }
    const report = {
      dataPath,
      vaultPath: vaultPath || null,
      entries: data.entries.length,
      images: data.entries.reduce((count, entry) => count + entry.images.length, 0),
      videos: data.entries.reduce((count, entry) => count + entry.videos.length, 0),
      audios: data.entries.reduce((count, entry) => count + entry.audios.length, 0),
      files: data.entries.reduce((count, entry) => count + entry.files.length, 0),
      comments: data.entries.reduce((count, entry) => count + entry.comments.length, 0),
      transcripts: data.entries.reduce((count, entry) => count + Object.keys(entry.audioTranscripts).length, 0),
      missingMedia,
    };
    output(report, opts, `记录 ${report.entries} 条；媒体缺失 ${missingMedia.length} 个。`);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
