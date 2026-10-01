import type { EntrySource, TimelineEntry } from './settings';

export type EntryDraft = Partial<Pick<TimelineEntry, 'date' | 'createdAt' | 'content' | 'tags' | 'images' | 'videos' | 'audios' | 'files' | 'audioTranscripts'>>;

/** The entry that already kept any of these source items, if one exists. */
export function findSourcedEntry(entries: TimelineEntry[], source: EntrySource): TimelineEntry | undefined {
    return entries.find(e => e.source?.plugin === source.plugin && e.source.keys.some(key => source.keys.includes(key)));
}

/** Builds a new entry for items of another plugin; dates default to the item's local day. */
export function newSourcedEntry(draft: EntryDraft, source: EntrySource, now = Date.now()): TimelineEntry {
    const keys = source.keys.filter(key => typeof key === 'string' && key);
    if (!source.plugin || !keys.length) throw new Error('来源无效');
    const createdAt = typeof draft.createdAt === 'number' && Number.isFinite(draft.createdAt) ? draft.createdAt : now;
    const d = new Date(createdAt);
    const fallbackDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
        id: `${now}-${Math.random().toString(36).substring(2, 9)}`,
        date: draft.date && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : fallbackDate,
        childName: '',
        content: draft.content || '',
        images: [...(draft.images || [])],
        videos: [...(draft.videos || [])],
        audios: [...(draft.audios || [])],
        files: [...(draft.files || [])],
        audioTranscripts: { ...(draft.audioTranscripts || {}) },
        likes: 0,
        comments: [],
        createdAt,
        ...(draft.tags?.length ? { tags: [...draft.tags] } : {}),
        source: { plugin: source.plugin, keys, ...(source.notePath ? { notePath: source.notePath } : {}) },
    };
}
