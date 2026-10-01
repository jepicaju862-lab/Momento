import { Notice, Platform, TFile } from 'obsidian';
import type ChildTimelinePlugin from './main';
import {
    imageSize, looksLikeScreenshot, mergeGroups, pendingGroups, remindable,
    type WechatGroup, type WechatMessage,
} from './wechat-candidates';

/** WeChat2Ob's plugin API (version 1); only what Momento uses. */
interface Wechat2obApi {
    version: 1;
    query(options: { days?: number; limit?: number; kinds?: string[] }): Promise<{ messages: WechatMessage[] }>;
    /** Newer WeChat2Ob: marks messages 已整理 / 待整理 in its inbox table. */
    setProcessed?(keys: string[], processed: boolean): Promise<{ changed: number; skipped: number }>;
}

/** Fired after the candidate snapshot changed (new messages, keep, dismiss). */
export const WECHAT_UPDATED_EVENT = 'momento:wechat-updated';
export const WECHAT_SOURCE = 'wechat2ob';
const WECHAT_TAG = '微信';
/** Dismissed keys are forgotten once older than this and no longer returned by WeChat2Ob. */
const DISMISS_TTL = 90 * 86400000;

/**
 * Reads WeChat2Ob through its public API and offers photo / video / voice groups as
 * candidates. Nothing is written to Momento until the user keeps a group (or turns on
 * auto-keep), so ignoring candidates costs nothing.
 */
export class WechatBridge {
    private messages: WechatMessage[] = [];
    private screenshots = new Map<string, boolean>();
    private loading: Promise<void> | null = null;
    private loadedOnce = false;
    private reconciled = false;

    constructor(private plugin: ChildTimelinePlugin) {}

    private api(): Wechat2obApi | null {
        const plugins = (this.plugin.app as unknown as { plugins?: { plugins?: Record<string, { api?: unknown }> } }).plugins?.plugins;
        const api = plugins?.[WECHAT_SOURCE]?.api as Partial<Wechat2obApi> | undefined;
        return api && api.version === 1 && typeof api.query === 'function' ? api as Wechat2obApi : null;
    }

    available(): boolean {
        return this.api() !== null;
    }

    /** Re-reads WeChat2Ob; concurrent calls share one load. */
    refresh(): Promise<void> {
        this.loading ??= this.load().finally(() => { this.loading = null; });
        return this.loading;
    }

    private async load(): Promise<void> {
        const api = this.api();
        let messages: WechatMessage[] = [];
        if (api) {
            try {
                const inbox = await api.query({ days: 0, limit: 200, kinds: [] });
                messages = Array.isArray(inbox?.messages) ? inbox.messages.filter(valid) : [];
            } catch (err) {
                console.error('Momento: reading WeChat2Ob failed', err);
                return;
            }
        }
        await this.measureImages(messages);
        this.messages = messages;
        this.loadedOnce = true;
        this.pruneDismissed();
        // Once per session: memories kept before the table could be updated (or while WeChat2Ob was off).
        if (api?.setProcessed && !this.reconciled) {
            this.reconciled = true;
            void this.markProcessed(Array.from(this.keptIndex().keys()), true);
        }
        this.plugin.app.workspace.trigger(WECHAT_UPDATED_EVENT);
    }

    /** Reads image headers once per path so screenshots are not offered as memories. */
    private async measureImages(messages: WechatMessage[]): Promise<void> {
        for (const m of messages) {
            for (const a of m.attachments) {
                if (!a.mimeType.startsWith('image/') || this.screenshots.has(a.path)) continue;
                let size: { width: number; height: number } | null = null;
                try {
                    const file = this.plugin.app.vault.getAbstractFileByPath(a.path);
                    if (file instanceof TFile) size = imageSize(new Uint8Array(await this.plugin.app.vault.readBinary(file)));
                } catch { /* Unreadable image: decided by file name only. */ }
                this.screenshots.set(a.path, looksLikeScreenshot(a.path, size));
            }
        }
    }

    private isScreenshot = (path: string): boolean => this.screenshots.get(path) ?? looksLikeScreenshot(path);

    /** Message key → id of the entry that kept it. */
    keptIndex(): Map<string, string> {
        const index = new Map<string, string>();
        for (const entry of this.plugin.data.entries) {
            if (entry.source?.plugin !== WECHAT_SOURCE) continue;
            for (const key of entry.source.keys) index.set(key, entry.id);
        }
        return index;
    }

    /** Every group not kept or dismissed yet, newest first (includes plain text). */
    pending(): WechatGroup[] {
        const kept = this.keptIndex(), dismissed = this.plugin.data.wechatDismissed;
        return pendingGroups(this.messages, key => kept.has(key) || key in dismissed, this.isScreenshot);
    }

    /** Photo / video / voice groups from the last 7 days that still wait for a decision. */
    candidates(): WechatGroup[] {
        return remindable(this.pending());
    }

    get ready(): boolean {
        return this.loadedOnce;
    }

    findGroup(keyOrMessageKey: string): WechatGroup | null {
        return this.pending().find(g => g.key === keyOrMessageKey || g.keys.includes(keyOrMessageKey)) ?? null;
    }

    /** Keeps one group, or several merged into one entry; `content` replaces the text (a caption written before keeping). */
    async keep(groups: WechatGroup[], content?: string): Promise<string | null> {
        if (!groups.length) return null;
        const group = groups.length === 1 ? groups[0] : mergeGroups(groups);
        const { id } = await this.plugin.captureEntry({
            ...group.draft,
            ...(content !== undefined ? { content } : {}),
            tags: [WECHAT_TAG],
        }, { plugin: WECHAT_SOURCE, keys: group.keys, notePath: group.notePath });
        this.plugin.app.workspace.trigger(WECHAT_UPDATED_EVENT);
        return id;
    }

