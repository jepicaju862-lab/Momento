import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "cli", "shiguang.js");
const tempRoot = path.join(root, ".smoke-shiguang-cli");
const vault = path.join(tempRoot, "vault");
const dataPath = path.join(vault, ".obsidian", "plugins", "Momento", "data.json");

function run(args) {
  return execFileSync(process.execPath, [cli, "--data", dataPath, "--vault", vault, "--json", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function json(args) {
  return JSON.parse(run(args));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dataPath), { recursive: true });

try {
  const entry = json(["capture", "今天记录了一场安静的会议", "--date", "2026-05-26", "--tag", "工作,会议"]);
  assert(entry.content.includes("会议"), "capture did not store content");
  assert(entry.childName === "", "capture reintroduced child information");
  assert(entry.tags.includes("工作"), "capture did not store tags");

  const sourceAudio = path.join(tempRoot, "sample.m4a");
  fs.writeFileSync(sourceAudio, "mock-audio", "utf8");
  const attached = json(["media", "add", entry.id, sourceAudio, "--type", "audio"]);
  assert(attached.path.startsWith("life-media/"), "media path did not use the plugin folder");
  assert(fs.existsSync(path.join(vault, attached.path)), "media was not copied into the vault");

  const comment = json(["comment", "add", entry.id, "会后整理行动项"]);
  assert(comment.text === "会后整理行动项", "comment add failed");

  const liked = json(["like", entry.id]);
  assert(liked.likes === 1, "like failed");

  json(["entry", "update", entry.id, "--content", "会议记录已整理", "--tag", "工作,复盘"]);
  const updated = json(["entry", "get", entry.id]);
  assert(updated.audios.length === 1, "audio relation disappeared after update");
  assert(updated.comments.length === 1, "comment relation disappeared after update");

  const search = json(["search", "行动项"]);
  assert(search.length === 1 && search[0].id === entry.id, "search did not inspect comments");

  const exportPath = path.join(tempRoot, "export.md");
  const exported = json(["export", "markdown", "--entry", entry.id, "--out", exportPath]);
  assert(exported.entries === 1 && fs.existsSync(exportPath), "markdown export failed");
  const markdown = fs.readFileSync(exportPath, "utf8");
  assert(markdown.includes("会议记录已整理") && markdown.includes("会后整理行动项"), "markdown export missed data");

  const report = json(["doctor"]);
  assert(report.entries === 1, "doctor entry count mismatch");
  assert(report.audios === 1 && report.comments === 1, "doctor media/comment counts mismatch");
  assert(report.missingMedia.length === 0, "doctor reported copied media as missing");

  console.log("拾光 CLI smoke passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
