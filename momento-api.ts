import type ChildTimelinePlugin from './main';
import type { EntrySource, TimelineEntry } from './settings';
import { WECHAT_SOURCE } from './wechat-bridge';
import type { EntryDraft } from './entry-source';

/**
 * Momento's plugin API, for dashboards and companion plugins:
 *
 *   const api = app.plugins.plugins["momento"]?.api;
 *   app.workspace.on("momento:ready", api => ...);
 *   app.workspace.on("momento:changed", () => ...);   // entries or candidates changed
 *
 * Entries are returned as copies; change them through Momento only.
 */
export interface MomentoEntry {
    id: string;
    date: string;
    createdAt: number;
    content: string;
    tags: string[];
    images: string[];
    videos: string[];
    audios: string[];
    files: string[];
    likes: number;
    source?: EntrySource;
}

export interface MomentoCandidate {
    key: string;
    date: string;
    receivedAt: number;
    summary: string;
    cover?: string;
    images: number;
    videos: number;
    audios: number;
}

export interface MomentoApi {
    version: 1;
    list(query?: { from?: string; to?: string; tag?: string; limit?: number }): MomentoEntry[];
    /** Entries on this month and day in earlier years, newest year first. */
    onThisDay(date?: Date): MomentoEntry[];
    random(): MomentoEntry | null;
    open(id: string): Promise<void>;
    /** Resolves a vault media path (or bare file name) to a displayable URL. */
    resourceUrl(path: string): string;
    /** Item key → entry id for items of `plugin` that were kept. */
    findBySource(plugin: string, keys: string[]): Record<string, string>;
    /** Creates an entry once per source; repeated calls return the existing entry. */
    capture(draft: EntryDraft, options: { source: EntrySource }): Promise<{ id: string; created: boolean }>;
    wechat: {
        available(): boolean;
        /** Photo / video / voice groups from the last 7 days that wait for a decision. */
        candidates(): MomentoCandidate[];
        /**
         * Keeps the group that contains this message (or group) key; returns the entry id.
         * `notify` shows Momento's “saved · view · undo” notice, so every surface behaves alike.
         */
        keep(key: string, options?: { notify?: boolean }): Promise<string | null>;
        keepAll(): Promise<number>;
        dismiss(key: string): Promise<void>;
    };
}

export const MOMENTO_CHANGED = 'momento:changed';
export const MOMENTO_READY = 'momento:ready';

function copy(entry: TimelineEntry): MomentoEntry {
    return {
        id: entry.id,
        date: entry.date,
        createdAt: entry.createdAt,
        content: entry.content,
        tags: [...(entry.tags || [])],
        images: [...(entry.images || [])],
        videos: [...(entry.videos || [])],
        audios: [...(entry.audios || [])],
        files: [...(entry.files || [])],
        likes: entry.likes || 0,
        ...(entry.source ? { source: { ...entry.source, keys: [...entry.source.keys] } } : {}),
    };
}

const newestFirst = (a: TimelineEntry, b: TimelineEntry) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

export function createMomentoApi(plugin: ChildTimelinePlugin): MomentoApi {
    const entries = () => plugin.data.entries.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    return {
        version: 1,
        list: (query = {}) => entries()
            .filter(e => (!query.from || e.date >= query.from) && (!query.to || e.date <= query.to) && (!query.tag || e.tags?.includes(query.tag)))
            .sort(newestFirst)
            .slice(0, Math.max(1, Math.min(query.limit ?? 50, 500)))
            .map(copy),
        onThisDay: (date = new Date()) => {
            const md = `-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const year = String(date.getFullYear());
            return entries().filter(e => e.date.endsWith(md) && e.date.slice(0, 4) < year).sort(newestFirst).map(copy);
        },
        random: () => {
            const all = entries();
            return all.length ? copy(all[Math.floor(Math.random() * all.length)]) : null;
        },
        open: (id) => plugin.openEntry(id),
        resourceUrl: (path) => plugin.resourceUrl(path),
        findBySource: (source, keys) => {
            const wanted = new Set(keys), result: Record<string, string> = {};
            for (const e of plugin.data.entries) {
                if (e.source?.plugin !== source) continue;
                for (const key of e.source.keys) if (wanted.has(key)) result[key] = e.id;
            }
            return result;
        },
        capture: (draft, options) => plugin.captureEntry(draft, options.source),
        wechat: {
            available: () => plugin.wechat.available(),
            candidates: () => plugin.wechat.candidates().map(g => ({
                key: g.key,
                date: g.draft.date,
                receivedAt: g.firstAt,
                summary: g.summary,
                cover: g.cover,
                images: g.draft.images.length,
                videos: g.draft.videos.length,
                audios: g.draft.audios.length,
            })),
            keep: async (key, options = {}) => {
                const kept = plugin.data.entries.find(e => e.source?.plugin === WECHAT_SOURCE && e.source.keys.includes(key));
                if (kept) return kept.id;
                // The message may have arrived after the last snapshot: re-read once before giving up.
                let group = plugin.wechat.findGroup(key);
                if (!group) { await plugin.wechat.refresh(); group = plugin.wechat.findGroup(key); }
                const id = group ? await plugin.wechat.keep([group]) : null;
                if (id && options.notify) plugin.wechat.notifyKept([id], '已存为拾光');
                return id;
            },
            keepAll: async () => (await plugin.wechat.keepEach(plugin.wechat.candidates())).length,
            dismiss: async (key) => {
                const group = plugin.wechat.findGroup(key);
                if (group) await plugin.wechat.dismiss([group]);
            },
        },
    };
}
