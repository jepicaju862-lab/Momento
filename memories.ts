// Pure helpers for showing memories on the homepage. No Obsidian imports (unit-tested in Node).
import type { TimelineEntry } from './settings';

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');

function parseDate(date: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Whole years between an entry's date and today ("今年" for the current year). */
export function yearsAgoLabel(date: string, today = new Date()): string {
    const years = today.getFullYear() - Number(date.slice(0, 4));
    return years > 0 ? `${years} 年前` : '今年';
}

/** "2023年10月1日 · 周日" */
export function longDate(date: string): string {
    const d = parseDate(date);
    if (!d) return date;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`;
}

/**
 * Entries from earlier years on this month and day; when there are none, entries within
 * `windowDays` of it ("往年这几天"), so the card is rarely empty. Newest year first.
 */
export function memoriesAround(entries: TimelineEntry[], today = new Date(), windowDays = 3): { exact: boolean; entries: TimelineEntry[] } {
    const md = `-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const earlier = entries.filter(e => parseDate(e.date) && Number(e.date.slice(0, 4)) < today.getFullYear());
    const byRecent = (a: TimelineEntry, b: TimelineEntry) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
    const exact = earlier.filter(e => e.date.endsWith(md)).sort(byRecent);
    if (exact.length || windowDays <= 0) return { exact: true, entries: exact };
    const near = earlier.filter(e => {
        const d = parseDate(e.date)!;
        // Around New Year, "last December" is days ago, not a memory from an earlier year.
        if (today.getTime() - d.getTime() < 300 * DAY) return false;
        // Compare within the entry's own year so leap years and year ends behave.
        const anchor = new Date(d.getFullYear(), today.getMonth(), today.getDate());
        const diff = Math.abs(Math.round((d.getTime() - anchor.getTime()) / DAY));
        return Math.min(diff, 366 - diff) <= windowDays;
    }).sort(byRecent);
    return { exact: false, entries: near };
}

/** "3 张照片 · 1 段语音" */
export function mediaSummary(media: { images?: string[]; videos?: string[]; audios?: string[]; files?: string[] }): string {
    const parts: string[] = [];
    if (media.images?.length) parts.push(`${media.images.length} 张照片`);
    if (media.videos?.length) parts.push(`${media.videos.length} 段视频`);
    if (media.audios?.length) parts.push(`${media.audios.length} 段语音`);
    if (media.files?.length) parts.push(`${media.files.length} 个文件`);
    return parts.join(' · ');
}

/** Plain one-line text of an entry for cards (markdown marks removed). */
export function plainText(entry: Pick<TimelineEntry, 'content' | 'audioTranscripts'>, max = 140): string {
    const text = entry.content || Object.values(entry.audioTranscripts || {})[0] || '';
    return text
        .replace(/!?\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#>*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

/** A random entry, avoiding `exclude` when another one exists. */
export function pickRandom<T extends { id: string }>(items: T[], exclude?: string, random = Math.random): T | undefined {
    const choices = items.length > 1 ? items.filter(item => item.id !== exclude) : items;
    return choices[Math.floor(random() * choices.length)];
}
