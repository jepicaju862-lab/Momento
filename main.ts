import { Notice, Plugin, WorkspaceLeaf, normalizePath, requestUrl, TFile } from 'obsidian';
import { PluginData, DEFAULT_DATA, ChildTimelineSettingTab, TimelineEntry } from './settings';
import { TIMELINE_VIEW_TYPE, TimelineView } from './view';
import { AddPostModal } from './post-modal';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.webm', '.ogg'];

function isLikelyAudioName(name: string): boolean {
    const lower = name.toLowerCase();
    const hasAudioExt = AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
    return hasAudioExt && /(^|[/\\_-])(voice|audio|record|recording|录音)([/\\_.-]|$)/i.test(name);
}

export default class ChildTimelinePlugin extends Plugin {
    data: PluginData;

    async onload() {
        await this.loadPluginData();

        this.registerView(
            TIMELINE_VIEW_TYPE,
            (leaf) => new TimelineView(leaf, this)
        );

        this.addRibbonIcon('inbox', '打开拾光', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-life-timeline',
            name: '打开拾光',
            callback: () => {
                this.activateView();
            }
        });

        this.addCommand({
            id: 'add-timeline-post',
            name: '新增拾光记录',
            callback: () => {
                const modal = new AddPostModal(this.app, this, () => {
                    this.app.workspace.trigger('child-timeline-data-changed');
                });
                modal.open();
            }
        });

        this.addCommand({
            id: 'batch-import-images',
            name: '批量导入图片',
            callback: () => {
                this.batchImportImages();
            }
        });

