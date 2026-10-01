// Pure logic for turning WeChat2Ob messages into Momento candidates.
// No Obsidian imports: unit-tested in Node by scripts/test-wechat.mjs.

/** One message as returned by WeChat2Ob's plugin API (version 1). */
export interface WechatMessage {
    key: string;
    kind: string;
    title: string;
    content: string;
    transcript: string;
    receivedAt: string;
    sessionId?: string;
    senderId?: string;
    notePath?: string;
    attachments: { path: string; kind: string; mimeType: string }[];
}

/** The entry a group would become when kept. */
export interface CandidateDraft {
    date: string;
    createdAt: number;
    content: string;
    images: string[];
    videos: string[];
    audios: string[];
    files: string[];
    audioTranscripts: Record<string, string>;
}

export interface WechatGroup {
    /** Key of the first message; stable while later messages join the group. */
    key: string;
    keys: string[];
    firstAt: number;
    lastAt: number;
    notePath?: string;
    draft: CandidateDraft;
    /** Has a real photo, a video or a voice message (screenshots do not count). */
    memorable: boolean;
    summary: string;
    /** First non-screenshot image, for thumbnails. */
    cover?: string;
}

/** Consecutive messages of one conversation within this gap form one group. */
export const GROUP_WINDOW_MS = 3 * 60 * 1000;
/** Candidates are offered in the timeline and on the homepage for this many days. */
export const REMIND_DAYS = 7;
const DAY = 86400000;