    /** Keeps each group as its own entry; `contentFor` may supply a caption per group. */
    async keepEach(groups: WechatGroup[], contentFor?: (group: WechatGroup) => string | undefined): Promise<string[]> {
        const ids: string[] = [];
        for (const group of groups) {
            const id = await this.keep([group], contentFor?.(group));
            if (id) ids.push(id);
        }
        return ids;
    }

    async dismiss(groups: WechatGroup[]): Promise<void> {
        if (!groups.length) return;
        const now = Date.now();
        for (const group of groups) for (const key of group.keys) this.plugin.data.wechatDismissed[key] = now;
        await this.plugin.savePluginData();
        this.plugin.app.workspace.trigger(WECHAT_UPDATED_EVENT);
    }

    /** Puts dismissed groups back (used by undo). */
    async restore(keys: string[]): Promise<void> {
        for (const key of keys) delete this.plugin.data.wechatDismissed[key];
        await this.plugin.savePluginData();
        this.plugin.app.workspace.trigger(WECHAT_UPDATED_EVENT);
    }

    /**
     * Undo for a keep: removes the entries (WeChat2Ob's files stay). The groups become candidates
     * again, unless `dismiss` (used for auto-keep, which would otherwise keep them on the next sync).
     */
    async unkeep(entryIds: string[], options: { dismiss?: boolean } = {}): Promise<void> {
        const keys: string[] = [];
        for (const id of entryIds) {
            const entry = this.plugin.data.entries.find(e => e.id === id);
            if (entry?.source?.plugin === WECHAT_SOURCE) keys.push(...entry.source.keys);
            await this.plugin.deleteEntry(id);
        }
        if (options.dismiss) {
            const now = Date.now();
            for (const key of keys) this.plugin.data.wechatDismissed[key] = now;
            await this.plugin.savePluginData();
        }
        this.plugin.app.workspace.trigger(WECHAT_UPDATED_EVENT);
    }

    /**
     * Keeps WeChat2Ob's inbox table in step: kept messages are 已整理, undone or deleted ones 待整理 again.
     * Best effort: a failure is logged and never blocks keeping.
     */
    async markProcessed(keys: string[], processed: boolean): Promise<void> {
        const api = this.api();
        if (!api?.setProcessed || !keys.length) return;
        try {
            await api.setProcessed(keys, processed);
        } catch (err) {
            console.error('Momento: updating WeChat2Ob inbox status failed', err);
        }
    }

    /** After WeChat2Ob synced: refresh, then auto-keep when the user asked for it. */
    async onSynced(): Promise<void> {
        await this.refresh();
        // Auto-keep runs only on desktop, where WeChat2Ob syncs, so two devices never race on data.json.
        if (!this.plugin.data.settings.wechatAutoKeep || !Platform.isDesktopApp) return;
        const groups = this.candidates();
        if (!groups.length) return;
        const ids = await this.keepEach(groups);
        if (ids.length) this.notifyKept(ids, `已自动存为拾光：${ids.length} 条`, { dismissOnUndo: true });
    }

    /** “Kept N memories · View · Undo”. */
    notifyKept(ids: string[], label = `已存为拾光：${ids.length} 条`, options: { dismissOnUndo?: boolean } = {}): void {
        const fragment = createFragment();
        fragment.createSpan({ text: label });
        const actions = fragment.createDiv({ cls: 'momento-notice-actions' });
        const view = actions.createEl('button', { text: '查看' });
        const undo = actions.createEl('button', { text: '撤销' });
        const notice = new Notice(fragment, 8000);
        view.onclick = () => { notice.hide(); void this.plugin.openEntry(ids[0]); };
        undo.onclick = () => { notice.hide(); void this.unkeep(ids, { dismiss: options.dismissOnUndo }); };
    }

    /** “Ignored · Undo”. */
    notifyDismissed(groups: WechatGroup[]): void {
        const fragment = createFragment();
        fragment.createSpan({ text: groups.length > 1 ? `已忽略 ${groups.length} 组` : '已忽略' });
        const actions = fragment.createDiv({ cls: 'momento-notice-actions' });
        const undo = actions.createEl('button', { text: '撤销' });
        const notice = new Notice(fragment, 6000);
        undo.onclick = () => { notice.hide(); void this.restore(groups.flatMap(g => g.keys)); };
    }

    private pruneDismissed(): void {
        const cutoff = Date.now() - DISMISS_TTL, present = new Set(this.messages.map(m => m.key));
        let changed = false;
        for (const [key, at] of Object.entries(this.plugin.data.wechatDismissed)) {
            if (at < cutoff && !present.has(key)) { delete this.plugin.data.wechatDismissed[key]; changed = true; }
        }
        if (changed) void this.plugin.savePluginData();
    }
}

function valid(m: WechatMessage): boolean {
    return !!m && typeof m.key === 'string' && typeof m.receivedAt === 'string' && Number.isFinite(Date.parse(m.receivedAt))
        && typeof m.content === 'string' && typeof m.transcript === 'string' && typeof m.title === 'string'
        && Array.isArray(m.attachments) && m.attachments.every(a => !!a && typeof a.path === 'string' && typeof a.kind === 'string' && typeof a.mimeType === 'string');
}
