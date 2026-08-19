import { ItemView, WorkspaceLeaf, normalizePath, setIcon, Notice, MarkdownRenderer } from 'obsidian';
import ChildTimelinePlugin from './main';
import { Platform, setCssProps } from 'obsidian';
import { TFile } from 'obsidian';
import { ChildInfo, TimelineEntry } from './settings';
import { AddPostModal } from './post-modal';
import { CameraCaptureModal, openImageSourceMenu, prefersNativeCameraPicker } from './media-capture';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import { MemoryWalkApp } from './components/MemoryWalkApp';

export const TIMELINE_VIEW_TYPE = "child-timeline-view";

type ViewMode = 'timeline' | 'calendar' | 'gallery' | 'memory-walk';

interface RenderedPost {
    entry: TimelineEntry;
    date: Date;
    ageStr: string;
    ageYear: number;
    ageMonth: number;
}

interface MonthGroup {
    ageMonth: number;
    label: string;
    posts: RenderedPost[];
}

interface AgeGroup {
    ageYear: number;
    label: string;
    months: MonthGroup[];
    posts: RenderedPost[];
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.webm', '.ogg'];

type InboxSelectedFile = { file: File; buffer: ArrayBuffer };
type InboxSavedMedia = { images: string[]; videos: string[]; audios: string[]; files: string[] };

export class TimelineView extends ItemView {
    plugin: ChildTimelinePlugin;
    activeChildIndex = 0;
    viewMode: ViewMode = 'timeline';

    ageGroups: AgeGroup[] = [];
    allPosts: RenderedPost[] = [];
    mainEl: HTMLElement | null = null;
    sidebarEl: HTMLElement | null = null;
    calMonth: number;
    calYear: number;
    calSelectedDate: string | null = null;
    private scrollHandler: (() => void) | null = null;
    searchQuery = '';
    searchFilter: 'all' | 'image' | 'video' | 'audio' | 'file' | 'text' | 'liked' = 'all';
    searchTag: string | null = null;
    gallerySearchQuery = '';
    hasRandomRoamed = false;
    selectionMode = false;
    selectedEntryIds = new Set<string>();
    
    timelineObserver: IntersectionObserver | null = null;
    galleryObserver: IntersectionObserver | null = null;
    reactRoot: Root | null = null;

    private scrollElementIntoTimeline(el: HTMLElement, block: 'start' | 'center' = 'center') {
        if (!this.mainEl) {
            el.scrollIntoView({ behavior: 'smooth', block });
            return;
        }

        const mainRect = this.mainEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = block === 'center'
            ? (mainRect.height - elRect.height) / 2
            : 24;
        const top = this.mainEl.scrollTop + elRect.top - mainRect.top - offset;

        this.mainEl.scrollTo({
            top: Math.max(0, top),
            behavior: 'smooth'
        });
    }

    constructor(leaf: WorkspaceLeaf, plugin: ChildTimelinePlugin) {
        super(leaf);
        this.plugin = plugin;
        const now = new Date();
        this.calYear = now.getFullYear();
        this.calMonth = now.getMonth();
    }

    getViewType() { return TIMELINE_VIEW_TYPE; }
    getDisplayText() { return "拾光"; }
    getIcon() { return "inbox"; }

    async onOpen() {
        await this.renderView();
        
        // Random roam on initial load
        if (this.plugin.data.settings.randomRoamEnabled && !this.hasRandomRoamed && this.viewMode === 'timeline' && this.allPosts.length > 0) {
            this.hasRandomRoamed = true;
            const randomIndex = Math.floor(Math.random() * this.allPosts.length);
            const randomPost = this.allPosts[randomIndex];
            const dateStr = `${randomPost.date.getFullYear()}-${String(randomPost.date.getMonth() + 1).padStart(2, '0')}-${String(randomPost.date.getDate()).padStart(2, '0')}`;
            setTimeout(() => {
                this.jumpToDate(dateStr);
            }, 300);
        }

        this.registerEvent(this.app.workspace.on('child-timeline-settings-updated', () => this.renderView()));
        this.registerEvent(this.app.workspace.on('child-timeline-data-changed', () => this.renderView()));
        this.registerEvent(this.app.workspace.on('shiguang-jump-to-entry', (entryId: string) => {
            void this.jumpToEntry(entryId);
        }));
    }

    async onClose() {
        if (this.scrollHandler && this.mainEl) this.mainEl.removeEventListener('scroll', this.scrollHandler);
        if (this.timelineObserver) this.timelineObserver.disconnect();
        if (this.galleryObserver) this.galleryObserver.disconnect();
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }
    }

    // ============ Utilities ============

    fmtDate(d: Date): string { return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; }
    fmtShortDate(d: Date): string { return `${d.getMonth()+1}/${d.getDate()}`; }
    relativeDateLabel(d: Date): string {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((todayStart - dateStart) / 86400000);
        if (diffDays === 0) return '今天';
        if (diffDays === 1) return '昨天';
        if (diffDays > 1) return `${diffDays}天前`;
        if (diffDays === -1) return '明天';
        return `${Math.abs(diffDays)}天后`;
    }
    fmtTime(ts: number): string {
        const d = new Date(ts);
        return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    resolveMediaSrc(fileName: string): string {
        const p = this.plugin.resolveMediaPath(fileName);
        const file = this.app.vault.getAbstractFileByPath(p);
        return file ? this.app.vault.getResourcePath(file as any) : p;
    }

    resolveMediaInfo(fileName: string): { ok: boolean; src: string; path: string; reason?: string } {
        const path = this.plugin.resolveMediaPath(fileName);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            return { ok: false, src: path, path, reason: '文件不存在' };
        }
        if ((file.stat?.size || 0) <= 0) {
            return { ok: false, src: path, path, reason: '文件为空或已损坏' };
        }
        return { ok: true, src: this.app.vault.getResourcePath(file), path };
    }

    renderMediaPlaceholder(parent: HTMLElement, fileName: string, reason = '无法预览') {
        const box = parent.createDiv('timeline-media-placeholder');
        setIcon(box.createSpan('timeline-media-placeholder-icon'), 'image-off');
        const body = box.createDiv('timeline-media-placeholder-body');
        body.createSpan('timeline-media-placeholder-title').setText(reason);
        body.createSpan('timeline-media-placeholder-name').setText(fileName.split('/').pop() || fileName);
        return box;
    }

    mediaCount(entry: TimelineEntry): number {
        return (entry.images?.length || 0) + (entry.videos?.length || 0) + (entry.audios?.length || 0) + (entry.files?.length || 0);
    }

    mediaNames(entry: TimelineEntry): string[] {
        return [...(entry.images || []), ...(entry.videos || []), ...(entry.audios || []), ...(entry.files || [])];
    }

    mediaWikiPath(fileName: string): string {
        return this.plugin.resolveMediaPath(fileName);
    }

    dateKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    postsForDateKey(dateKey: string): RenderedPost[] {
        return this.getFilteredPosts().filter(post => this.dateKey(post.date) === dateKey);
    }

    togglePostSelection(entryId: string) {
        if (this.selectedEntryIds.has(entryId)) {
            this.selectedEntryIds.delete(entryId);
        } else {
            this.selectedEntryIds.add(entryId);
        }

        const postEl = this.containerEl.querySelector(`.timeline-post[data-entry-id="${entryId}"]`) as HTMLElement | null;
        postEl?.toggleClass('is-selected', this.selectedEntryIds.has(entryId));

        const selectBtn = postEl?.querySelector('.timeline-post-select') as HTMLElement | null;
        if (selectBtn) {
            selectBtn.empty();
            setIcon(selectBtn, this.selectedEntryIds.has(entryId) ? 'check' : 'circle');
        }

        this.updateExportSelectionUi();
        const post = this.allPosts.find(item => item.entry.id === entryId);
        if (post) this.updateDateSelectButtons(this.dateKey(post.date));
    }

    toggleDateSelection(dateKey: string) {
        const posts = this.postsForDateKey(dateKey);
        if (posts.length === 0) return;

        const shouldSelect = !posts.every(post => this.selectedEntryIds.has(post.entry.id));
        for (const post of posts) {
            if (shouldSelect) this.selectedEntryIds.add(post.entry.id);
            else this.selectedEntryIds.delete(post.entry.id);

            const postEl = this.containerEl.querySelector(`.timeline-post[data-entry-id="${post.entry.id}"]`) as HTMLElement | null;
            postEl?.toggleClass('is-selected', this.selectedEntryIds.has(post.entry.id));
            const selectBtn = postEl?.querySelector('.timeline-post-select') as HTMLElement | null;
            if (selectBtn) {
                selectBtn.empty();
                setIcon(selectBtn, this.selectedEntryIds.has(post.entry.id) ? 'check' : 'circle');
            }
        }

        this.updateDateSelectButtons(dateKey);
        this.updateExportSelectionUi();
    }

    updateDateSelectButtons(dateKey?: string) {
        const selector = dateKey ? `.timeline-day-select[data-date-key="${dateKey}"]` : '.timeline-day-select';
        this.containerEl.querySelectorAll(selector).forEach(button => {
            const btn = button as HTMLButtonElement;
            const key = btn.dataset.dateKey || '';
            const posts = this.postsForDateKey(key);
            const allSelected = posts.length > 0 && posts.every(post => this.selectedEntryIds.has(post.entry.id));
            const hasSelected = posts.some(post => this.selectedEntryIds.has(post.entry.id));
            btn.toggleClass('is-selected', allSelected);
            btn.setAttr('aria-label', allSelected ? '取消选择当天' : '全选当天');
            btn.setAttr('title', allSelected ? '取消选择当天' : '全选当天');
            btn.empty();
            setIcon(btn.createSpan('timeline-day-select-icon'), allSelected ? 'check-circle-2' : 'circle');
            btn.createSpan('timeline-day-select-text').setText(allSelected ? '取消' : '全选');

            const exportBtn = btn.parentElement?.querySelector('.timeline-day-export') as HTMLButtonElement | null;
            if (exportBtn) {
                exportBtn.toggleClass('is-visible', hasSelected);
                exportBtn.disabled = this.selectedEntryIds.size === 0;
                exportBtn.querySelector('.timeline-day-export-count')?.setText(String(this.selectedEntryIds.size));
            }
        });
    }

    updateExportSelectionUi() {
        const count = this.selectedEntryIds.size;
        this.containerEl.querySelectorAll('.timeline-day-export-count').forEach(el => el.setText(String(count)));
        this.containerEl.querySelectorAll('.timeline-day-export').forEach(el => {
            (el as HTMLButtonElement).disabled = count === 0;
        });
    }

    exportFileStamp(date = new Date()): string {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
    }