const pad = (n: number) => String(n).padStart(2, '0');
export function localDate(time: number): string {
    const d = new Date(time);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type MediaKind = 'image' | 'video' | 'audio' | 'file';
export function mediaKind(attachment: { kind: string; mimeType: string }): MediaKind {
    const mime = attachment.mimeType.toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (attachment.kind === 'image') return 'image';
    if (attachment.kind === 'video') return 'video';
    if (attachment.kind === 'voice' || attachment.kind === 'audio') return 'audio';
    return 'file';
}

const SCREENSHOT_NAME = /screenshot|screen[_ -]?shot|截屏|截图|屏幕快照/i;
/** Phone screenshots are tall (≈ 19.5:9); camera photos are 4:3, 3:2 or 16:9. */
export function looksLikeScreenshot(path: string, size?: { width: number; height: number } | null): boolean {
    if (SCREENSHOT_NAME.test(path.split('/').pop() || '')) return true;
    if (!size || size.width <= 0 || size.height <= 0) return false;
    const ratio = Math.max(size.width, size.height) / Math.min(size.width, size.height);
    return ratio >= 1.95 && ratio <= 2.4;
}

function toDraft(messages: WechatMessage[]): CandidateDraft {
    const draft: CandidateDraft = {
        date: localDate(Date.parse(messages[0].receivedAt)),
        createdAt: Date.parse(messages[0].receivedAt),
        content: '',
        images: [], videos: [], audios: [], files: [],
        audioTranscripts: {},
    };
    const texts: string[] = [];
    for (const m of messages) {
        let firstAudio: string | undefined;
        for (const a of m.attachments) {
            const kind = mediaKind(a);
            if (kind === 'image') draft.images.push(a.path);
            else if (kind === 'video') draft.videos.push(a.path);
            else if (kind === 'audio') { draft.audios.push(a.path); firstAudio ??= a.path; }
            else draft.files.push(a.path);
        }
        const transcript = m.transcript.trim();
        const content = m.content.trim();
        // A voice transcript belongs to its recording; without one it is the text itself.
        if (transcript && firstAudio) draft.audioTranscripts[firstAudio] = transcript;
        if (content && content !== transcript) texts.push(content);
        else if (!content && transcript && !firstAudio) texts.push(transcript);
        else if (!content && !transcript && !m.attachments.length && m.title.trim()) texts.push(m.title.trim());
    }
    draft.content = texts.join('\n\n');
    return draft;
}

function summarize(draft: CandidateDraft): string {
    const text = draft.content || Object.values(draft.audioTranscripts)[0] || '';
    if (text) return text.replace(/\s+/g, ' ').slice(0, 80);
    const parts: string[] = [];
    if (draft.images.length) parts.push(`${draft.images.length} 张照片`);
    if (draft.videos.length) parts.push(`${draft.videos.length} 段视频`);
    if (draft.audios.length) parts.push(`${draft.audios.length} 段语音`);
    if (draft.files.length) parts.push(`${draft.files.length} 个文件`);
    return parts.join(' · ') || '微信消息';
}

/**
 * Groups messages of one conversation that arrive close together, e.g. a burst of photos
 * followed by a caption. Returns newest groups first.
 */
export function groupMessages(
    messages: WechatMessage[],
    isScreenshot: (path: string) => boolean = () => false,
    windowMs = GROUP_WINDOW_MS,
): WechatGroup[] {
    const sorted = messages
        .filter(m => Number.isFinite(Date.parse(m.receivedAt)))
        .slice()
        .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const runs: WechatMessage[][] = [];
    for (const m of sorted) {
        const run = runs[runs.length - 1];
        const last = run?.[run.length - 1];
        const sameSession = last && (last.sessionId || '') === (m.sessionId || '');
        if (run && sameSession && Date.parse(m.receivedAt) - Date.parse(last.receivedAt) <= windowMs) run.push(m);
        else runs.push([m]);
    }
    return runs.map(run => {
        const draft = toDraft(run);
        const photos = draft.images.filter(path => !isScreenshot(path));
        return {
            key: run[0].key,
            keys: run.map(m => m.key),
            firstAt: Date.parse(run[0].receivedAt),
            lastAt: Date.parse(run[run.length - 1].receivedAt),
            notePath: run.find(m => m.notePath)?.notePath,
            draft,
            memorable: photos.length > 0 || draft.videos.length > 0 || draft.audios.length > 0,
            summary: summarize(draft),
            cover: photos[0],
        };
    }).reverse();
}

/** Groups not yet kept or dismissed; already handled messages never re-form a group. */
export function pendingGroups(
    messages: WechatMessage[],
    handled: (key: string) => boolean,
    isScreenshot?: (path: string) => boolean,
): WechatGroup[] {
    return groupMessages(messages.filter(m => !handled(m.key)), isScreenshot);
}

/** Candidates worth a reminder: memorable and received within the reminder window. */
export function remindable(groups: WechatGroup[], now = Date.now(), days = REMIND_DAYS): WechatGroup[] {
    return groups.filter(g => g.memorable && now - g.lastAt <= days * DAY);
}

/** Combines groups the user selected together into one draft (keeps chronological order). */
export function mergeGroups(groups: WechatGroup[]): WechatGroup {
    const ordered = groups.slice().sort((a, b) => a.firstAt - b.firstAt);
    const draft: CandidateDraft = {
        date: ordered[0].draft.date,
        createdAt: ordered[0].draft.createdAt,
        content: ordered.map(g => g.draft.content).filter(Boolean).join('\n\n'),
        images: ordered.flatMap(g => g.draft.images),
        videos: ordered.flatMap(g => g.draft.videos),
        audios: ordered.flatMap(g => g.draft.audios),
        files: ordered.flatMap(g => g.draft.files),
        audioTranscripts: ordered.reduce<Record<string, string>>((all, g) => ({ ...all, ...g.draft.audioTranscripts }), {}),
    };
    return {
        key: ordered[0].key,
        keys: ordered.flatMap(g => g.keys),
        firstAt: ordered[0].firstAt,
        lastAt: ordered[ordered.length - 1].lastAt,
        notePath: ordered.find(g => g.notePath)?.notePath,
        draft,
        memorable: ordered.some(g => g.memorable),
        summary: summarize(draft),
        cover: ordered.find(g => g.cover)?.cover,
    };
}

/** Width and height from an image header (PNG, JPEG, GIF, WebP); null when unknown. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
    const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
    const u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8);
    const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
    const u32be = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
    const ascii = (i: number, n: number) => String.fromCharCode(...Array.from(bytes.subarray(i, i + n)));
    if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return { width: u32be(16), height: u32be(20) };
    if (bytes.length >= 10 && ascii(0, 3) === 'GIF') return { width: u16le(6), height: u16le(8) };
    if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
        const chunk = ascii(12, 4);
        if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
        if (chunk === 'VP8L') {
            const b = bytes;
            return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
        }
        if (chunk === 'VP8X') return { width: 1 + u24le(24), height: 1 + u24le(27) };
        return null;
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let i = 2;
        while (i + 9 < bytes.length) {
            if (bytes[i] !== 0xff) { i++; continue; }
            const marker = bytes[i + 1];
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
            const length = u16be(i + 2);
            // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                const height = u16be(i + 5), width = u16be(i + 7);
                // EXIF orientations 5–8 rotate the photo, which does not change the ratio test.
                return width && height ? { width, height } : null;
            }
            if (length < 2) return null;
            i += 2 + length;
        }
    }
    return null;
}