        this.addSettingTab(new ChildTimelineSettingTab(this.app, this));
    }

    onunload() {
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            // Force opening in the main central area (middle tab) instead of sidebars
            leaf = workspace.getLeaf('tab');
            if (leaf) {
                await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    // ---- Data Persistence ----

    async loadPluginData() {
        const raw = await this.loadData();
        let needsSave = false;
        if (raw) {
            this.data = {
                settings: Object.assign({}, DEFAULT_DATA.settings, raw.settings || {}),
                entries: raw.entries || [],
            };
            const safeAttachmentFolder = this.getAttachmentFolder();
            if (this.data.settings.attachmentFolder !== safeAttachmentFolder) {
                this.data.settings.attachmentFolder = safeAttachmentFolder;
                needsSave = true;
            }
            // Migration: ensure avatar field
            for (const child of this.data.settings.children) {
                if (!child.avatar) { child.avatar = '记'; needsSave = true; }
            }
            // Migration: ensure new fields on all entries
            for (const entry of this.data.entries) {
                if (!entry.videos) { entry.videos = []; needsSave = true; }
                if (!entry.audios) { entry.audios = []; needsSave = true; }
                if (!entry.files) { entry.files = []; needsSave = true; }
                if (!entry.audioTranscripts) { entry.audioTranscripts = {}; needsSave = true; }
                if (entry.likes === undefined) { entry.likes = 0; needsSave = true; }
                if (!entry.comments) { entry.comments = []; needsSave = true; }
                const voiceVideos = (entry.videos || []).filter(isLikelyAudioName);
                if (voiceVideos.length > 0) {
                    entry.videos = (entry.videos || []).filter(name => !isLikelyAudioName(name));
                    entry.audios = Array.from(new Set([...(entry.audios || []), ...voiceVideos]));
                    needsSave = true;
                }
            }
        } else {
            this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        }
        if (needsSave) await this.saveData(this.data);
    }

    async savePluginData() {
        await this.saveData(this.data);
        this.app.workspace.trigger('child-timeline-settings-updated');
    }

    getAttachmentFolder(): string {
        const configured = (this.data.settings.attachmentFolder || 'life-media').trim().replace(/\\/g, '/');
        const unsafe = !configured
            || configured.startsWith('/')
            || /^[a-zA-Z]:\//.test(configured)
            || configured.split('/').some(part => part === '..' || part.includes(':'));
        return unsafe ? 'life-media' : normalizePath(configured.replace(/^\.\/+/, '').replace(/\/+$/, ''));
    }

    resolveMediaPath(filename: string): string {
        const normalized = normalizePath(filename);
        if (normalized.includes('/') || this.app.vault.getAbstractFileByPath(normalized)) return normalized;
        return normalizePath(`${this.getAttachmentFolder()}/${normalized}`);
    }

    private async ensureVaultFolder(folderPath: string) {
        const segments = normalizePath(folderPath).split('/').filter(Boolean);
        let current = '';
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }

    private uniqueMediaPath(path: string): string {
        const normalized = normalizePath(path);
        if (!this.app.vault.getAbstractFileByPath(normalized)) return normalized;
        const dot = normalized.lastIndexOf('.');
        const stem = dot >= 0 ? normalized.slice(0, dot) : normalized;
        const ext = dot >= 0 ? normalized.slice(dot) : '';
        let index = 2;
        let candidate = `${stem}_${index}${ext}`;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            index += 1;
            candidate = `${stem}_${index}${ext}`;
        }
        return candidate;
    }

    async saveMediaBinary(filename: string, buffer: ArrayBuffer): Promise<string> {
        if (buffer.byteLength === 0) {
            throw new Error('文件为空，已跳过保存。');
        }

        const safeName = filename.replace(/[\\/:*?"<>|#\[\]]/g, '_') || `media_${Date.now()}.bin`;
        const folder = this.getAttachmentFolder();
        let initialError: unknown;

        try {
            await this.ensureVaultFolder(folder);
            const preferredPath = this.uniqueMediaPath(`${folder}/${safeName}`);
            await this.app.vault.createBinary(preferredPath, buffer);
            return preferredPath;
        } catch (err) {
            initialError = err;
            console.warn('Preferred media directory is not writable; falling back to an Obsidian attachment path.', err);
        }

        try {
            const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(`拾光_${Date.now()}_${safeName}`);
            const availablePath = this.uniqueMediaPath(attachmentPath);
            await this.app.vault.createBinary(availablePath, buffer);
            new Notice('原媒体文件夹不可写，附件已保存到 Obsidian 默认附件位置。');
            return availablePath;
        } catch (err) {
            console.warn('Obsidian attachment path is not writable; falling back to the vault root.', err);
        }

        try {
            const rootPath = this.uniqueMediaPath(`拾光_${Date.now()}_${safeName}`);
            await this.app.vault.createBinary(rootPath, buffer);
            new Notice('媒体文件夹不可写，附件已暂存到仓库根目录。');
            return rootPath;
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err || initialError);
            throw new Error(`iPad 无法向当前仓库写入附件，请检查仓库同步/文件权限。${detail ? ` ${detail}` : ''}`);
        }
    }

    // ---- Entry CRUD ----

    async addEntry(entry: TimelineEntry) {
        this.data.entries.push(entry);
        await this.savePluginData();
        this.app.workspace.trigger('child-timeline-data-changed');
        await this.syncEntryToDailyNoteSafely(entry);
        this.queueAutoTranscribe(entry.id);
    }

    async deleteEntry(entryId: string) {
        const entry = this.data.entries.find(e => e.id === entryId);
        if (entry) {
            const media = [...(entry.images || []), ...(entry.videos || []), ...(entry.audios || []), ...(entry.files || [])];
            for (const m of media) {
                await this.deleteMediaFile(m);
            }
            await this.removeDailyNoteEntrySafely(entry.id, entry.date);
        }
        this.data.entries = this.data.entries.filter(e => e.id !== entryId);
        await this.savePluginData();
        this.app.workspace.trigger('child-timeline-data-changed');
    }

    async updateEntry(updatedEntry: TimelineEntry) {
        const index = this.data.entries.findIndex(e => e.id === updatedEntry.id);
        if (index !== -1) {
            const oldEntry = this.data.entries[index];
            const oldMedia = [...(oldEntry.images || []), ...(oldEntry.videos || []), ...(oldEntry.audios || []), ...(oldEntry.files || [])];
            const newMedia = [...(updatedEntry.images || []), ...(updatedEntry.videos || []), ...(updatedEntry.audios || []), ...(updatedEntry.files || [])];
            const removedMedia = oldMedia.filter(m => !newMedia.includes(m));
            
            for (const m of removedMedia) {
                await this.deleteMediaFile(m);
            }

            this.data.entries[index] = updatedEntry;
            await this.savePluginData();
            this.app.workspace.trigger('child-timeline-data-changed');
            await this.syncEntryToDailyNoteSafely(updatedEntry, oldEntry.date);
            this.queueAutoTranscribe(updatedEntry.id);
        }
    }

    private getDailyNotePath(date: string): string {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!match) throw new Error(`记录日期格式无效：${date}`);

        const template = (this.data.settings.dailyNotePathTemplate || 'YYYY-MM-DD.md').trim().replace(/\\/g, '/');
        const unsafe = !template
            || template.startsWith('/')
            || /^[a-zA-Z]:\//.test(template)
            || template.split('/').some(part => part === '..' || part.includes(':'));
        if (unsafe) throw new Error('日记路径模板必须是仓库内相对路径');

        const path = template
            .replace(/YYYY/g, match[1])
            .replace(/MM/g, match[2])
            .replace(/DD/g, match[3]);
        return normalizePath(path.toLowerCase().endsWith('.md') ? path : `${path}.md`);
    }

    private renderDailyNoteEntry(entry: TimelineEntry): string {
        const time = new Date(entry.createdAt || Date.now());
        const timeText = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
        const lines = [
            `<!-- shiguang-entry:${entry.id}:start -->`,
            `### 拾光 ${timeText}`,
        ];
        if (entry.content.trim()) lines.push('', entry.content.trim());
        if (entry.tags?.length) {
            lines.push('', `标签：${entry.tags.map(tag => `#${tag.trim().replace(/\s+/g, '-')}`).join(' ')}`);
        }
        const embeddedMedia = [...(entry.images || []), ...(entry.videos || []), ...(entry.audios || [])];
        if (embeddedMedia.length) lines.push('', ...embeddedMedia.map(path => `![[${path}]]`));
        if (entry.files?.length) lines.push('', ...entry.files.map(path => `[[${path}]]`));
        lines.push(`<!-- shiguang-entry:${entry.id}:end -->`);
        return lines.join('\n');
    }

    private async removeDailyNoteEntry(entryId: string, date: string): Promise<void> {
        const path = this.getDailyNotePath(date);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const content = await this.app.vault.read(file);
        const escapedId = entryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\n?<!-- shiguang-entry:${escapedId}:start -->[\\s\\S]*?<!-- shiguang-entry:${escapedId}:end -->\\n?`);
        if (pattern.test(content)) await this.app.vault.modify(file, content.replace(pattern, '\n').trimEnd() + '\n');
    }

    private async syncEntryToDailyNote(entry: TimelineEntry, previousDate?: string): Promise<void> {
        if (!this.data.settings.dailyNoteSyncEnabled) return;
        if (previousDate && previousDate !== entry.date) await this.removeDailyNoteEntry(entry.id, previousDate);

        const path = this.getDailyNotePath(entry.date);
        const slash = path.lastIndexOf('/');
        if (slash > 0) await this.ensureVaultFolder(path.slice(0, slash));

        const block = this.renderDailyNoteEntry(entry);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (!(existing instanceof TFile)) {
            await this.app.vault.create(path, `# ${entry.date}\n\n## 拾光\n\n${block}\n`);
            return;
        }

        const content = await this.app.vault.read(existing);
        const escapedId = entry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`<!-- shiguang-entry:${escapedId}:start -->[\\s\\S]*?<!-- shiguang-entry:${escapedId}:end -->`);
        if (pattern.test(content)) {
            await this.app.vault.modify(existing, content.replace(pattern, block));
            return;
        }

        const sectionMatch = /^## 拾光\s*$/m.exec(content);
        if (!sectionMatch) {
            await this.app.vault.modify(existing, `${content.trimEnd()}\n\n## 拾光\n\n${block}\n`);
            return;
        }

        const sectionBodyStart = sectionMatch.index + sectionMatch[0].length;
        const nextSection = /\n##\s/.exec(content.slice(sectionBodyStart));
        const insertAt = nextSection ? sectionBodyStart + nextSection.index : content.length;
        const before = content.slice(0, insertAt).trimEnd();
        const after = content.slice(insertAt).replace(/^\n+/, '');
        await this.app.vault.modify(existing, `${before}\n\n${block}\n${after ? `\n${after}` : ''}`);
    }

    private async syncEntryToDailyNoteSafely(entry: TimelineEntry, previousDate?: string): Promise<void> {
        try {
            await this.syncEntryToDailyNote(entry, previousDate);
        } catch (err) {
            console.error('Failed to sync entry to daily note:', err);
            const reason = err instanceof Error ? err.message : String(err);
            new Notice(`记录已保存，但写入日记失败：${reason}`);
        }
    }

    private async removeDailyNoteEntrySafely(entryId: string, date: string): Promise<void> {
        if (!this.data.settings.dailyNoteSyncEnabled) return;
        try {
            await this.removeDailyNoteEntry(entryId, date);
        } catch (err) {
            console.error('Failed to remove entry from daily note:', err);
            const reason = err instanceof Error ? err.message : String(err);
            new Notice(`记录已删除，但清理日记失败：${reason}`);
        }
    }

    async deleteMediaFile(filename: string) {
        const p = this.resolveMediaPath(filename);
        const file = this.app.vault.getAbstractFileByPath(p);
        if (file instanceof TFile) {
            try {
                await this.app.vault.trash(file, true); // Move to system trash instead of permanent delete
            } catch (err) {
                console.error("Failed to delete media file:", err);
            }
        }
    }

    async batchImportImages() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        
        input.onchange = async (e: Event) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files || files.length === 0) return;
            
            const mode = this.data.settings.batchImportTimeMode || 'creation';
            const defaultTags = this.data.settings.batchImportDefaultTag 
                ? this.data.settings.batchImportDefaultTag.split(',').map(s => s.trim()).filter(Boolean) 
                : ['inbox'];
            const defaultText = this.data.settings.batchImportDefaultText || '';
            
            let count = 0;
            const importedEntries: TimelineEntry[] = [];
            new Notice(`开始导入 ${files.length} 张图片...`);
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    if (file.size === 0) {
                        console.warn('Skipped empty image file:', file.name);
                        continue;
                    }

                    const buffer = await file.arrayBuffer();
                    
                    let safeName = file.name.replace(/[\\/:*?"<>|#\[\]]/g, '_');
                    if (!safeName || !safeName.includes('.')) {
                        const ext = file.type ? file.type.split('/')[1] : 'jpg';
                        safeName = `capture_${Date.now()}_${i}.${ext}`;
                    }
                    const savedPath = await this.saveMediaBinary(safeName, buffer);
                    
                    // Determine time
                    let timeMs = Date.now();
                    if (mode === 'creation' && file.lastModified) {
                        timeMs = file.lastModified;
                    }
                    const d = new Date(timeMs);
                    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    
                    const entry: TimelineEntry = {
                        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                        date: dateStr,
                        subjectName: undefined,
                        childName: '',
                        content: defaultText,
                        images: [savedPath],
                        videos: [],
                        audios: [],
                        files: [],
                        audioTranscripts: {},
                        likes: 0,
                        comments: [],
                        createdAt: timeMs,
                        tags: defaultTags.length > 0 ? defaultTags : undefined,
                    };
                    
                    this.data.entries.push(entry);
                    importedEntries.push(entry);
                    count++;
                } catch (err) {
                    console.error('Failed to import file', file.name, err);
                }
            }
            
            if (count > 0) {
                await this.savePluginData();
                this.app.workspace.trigger('child-timeline-data-changed');
                for (const entry of importedEntries) await this.syncEntryToDailyNoteSafely(entry);
                new Notice(`✅ 成功批量导入 ${count} 张图片！`);
            }
        };
        input.click();
    }


    getEntriesForChild(childName: string): TimelineEntry[] {
        if (!childName) return this.data.entries;
        return this.data.entries.filter(e => (e.subjectName || e.childName) === childName);
    }

    async toggleLike(entryId: string) {
        const entry = this.data.entries.find(e => e.id === entryId);
        if (entry) {
            entry.likes = (entry.likes || 0) + 1;
            await this.saveData(this.data);
            this.app.workspace.trigger('child-timeline-data-changed');
        }
    }

    async addComment(entryId: string, text: string) {
        const entry = this.data.entries.find(e => e.id === entryId);
        const value = text.trim();
        if (!entry || !value) return;
        entry.comments = entry.comments || [];
        entry.comments.push({
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            text: value,
            author: '我',
            createdAt: Date.now(),
        });
        await this.saveData(this.data);
        this.app.workspace.trigger('child-timeline-data-changed');
    }

    async deleteComment(entryId: string, commentId: string) {
        const entry = this.data.entries.find(e => e.id === entryId);
        if (!entry || !entry.comments) return;
        entry.comments = entry.comments.filter(comment => comment.id !== commentId);
        await this.saveData(this.data);
        this.app.workspace.trigger('child-timeline-data-changed');
    }

    private queueAutoTranscribe(entryId: string) {
        if (!this.data.settings.sttAutoTranscribe) return;
        window.setTimeout(() => {
            this.transcribeMissingAudios(entryId).catch(err => {
                console.error('Auto transcription failed:', err);
                new Notice(`录音自动转写失败：${err.message || err}`);
            });
        }, 200);
    }

    async transcribeMissingAudios(entryId: string) {
        const entry = this.data.entries.find(e => e.id === entryId);
        if (!entry || !entry.audios?.length) return;
        for (const audioName of entry.audios) {
            if (entry.audioTranscripts?.[audioName]) continue;
            await this.transcribeAudio(entryId, audioName);
        }
    }

    async transcribeAudio(entryId: string, audioName: string): Promise<string> {
        const endpoint = (this.data.settings.sttEndpoint || '').trim();
        if (!endpoint) throw new Error('请先在设置中填写语音转文字接口地址');

        const entry = this.data.entries.find(e => e.id === entryId);
        if (!entry) throw new Error('找不到这条记录');

        const p = this.resolveMediaPath(audioName);
        const file = this.app.vault.getAbstractFileByPath(p);
        if (!(file instanceof TFile)) throw new Error(`找不到音频文件：${audioName}`);

        const buffer = await this.app.vault.readBinary(file);
        const response = await requestUrl({
            url: endpoint,
            method: 'POST',
            contentType: 'application/octet-stream',
            body: buffer,
            headers: {
                'X-Filename': encodeURIComponent(audioName.split('/').pop() || audioName),
                'X-Language': 'zh'
            },
            throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(response.text || `接口返回 ${response.status}`);
        }

        const text = this.extractTranscriptText(response.json, response.text);
        if (!text) throw new Error('接口未返回转写文本');

        entry.audioTranscripts = entry.audioTranscripts || {};
        entry.audioTranscripts[audioName] = text;
        await this.saveData(this.data);
        this.app.workspace.trigger('child-timeline-data-changed');
        return text;
    }

    private extractTranscriptText(json: any, text: string): string {
        if (json) {
            if (typeof json === 'string') return json.trim();
            if (typeof json.text === 'string') return json.text.trim();
            if (typeof json.transcript === 'string') return json.transcript.trim();
            if (Array.isArray(json.segments)) {
                return json.segments
                    .map((segment: any) => typeof segment === 'string' ? segment : segment?.text)
                    .filter(Boolean)
                    .join('\n')
                    .trim();
            }
        }
        return (text || '').trim();
    }

}