    exportDisplayStamp(date = new Date()): string {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    sanitizeObsidianTag(tag: string): string {
        return tag
            .replace(/^#+/, '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[\\/#\[\]|^:*?"<>]/g, '_');
    }

    async uniqueMarkdownPath(basePath: string): Promise<string> {
        const normalized = normalizePath(basePath);
        if (!this.app.vault.getAbstractFileByPath(normalized)) return normalized;

        const dot = normalized.lastIndexOf('.');
        const stem = dot >= 0 ? normalized.slice(0, dot) : normalized;
        const ext = dot >= 0 ? normalized.slice(dot) : '.md';
        let index = 2;
        let next = normalizePath(`${stem}_${index}${ext}`);
        while (this.app.vault.getAbstractFileByPath(next)) {
            index += 1;
            next = normalizePath(`${stem}_${index}${ext}`);
        }
        return next;
    }

    buildExportMarkdown(posts: RenderedPost[]): string {
        const exportedAt = this.exportDisplayStamp();
        const lines: string[] = [
            '---',
            'source: 拾光',
            `exported: ${exportedAt}`,
            `records: ${posts.length}`,
            '---',
            '',
            `# 拾光导出 ${exportedAt}`,
            ''
        ];

        for (const post of posts) {
            const entry = post.entry;
            const tags = (entry.tags || []).filter(Boolean);
            const tagLine = tags
                .map(tag => this.sanitizeObsidianTag(tag))
                .filter(Boolean)
                .map(tag => `#${tag}`)
                .join(' ');
            const comments = entry.comments || [];

            lines.push(`## ${post.ageStr} · ${this.fmtDate(post.date)}`);
            lines.push('');
            if (tagLine || entry.likes || entry.createdAt) {
                lines.push(`- 日期：${entry.date}`);
                if (tagLine) lines.push(`- 标签：${tagLine}`);
                if (entry.likes) lines.push(`- 喜欢：${entry.likes}`);
                if (entry.createdAt) lines.push(`- 创建：${this.exportDisplayStamp(new Date(entry.createdAt))}`);
                lines.push('');
            }

            if (entry.content?.trim()) {
                lines.push(entry.content.trim());
                lines.push('');
            }

            const mediaBlocks: string[] = [];
            for (const img of entry.images || []) mediaBlocks.push(`![[${this.mediaWikiPath(img)}]]`);
            for (const vid of entry.videos || []) mediaBlocks.push(`![[${this.mediaWikiPath(vid)}]]`);
            for (const audio of entry.audios || []) mediaBlocks.push(`![[${this.mediaWikiPath(audio)}]]`);
            for (const file of entry.files || []) mediaBlocks.push(`[[${this.mediaWikiPath(file)}]]`);
            if (mediaBlocks.length > 0) {
                lines.push('### 附件');
                lines.push('');
                lines.push(...mediaBlocks);
                lines.push('');
            }

            const transcripts = Object.entries(entry.audioTranscripts || {}).filter(([, text]) => text?.trim());
            if (transcripts.length > 0) {
                lines.push('### 语音转写');
                lines.push('');
                for (const [audioName, text] of transcripts) {
                    lines.push(`**${audioName.split('/').pop() || audioName}**`);
                    lines.push('');
                    for (const paragraph of text.trim().split(/\n+/)) {
                        lines.push(`> ${paragraph}`);
                    }
                    lines.push('');
                }
            }

            if (comments.length > 0) {
                lines.push('### 评论');
                lines.push('');
                for (const comment of comments) {
                    const author = comment.author || '我';
                    const time = comment.createdAt ? this.exportDisplayStamp(new Date(comment.createdAt)) : '';
                    lines.push(`- **${author}**${time ? `（${time}）` : ''}：${comment.text}`);
                }
                lines.push('');
            }

            lines.push('---');
            lines.push('');
        }

        return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
    }

    async exportSelectedEntries() {
        const selected = this.getFilteredPosts().filter(post => this.selectedEntryIds.has(post.entry.id));
        if (selected.length === 0) {
            new Notice('请先选择要导出的记录');
            return;
        }

        const exportFolder = '拾光导出';
        await this.ensureFolder(exportFolder);
        const path = await this.uniqueMarkdownPath(`${exportFolder}/拾光导出_${this.exportFileStamp()}.md`);
        const markdown = this.buildExportMarkdown(selected);
        const file = await this.app.vault.create(path, markdown);

        this.selectionMode = false;
        this.selectedEntryIds.clear();
        this.updateExportSelectionUi();
        new Notice(`已导出 ${selected.length} 条记录到 ${file.path}`);
        await this.app.workspace.openLinkText(file.path, '', true);
        await this.renderView();
    }

    getAvailableTags(): string[] {
        const tags = new Set<string>(this.plugin.data.settings.customTags || []);
        for (const post of this.allPosts) {
            (post.entry.tags || []).forEach(tag => tags.add(tag));
        }
        return Array.from(tags).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    }

    mediaKind(file: File): 'image' | 'video' | 'audio' | 'file' {
        const lower = file.name.toLowerCase();
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('audio/')) return 'audio';
        if (file.type.startsWith('video/')) return 'video';
        if (AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext))) return 'audio';
        if (VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext))) return 'video';
        return 'file';
    }

    sanitizeName(name: string): string {
        return name.replace(/[\\/:*?"<>|#\[\]]/g, '_');
    }

    async ensureFolder(folderPath: string) {
        const p = normalizePath(folderPath);
        if (!this.app.vault.getAbstractFileByPath(p)) {
            await this.app.vault.createFolder(p);
        }
    }

    async saveInboxFiles(selectedFiles: InboxSelectedFile[]): Promise<InboxSavedMedia> {
        const saved: InboxSavedMedia = { images: [], videos: [], audios: [], files: [] };
        if (selectedFiles.length === 0) return saved;

        for (const item of selectedFiles) {
            let safeName = this.sanitizeName(item.file.name);
            if (!safeName || !safeName.includes('.')) {
                const ext = item.file.type ? item.file.type.split('/')[1] : 'bin';
                safeName = `inbox_${Date.now()}.${ext}`;
            }
            const savedPath = await this.plugin.saveMediaBinary(safeName, item.buffer);

            const kind = this.mediaKind(item.file);
            if (kind === 'image') saved.images.push(savedPath);
            else if (kind === 'video') saved.videos.push(savedPath);
            else if (kind === 'audio') saved.audios.push(savedPath);
            else saved.files.push(savedPath);
        }

        return saved;
    }

    createAudioRecorder(stream: MediaStream): MediaRecorder {
        const preferredTypes = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
        const supportedType = typeof MediaRecorder.isTypeSupported === 'function'
            ? preferredTypes.find(type => MediaRecorder.isTypeSupported(type))
            : undefined;
        return supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
    }

    async recordedAudioFile(chunks: Blob[], recorder: MediaRecorder): Promise<{ file: File; buffer: ArrayBuffer }> {
        const rawType = recorder.mimeType || chunks.find(chunk => !!chunk.type)?.type || 'audio/webm';
        const mimeType = rawType.split(';')[0] || 'audio/webm';
        const extension = mimeType.includes('mpeg') || mimeType.includes('mp3')
            ? 'mp3'
            : mimeType.includes('mp4') || mimeType.includes('m4a')
                ? 'm4a'
                : mimeType.includes('ogg')
                    ? 'ogg'
                    : mimeType.includes('wav')
                        ? 'wav'
                        : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        return {
            file: new File([blob], `voice_${Date.now()}.${extension}`, { type: mimeType }),
            buffer: await blob.arrayBuffer(),
        };
    }

    renderAudioCard(
        parent: HTMLElement,
        src: string,
        title = '录音',
        options: { transcript?: string; onTranscribe?: () => Promise<string> } = {}
    ): HTMLAudioElement {
        const card = parent.createDiv('life-audio-card');
        if (options.transcript) card.addClass('has-transcript');
        if (options.onTranscribe) card.addClass('has-transcribe');
        const audio = card.createEl('audio');
        audio.src = src;
        audio.preload = 'metadata';

        const setAudioIcon = (button: HTMLElement, icon: string) => {
            button.empty();
            setIcon(button.createSpan('life-audio-btn-icon'), icon);
        };
        const playBtn = card.createEl('button', { cls: 'life-audio-play', attr: { title: '播放录音', 'aria-label': '播放录音' } });
        setAudioIcon(playBtn, 'play');

        const body = card.createDiv('life-audio-body');
        body.createSpan('life-audio-title').setText(title);
        const progress = body.createEl('input', {
            cls: 'life-audio-progress',
            attr: { type: 'range', min: '0', max: '100', value: '0', step: '0.1' }
        });

        const wave = body.createDiv('life-audio-wave');
        wave.appendChild(progress);
        for (let i = 0; i < 30; i++) {
            const bar = wave.createSpan('life-audio-wave-bar');
            setCssProps(bar, {
                height: `${6 + ((i * 7) % 20)}px`,
                '--wave-delay': `${(i % 9) * 70}ms`
            });
        }
        const timeEl = body.createSpan('life-audio-time');
        timeEl.setText('0:00');
        if (options.onTranscribe) {
            const transcribeBtn = body.createEl('button', {
                cls: 'life-audio-transcribe-btn',
                attr: { title: '转文字', 'aria-label': '转文字' }
            });
            setAudioIcon(transcribeBtn, 'captions');
            transcribeBtn.onclick = async (event) => {
                event.stopPropagation();
                transcribeBtn.disabled = true;
                transcribeBtn.addClass('is-loading');
                try {
                    new Notice('正在转写录音...');
                    await options.onTranscribe?.();
                    new Notice('录音转写完成');
                } catch (err) {
                    new Notice(`录音转写失败：${err}`);
                    transcribeBtn.disabled = false;
                    transcribeBtn.removeClass('is-loading');
                }
            };
        }

        if (options.transcript) {
            const transcript = card.createDiv('life-audio-transcript');
            transcript.setText(options.transcript);
        }

        const fmt = (seconds: number) => {
            if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
            const minutes = Math.floor(seconds / 60);
            const rest = Math.floor(seconds % 60);
            return `${minutes}:${String(rest).padStart(2, '0')}`;
        };
        const syncProgress = () => {
            const duration = audio.duration || 0;
            progress.value = duration ? String((audio.currentTime / duration) * 100) : '0';
            setCssProps(card, { '--audio-progress': `${duration ? (audio.currentTime / duration) * 100 : 0}%` });
            timeEl.setText(`${fmt(audio.currentTime)}${duration ? ` / ${fmt(duration)}` : ''}`);
        };

        playBtn.onclick = async (event) => {
            event.stopPropagation();
            if (audio.paused) {
                try {
                    await audio.play();
                } catch (err) {
                    console.error('Audio playback failed:', err);
                    new Notice('该录音无法在当前设备播放，请重新录制为兼容格式');
                }
            } else {
                audio.pause();
            }
        };
        audio.onplay = () => {
            setAudioIcon(playBtn, 'pause');
            playBtn.setAttr('title', '暂停播放');
            playBtn.setAttr('aria-label', '暂停播放');
            card.addClass('is-playing');
        };
        audio.onpause = () => {
            setAudioIcon(playBtn, 'play');
            playBtn.setAttr('title', '播放录音');
            playBtn.setAttr('aria-label', '播放录音');
            card.removeClass('is-playing');
        };
        audio.onended = () => {
            setAudioIcon(playBtn, 'play');
            playBtn.setAttr('title', '播放录音');
            playBtn.setAttr('aria-label', '播放录音');
            card.removeClass('is-playing');
            setCssProps(card, { '--audio-progress': '0%' });
        };
        audio.ontimeupdate = syncProgress;
        audio.onloadedmetadata = syncProgress;
        progress.oninput = () => {
            if (!audio.duration) return;
            audio.currentTime = (Number(progress.value) / 100) * audio.duration;
        };
        return audio;
    }

    entrySearchText(post: RenderedPost): string {
        const entry = post.entry;
        return [
            entry.content,
            entry.date,
            this.fmtDate(post.date),
            post.ageStr,
            entry.tags?.join(' '),
            entry.comments?.map(comment => comment.text).join(' '),
            Object.values(entry.audioTranscripts || {}).join(' '),
            this.mediaNames(entry).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();
    }

    // ============ Data ============

    loadPosts(child: ChildInfo): RenderedPost[] {
        const entries = this.plugin.data.entries;
        const order = this.plugin.data.settings.sortOrder;
        const posts: RenderedPost[] = [];
        for (const e of entries) {
            const d = new Date(e.date + 'T00:00:00');
            if (isNaN(d.getTime())) continue;
            posts.push({ entry: e, date: d, ageStr: this.relativeDateLabel(d), ageYear: d.getFullYear(), ageMonth: d.getMonth() + 1 });
        }
        posts.sort((a, b) => {
            const timeDiff = b.date.getTime() - a.date.getTime();
            if (timeDiff !== 0) {
                return order === 'desc' ? timeDiff : -timeDiff;
            }
            const createDiff = b.entry.createdAt - a.entry.createdAt;
            return order === 'desc' ? createDiff : -createDiff;
        });
        return posts;
    }

    loadAllPosts(): RenderedPost[] {
        const order = this.plugin.data.settings.sortOrder;
        const posts: RenderedPost[] = [];
        for (const e of this.plugin.data.entries) {
            const d = new Date(e.date + 'T00:00:00');
            if (isNaN(d.getTime())) continue;
            posts.push({ entry: e, date: d, ageStr: this.relativeDateLabel(d), ageYear: d.getFullYear(), ageMonth: d.getMonth() + 1 });
        }
        posts.sort((a, b) => {
            const timeDiff = b.date.getTime() - a.date.getTime();
            if (timeDiff !== 0) return order === 'desc' ? timeDiff : -timeDiff;
            const createDiff = b.entry.createdAt - a.entry.createdAt;
            return order === 'desc' ? createDiff : -createDiff;
        });
        return posts;
    }

    groupByAge(posts: RenderedPost[]): AgeGroup[] {
        const yearMap = new Map<number, RenderedPost[]>();
        for (const p of posts) {
            if (!yearMap.has(p.ageYear)) yearMap.set(p.ageYear, []);
            yearMap.get(p.ageYear)!.push(p);
        }

        const groups: AgeGroup[] = [];
        const desc = this.plugin.data.settings.sortOrder === 'desc';

        for (const [ay, yearPosts] of yearMap) {
            const monthMap = new Map<number, RenderedPost[]>();
            for (const p of yearPosts) {
                const dayKey = Math.round(new Date(p.date.getFullYear(), p.date.getMonth(), p.date.getDate()).getTime() / 86400000);
                if (!monthMap.has(dayKey)) monthMap.set(dayKey, []);
                monthMap.get(dayKey)!.push(p);
            }

            const months: MonthGroup[] = [];
            for (const [dayKey, monthPosts] of monthMap) {
                const firstPost = monthPosts[0];
                const monthLabel = `${this.relativeDateLabel(firstPost.date)} · ${this.fmtShortDate(firstPost.date)}`;
                months.push({
                    ageMonth: dayKey,
                    label: monthLabel,
                    posts: monthPosts
                });
            }

            months.sort((a, b) => desc ? b.ageMonth - a.ageMonth : a.ageMonth - b.ageMonth);

            const yearLabel = `${ay}年`;
            groups.push({
                ageYear: ay,
                label: yearLabel,
                months,
                posts: yearPosts
            });
        }

        groups.sort((a, b) => desc ? b.ageYear - a.ageYear : a.ageYear - b.ageYear);
        return groups;
    }

    // ============ Main Render ============

    async renderView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('child-timeline-wrapper');
        container.toggleClass('is-selection-mode', this.selectionMode);
        const touchLayout = Platform.isMobileApp || window.matchMedia?.('(pointer: coarse)').matches;
        container.toggleClass('is-touch-layout', touchLayout);

        const activeChild = { name: '', dob: '', avatar: 'IN' };
        this.allPosts = this.loadAllPosts();
        this.selectedEntryIds = new Set(Array.from(this.selectedEntryIds).filter(id => this.allPosts.some(post => post.entry.id === id)));

        this.renderHeader(container, []);

        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }

        if (this.viewMode === 'timeline') this.renderTimelineMode(container, activeChild);
        else if (this.viewMode === 'calendar') this.renderCalendarMode(container, activeChild);
        else if (this.viewMode === 'gallery') this.renderGalleryMode(container, activeChild);
        else if (this.viewMode === 'memory-walk') this.renderMemoryWalkMode(container);

        // The add entry action lives in the header to keep the timeline canvas clean.
    }

    renderMemoryWalkMode(container: HTMLElement) {
        const wrapper = container.createDiv('shiguang-memory-walk-wrapper flex-1');
        setCssProps(wrapper, {
            height: '100%',
            minHeight: '0',
            overflow: 'hidden',
            position: 'relative'
        });
        
        this.reactRoot = createRoot(wrapper);
        this.reactRoot.render(React.createElement(MemoryWalkApp, { plugin: this.plugin }));
    }


    renderEmpty(c: HTMLElement, icon: string, title: string, hint: string) {
        const el = c.createDiv('timeline-empty');
        el.createDiv('timeline-empty-icon').setText(icon);
        el.createDiv('timeline-empty-text').setText(title);
        el.createDiv('timeline-empty-hint').setText(hint);
    }

    // ============ Header ============

    renderHeader(container: HTMLElement, children: ChildInfo[]) {
        const h = container.createDiv('timeline-header');
        const left = h.createDiv('timeline-header-left');
        const addBtn = left.createEl('button', {
            cls: 'timeline-header-add-btn',
            attr: { title: '新增拾光记录', 'aria-label': '新增拾光记录' }
        });
        setIcon(addBtn.createSpan('timeline-button-icon'), 'plus');
        addBtn.onclick = () => { new AddPostModal(this.app, this.plugin, () => this.renderView()).open(); };
        left.createDiv('timeline-header-title').setText('拾光');

        const act = h.createDiv('timeline-header-actions');
        const openSidebar = () => {
            const sidebar = container.querySelector('.timeline-sidebar');
            const overlay = container.querySelector('.timeline-drawer-overlay');
            if (sidebar && overlay) {
                sidebar.classList.toggle('drawer-open');
                overlay.classList.toggle('active');
            }
        };
        const openInboxCapture = () => {
            const sidebar = container.querySelector('.timeline-sidebar') as HTMLElement | null;
            const overlay = container.querySelector('.timeline-drawer-overlay');
            if (sidebar && overlay) {
                sidebar.classList.add('drawer-open');
                overlay.classList.add('active');
            }
            setTimeout(() => {
                const input = container.querySelector('.life-inbox-capture-text') as HTMLTextAreaElement | null;
                input?.focus();
                input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 120);
        };
        const randomJump = () => {
            if (this.allPosts && this.allPosts.length > 0) {
                const randomIndex = Math.floor(Math.random() * this.allPosts.length);
                const randomPost = this.allPosts[randomIndex];
                const dateStr = `${randomPost.date.getFullYear()}-${String(randomPost.date.getMonth() + 1).padStart(2, '0')}-${String(randomPost.date.getDate()).padStart(2, '0')}`;
                this.jumpToDate(dateStr);
            }
        };
        const refreshData = async () => {
            await this.plugin.loadPluginData();
            this.renderView();
        };

        // Segmented View Mode Switcher
        const switcher = act.createDiv('timeline-view-switcher');
        const modes: { mode: ViewMode; label: string; icon: string }[] = [
            { mode: 'timeline', label: '时间线', icon: 'list-tree' },
            { mode: 'calendar', label: '日历', icon: 'calendar-days' },
            { mode: 'gallery', label: '资源库', icon: 'folder-open' },
            { mode: 'memory-walk', label: '漫游', icon: 'sparkles' }
        ];
        for (const m of modes) {
            const btn = switcher.createDiv('timeline-view-switcher-item');
            if (this.viewMode === m.mode) btn.addClass('active');
            const iconEl = btn.createSpan('switcher-icon');
            setIcon(iconEl, m.icon);
            btn.createSpan('switcher-label').setText(m.label);
            btn.onclick = () => { this.viewMode = m.mode; this.renderView(); };
        }

        // Refresh Button
        const rb = act.createDiv('timeline-refresh-btn clickable-icon');
        setIcon(rb, 'refresh-cw');
        rb.onclick = () => { void refreshData(); };

        // Random Roam Button
        if (this.plugin.data.settings.randomRoamEnabled) {
            const randomBtn = act.createDiv('timeline-refresh-btn clickable-icon');
            setIcon(randomBtn, 'dices');
            randomBtn.title = '随机漫游';
            randomBtn.onclick = randomJump;
        }

        // Mobile Inbox Wake Button
        const inboxBtn = act.createEl('button', {
            cls: 'timeline-inbox-toggle-btn',
            attr: { title: '打开 Inbox 采集', 'aria-label': '打开 Inbox 采集' }
        });
        setIcon(inboxBtn.createSpan('timeline-button-icon'), 'inbox');
        inboxBtn.onclick = openInboxCapture;

        // Mobile Menu Button (Drawer Toggle)
        const menuBtn = act.createDiv('timeline-header-menu-btn');
        menuBtn.setAttr('title', '打开筛选侧栏');
        menuBtn.setAttr('aria-label', '打开筛选侧栏');
        setIcon(menuBtn.createSpan('timeline-button-icon'), 'panel-right-open');
        menuBtn.onclick = openSidebar;

        const more = act.createDiv('timeline-more-menu');
        const moreBtn = more.createEl('button', {
            cls: 'timeline-more-btn',
            attr: { title: '更多操作', 'aria-label': '更多操作' }
        });
        setIcon(moreBtn.createSpan('timeline-button-icon'), 'ellipsis');
        const morePanel = more.createDiv('timeline-more-panel');
        const addMoreItem = (label: string, icon: string, action: () => void | Promise<void>) => {
            const item = morePanel.createEl('button', { cls: 'timeline-more-item' });
            setIcon(item.createSpan('timeline-more-item-icon'), icon);
            item.createSpan().setText(label);
            item.onclick = (event) => {
                event.stopPropagation();
                more.removeClass('open');
                action();
            };
            return item;
        };
        addMoreItem('刷新', 'refresh-cw', refreshData);
        addMoreItem('批量导入图片', 'image-plus', () => {
            this.plugin.batchImportImages();
        });
        if (this.plugin.data.settings.randomRoamEnabled) {
            addMoreItem('随机漫游', 'dices', randomJump);
        }
        addMoreItem(this.selectionMode ? '退出选择' : '选择导出', this.selectionMode ? 'x' : 'check-square', () => {
            this.selectionMode = !this.selectionMode;
            if (!this.selectionMode) this.selectedEntryIds.clear();
            this.renderView();
        });
        moreBtn.onclick = (event) => {
            event.stopPropagation();
            more.toggleClass('open', !more.hasClass('open'));
        };
    }


    renderFab(container: HTMLElement) {
        const fab = container.createDiv('timeline-fab');
        fab.setAttr('title', '新增拾光记录');
        fab.setAttr('aria-label', '新增拾光记录');
        setIcon(fab, 'plus');
        fab.onclick = () => { new AddPostModal(this.app, this.plugin, () => this.renderView()).open(); };
    }

    // ================================================================
    //  TIMELINE MODE
    // ================================================================

    renderTimelineMode(container: HTMLElement, child: ChildInfo) {
        const content = container.createDiv('child-timeline-content');
        this.mainEl = content.createDiv('timeline-main');
        
        // Resizer Handle
        const resizer = content.createDiv('timeline-resizer');
        
        this.sidebarEl = content.createDiv('timeline-sidebar');
        const savedWidth = this.plugin.data.settings.sidebarWidth || 260;
        setCssProps(this.sidebarEl, { width: `${savedWidth}px` });

        // Mobile Drawer Overlay
        const overlay = content.createDiv('timeline-drawer-overlay');
        overlay.onclick = () => {
            this.sidebarEl.classList.remove('drawer-open');
            overlay.classList.remove('active');
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = this.sidebarEl.offsetWidth;

            const onMouseMove = (moveEvent: MouseEvent) => {
                const delta = startX - moveEvent.clientX;
                const newWidth = startWidth + delta;
                if (newWidth >= 150 && newWidth <= 600) {
                    setCssProps(this.sidebarEl, { width: `${newWidth}px` });
                }
            };

            const onMouseUp = async () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                setCssProps(document.body, { cursor: '' });
                this.plugin.data.settings.sidebarWidth = this.sidebarEl.offsetWidth;
                await this.plugin.savePluginData();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            setCssProps(document.body, { cursor: 'col-resize' });
        });

        if (this.allPosts.length === 0) {
            this.renderEmpty(this.mainEl, '＋', '还没有记录', '点击左上角 + 开始记录生活');
            return;
        }

        // Posts List Container
        const postsListContainer = this.mainEl.createDiv('timeline-posts-list-container');
        this.renderFilteredPosts(postsListContainer, child);

        this.renderSidebar(this.sidebarEl, child);
        this.setupScrollSpy(postsListContainer);
    }

    getFilteredPosts(): RenderedPost[] {
        let posts = this.allPosts;

        // Apply media filter
        if (this.searchFilter === 'image') {
            posts = posts.filter(p => p.entry.images && p.entry.images.length > 0);
        } else if (this.searchFilter === 'video') {
            posts = posts.filter(p => p.entry.videos && p.entry.videos.length > 0);
        } else if (this.searchFilter === 'audio') {
            posts = posts.filter(p => p.entry.audios && p.entry.audios.length > 0);
        } else if (this.searchFilter === 'file') {
            posts = posts.filter(p => p.entry.files && p.entry.files.length > 0);
        } else if (this.searchFilter === 'text') {
            posts = posts.filter(p => this.mediaCount(p.entry) === 0);
        } else if (this.searchFilter === 'liked') {
            posts = posts.filter(p => p.entry.likes && p.entry.likes > 0);
        }

        // Apply Scene Tag filter
        if (this.searchTag) {
            posts = posts.filter(p => p.entry.tags && p.entry.tags.includes(this.searchTag!));
        }

        // Apply text query search
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            posts = posts.filter(p => this.entrySearchText(p).includes(q));
        }

        return posts;
    }

    renderSearchBar(parent: HTMLElement) {
        const searchContainer = parent.createDiv('timeline-search-container');
        
        // Row 1: Search Input (Full Width)
        const row1 = searchContainer.createDiv('timeline-search-row-1');
        setCssProps(row1, { display: 'flex', width: '100%' });

        // Search Input Box
        const inputWrapper = row1.createDiv('timeline-search-input-wrapper');
        setCssProps(inputWrapper, { width: '100%' });
        inputWrapper.createSpan('timeline-search-icon').setText('🔍');
        
        const input = inputWrapper.createEl('input', {
            cls: 'timeline-search-input',
            attr: {
                placeholder: '搜索记录、标签、文件名或日期...',
                type: 'text',
                value: this.searchQuery
            }
        });
        
        // Clear button
        let clearBtn: HTMLElement | null = null;
        const updateClearBtn = () => {
            if (input.value.trim()) {
                if (!clearBtn) {
                    clearBtn = inputWrapper.createSpan('timeline-search-clear');
                    clearBtn.setText('×');
                    clearBtn.onclick = () => {
                        this.searchQuery = '';
                        input.value = '';
                        updateClearBtn();
                        this.onSearchChanged();
                    };
                }
            } else {
                if (clearBtn) {
                    clearBtn.remove();
                    clearBtn = null;
                }
            }
        };
        updateClearBtn();

        input.addEventListener('input', () => {
            this.searchQuery = input.value.trim();
            updateClearBtn();
            this.onSearchChanged();
        });

        // Row 2: Type Filter & Tags Dropdown
        const row2 = searchContainer.createDiv('timeline-search-row-2');
        setCssProps(row2, { display: 'flex', gap: '8px', width: '100%' });

        // Filter Dropdown (Row 2 Left)
        const filterSelect = row2.createEl('select', { cls: 'timeline-search-filter-select' });
        setCssProps(filterSelect, { flex: '1' });
        const filters: { type: typeof TimelineView.prototype.searchFilter; label: string; icon: string }[] = [
            { type: 'all', label: '全部类型', icon: '✨' },
            { type: 'image', label: '只看图片', icon: '🖼️' },
            { type: 'video', label: '只看视频', icon: '🎬' },
            { type: 'audio', label: '只看录音', icon: '🎙️' },
            { type: 'file', label: '只看文件', icon: '📎' },
            { type: 'text', label: '只看文字', icon: '📝' },
            { type: 'liked', label: '我的喜欢', icon: '♥' }
        ];

        for (const f of filters) {
            const option = filterSelect.createEl('option', { value: f.type });
            option.setText(`${f.icon} ${f.label}`);
            if (this.searchFilter === f.type) option.selected = true;
        }

        filterSelect.onchange = () => {
            this.searchFilter = filterSelect.value as typeof TimelineView.prototype.searchFilter;
            this.onSearchChanged();
        };

        // Tags Dropdown (Row 2 Right)
        const tagSelect = row2.createEl('select', { cls: 'timeline-search-filter-select' });
        setCssProps(tagSelect, { flex: '1' });
        
        const tagCounts: Record<string, number> = {};
        const availableTagsSet = new Set<string>(this.plugin.data.settings.customTags || []);

        for (const p of this.allPosts) {
            if (p.entry.tags) {
                for (const t of p.entry.tags) {
                    tagCounts[t] = (tagCounts[t] || 0) + 1;
                    availableTagsSet.add(t);
                }
            }
        }

        const availableTags = Array.from(availableTagsSet).filter(t => (tagCounts[t] || 0) > 0);
        
        const allTagsOption = tagSelect.createEl('option', { value: '' });
        allTagsOption.setText('所有标签');
        if (!this.searchTag) allTagsOption.selected = true;

        for (const tag of availableTags) {
            const count = tagCounts[tag] || 0;
            const option = tagSelect.createEl('option', { value: tag });
            option.setText(`${tag} (${count})`);
            if (this.searchTag === tag) option.selected = true;
        }

        tagSelect.onchange = () => {
            const val = tagSelect.value;
            this.searchTag = val === '' ? null : val;
            this.onSearchChanged();
        };
    }

    renderFilteredPosts(container: HTMLElement, child: ChildInfo) {
        const filtered = this.getFilteredPosts();
        
        // This is necessary for the sidebar month tree to render correctly!
        this.ageGroups = this.groupByAge(filtered);

        if (filtered.length === 0) {
            this.renderEmpty(container, '🔍', '没有找到匹配的记录', '请尝试更换搜索词或筛选条件');
            return;
        }

        let BATCH_SIZE = this.forceInitialRenderCount > 0 ? this.forceInitialRenderCount : 20;
        this.forceInitialRenderCount = 0;
        let renderedCount = 0;

        const sentinel = container.createDiv('timeline-sentinel');
        setCssProps(sentinel, { height: '20px', width: '100%' }); // invisible trigger at the bottom

        const renderBatch = () => {
            const batch = filtered.slice(renderedCount, renderedCount + BATCH_SIZE);
            BATCH_SIZE = 20; // reset to 20 for subsequent loads
            if (batch.length === 0) return;

            const groups = this.groupByAge(batch);
            let delay = 0;

            for (const group of groups) {
                const glId = `age-group-${group.ageYear}`;
                if (!container.querySelector(`[id="${glId}"]`)) {
                    const gl = container.insertBefore(document.createElement('div'), sentinel);
                    gl.className = 'timeline-age-group-label';
                    gl.id = glId;
                    this.attachDateJumpButton(gl);
                    gl.createSpan('timeline-year-label').setText(group.label);
                }

                for (const month of group.months) {
                    const mlId = `month-group-${group.ageYear}-${month.ageMonth}`;
                    if (!container.querySelector(`[id="${mlId}"]`)) {
                        const ml = container.insertBefore(document.createElement('div'), sentinel);
                        ml.className = 'timeline-month-group-label';
                        ml.id = mlId;
                        ml.dataset.year = String(group.ageYear);
                        ml.dataset.dayKey = String(month.ageMonth);
                        if (month.posts.length > 0) {
                            ml.dataset.date = this.dateKey(month.posts[0].date);
                        }
                        ml.createSpan('timeline-month-label-text').setText(month.label);
                        if (this.selectionMode && month.posts.length > 0) {
                            const dayKey = this.dateKey(month.posts[0].date);
                            const daySelect = ml.createEl('button', {
                                cls: 'timeline-day-select',
                                attr: { type: 'button', 'data-date-key': dayKey }
                            });
                            daySelect.onclick = (event) => {
                                event.stopPropagation();
                                this.toggleDateSelection(dayKey);
                            };
                            const dayExport = ml.createEl('button', {
                                cls: 'timeline-day-export',
                                attr: { type: 'button', title: '导出选中记录', 'aria-label': '导出选中记录' }
                            });
                            setIcon(dayExport.createSpan('timeline-day-export-icon'), 'file-output');
                            dayExport.createSpan().setText('导出选中 ');
                            dayExport.createSpan('timeline-day-export-count').setText(String(this.selectedEntryIds.size));
                            dayExport.onclick = async (event) => {
                                event.stopPropagation();
                                await this.exportSelectedEntries();
                            };
                            this.updateDateSelectButtons(dayKey);
                        }
                    }

                    for (const post of month.posts) {
                        const el = container.insertBefore(document.createElement('div'), sentinel);
                        el.className = 'timeline-post';
                        el.setAttribute('data-entry-id', post.entry.id);
                        el.setAttribute('data-date', this.dateKey(post.date));
                        el.toggleClass('is-selected', this.selectedEntryIds.has(post.entry.id));
                        setCssProps(el, { animationDelay: `${Math.min(delay, 500)}ms` });
                        delay += 50;

                        el.createDiv('timeline-post-line');
                        el.createDiv('timeline-post-dot');

                        const card = el.createDiv('timeline-post-content');
                        if (this.selectionMode) {
                            const select = card.createEl('button', {
                                cls: 'timeline-post-select',
                                attr: { title: '选择这条记录', 'aria-label': '选择这条记录' }
                            });
                            setIcon(select, this.selectedEntryIds.has(post.entry.id) ? 'check' : 'circle');
                            select.onclick = (event) => {
                                event.stopPropagation();
                                this.togglePostSelection(post.entry.id);
                            };
                            card.onclick = (event) => {
                                if (!this.selectionMode) return;
                                const target = event.target as HTMLElement;
                                if (target.closest('button, a, input, textarea, select, audio, video')) return;
                                this.togglePostSelection(post.entry.id);
                            };
                        }

                        // Header
                        const header = card.createDiv('timeline-post-header');
                        header.createDiv('timeline-post-age').setText(post.ageStr);
                        header.createDiv('timeline-post-date').setText(`· ${this.fmtDate(post.date)}`);

                        // Body
                        const body = card.createDiv('timeline-post-body');
                        if (post.entry.content) {
                            const contentDiv = body.createDiv('timeline-post-markdown-content markdown-rendered');
                            MarkdownRenderer.render(this.app, post.entry.content, contentDiv, "", this);
                        }
                        
                        const visualMediaTotal = (post.entry.images?.length || 0) + (post.entry.videos?.length || 0);
                        if (visualMediaTotal > 0) {
                            const gridCls = visualMediaTotal === 1 ? 'grid-1' 
                                          : visualMediaTotal === 2 ? 'grid-2' 
                                          : visualMediaTotal === 4 ? 'grid-4' 
                                          : 'grid-multiple';
                            const grid = body.createDiv(`post-media-grid ${gridCls}`);
                            
                            for (const img of (post.entry.images || [])) {
                                const media = this.resolveMediaInfo(img);
                                if (!media.ok) {
                                    this.renderMediaPlaceholder(grid, img, media.reason);
                                    continue;
                                }
                                const imgEl = grid.createEl('img', { cls: 'timeline-image' });
                                imgEl.src = media.src; imgEl.alt = img; imgEl.loading = 'lazy';
                                imgEl.onerror = () => {
                                    this.renderMediaPlaceholder(grid, img, '图片无法读取');
                                    imgEl.remove();
                                };
                                imgEl.onclick = () => {
                                    const allImages = Array.from(this.mainEl?.querySelectorAll('.timeline-image') || []) as HTMLImageElement[];
                                    const srcs = allImages.map(img => img.src);
                                    let index = srcs.indexOf(imgEl.src);
                                    if (index === -1) index = 0;
                                    this.openLightbox(index, srcs);
                                };
                            }
                            for (const vid of (post.entry.videos || [])) {
                                const vidEl = grid.createEl('video', { cls: 'timeline-video', attr: { controls: '', preload: 'metadata' } });
                                vidEl.src = this.resolveMediaSrc(vid);
                            }
                        }
                        if ((post.entry.audios || []).length > 0) {
                            const audioList = body.createDiv('life-audio-list');
                            for (const audioName of (post.entry.audios || [])) {
                                this.renderAudioCard(audioList, this.resolveMediaSrc(audioName), audioName.split('/').pop() || '录音', {
                                    transcript: post.entry.audioTranscripts?.[audioName],
                                    onTranscribe: () => this.plugin.transcribeAudio(post.entry.id, audioName),
                                });
                            }
                        }
                        if ((post.entry.files || []).length > 0) {
                            const fileList = body.createDiv('life-file-list');
                            for (const fileName of (post.entry.files || [])) {
                                const link = fileList.createEl('a', { href: this.resolveMediaSrc(fileName), text: fileName.split('/').pop() || fileName });
                                link.addClass('life-media-file');
                            }
                        }

                        // Action bar
                        this.renderActionBar(card, post);
                    }
                }
            }

            renderedCount += batch.length;
            if (renderedCount >= filtered.length) {
                if (this.timelineObserver) this.timelineObserver.disconnect();
                sentinel.remove();
            }
        };

        if (this.timelineObserver) this.timelineObserver.disconnect();
        this.timelineObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                renderBatch();
            }
        }, { root: this.mainEl, rootMargin: '400px' });
        
        this.timelineObserver.observe(sentinel);
        renderBatch(); // Initial render
    }


    onSearchChanged() {
        const postsListContainer = this.containerEl.querySelector('.timeline-posts-list-container') as HTMLElement;
        if (postsListContainer) {
            postsListContainer.empty();
            this.renderFilteredPosts(postsListContainer, { name: '', dob: '', avatar: 'IN' });
        }
        
        if (this.sidebarEl) {
            const dynamicContent = this.sidebarEl.querySelector('.sidebar-dynamic-content') as HTMLElement;
            if (dynamicContent) {
                dynamicContent.empty();
                this.renderSidebarDynamicContent(dynamicContent, { name: '', dob: '', avatar: 'IN' });
            }
        }
    }

    forceInitialRenderCount = 0;

    async jumpToEntry(entryId: string) {
        this.viewMode = 'timeline';
        this.searchQuery = '';
        this.searchFilter = 'all';
        this.searchTag = null;
        this.allPosts = this.loadAllPosts();

        const visiblePosts = this.getFilteredPosts();
        const targetIndex = visiblePosts.findIndex(post => post.entry.id === entryId);
        if (targetIndex === -1) {
            await this.renderView();
            return;
        }

        const targetPost = visiblePosts[targetIndex];
        const dateKey = this.dateKey(targetPost.date);
        this.forceInitialRenderCount = Math.max(targetIndex + 20, 40);
        await this.renderView();

        window.requestAnimationFrame(() => {
            if (!this.mainEl) return;
            const el = this.mainEl.querySelector(`[data-entry-id="${entryId}"]`) as HTMLElement | null;
            if (!el) return;

            this.scrollElementIntoTimeline(el, 'center');
            setCssProps(el, {
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
                boxShadow: '0 0 0 4px var(--ct-accent-glow), 0 18px 44px rgba(20, 184, 166, 0.18)',
                transform: 'translateY(-2px)'
            });
            window.setTimeout(() => {
                setCssProps(el, { boxShadow: '', transform: '' });
            }, 1300);

            this.sidebarEl?.findAll('.sidebar-tree-month-item').forEach(nav => nav.removeClass('active'));
            const nav = this.sidebarEl?.querySelector(`.sidebar-tree-month-item[data-date="${dateKey}"]`) as HTMLElement | null;
            nav?.addClass('active');
        });
    }

    async jumpToDate(dateStr: string) {
        this.viewMode = 'timeline';
        this.searchQuery = '';
        this.searchFilter = 'all';
        this.searchTag = null;
        
        const target = new Date(dateStr + 'T00:00:00');
        if (isNaN(target.getTime())) return;
        
        const dateKey = this.dateKey(target);
        const visiblePosts = this.getFilteredPosts();
        let targetIndex = -1;
        let closestDiff = Infinity;
        
        for (let i = 0; i < visiblePosts.length; i++) {
            if (this.dateKey(visiblePosts[i].date) === dateKey) {
                targetIndex = i;
                break;
            }
            const diff = Math.abs(visiblePosts[i].date.getTime() - target.getTime());
            if (diff < closestDiff) {
                closestDiff = diff;
                targetIndex = i;
            }
        }

        if (targetIndex !== -1) {
            this.forceInitialRenderCount = Math.max(targetIndex + 20, 40);
            await this.renderView();
            
            window.requestAnimationFrame(() => {
                const closestPost = visiblePosts[targetIndex];
                if (closestPost && this.mainEl) {
                    const label = this.mainEl.querySelector(`.timeline-month-group-label[data-date="${dateKey}"]`) as HTMLElement;
                    const el = this.mainEl.querySelector(`[data-entry-id="${closestPost.entry.id}"]`) as HTMLElement;
                    const targetEl = label || el;
                    if (targetEl) {
                        this.scrollElementIntoTimeline(targetEl, label ? 'start' : 'center');
                    }
                    if (el) {
                        setCssProps(el, {
                            transition: 'box-shadow 0.3s ease',
                            boxShadow: '0 0 0 4px var(--ct-accent-glow)'
                        });
                        window.setTimeout(() => {
                            setCssProps(el, { boxShadow: '' });
                        }, 1000);
                    }

                    this.sidebarEl?.findAll('.sidebar-tree-month-item').forEach(nav => nav.removeClass('active'));
                    const nav = this.sidebarEl?.querySelector(`.sidebar-tree-month-item[data-date="${dateKey}"]`) as HTMLElement;
                    nav?.addClass('active');
                }
            });
        } else {
            await this.renderView();
        }
    }

    // ---------- Action Bar (❤️ Like / 💬 Comment / ✏️ Edit / 🗑�?Delete) ----------

    renderActionBar(card: HTMLElement, post: RenderedPost) {
        const bar = card.createDiv('post-action-bar');

        // Tags on the left
        const tagsContainer = bar.createDiv('timeline-post-tags-container');
        if (post.entry.tags && post.entry.tags.length > 0) {
            post.entry.tags.forEach(tag => {
                const tagItem = tagsContainer.createDiv('timeline-post-tag-item');
                tagItem.setText(tag);
            });
        }

        const rightActions = bar.createDiv('post-actions-right');

        // Like
        const likeBtn = rightActions.createDiv('post-action-btn post-like-btn');
        const likeCount = post.entry.likes || 0;
        likeBtn.createSpan('post-action-icon').setText('❤️');
        likeBtn.createSpan('post-action-label').setText(likeCount > 0 ? String(likeCount) : '');
        if (likeCount > 0) likeBtn.addClass('liked');
        likeBtn.onclick = (e) => {
            e.stopPropagation();
            this.plugin.toggleLike(post.entry.id);
        };

        // Comment
        const comments = post.entry.comments || [];
        const commentBtn = rightActions.createDiv('post-action-btn post-comment-btn');
        setIcon(commentBtn.createSpan('post-action-icon'), 'message-circle');
        commentBtn.createSpan('post-action-label').setText(comments.length > 0 ? String(comments.length) : '');

        const commentsSection = this.renderCommentsSection(card, post);
        commentBtn.onclick = (e) => {
            e.stopPropagation();
            commentsSection.toggleClass('expanded', !commentsSection.hasClass('expanded'));
            const input = commentsSection.querySelector('.post-comment-input') as HTMLInputElement | null;
            window.setTimeout(() => input?.focus(), 40);
        };

        // Delete
        const delBtn = rightActions.createDiv('post-action-btn post-delete-btn');
        setIcon(delBtn.createSpan('post-action-icon'), 'trash-2');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('确定删除这条记录吗？')) {
                this.plugin.deleteEntry(post.entry.id);
            }
        };

        // Double click to edit
        card.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const modal = new AddPostModal(this.app, this.plugin, () => this.renderView(), post.entry);
            modal.open();
        });
    }

    renderCommentsSection(card: HTMLElement, post: RenderedPost): HTMLElement {
        const comments = post.entry.comments || [];
        const section = card.createDiv('post-comments-section');
        if (comments.length > 0) section.addClass('expanded');

        const list = section.createDiv('post-comments-list');
        comments.forEach(comment => {
            const item = list.createDiv('post-comment-item');
            const text = item.createDiv('post-comment-text');
            text.createSpan('post-comment-author').setText(`${comment.author || '我'}：`);
            text.createSpan().setText(comment.text);
            item.createSpan('post-comment-time').setText(this.fmtTime(comment.createdAt));
            const del = item.createEl('button', { cls: 'post-comment-del', attr: { title: '删除评论', 'aria-label': '删除评论' } });
            setIcon(del, 'x');
            del.onclick = async (event) => {
                event.stopPropagation();
                if (confirm('确定删除这条评论吗？')) {
                    await this.plugin.deleteComment(post.entry.id, comment.id);
                }
            };
        });

        const row = section.createDiv('post-comment-input-row');
        const input = row.createEl('input', {
            cls: 'post-comment-input',
            attr: { type: 'text', placeholder: '评论一下...' }
        });
        const send = row.createEl('button', { cls: 'post-comment-send', text: '发送' });
        const submit = async () => {
            const value = input.value.trim();
            if (!value) {
                input.focus();
                return;
            }
            await this.plugin.addComment(post.entry.id, value);
        };
        send.onclick = (event) => {
            event.stopPropagation();
            submit();
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        });
        input.onclick = event => event.stopPropagation();
        return section;
    }

    // ---------- Sidebar (simplified & beautified) ----------

    renderSidebar(sidebarEl: HTMLElement, child: ChildInfo) {
        // Search Bar in Sidebar
        this.renderSearchBar(sidebarEl);
        this.renderInboxCaptureArea(sidebarEl);
        // Divider
        sidebarEl.createDiv('sidebar-divider');

        // Dynamic content wrapper
        const dynamicContent = sidebarEl.createDiv('sidebar-dynamic-content');

        // Bottom Controls Wrapper
        const bottomControls = sidebarEl.createDiv('sidebar-bottom-controls');
        this.renderSidebarBottomControls(bottomControls);

        this.renderSidebarDynamicContent(dynamicContent, child);
    }

    renderInboxCaptureArea(parent: HTMLElement) {
        const selectedFiles: InboxSelectedFile[] = [];
        const selectedTags = new Set<string>(['Inbox']);
        let recorder: MediaRecorder | null = null;
        let audioChunks: Blob[] = [];
        let recordingStartedAt = 0;
        let recordingTimer: number | null = null;

        const box = parent.createDiv('life-inbox-capture');
        const header = box.createDiv('life-inbox-capture-header');
        const title = header.createDiv('life-inbox-capture-title');
        title.createSpan('life-inbox-capture-dot').setText('IN');
        title.createSpan().setText('Inbox 采集');
        const hint = header.createSpan('life-inbox-capture-hint');
        hint.setText('先收进来，稍后整理');

        const textarea = box.createEl('textarea', {
            cls: 'life-inbox-capture-text',
            attr: {
                placeholder: '快速记录一个想法、待办、灵感或生活片段...',
                rows: '3'
            }
        });

        const preview = box.createDiv('life-inbox-attachment-preview');
        const renderPreview = () => {
            preview.empty();
            if (selectedFiles.length === 0) return;
            selectedFiles.forEach((item, index) => {
                const chip = preview.createDiv('life-inbox-attachment-chip');
                const kind = this.mediaKind(item.file);
                setIcon(chip.createSpan('life-inbox-attachment-icon'), kind === 'image' ? 'image' : kind === 'audio' ? 'mic' : kind === 'video' ? 'video' : 'paperclip');
                chip.createSpan('life-inbox-attachment-name').setText(item.file.name);
                const remove = chip.createEl('button', { cls: 'life-inbox-attachment-remove', attr: { 'aria-label': '移除附件' } });
                setIcon(remove, 'x');
                remove.onclick = () => {
                    selectedFiles.splice(index, 1);
                    renderPreview();
                };
            });
        };

        const addFiles = async (files: File[] | FileList | null) => {
            if (!files) return;
            for (const file of Array.from(files)) {
                try {
                    const buffer = await file.arrayBuffer();
                    selectedFiles.push({ file, buffer });
                } catch (err) {
                    new Notice(`读取文件失败：${err}`);
                }
            }
            renderPreview();
        };

        textarea.addEventListener('paste', async (event: ClipboardEvent) => {
            if (!event.clipboardData) return;
            const files = Array.from(event.clipboardData.files || []).filter(file => file.type.startsWith('image/'));
            if (files.length > 0) {
                event.preventDefault();
                await addFiles(files.map((file, index) => {
                    const ext = file.type.split('/')[1] || 'png';
                    const name = file.name && file.name !== 'image.png' ? file.name : `pasted_image_${Date.now()}_${index}.${ext}`;
                    return new File([file], name, { type: file.type });
                }));
                new Notice(`已添加 ${files.length} 张粘贴图片。`);
            }
        });

        const tagPanel = box.createDiv('life-inbox-tag-panel');
        const tagComposer = tagPanel.createDiv('life-inbox-tag-composer is-select');
        setIcon(tagComposer.createSpan('life-inbox-tag-icon'), 'tag');
        const tagSelect = tagComposer.createEl('select', {
            cls: 'life-inbox-tag-select',
            attr: { 'aria-label': '标签', title: '标签' }
        });
        tagSelect.createEl('option', { value: '', text: '标签' });
        ['Inbox', ...this.getAvailableTags().filter(tag => tag !== 'Inbox')].forEach(tag => {
            tagSelect.createEl('option', { value: tag, text: tag });
        });
        tagSelect.createEl('option', { value: '__custom__', text: '自定义...' });
        const addTagBtn = tagPanel.createEl('button', { cls: 'life-inbox-tag-add', attr: { 'aria-label': '添加标签', title: '添加标签' } });
        setIcon(addTagBtn.createSpan('life-inbox-btn-icon'), 'plus');

        const customTagRow = box.createDiv('life-inbox-custom-tag-row is-hidden');
        const customTagInput = customTagRow.createEl('input', {
            cls: 'life-inbox-custom-tag-input',
            attr: { type: 'text', placeholder: '输入新标签后回车', 'aria-label': '自定义标签' }
        });

        const tagChips = box.createDiv('life-inbox-tag-chips');
        const renderTags = () => {
            tagChips.empty();
            const visibleTags = Array.from(selectedTags).filter(tag => tag !== 'Inbox');
            tagChips.toggleClass('is-empty', visibleTags.length === 0);
            visibleTags.forEach(tag => {
                const chip = tagChips.createDiv('life-inbox-tag-chip');
                chip.createSpan().setText(tag);
                const remove = chip.createEl('button', { attr: { 'aria-label': '移除标签', title: '移除标签' } });
                setIcon(remove, 'x');
                remove.onclick = () => {
                    selectedTags.delete(tag);
                    renderTags();
                };
            });
        };
        const addTag = (tag: string) => {
            const value = tag.trim();
            if (!value) return;
            selectedTags.add(value);
            tagSelect.value = '';
            customTagInput.value = '';
            customTagRow.addClass('is-hidden');
            renderTags();
        };
        tagSelect.onchange = () => {
            if (tagSelect.value === '__custom__') {
                customTagRow.removeClass('is-hidden');
                customTagInput.focus();
                return;
            }
            addTag(tagSelect.value);
        };
        addTagBtn.onclick = () => {
            if (tagSelect.value === '__custom__' || !customTagRow.hasClass('is-hidden')) {
                addTag(customTagInput.value);
            } else {
                addTag(tagSelect.value);
            }
        };
        customTagInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addTag(customTagInput.value);
            }
        });
        renderTags();

        const fileInput = box.createEl('input', { attr: { type: 'file', multiple: 'true' } });
        setCssProps(fileInput, { display: 'none' });
        const imageInput = box.createEl('input', { attr: { type: 'file', accept: 'image/*', multiple: 'true' } });
        setCssProps(imageInput, { display: 'none' });
        const cameraInput = box.createEl('input', { attr: { type: 'file', accept: 'image/*', capture: 'environment' } });
        setCssProps(cameraInput, { display: 'none' });
        fileInput.onchange = async () => {
            await addFiles(fileInput.files);
            fileInput.value = '';
        };
        imageInput.onchange = async () => {
            await addFiles(imageInput.files);
            imageInput.value = '';
        };
        cameraInput.onchange = async () => {
            await addFiles(cameraInput.files);
            cameraInput.value = '';
        };

        const actions = tagPanel.createDiv('life-inbox-capture-actions');
        const attachBtn = actions.createEl('button', { cls: 'life-inbox-action-btn', attr: { 'aria-label': '添加附件', title: '添加附件' } });
        setIcon(attachBtn.createSpan('life-inbox-btn-icon'), 'paperclip');
        attachBtn.onclick = () => fileInput.click();

        const imageBtn = actions.createEl('button', { cls: 'life-inbox-action-btn', attr: { 'aria-label': '添加图片', title: '添加图片' } });
        setIcon(imageBtn.createSpan('life-inbox-btn-icon'), 'image');
        imageBtn.onclick = () => {
            const takePhoto = () => {
                if (prefersNativeCameraPicker() || !navigator.mediaDevices?.getUserMedia) {
                    cameraInput.click();
                    return;
                }
                new CameraCaptureModal(this.app, async file => {
                    await addFiles([file]);
                }, () => cameraInput.click()).open();
            };
            openImageSourceMenu(imageBtn, () => imageInput.click(), takePhoto);
        };

        const recordingStatus = box.createDiv('life-inbox-recording-status');
        recordingStatus.addClass('is-hidden');
        recordingStatus.createSpan('life-inbox-recording-dot');
        const recordingLabel = recordingStatus.createSpan('life-inbox-recording-label');
        recordingLabel.setText('正在录音');
        const recordingTime = recordingStatus.createSpan('life-inbox-recording-time');
        recordingTime.setText('0:00');
        const stopRecordingBtn = recordingStatus.createEl('button', { cls: 'life-inbox-recording-stop', attr: { 'aria-label': '停止录音', title: '停止录音' } });
        setIcon(stopRecordingBtn.createSpan('life-inbox-btn-icon'), 'square');

        const formatDuration = (ms: number) => {
            const seconds = Math.max(0, Math.floor(ms / 1000));
            const minutes = Math.floor(seconds / 60);
            const rest = seconds % 60;
            return `${minutes}:${String(rest).padStart(2, '0')}`;
        };
        const setRecordButton = (label: string, icon: string, isRecording: boolean) => {
            recordBtn.empty();
            setIcon(recordBtn.createSpan('life-inbox-btn-icon'), icon);
            recordBtn.setAttr('aria-label', label === '停止' ? '停止录音' : '开始录音');
            recordBtn.setAttr('title', label === '停止' ? '停止录音' : '开始录音');
            recordBtn.toggleClass('is-recording', isRecording);
        };
        const stopRecordingStatus = (finalText?: string) => {
            if (recordingTimer !== null) {
                window.clearInterval(recordingTimer);
                recordingTimer = null;
            }
            setRecordButton('录音', 'mic', false);
            if (finalText) {
                recordingLabel.setText(finalText);
                recordingStatus.addClass('is-complete');
                window.setTimeout(() => {
                    recordingStatus.addClass('is-hidden');
                    recordingStatus.removeClass('is-complete');
                    recordingLabel.setText('正在录音');
                    recordingTime.setText('0:00');
                }, 1600);
            } else {
                recordingStatus.addClass('is-hidden');
                recordingTime.setText('0:00');
            }
        };
        const stopActiveRecording = () => {
            if (recorder && recorder.state === 'recording') recorder.stop();
        };
        stopRecordingBtn.onclick = stopActiveRecording;

        const recordBtn = actions.createEl('button', { cls: 'life-inbox-action-btn', attr: { 'aria-label': '开始录音', title: '开始录音' } });
        setIcon(recordBtn.createSpan('life-inbox-btn-icon'), 'mic');
        recordBtn.onclick = async () => {
            if (recorder && recorder.state === 'recording') {
                stopActiveRecording();
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioChunks = [];
                recorder = this.createAudioRecorder(stream);
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) audioChunks.push(event.data);
                };
                recorder.onstop = async () => {
                    stream.getTracks().forEach(track => track.stop());
                    const recorded = await this.recordedAudioFile(audioChunks, recorder!);
                    selectedFiles.push(recorded);
                    const finalTime = formatDuration(Date.now() - recordingStartedAt);
                    audioChunks = [];
                    renderPreview();
                    stopRecordingStatus(`录音已添加 ${finalTime}`);
                    new Notice('录音已添加');
                };
                recorder.start();
                recordingStartedAt = Date.now();
                recordingStatus.removeClass('is-hidden');
                recordingStatus.removeClass('is-complete');
                recordingLabel.setText('正在录音');
                recordingTime.setText('0:00');
                setRecordButton('停止', 'square', true);
                recordingTimer = window.setInterval(() => {
                    recordingTime.setText(formatDuration(Date.now() - recordingStartedAt));
                }, 250);
            } catch (err) {
                stopRecordingStatus();
                new Notice(`录音失败：${err}`);
            }
        };

        const saveBtn = actions.createEl('button', { cls: 'life-inbox-save mod-cta', attr: { 'aria-label': '收进 Inbox', title: '收进 Inbox' } });
        const renderSaveButton = (busy = false) => {
            saveBtn.empty();
            setIcon(saveBtn.createSpan('life-inbox-btn-icon'), 'inbox');
            saveBtn.toggleClass('is-saving', busy);
            saveBtn.disabled = busy;
            saveBtn.setAttr('aria-label', busy ? '正在收纳' : '收进 Inbox');
            saveBtn.setAttr('title', busy ? '正在收纳' : '收进 Inbox');
        };
        renderSaveButton();

        const saveCapture = async () => {
            const content = textarea.value.trim();
            if (recorder && recorder.state === 'recording') {
                new Notice('请先停止录音再收进 Inbox');
                return;
            }
            if (!content && selectedFiles.length === 0) {
                new Notice('请输入采集内容或添加附件');
                textarea.focus();
                return;
            }
            renderSaveButton(true);
            try {
                const now = new Date();
                const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                const saved = await this.saveInboxFiles(selectedFiles);
                const tags = Array.from(selectedTags);
                const customTags = tags.filter(tag => tag !== 'Inbox' && !(this.plugin.data.settings.customTags || []).includes(tag));
                if (customTags.length > 0) {
                    this.plugin.data.settings.customTags = Array.from(new Set([...(this.plugin.data.settings.customTags || []), ...customTags]));
                }
                const entry: TimelineEntry = {
                    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    date,
                    childName: '',
                    content,
                    images: saved.images,
                    videos: saved.videos,
                    audios: saved.audios,
                    files: saved.files,
                    audioTranscripts: {},
                    likes: 0,
                    comments: [],
                    createdAt: Date.now(),
                    tags,
                };
                await this.plugin.addEntry(entry);
                new Notice('已采集到 Inbox');
                await this.renderView();
            } catch (err) {
                console.error('Inbox capture save failed:', err);
                const reason = err instanceof Error ? err.message : String(err);
                new Notice(`收纳失败：${reason}`);
                renderSaveButton(false);
            }
        };

        saveBtn.onclick = async () => {
            await saveCapture();
        };
        textarea.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                saveCapture();
            }
        });
    }

    renderSidebarBottomControls(container: HTMLElement) {
        const stats = container.createDiv('sidebar-stats');
    }

    attachDateJumpButton(parent: HTMLElement) {
        const jumpBtn = parent.createEl('button', {
            cls: 'timeline-year-date-jump',
            attr: { title: '跳转到指定日期', 'aria-label': '跳转到指定日期' }
        });
        setIcon(jumpBtn.createSpan('timeline-button-icon timeline-date-jump-icon'), 'calendar-days');

        const jumpInput = parent.createEl('input', {
            cls: 'timeline-year-date-jump-input',
            attr: { type: 'date' }
        });

        const openPicker = () => {
            try {
                // @ts-ignore
                if (typeof jumpInput.showPicker === 'function') {
                    // @ts-ignore
                    jumpInput.showPicker();
                } else {
                    jumpInput.click();
                }
            } catch (err) {
                jumpInput.click();
            }
        };

        jumpBtn.onclick = (e) => {
            e.stopPropagation();
            openPicker();
        };
        jumpInput.onclick = (e) => {
            e.stopPropagation();
        };
        jumpInput.onchange = async () => {
            const val = jumpInput.value;
            if (!val) return;
            await this.jumpToDate(val);
            jumpInput.value = '';
        };
    }

    renderSidebarDynamicContent(dynamicEl: HTMLElement, child: ChildInfo) {
        const treeContainer = dynamicEl.createDiv('sidebar-month-tree');

        for (const group of this.ageGroups) {
            const ageGroupEl = treeContainer.createDiv('sidebar-tree-age-group');
            
            const header = ageGroupEl.createDiv('sidebar-tree-age-header');
            header.id = `nav-age-${group.ageYear}`;
            
            const chevron = header.createSpan('sidebar-tree-chevron');
            chevron.setText('▾'); // Default to expanded
            
            const label = header.createSpan('sidebar-tree-age-label');
            label.setText(group.label);
            
            const count = header.createSpan('sidebar-tree-age-count');
            count.setText(`${group.posts.length}`);
            
            const monthsList = ageGroupEl.createDiv('sidebar-tree-months-list');
            monthsList.id = `months-list-${group.ageYear}`;
            
            header.onclick = (e) => {
                e.stopPropagation();
                const isCollapsed = monthsList.hasClass('collapsed');
                if (isCollapsed) {
                    monthsList.removeClass('collapsed');
                    chevron.setText('▾');
                } else {
                    monthsList.addClass('collapsed');
                    chevron.setText('▸');
                }
            };
            
            let lastMonthKey = -1;
            let currentMonthDaysList: HTMLElement | null = null;

            for (const month of group.months) {
                const dateObj = month.posts[0].date;
                const curMonthKey = dateObj.getMonth();
                
                if (curMonthKey !== lastMonthKey) {
                    const realMonthHeader = monthsList.createDiv('sidebar-tree-real-month-header');
                    
                    const mChevron = realMonthHeader.createSpan('sidebar-tree-chevron');
                    mChevron.setText('▾');
                    setCssProps(mChevron, {
                        marginRight: '6px',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        transition: 'transform 0.2s ease'
                    });
                    
                    const mText = realMonthHeader.createSpan('sidebar-tree-real-month-text');
                    mText.setText(`${curMonthKey + 1}月`);
                    
                    // Simple inline styling for the new month header
                    setCssProps(realMonthHeader, {
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: 'var(--text-normal)',
                        padding: '8px 0 4px 16px',
                        marginTop: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center'
                    });
                    
                    // Use const so each onclick captures its own list element
                    const thisDaysList = monthsList.createDiv('sidebar-tree-months-list');
                    currentMonthDaysList = thisDaysList;
                    
                    realMonthHeader.onclick = (e) => {
                        e.stopPropagation();
                        const isCollapsed = thisDaysList.hasClass('collapsed');
                        if (isCollapsed) {
                            thisDaysList.removeClass('collapsed');
                            mChevron.setText('▾');
                        } else {
                            thisDaysList.addClass('collapsed');
                            mChevron.setText('▸');
                        }
                    };
                    
                    lastMonthKey = curMonthKey;
                }

                const monthItem = currentMonthDaysList!.createDiv('sidebar-tree-month-item');
                monthItem.id = `nav-month-${group.ageYear}-${month.ageMonth}`;
                const dateStr = this.dateKey(month.posts[0].date);
                monthItem.dataset.year = String(group.ageYear);
                monthItem.dataset.dayKey = String(month.ageMonth);
                monthItem.dataset.date = dateStr;
                
                const mLabel = monthItem.createSpan('sidebar-tree-month-label');
                mLabel.setText(month.label);
                
                const mCount = monthItem.createSpan('sidebar-tree-month-count');
                mCount.setText(`${month.posts.length}`);
                
                monthItem.onclick = async (e) => {
                    e.stopPropagation();
                    treeContainer.findAll('.sidebar-tree-month-item').forEach(el => el.removeClass('active'));
                    monthItem.addClass('active');
                    await this.jumpToDate(dateStr);
                };
            }
        }

        // Stats at bottom
        const filteredPosts = this.getFilteredPosts();
        const totalMedia = filteredPosts.reduce((s, p) => s + this.mediaCount(p.entry), 0);
        const totalLikes = filteredPosts.reduce((s, p) => s + (p.entry.likes || 0), 0);
        
        if (this.sidebarEl) {
            const statsEl = this.sidebarEl.querySelector('.sidebar-stats');
            if (statsEl) {
                statsEl.setText(`📝 ${filteredPosts.length} 条 · 媒体 ${totalMedia} 个 · 喜欢 ${totalLikes}`);
            }
        }
    }

    setupScrollSpy(postsListContainer?: HTMLElement) {
        if (!this.mainEl || !this.sidebarEl) return;
        
        if (this.scrollHandler && this.mainEl) {
            this.mainEl.removeEventListener('scroll', this.scrollHandler);
        }
        
        const mainEl = this.mainEl, sidebarEl = this.sidebarEl;
        const searchEl = postsListContainer || mainEl;
        const handler = () => {
            const labels = searchEl.querySelectorAll('.timeline-month-group-label');
            let curYear: string | null = null;
            let curMonth: string | null = null;
            for (const l of Array.from(labels)) {
                if (l.getBoundingClientRect().top - mainEl.getBoundingClientRect().top <= 120) {
                    const label = l as HTMLElement;
                    curYear = label.dataset.year || null;
                    curMonth = label.dataset.dayKey || null;
                }
            }
            if (curYear !== null && curMonth !== null) {
                sidebarEl.findAll('.sidebar-tree-month-item').forEach(e => e.removeClass('active'));
                const monthNav = sidebarEl.querySelector(`.sidebar-tree-month-item[data-year="${curYear}"][data-day-key="${curMonth}"]`);
                if (monthNav) {
                    monthNav.addClass('active');
                    
                    const parentDaysList = monthNav.parentElement;
                    if (parentDaysList && parentDaysList.hasClass('sidebar-tree-months-list') && parentDaysList.hasClass('collapsed')) {
                        parentDaysList.removeClass('collapsed');
                        const monthHeader = parentDaysList.previousElementSibling as HTMLElement;
                        if (monthHeader && monthHeader.hasClass('sidebar-tree-real-month-header')) {
                            const chevron = monthHeader.querySelector('.sidebar-tree-chevron');
                            if (chevron) chevron.setText('▾');
                        }
                    }

                    const yearList = parentDaysList?.parentElement;
                    if (yearList && yearList.hasClass('sidebar-tree-months-list') && yearList.hasClass('collapsed')) {
                        yearList.removeClass('collapsed');
                        const ageGroupEl = yearList.closest('.sidebar-tree-age-group');
                        if (ageGroupEl) {
                            const chevron = ageGroupEl.querySelector('.sidebar-tree-chevron');
                            if (chevron) chevron.setText('▾');
                        }
                    }
                }
                
                sidebarEl.findAll('.sidebar-tree-age-header').forEach(e => e.removeClass('active'));
                const ageNav = sidebarEl.querySelector(`#nav-age-${curYear}`);
                if (ageNav) ageNav.addClass('active');
            }
        };
        this.scrollHandler = handler;
        mainEl.addEventListener('scroll', handler, { passive: true });
    }

    // ================================================================
    //  CALENDAR MODE with image preview & date jump
    // ================================================================

    renderCalendarMode(container: HTMLElement, child: ChildInfo) {
        const cal = container.createDiv('calendar-container');

        // Header
        const header = cal.createDiv('calendar-header');

        // Left controls
        const headerLeft = header.createDiv('calendar-header-left');
        const prev = headerLeft.createDiv('calendar-nav-btn'); prev.setText('‹');
        prev.onclick = () => { this.calMonth--; if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; } this.renderView(); };

        // Centered title
        const title = header.createDiv('calendar-title');
        title.createSpan('cal-month').setText(`${this.calYear}年${this.calMonth + 1}月`);
        title.createSpan('cal-age').setText('拾光');

        // Right controls
        const headerRight = header.createDiv('calendar-header-right');
        const next = headerRight.createDiv('calendar-nav-btn'); next.setText('›');
        next.onclick = () => { this.calMonth++; if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; } this.renderView(); };

        const todayBtn = headerRight.createDiv('calendar-today-btn');
        todayBtn.setText('今天');
        todayBtn.onclick = () => { const now = new Date(); this.calYear = now.getFullYear(); this.calMonth = now.getMonth(); this.calSelectedDate = null; this.renderView(); };

        // Weekday labels
        const weekdays = cal.createDiv('calendar-weekdays');
        for (const d of ['日', '一', '二', '三', '四', '五', '六']) weekdays.createDiv('calendar-weekday').setText(d);

        // Build date map
        const dateMap = new Map<string, RenderedPost[]>();
        for (const p of this.allPosts) { const k = p.entry.date; if (!dateMap.has(k)) dateMap.set(k, []); dateMap.get(k)!.push(p); }

        // Grid
        const grid = cal.createDiv('calendar-grid');
        const firstDay = new Date(this.calYear, this.calMonth, 1).getDay();
        const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
        const daysInPrev = new Date(this.calYear, this.calMonth, 0).getDate();
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

        // Prev month trailing
        for (let i = firstDay - 1; i >= 0; i--) {
            const cell = grid.createDiv('calendar-day other-month');
            const numEl = cell.createDiv('calendar-day-number-wrapper');
            numEl.createSpan('calendar-day-number').setText(String(daysInPrev - i));
        }

        // Current month
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${this.calYear}-${String(this.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const cell = grid.createDiv('calendar-day');
            if (dateStr === todayStr) cell.addClass('today');

            const numEl = cell.createDiv('calendar-day-number-wrapper');
            numEl.createSpan('calendar-day-number').setText(String(d));

            const entries = dateMap.get(dateStr) || [];
            if (entries.length > 0) {
                cell.addClass('has-entries');
                // Show first image as background thumbnail
                const firstImg = entries.find(e => e.entry.images?.length > 0);
                if (firstImg) {
                    cell.addClass('has-image');
                    const thumb = cell.createDiv('calendar-day-thumb');
                    const img = thumb.createEl('img');
                    img.src = this.resolveMediaSrc(firstImg.entry.images[0]);
                    img.loading = 'lazy';
                } else {
                    cell.addClass('has-entries-only');
                }

                const mediaKinds = new Set<string>();
                entries.forEach(post => {
                    if ((post.entry.images || []).length) mediaKinds.add('图');
                    if ((post.entry.videos || []).length) mediaKinds.add('影');
                    if ((post.entry.audios || []).length) mediaKinds.add('声');
                    if ((post.entry.files || []).length) mediaKinds.add('文');
                    if (this.mediaCount(post.entry) === 0) mediaKinds.add('记');
                });
                const dots = cell.createDiv('calendar-day-dots');
                Array.from(mediaKinds).slice(0, 4).forEach(kind => dots.createSpan('calendar-day-dot').setText(kind));

                // Count badge
                const countBadge = cell.createDiv('calendar-day-count-badge');
                if (entries.length > 1) {
                    countBadge.setText(`+${entries.length}`);
                } else {
                    countBadge.setText('1');
                }
            }

            if (entries.length > 0) {
                cell.onclick = () => { this.jumpToDate(dateStr); };
            }
        }

        // Next month fill
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            const cell = grid.createDiv('calendar-day other-month');
            const numEl = cell.createDiv('calendar-day-number-wrapper');
            numEl.createSpan('calendar-day-number').setText(String(i));
        }
    }

    // ================================================================
    //  GALLERY MODE
    // ================================================================

    renderGalleryMode(container: HTMLElement, child: ChildInfo) {
        const gc = container.createDiv('gallery-container');

        const toolbar = gc.createDiv('gallery-toolbar');
        let activeType: 'all' | 'image' | 'video' | 'audio' | 'file' = 'all';
        let activeTag = '';
        let statsEl: HTMLElement | null = null;

        const filters: { type: string; label: string }[] = [
            { type: 'all', label: '全部类型' },
            { type: 'image', label: '图片' },
            { type: 'video', label: '视频' },
            { type: 'audio', label: '录音' },
            { type: 'file', label: '文件' },
        ];

        const allTags = new Set<string>();
        for (const post of this.allPosts) {
            if (post.entry.tags) {
                post.entry.tags.forEach(t => allTags.add(t));
            }
        }

        const renderGrid = () => {
            // Remove old dynamic contents
            gc.querySelectorAll('.gallery-date-group').forEach(el => el.remove());
            gc.querySelector('.gallery-empty')?.remove();
            gc.querySelector('.gallery-sentinel')?.remove();

            interface MediaItem { fileName: string; type: 'image'|'video'|'audio'|'file'|'text'; date: Date; ageStr: string; isLiked: boolean; entryId: string; entry: TimelineEntry; }
            const items: MediaItem[] = [];
            for (const post of this.allPosts) {
                const liked = post.entry.likes && post.entry.likes > 0;
                if (activeTag === '__liked__' && !liked) continue;
                if (activeTag.startsWith('tag:')) {
                    const tag = activeTag.substring(4);
                    if (!post.entry.tags || !post.entry.tags.includes(tag)) continue;
                }
                if (this.gallerySearchQuery && !this.entrySearchText(post).includes(this.gallerySearchQuery.toLowerCase())) continue;

                const mediaCount = (post.entry.images?.length || 0) + (post.entry.videos?.length || 0) + (post.entry.audios?.length || 0) + (post.entry.files?.length || 0);
                if (mediaCount === 0 && liked && post.entry.content) {
                    if (activeType === 'all') {
                        items.push({ fileName: post.entry.content, type: 'text', date: post.date, ageStr: post.ageStr, isLiked: !!liked, entryId: post.entry.id, entry: post.entry });
                    }
                }

                for (const img of (post.entry.images||[])) {
                    if (activeType !== 'all' && activeType !== 'image') continue;
                    items.push({ fileName: img, type: 'image', date: post.date, ageStr: post.ageStr, isLiked: !!liked, entryId: post.entry.id, entry: post.entry });
                }
                for (const vid of (post.entry.videos||[])) {
                    if (activeType !== 'all' && activeType !== 'video') continue;
                    items.push({ fileName: vid, type: 'video', date: post.date, ageStr: post.ageStr, isLiked: !!liked, entryId: post.entry.id, entry: post.entry });
                }
                for (const audioName of (post.entry.audios || [])) {
                    if (activeType !== 'all' && activeType !== 'audio') continue;
                    items.push({ fileName: audioName, type: 'audio', date: post.date, ageStr: post.ageStr, isLiked: !!liked, entryId: post.entry.id, entry: post.entry });
                }
                for (const fileName of (post.entry.files || [])) {
                    if (activeType !== 'all' && activeType !== 'file') continue;
                    items.push({ fileName, type: 'file', date: post.date, ageStr: post.ageStr, isLiked: !!liked, entryId: post.entry.id, entry: post.entry });
                }
            }

            if (statsEl) statsEl.setText(`共 ${items.length} 个文件`);
            if (items.length === 0) { gc.createDiv('gallery-empty').setText('暂无内容'); return; }

            // The gallery lives in Obsidian's pane scroller, not always inside its
            // own scroll container. Rendering the filtered set eagerly avoids an
            // IntersectionObserver root mismatch that can hide older media groups.
            const BATCH_SIZE = Math.max(items.length, 30);
            let renderedCount = 0;
            
            const sentinel = gc.createDiv('gallery-sentinel');
            setCssProps(sentinel, { height: '20px', width: '100%' });

            const renderBatch = () => {
                const batch = items.slice(renderedCount, renderedCount + BATCH_SIZE);
                if (batch.length === 0) return;

                // Group by Date string
                const grouped = new Map<string, MediaItem[]>();
                for (const item of batch) {
                    const dateStr = this.fmtDate(item.date);
                    if (!grouped.has(dateStr)) grouped.set(dateStr, []);
                    grouped.get(dateStr)!.push(item);
                }

                // Create a date group container for each date
                for (const [dateStr, groupItems] of grouped.entries()) {
                    let groupEl = gc.querySelector(`.gallery-date-group[data-date="${dateStr}"]`) as HTMLElement;
                    if (!groupEl) {
                        groupEl = document.createElement('div');
                        groupEl.className = 'gallery-date-group';
                        groupEl.setAttribute('data-date', dateStr);
                        gc.insertBefore(groupEl, sentinel);
                        
                        const header = groupEl.createDiv('gallery-date-header');
                        header.setText(dateStr);
                        
                        groupEl.createDiv('gallery-grid');
                    }
                    
                    const grid = groupEl.querySelector('.gallery-grid') as HTMLElement;
                    
                    for (const item of groupItems) {
                        const wrapper = grid.createDiv('gallery-item');
                        if (item.type === 'image') {
                            const media = this.resolveMediaInfo(item.fileName);
                            if (!media.ok) {
                                wrapper.addClass('gallery-broken-item');
                                this.renderMediaPlaceholder(wrapper, item.fileName, media.reason);
                            } else {
                                const img = wrapper.createEl('img');
                                img.src = media.src; img.loading = 'lazy';
                                img.onerror = () => {
                                    wrapper.addClass('gallery-broken-item');
                                    this.renderMediaPlaceholder(wrapper, item.fileName, '图片无法读取');
                                    img.remove();
                                };
                                img.onclick = () => {
                                    const allImages = Array.from(gc.querySelectorAll('.gallery-item img')) as HTMLImageElement[];
                                    const srcs = allImages.map(img => img.src);
                                    let index = srcs.indexOf(img.src);
                                    if (index === -1) index = 0;
                                    this.openLightbox(index, srcs);
                                };
                            }
                        } else if (item.type === 'video') {
                            const vid = wrapper.createEl('video', { attr: { preload: 'metadata' } });
                            vid.src = this.resolveMediaSrc(item.fileName);
                            const play = wrapper.createDiv('gallery-item-play'); play.setText('▶');
                            wrapper.onclick = () => {
                                vid.controls = true;
                                void vid.play();
                                setCssProps(play, { display: 'none' });
                            };
                        } else if (item.type === 'audio') {
                            wrapper.addClass('gallery-audio-item');
                            this.renderAudioCard(wrapper, this.resolveMediaSrc(item.fileName), item.fileName.split('/').pop() || '录音', {
                                transcript: item.entry.audioTranscripts?.[item.fileName],
                                onTranscribe: () => this.plugin.transcribeAudio(item.entry.id, item.fileName),
                            });
                        } else if (item.type === 'text') {
                            wrapper.addClass('gallery-text-item');
                            const textContent = wrapper.createDiv('gallery-text-content');
                            textContent.setText(item.fileName); // fileName holds the content
                            setCssProps(wrapper, {
                                padding: '12px',
                                backgroundColor: 'var(--background-secondary)',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column'
                            });
                            setCssProps(textContent, {
                                whiteSpace: 'pre-wrap',
                                fontSize: '13px',
                                color: 'var(--text-normal)'
                            });
                        } else {
                            const link = wrapper.createEl('a', { href: '#', text: item.fileName.split('/').pop() || item.fileName });
                            link.addClass('life-media-file');
                            link.onclick = (e) => {
                                e.preventDefault();
                                const path = this.plugin.resolveMediaPath(item.fileName);
                                const file = this.app.vault.getAbstractFileByPath(path);
                                if (file instanceof TFile) {
                                    void this.app.workspace.getLeaf('tab').openFile(file);
                                }
                            };
                        }
                        
                        const overlay = wrapper.createDiv('gallery-item-overlay');
                        overlay.createDiv('overlay-age').setText(item.ageStr);

                        if (item.isLiked) {
                            const badge = wrapper.createDiv('gallery-item-like-badge');
                            badge.setText('❤️');
                        }

                        const delBtn = wrapper.createDiv('gallery-item-delete-btn');
                        setIcon(delBtn, 'trash-2');
                        delBtn.onclick = async (e) => {
                            e.stopPropagation();
                            if (confirm(item.type === 'text' ? '确定取消喜欢该记录？' : '确定删除该文件？')) {
                                if (item.type !== 'text') {
                                    await this.plugin.deleteMediaFile(item.fileName);
                                }
                                const entry = this.plugin.data.entries.find(e => e.id === item.entryId);
                                if (entry) {
                                    if (item.type === 'image' && entry.images) {
                                        entry.images = entry.images.filter(img => img !== item.fileName);
                                    } else if (item.type === 'video' && entry.videos) {
                                        entry.videos = entry.videos.filter(vid => vid !== item.fileName);
                                    } else if (item.type === 'audio' && entry.audios) {
                                        entry.audios = entry.audios.filter(audio => audio !== item.fileName);
                                    } else if (item.type === 'file' && entry.files) {
                                        entry.files = entry.files.filter(file => file !== item.fileName);
                                    } else if (item.type === 'text') {
                                        entry.likes = 0;
                                    }
                                    await this.plugin.savePluginData();
                                    this.app.workspace.trigger('child-timeline-data-changed');
                                }
                            }
                        };
                    }
                }
                
                renderedCount += batch.length;
                if (renderedCount >= items.length) {
                    if (this.galleryObserver) this.galleryObserver.disconnect();
                    sentinel.remove();
                }
            };
            
            if (this.galleryObserver) this.galleryObserver.disconnect();
            this.galleryObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    renderBatch();
                }
            }, { root: gc, rootMargin: '400px' });
            
            this.galleryObserver.observe(sentinel);
            renderBatch(); // Initial render
        };

        const btnContainer = toolbar.createDiv('gallery-filter-bar');

        const searchWrap = btnContainer.createDiv('gallery-search-field');
        setIcon(searchWrap.createSpan('gallery-search-icon'), 'search');
        const searchInput = searchWrap.createEl('input', {
            type: 'search',
            placeholder: '检索资源、录音、文件...'
        });
        searchInput.addClass('gallery-search-input');
        searchInput.value = this.gallerySearchQuery;
        searchInput.oninput = () => {
            this.gallerySearchQuery = searchInput.value.trim();
            renderGrid();
        };

        const typeSelect = btnContainer.createEl('select', { cls: 'gallery-filter-select gallery-type-select' });
        for (const f of filters) {
            typeSelect.createEl('option', { value: f.type, text: f.label });
        }
        typeSelect.value = activeType;
        typeSelect.onchange = () => {
            activeType = typeSelect.value as typeof activeType;
            renderGrid();
        };

        const tagSelect = btnContainer.createEl('select', { cls: 'gallery-filter-select gallery-tag-select' });
        tagSelect.createEl('option', { text: '所有标签', value: '' });
        tagSelect.createEl('option', { text: '喜欢', value: '__liked__' });
        allTags.forEach(tag => {
            tagSelect.createEl('option', { text: tag, value: `tag:${tag}` });
        });
        
        tagSelect.onchange = () => {
            activeTag = tagSelect.value;
            renderGrid();
        };

        // Initialize select value if needed
        tagSelect.value = activeTag;

        statsEl = btnContainer.createDiv('gallery-stats');
        renderGrid();
    }

    // ============ LIGHTBOX ============

    openLightbox(initialIndex: number, srcs: string[]) {
        if (srcs.length === 0) return;
        document.querySelector('.timeline-lightbox')?.remove();
        let currentIndex = initialIndex;

        const overlay = document.body.createDiv('timeline-lightbox active');
        const imgEl = overlay.createEl('img'); 
        imgEl.src = srcs[currentIndex];

        const counter = overlay.createDiv('timeline-lightbox-counter');
        const updateCounter = () => { counter.setText(`${currentIndex + 1} / ${srcs.length}`); };
        updateCounter();

        const showImage = (index: number) => {
            if (index < 0) index = srcs.length - 1;
            if (index >= srcs.length) index = 0;
            currentIndex = index;
            imgEl.src = srcs[currentIndex];
            updateCounter();
        };

        const prevBtn = overlay.createDiv('timeline-lightbox-nav prev'); prevBtn.setText('❮');
        const nextBtn = overlay.createDiv('timeline-lightbox-nav next'); nextBtn.setText('❯');

        prevBtn.onclick = (e) => { e.stopPropagation(); showImage(currentIndex - 1); };
        nextBtn.onclick = (e) => { e.stopPropagation(); showImage(currentIndex + 1); };

        const close = overlay.createDiv('timeline-lightbox-close'); close.setText('×');
        close.onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        let touchStartX = 0;
        let touchEndX = 0;
        overlay.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, {passive: true});
        overlay.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            if (touchEndX < touchStartX - 50) showImage(currentIndex + 1);
            if (touchEndX > touchStartX + 50) showImage(currentIndex - 1);
        }, {passive: true});

        const handler = (e: KeyboardEvent) => { 
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
            else if (e.key === 'ArrowLeft') showImage(currentIndex - 1);
            else if (e.key === 'ArrowRight') showImage(currentIndex + 1);
        };
        document.addEventListener('keydown', handler);
    }

}



