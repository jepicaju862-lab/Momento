import { Setting, setIcon, type App, type EventRef } from 'obsidian';
import type ChildTimelinePlugin from './main';
import type { TimelineEntry } from './settings';
import { MOMENTO_CHANGED } from './momento-api';
import type { WechatGroup } from './wechat-candidates';
import { dayLabel, longDate, mediaSummary, memoriesAround, pickRandom, plainText, recentEntries, yearsAgoLabel } from './memories';
import { WECHAT_SOURCE } from './wechat-bridge';

/** The parts of Home Pages' host API (version 1) that Momento uses. */
interface HomeApi {
    version: 1;
    registerWidget(definition: HomeWidget<Record<string, unknown>>, provider?: string): () => void;
    refresh(kind?: string): void;
    pinWidget?(kind: string, config?: Record<string, unknown>, options?: { title?: string; w?: number; h?: number; provider?: string; open?: boolean }): Promise<void>;
    ui: { renderEmpty(el: HTMLElement, options: { icon?: string; text: string; action?: { label: string; onClick: () => void } }): void };
}
interface HomeContext<C> {
    app: App;
    /** Home Pages itself; used to see what else is on the current page. */
    plugin?: { getActivePage?(): { widgets: Array<{ kind: string; config?: Record<string, unknown> }> } };
    widget: { id: string };
    config: C;
    setSubtitle(text: string): void;
    addHeaderAction(icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLElement;
    rerender(): void;
    isAlive(): boolean;
    registerInterval(callback: () => void, ms: number): void;
    registerCleanup(callback: () => void): void;
    /** Newer Home Pages: hide the card until it has something to show (always visible while editing). */
    setHidden?(hidden: boolean): void;
}
interface HomeSettingsContext<C> { config: C; update(patch: Partial<C>): void }
interface HomeWidget<C> {
    kind: string; name: string; description: string; icon: string; accent: string;
    defaultSize: { w: number; h: number };
    defaultConfig(): C;
    normalizeConfig?(raw: Record<string, unknown>): C;
    render(body: HTMLElement, ctx: HomeContext<C>): void | Promise<void>;
    renderSettings(container: HTMLElement, ctx: HomeSettingsContext<C>): void;
    liveRefresh?: boolean;
}

/** Widgets that show entries or candidates and redraw when Momento changes. */
const DATA_KINDS = ['momento-capture', 'momento-today', 'momento-onthisday', 'momento-random'];
const LEAVE_MS = 200;
const UNDO_MS = 8000;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, reducedMotion() ? 0 : ms));

function isHomeApi(value: unknown): value is HomeApi {
    const api = value as Partial<HomeApi> | null;
    return !!api && api.version === 1 && typeof api.registerWidget === 'function' && typeof api.refresh === 'function';
}

function button(parent: HTMLElement, options: { icon: string; label: string; text?: string; cls?: string }): HTMLButtonElement {
    const el = parent.createEl('button', { cls: `momento-hp-btn ${options.cls ?? ''}`.trim(), attr: { type: 'button', 'aria-label': options.label, title: options.label } });
    setIcon(el.createSpan('momento-hp-btn-icon'), options.icon);
    if (options.text) el.createSpan({ text: options.text });
    return el;
}

// ---- Inline undo: survives the redraws that the change itself triggers ----

interface UndoState { text: string; until: number; undo: () => Promise<void>; view?: () => void }
const undoByWidget = new Map<string, UndoState>();

function showUndo(widgetId: string, state: Omit<UndoState, 'until'>): void {
    undoByWidget.set(widgetId, { ...state, until: Date.now() + UNDO_MS });
}

/** Renders the “已收下 · 查看 · 撤销” bar while it is fresh; returns whether it is showing. */
function renderUndo(parent: HTMLElement, ctx: HomeContext<unknown>): boolean {
    const state = undoByWidget.get(ctx.widget.id);
    if (!state || state.until <= Date.now()) { undoByWidget.delete(ctx.widget.id); return false; }
    const bar = parent.createDiv('momento-hp-undo');
    setIcon(bar.createSpan('momento-hp-undo-icon'), 'check-circle-2');
    bar.createSpan({ cls: 'momento-hp-undo-text', text: state.text });
    if (state.view) {
        const view = bar.createEl('button', { cls: 'momento-hp-link', text: '查看', attr: { type: 'button' } });
        view.onclick = () => state.view?.();
    }
    const undo = bar.createEl('button', { cls: 'momento-hp-link', text: '撤销', attr: { type: 'button' } });
    undo.onclick = async () => {
        undo.disabled = true;
        undoByWidget.delete(ctx.widget.id);
        await state.undo();
        if (ctx.isAlive()) ctx.rerender();
    };
    const timer = window.setTimeout(() => { if (ctx.isAlive()) ctx.rerender(); }, state.until - Date.now() + 20);
    ctx.registerCleanup(() => window.clearTimeout(timer));
    return true;
}

// ---- Memory card ----

/** Large memory card: photo with a soft caption overlay, or a quote card when there is no photo. */
function renderMemoryCard(plugin: ChildTimelinePlugin, parent: HTMLElement, entry: TimelineEntry, eyebrow: string): HTMLElement {
    const card = parent.createDiv('momento-hp-memory-card');
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `打开这条拾光：${eyebrow}`);
    const photo = entry.images?.[0];
    const url = photo ? plugin.resourceUrl(photo) : '';
    const text = plainText(entry);
    if (url) {
        card.addClass('has-photo');
        card.createEl('img', { cls: 'momento-hp-memory-photo', attr: { src: url, alt: '', draggable: 'false' } });
        if ((entry.images?.length || 0) > 1) card.createDiv({ cls: 'momento-hp-memory-count', text: `${entry.images.length} 张` });
    } else {
        card.addClass('is-quote');
        card.createDiv({ cls: 'momento-hp-quote-mark', text: '“' });
    }
    const caption = card.createDiv('momento-hp-memory-caption');
    caption.createDiv({ cls: 'momento-hp-eyebrow', text: eyebrow });
    caption.createDiv({ cls: 'momento-hp-memory-date', text: longDate(entry.date) });
    if (text) caption.createDiv({ cls: 'momento-hp-memory-text', text });
    else if (!url) caption.createDiv({ cls: 'momento-hp-memory-text', text: mediaSummary(entry) || '一条记录' });

    const actions = card.createDiv('momento-hp-memory-actions');
    const like = button(actions, { icon: 'heart', label: '喜欢', text: entry.likes ? String(entry.likes) : '', cls: entry.likes ? 'is-liked' : '' });
    like.onclick = (event) => { event.stopPropagation(); like.addClass('is-pop'); void plugin.toggleLike(entry.id); };
    const open = button(actions, { icon: 'arrow-up-right', label: '在拾光中打开' });
    open.onclick = (event) => { event.stopPropagation(); void plugin.openEntry(entry.id); };
    card.onclick = () => void plugin.openEntry(entry.id);
    card.onkeydown = (event) => { if (event.key === 'Enter' && event.target === card) void plugin.openEntry(entry.id); };
    return card;
}

// ---- Timeline (shared by 「拾光」 and 「今日拾光」), styled like Momento's own timeline ----

/** Captions typed before keeping, by group key; kept across redraws. */
const captions = new Map<string, string>();
/** Entries just saved or kept from the homepage → until when they offer “撤销”. */
const fresh = new Map<string, number>();
/** Widgets whose composer has focus: redraws wait so typing is never interrupted. */
const composing = new Set<string>();
let deferredRedraw: (() => void) | null = null;

type TimelineItem =
    | { kind: 'entry'; entry: TimelineEntry; date: string; time: number }
    | { kind: 'candidate'; group: WechatGroup; date: string; time: number };

function hm(time: number): string {
    const d = new Date(time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Small thumbnails (+N), a play tile for video, and a voice pill with its transcript. */
function renderMedia(plugin: ChildTimelinePlugin, parent: HTMLElement, media: { images: string[]; videos: string[]; audios: string[] }, transcript?: string): void {
    if (media.images.length || media.videos.length) {
        const row = parent.createDiv('momento-hp-tl-media');
        const shown = media.images.slice(0, 4);
        // Narrow cards split the full width between the tiles (one photo becomes a wide banner).
        row.addClass(`is-n${Math.min(4, shown.length + (media.videos.length ? 1 : 0))}`);
        shown.forEach((path, i) => {
            const cell = row.createDiv('momento-hp-tl-thumb');
            const url = plugin.resourceUrl(path);
            if (url) cell.createEl('img', { attr: { src: url, alt: '', loading: 'lazy', draggable: 'false' } });
            const extra = media.images.length - shown.length;
            if (i === shown.length - 1 && extra > 0) cell.createDiv({ cls: 'momento-hp-tl-more', text: `+${extra}` });
        });
        if (media.videos.length) {
            const video = row.createDiv('momento-hp-tl-thumb is-video');
            setIcon(video, 'play');
            if (media.videos.length > 1) video.createDiv({ cls: 'momento-hp-tl-more', text: `${media.videos.length}` });
        }
    }
    if (media.audios.length) {
        const pill = parent.createDiv('momento-hp-tl-voice');
        setIcon(pill.createSpan('momento-hp-tl-voice-icon'), 'mic');
        pill.createSpan({ cls: 'momento-hp-tl-voice-text', text: transcript || (media.audios.length > 1 ? `${media.audios.length} 段语音` : '语音') });
    }
}

interface TimelineHandlers {
    keep(group: WechatGroup): Promise<void>;
    dismiss(group: WechatGroup): Promise<void>;
    undoFresh(entry: TimelineEntry): Promise<void>;
    editCaption(holder: HTMLElement, group: WechatGroup): void;
}

function renderTimeline(plugin: ChildTimelinePlugin, parent: HTMLElement, items: TimelineItem[], ctx: HomeContext<unknown>, on: TimelineHandlers): void {
    const tl = parent.createDiv({ cls: 'momento-hp-tl', attr: { role: 'list' } });
    const now = Date.now();
    let nextExpiry = Infinity;
    let lastDate = '';
    for (const item of items) {
        if (item.date !== lastDate) {
            lastDate = item.date;
            tl.createDiv({ cls: 'momento-hp-tl-day', text: dayLabel(item.date) });
        }
        const row = tl.createDiv({ cls: 'momento-hp-tl-item', attr: { role: 'listitem', tabindex: '0' } });
        row.createDiv('momento-hp-tl-rail');
        const body = row.createDiv('momento-hp-tl-body');
        const head = body.createDiv('momento-hp-tl-head');
        head.createSpan({ cls: 'momento-hp-tl-time', text: hm(item.time) });

        if (item.kind === 'entry') {
            const { entry } = item;
            const until = fresh.get(entry.id) ?? 0;
            if (until > now) { row.addClass('is-fresh'); nextExpiry = Math.min(nextExpiry, until); } else fresh.delete(entry.id);
            const fromWechat = entry.source?.plugin === WECHAT_SOURCE;
            if (fromWechat) head.createSpan({ cls: 'momento-hp-tl-source', text: '微信' });
            const actions = head.createDiv('momento-hp-tl-actions');
            const text = plainText(entry, 200);
            if (text) body.createDiv({ cls: 'momento-hp-tl-text', text });
            renderMedia(plugin, body, { images: entry.images || [], videos: entry.videos || [], audios: entry.audios || [] }, text ? undefined : Object.values(entry.audioTranscripts || {})[0]);
            // The 微信 source chip already says where it came from; skip the matching tag.
            const tags = (entry.tags || []).filter(t => !(fromWechat && t === '微信')).slice(0, 3);
            if (tags.length || entry.likes) {
                const foot = body.createDiv('momento-hp-tl-foot');
                for (const tag of tags) foot.createSpan({ cls: 'momento-hp-tl-tag', text: `#${tag}` });
                if (entry.likes) foot.createSpan({ cls: 'momento-hp-tl-likes', text: `♥ ${entry.likes}` });
            }
            if (row.hasClass('is-fresh')) {
                const undo = actions.createEl('button', { cls: 'momento-hp-tl-act is-undo', text: '撤销', attr: { type: 'button' } });
                undo.onclick = (event) => { event.stopPropagation(); undo.disabled = true; void on.undoFresh(entry); };
            }
            const like = actions.createEl('button', { cls: `momento-hp-tl-act is-like${entry.likes ? ' is-liked' : ''}`, attr: { type: 'button', 'aria-label': '喜欢', title: '喜欢' } });
            setIcon(like.createSpan(), 'heart');
            like.onclick = (event) => { event.stopPropagation(); like.addClass('is-pop'); void plugin.toggleLike(entry.id); };
            row.setAttribute('aria-label', `${dayLabel(entry.date)} ${hm(item.time)} ${text || mediaSummary(entry)}`);
            row.onclick = () => void plugin.openEntry(entry.id);
            row.onkeydown = (event) => { if (event.target === row && event.key === 'Enter') void plugin.openEntry(entry.id); };
        } else {
            const { group } = item;
            row.addClass('is-candidate');
            head.createSpan({ cls: 'momento-hp-tl-source is-pending', text: '微信 · 待收' });
            const actions = head.createDiv('momento-hp-tl-actions');
            const holder = body.createDiv({ cls: 'momento-hp-tl-caption', attr: { title: '点击写一句话，收下时一起保存' } });
            const caption = captions.get(group.key) ?? group.draft.content;
            const transcript = Object.values(group.draft.audioTranscripts)[0];
            // An empty caption only offers “添加一句话…” on hover / focus, so pending items stay quiet.
            if (!caption) holder.addClass('is-empty');
            holder.createDiv({ cls: `momento-hp-tl-text${caption ? '' : ' is-placeholder'}`, text: caption || '添加一句话…' });
            if (captions.has(group.key)) holder.createSpan({ cls: 'momento-hp-edited', text: '已编辑' });
            holder.onclick = (event) => { event.stopPropagation(); on.editCaption(holder, group); };
            renderMedia(plugin, body, group.draft, transcript);
            if (!caption) {
                const write = actions.createEl('button', { cls: 'momento-hp-tl-act', text: '写一句', attr: { type: 'button', title: '写一句话，收下时一起保存' } });
                write.onclick = (event) => { event.stopPropagation(); on.editCaption(holder, group); };
            }
            const skip = actions.createEl('button', { cls: 'momento-hp-tl-act', text: '忽略', attr: { type: 'button', title: '忽略' } });
            const keep = actions.createEl('button', { cls: 'momento-hp-tl-act is-keep', text: '收下', attr: { type: 'button', title: '收下' } });
            const leave = async (action: () => Promise<void>) => {
                keep.disabled = skip.disabled = true;
                row.addClass('is-leaving');
                await wait(LEAVE_MS);
                await action();
            };
            keep.onclick = (event) => { event.stopPropagation(); void leave(() => on.keep(group)); };
            skip.onclick = (event) => { event.stopPropagation(); void leave(() => on.dismiss(group)); };
            row.setAttribute('aria-label', `微信待收：${group.summary}。Enter 收下，Delete 忽略`);
            row.onclick = () => void plugin.openDate(group.draft.date);
            row.onkeydown = (event) => {
                if (event.target !== row) return;
                if (event.key === 'Enter') { event.preventDefault(); keep.click(); }
                if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); skip.click(); }
            };
        }
        row.addEventListener('keydown', (event) => {
            if (event.target !== row) return;
            const rows = Array.from(tl.querySelectorAll<HTMLElement>('.momento-hp-tl-item'));
            const i = rows.indexOf(row);
            if (event.key === 'ArrowDown') { event.preventDefault(); rows[i + 1]?.focus(); }
            if (event.key === 'ArrowUp') { event.preventDefault(); rows[i - 1]?.focus(); }
        });
    }
    if (nextExpiry < Infinity) {
        const timer = window.setTimeout(() => { if (ctx.isAlive()) ctx.rerender(); }, nextExpiry - now + 20);
        ctx.registerCleanup(() => window.clearTimeout(timer));
    }
}

/** Keep / ignore / caption / undo, shared by both timeline widgets. */
function timelineHandlers(plugin: ChildTimelinePlugin, home: HomeApi, ctx: HomeContext<unknown>, kind: string): TimelineHandlers {
    const redraw = () => home.refresh(kind);
    return {
        async keep(group) {
            const id = await plugin.wechat.keep([group], captions.get(group.key));
            captions.delete(group.key);
            if (!id) return;
            fresh.set(id, Date.now() + UNDO_MS);
            // 今日拾光 only lists candidates, so the kept one leaves; offer undo in the card instead.
            if (kind === 'momento-today') showUndo(ctx.widget.id, { text: '已存为拾光', view: () => void plugin.openEntry(id), undo: () => plugin.wechat.unkeep([id]) });
            redraw();
        },
        async dismiss(group) {
            await plugin.wechat.dismiss([group]);
            showUndo(ctx.widget.id, { text: '已忽略这一组', undo: () => plugin.wechat.restore(group.keys) });
            redraw();
        },
        async undoFresh(entry) {
            fresh.delete(entry.id);
            if (entry.source?.plugin === WECHAT_SOURCE) await plugin.wechat.unkeep([entry.id]);
            else await plugin.deleteEntry(entry.id);
            redraw();
        },
        editCaption(holder, group) {
            holder.empty();
            holder.addClass('is-editing');
            const input = holder.createEl('textarea', { cls: 'momento-hp-caption-input', attr: { rows: '2', placeholder: '写一句话，收下时一起保存' } });
            input.value = captions.get(group.key) ?? group.draft.content;
            let finished = false;
            const done = (save: boolean) => {
                if (finished) return;
                finished = true;
                if (save) {
                    const value = input.value.trim();
                    if (value === group.draft.content.trim()) captions.delete(group.key); else captions.set(group.key, value);
                }
                redraw();
            };
            input.onkeydown = (event) => {
                event.stopPropagation();
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); done(true); }
                if (event.key === 'Escape') { event.preventDefault(); done(false); }
            };
            input.onblur = () => done(true);
            input.onclick = (event) => event.stopPropagation();
            // Focus right away: keys typed meanwhile must not reach the row (Enter there means “keep”).
            input.focus();
            input.select();
        },
    };
}

// ---- 拾光: composer + recent timeline (entries and WeChat candidates together) ----

interface CaptureFile { name: string; type: string; buffer: ArrayBuffer; url: string }
interface CaptureDraft { text: string; tags: Set<string>; files: CaptureFile[] }
/** Drafts by widget id, so typing survives redraws and page switches. */
const drafts = new Map<string, CaptureDraft>();
interface StreamConfig extends Record<string, unknown> { days: number; showWechat: boolean }

function streamWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<StreamConfig> {
    const draftFor = (id: string) => {
        let draft = drafts.get(id);
        if (!draft) { draft = { text: '', tags: new Set(), files: [] }; drafts.set(id, draft); }
        return draft;
    };
    const addFiles = async (draft: CaptureDraft, files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            if (!file.size || !/^(image|video|audio)\//.test(file.type)) continue;
            draft.files.push({ name: file.name || `capture_${Date.now()}.${file.type.split('/')[1] || 'bin'}`, type: file.type, buffer: await file.arrayBuffer(), url: URL.createObjectURL(file) });
        }
    };
    const save = async (ctx: HomeContext<StreamConfig>, draft: CaptureDraft) => {
        const media = { images: [] as string[], videos: [] as string[], audios: [] as string[], files: [] as string[] };
        for (const file of draft.files) {
            const path = await plugin.saveMediaBinary(file.name, file.buffer);
            (file.type.startsWith('image/') ? media.images : file.type.startsWith('video/') ? media.videos : media.audios).push(path);
        }
        const now = new Date();
        const entry: TimelineEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
            childName: '',
            content: draft.text.trim(),
            ...media,
            audioTranscripts: {},
            likes: 0,
            comments: [],
            createdAt: now.getTime(),
            ...(draft.tags.size ? { tags: Array.from(draft.tags) } : {}),
        };
        draft.files.forEach(f => URL.revokeObjectURL(f.url));
        drafts.delete(ctx.widget.id);
        composing.delete(ctx.widget.id);
        fresh.set(entry.id, Date.now() + UNDO_MS);
        await plugin.addEntry(entry);
        deferredRedraw = null;
        home.refresh('momento-capture');
    };

    const renderComposer = (wrap: HTMLElement, ctx: HomeContext<StreamConfig>) => {
        const draft = draftFor(ctx.widget.id);
        const box = wrap.createDiv('momento-hp-composer');
        const open = () => box.addClass('is-open');
        if (draft.text || draft.files.length || draft.tags.size) open();
        const line = box.createDiv('momento-hp-composer-line');
        setIcon(line.createSpan('momento-hp-composer-icon'), 'pen-line');
        const input = line.createEl('textarea', { cls: 'momento-hp-composer-input', attr: { rows: '1', placeholder: '记下此刻…', 'aria-label': '记下此刻' } });
        input.value = draft.text;
        const send = line.createEl('button', { cls: 'momento-hp-composer-send', attr: { type: 'button', 'aria-label': '记下（Ctrl/⌘ + Enter）', title: '记下（Ctrl/⌘ + Enter）' } });
        setIcon(send, 'arrow-up');
        const extra = box.createDiv('momento-hp-composer-extra');
        const files = extra.createDiv('momento-hp-capture-files');
        const tags = extra.createDiv('momento-hp-capture-tags');
        const grow = () => { input.setCssStyles({ height: 'auto' }); input.setCssStyles({ height: `${Math.min(input.scrollHeight, 140)}px` }); };
        const canSend = () => !!draft.text.trim() || draft.files.length > 0;
        const refreshFiles = () => {
            send.toggleClass('is-ready', canSend());
            files.empty();
            draft.files.forEach((file, i) => {
                const thumb = files.createDiv('momento-hp-capture-thumb');
                if (file.type.startsWith('image/')) thumb.createEl('img', { attr: { src: file.url, alt: '' } });
                else setIcon(thumb, file.type.startsWith('video/') ? 'video' : 'mic');
                const remove = thumb.createEl('button', { cls: 'momento-hp-capture-remove', attr: { type: 'button', 'aria-label': '移除' } });
                setIcon(remove, 'x');
                remove.onmousedown = (event) => event.preventDefault();
                remove.onclick = () => { URL.revokeObjectURL(file.url); draft.files.splice(i, 1); refreshFiles(); };
            });
            const add = files.createEl('label', { cls: 'momento-hp-capture-add', attr: { title: '添加照片、视频或录音（也可以直接粘贴或拖进来）', 'aria-label': '添加照片、视频或录音' } });
            setIcon(add.createSpan(), 'image-plus');
            const picker = add.createEl('input', { attr: { type: 'file', accept: 'image/*,video/*,audio/*', multiple: 'true' } });
            picker.onchange = async () => { if (picker.files) { await addFiles(draft, picker.files); open(); refreshFiles(); } };
        };
        for (const tag of (plugin.data.settings.customTags || []).slice(0, 8)) {
            const chip = tags.createEl('button', { cls: `momento-hp-tag${draft.tags.has(tag) ? ' is-on' : ''}`, text: tag, attr: { type: 'button', 'aria-pressed': String(draft.tags.has(tag)) } });
            chip.onmousedown = (event) => event.preventDefault();
            chip.onclick = () => {
                if (draft.tags.has(tag)) draft.tags.delete(tag); else draft.tags.add(tag);
                chip.toggleClass('is-on', draft.tags.has(tag));
                chip.setAttribute('aria-pressed', String(draft.tags.has(tag)));
            };
        }
        extra.createDiv({ cls: 'momento-hp-composer-hint', text: 'Ctrl/⌘ + Enter 记下' });

        const submit = async () => {
            if (!canSend() || send.disabled) return;
            send.disabled = true;
            try { await save(ctx, draft); }
            catch (err) { send.disabled = false; console.error('Momento: quick capture failed', err); box.addClass('has-error'); }
        };
        input.onfocus = () => { composing.add(ctx.widget.id); open(); };
        input.onblur = () => {
            composing.delete(ctx.widget.id);
            if (!canSend() && !draft.tags.size) box.removeClass('is-open');
            // Blur also fires while Home Pages swaps this card's body; never redraw inside that swap.
            window.setTimeout(() => {
                if (composing.size || !deferredRedraw) return;
                const run = deferredRedraw;
                deferredRedraw = null;
                run();
            }, 0);
        };
        input.oninput = () => { draft.text = input.value; grow(); send.toggleClass('is-ready', canSend()); box.removeClass('has-error'); };
        input.onkeydown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); }
            if (event.key === 'Escape') input.blur();
        };
        input.onpaste = async (event) => {
            const pasted = Array.from(event.clipboardData?.files ?? []);
            if (!pasted.length) return;
            event.preventDefault();
            await addFiles(draft, pasted);
            refreshFiles();
        };
        box.ondragover = (event) => { event.preventDefault(); box.addClass('is-dragover'); open(); };
        box.ondragleave = () => box.removeClass('is-dragover');
        box.ondrop = async (event) => {
            event.preventDefault();
            box.removeClass('is-dragover');
            if (event.dataTransfer?.files.length) { await addFiles(draft, event.dataTransfer.files); refreshFiles(); }
        };
        send.onmousedown = (event) => event.preventDefault();
        send.onclick = () => void submit();
        refreshFiles();
        window.requestAnimationFrame(grow);
    };

    return {
        kind: 'momento-capture',
        name: '拾光',
        description: '最近几天的拾光时间线，顶部随手记一笔（可粘贴或拖入照片、选标签）；微信里待收的照片和语音也按时间排在其中。',
        icon: 'sparkles',
        accent: '#14b8a6',
        defaultSize: { w: 6, h: 9 },
        defaultConfig: () => ({ days: 7, showWechat: true }),
        normalizeConfig: (raw) => ({
            days: [1, 3, 7, 14, 30].includes(Number(raw.days)) ? Number(raw.days) : 7,
            showWechat: raw.showWechat !== false,
        }),
        liveRefresh: false,
        render(body, ctx) {
            const wrap = body.createDiv('momento-hp momento-hp-stream');
            renderUndo(wrap, ctx);
            renderComposer(wrap, ctx);
            const entries = recentEntries(plugin.data.entries, ctx.config.days);
            const candidates = ctx.config.showWechat ? plugin.wechat.candidates() : [];
            const items: TimelineItem[] = [
                ...entries.map(entry => ({ kind: 'entry' as const, entry, date: entry.date, time: entry.createdAt })),
                ...candidates.map(group => ({ kind: 'candidate' as const, group, date: group.draft.date, time: group.firstAt })),
            ].sort((a, b) => b.date.localeCompare(a.date) || b.time - a.time);
            const todayCount = entries.filter(e => dayLabel(e.date) === '今天').length;
            ctx.setSubtitle([todayCount ? `今天 ${todayCount} 条` : '', candidates.length ? `${candidates.length} 组待收` : ''].filter(Boolean).join(' · '));
            ctx.addHeaderAction('arrow-up-right', '打开拾光', () => void plugin.activateView());
            if (!items.length) {
                wrap.createDiv({ cls: 'momento-hp-tl-empty', text: `最近 ${ctx.config.days} 天还没有记录，在上面写下第一条吧。` });
                return;
            }
            renderTimeline(plugin, wrap, items, ctx, timelineHandlers(plugin, home, ctx, 'momento-capture'));
        },
        renderSettings(container, ctx) {
            new Setting(container).setName('显示最近几天').addDropdown(dropdown => dropdown
                .addOptions({ '1': '今天', '3': '3 天', '7': '7 天', '14': '14 天', '30': '30 天' })
                .setValue(String(ctx.config.days))
                .onChange(value => ctx.update({ days: Number(value) })));
            new Setting(container).setName('在时间线里显示微信待收内容').addToggle(toggle => toggle
                .setValue(ctx.config.showWechat).onChange(value => ctx.update({ showWechat: value })));
            container.createDiv({ cls: 'setting-item-description', text: '标签取自拾光设置里的「场景标签列表」前 8 个；照片保存到拾光的媒体文件夹。' });
        },
    };
}

// ---- 今日拾光: only WeChat candidates, shown only while some wait ----

interface TodayConfig extends Record<string, unknown> { limit: number }

function todayWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<TodayConfig> {
    return {
        kind: 'momento-today',
        name: '今日拾光',
        description: '只看微信里待收的照片、视频和语音（按会话自动分组），时间线排列；可先写一句话再收下。没有待收内容时自动隐藏。',
        icon: 'inbox',
        accent: '#14b8a6',
        defaultSize: { w: 6, h: 6 },
        defaultConfig: () => ({ limit: 8 }),
        normalizeConfig: (raw) => ({ limit: Math.min(30, Math.max(1, Math.round(Number(raw.limit) || 8))) }),
        liveRefresh: false,
        render(body, ctx) {
            const wrap = body.createDiv('momento-hp momento-hp-today');
            // 「拾光」 on this page already lists WeChat candidates: stay out of the way instead of repeating them.
            const twin = ctx.plugin?.getActivePage?.().widgets.some(w => w.kind === 'momento-capture' && w.config?.showWechat !== false);
            if (twin) {
                ctx.setHidden?.(true);
                wrap.createDiv({ cls: 'momento-hp-tl-empty', text: '这一页的「拾光」已经在显示微信待收内容，这张卡片会保持隐藏，可以在编辑布局时删除。' });
                return;
            }
            const groups = plugin.wechat.candidates();
            const undoing = renderUndo(wrap, ctx);
            ctx.setHidden?.(groups.length === 0 && !undoing);
            if (!groups.length) {
                if (undoing) wrap.createDiv({ cls: 'momento-hp-done', text: '都处理完了 ✨' });
                else home.ui.renderEmpty(wrap, {
                    icon: 'sparkles',
                    text: plugin.wechat.available()
                        ? '暂无待收的微信回忆。收到新的照片、视频或语音时，这张卡片会自动出现。'
                        : '启用带插件 API 的 WeChat2Ob 后，微信里的照片、视频和语音会出现在这里。',
                });
                return;
            }
            ctx.setSubtitle(`${groups.length} 组待收`);
            if (groups.length > 1) {
                const keepAll = async () => {
                    const ids = await plugin.wechat.keepEach(groups, g => captions.get(g.key));
                    groups.forEach(g => captions.delete(g.key));
                    if (ids.length) showUndo(ctx.widget.id, { text: `已收下 ${ids.length} 组`, view: () => void plugin.openEntry(ids[0]), undo: () => plugin.wechat.unkeep(ids) });
                    home.refresh('momento-today');
                };
                ctx.addHeaderAction('check-check', `全部收下（${groups.length} 组）`, () => void keepAll());
            }
            const items: TimelineItem[] = groups.slice(0, ctx.config.limit)
                .map(group => ({ kind: 'candidate' as const, group, date: group.draft.date, time: group.firstAt }));
            renderTimeline(plugin, wrap, items, ctx, timelineHandlers(plugin, home, ctx, 'momento-today'));
            if (groups.length > ctx.config.limit) {
                const more = wrap.createEl('button', { cls: 'momento-hp-more', text: `还有 ${groups.length - ctx.config.limit} 组，在拾光里查看`, attr: { type: 'button' } });
                more.onclick = () => void plugin.activateView();
            }
        },
        renderSettings(container, ctx) {
            new Setting(container).setName('最多显示组数').addSlider(slider => slider
                .setLimits(1, 30, 1).setValue(ctx.config.limit).setDynamicTooltip()
                .onChange(value => ctx.update({ limit: value })));
        },
    };
}

// ---- 那年今日 ----

interface OnThisDayConfig extends Record<string, unknown> { nearbyDays: number }
const heroIndex = new Map<string, number>();

function onThisDayWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<OnThisDayConfig> {
    return {
        kind: 'momento-onthisday',
        name: '那年今日',
        description: '往年的今天记下了什么；没有时看看往年这几天。可左右翻看、点赞或打开。',
        icon: 'history',
        accent: '#f59e0b',
        defaultSize: { w: 6, h: 7 },
        defaultConfig: () => ({ nearbyDays: 3 }),
        normalizeConfig: (raw) => ({ nearbyDays: Math.min(7, Math.max(0, Math.round(Number(raw.nearbyDays ?? 3)))) }),
        liveRefresh: false,
        render(body, ctx) {
            const { exact, entries } = memoriesAround(plugin.data.entries, new Date(), ctx.config.nearbyDays);
            const wrap = body.createDiv('momento-hp momento-hp-onthisday');
            if (!entries.length) {
                home.ui.renderEmpty(wrap, {
                    icon: 'history',
                    text: '往年的今天还没有记录。今天记下的，明年这时会出现在这里。',
                    action: { label: '随机回看一条', onClick: () => { const e = pickRandom(plugin.data.entries); if (e) void plugin.openEntry(e.id); } },
                });
                return;
            }
            const index = Math.min(heroIndex.get(ctx.widget.id) ?? 0, entries.length - 1);
            const show = (next: number) => { heroIndex.set(ctx.widget.id, (next + entries.length) % entries.length); ctx.rerender(); };
            const hero = entries[index];
            ctx.setSubtitle(exact ? `${entries.length} 条` : '往年这几天');
            const stage = wrap.createDiv('momento-hp-stage');
            const card = renderMemoryCard(plugin, stage, hero, exact ? `${yearsAgoLabel(hero.date)}的今天` : yearsAgoLabel(hero.date));
            card.addClass('momento-hp-fade');
            if (entries.length > 1) {
                const prev = button(stage, { icon: 'chevron-left', label: '上一条（←）', cls: 'momento-hp-nav is-prev' });
                const next = button(stage, { icon: 'chevron-right', label: '下一条（→）', cls: 'momento-hp-nav is-next' });
                prev.onclick = (event) => { event.stopPropagation(); show(index - 1); };
                next.onclick = (event) => { event.stopPropagation(); show(index + 1); };
                card.addEventListener('keydown', (event) => {
                    if (event.key === 'ArrowLeft') show(index - 1);
                    if (event.key === 'ArrowRight') show(index + 1);
                });
                const strip = wrap.createDiv({ cls: 'momento-hp-strip', attr: { role: 'tablist' } });
                entries.forEach((entry, i) => {
                    const chip = strip.createEl('button', { cls: `momento-hp-chip${i === index ? ' is-active' : ''}`, attr: { type: 'button', role: 'tab', 'aria-selected': String(i === index), title: `${longDate(entry.date)} ${plainText(entry, 40)}` } });
                    const url = entry.images?.[0] ? plugin.resourceUrl(entry.images[0]) : '';
                    const thumb = chip.createSpan('momento-hp-chip-thumb');
                    if (url) thumb.createEl('img', { attr: { src: url, alt: '', draggable: 'false' } });
                    else setIcon(thumb, entry.audios?.length ? 'mic' : 'quote');
                    chip.createSpan({ cls: 'momento-hp-chip-year', text: entry.date.slice(0, 4) });
                    chip.onclick = () => show(i);
                });
            }
        },
        renderSettings(container, ctx) {
            new Setting(container).setName('没有当天记录时，看看前后几天')
                .setDesc('0 表示只看当天。')
                .addSlider(slider => slider.setLimits(0, 7, 1).setValue(ctx.config.nearbyDays).setDynamicTooltip()
                    .onChange(value => ctx.update({ nearbyDays: value })));
        },
    };
}

// ---- 随机回忆 ----

interface RandomConfig extends Record<string, unknown> { photosOnly: boolean; rotateMinutes: number }

function randomWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<RandomConfig> {
    // Keeps the same memory across redraws until the user (or the timer) picks another one.
    const picked = new Map<string, string>();
    const pool = (config: RandomConfig) => plugin.data.entries.filter(e => !config.photosOnly || e.images?.length);
    const pick = (widgetId: string, config: RandomConfig, exclude?: string) => {
        const entry = pickRandom(pool(config), exclude);
        if (entry) picked.set(widgetId, entry.id);
        return entry;
    };
    return {
        kind: 'momento-random',
        name: '随机回忆',
        description: '从拾光里随机翻出一条回忆：照片铺满卡片，点“换一个”再看下一条，也可以定时自动换。',
        icon: 'shuffle',
        accent: '#8b5cf6',
        defaultSize: { w: 4, h: 7 },
        defaultConfig: () => ({ photosOnly: true, rotateMinutes: 0 }),
        normalizeConfig: (raw) => ({
            photosOnly: raw.photosOnly !== false,
            rotateMinutes: [0, 5, 15, 60].includes(Number(raw.rotateMinutes)) ? Number(raw.rotateMinutes) : 0,
        }),
        liveRefresh: false,
        render(body, ctx) {
            const current = picked.get(ctx.widget.id);
            const entry = pool(ctx.config).find(e => e.id === current) ?? pick(ctx.widget.id, ctx.config);
            const wrap = body.createDiv('momento-hp momento-hp-random');
            if (!entry) {
                home.ui.renderEmpty(wrap, { icon: 'shuffle', text: ctx.config.photosOnly ? '拾光里还没有带照片的记录。' : '拾光里还没有记录。' });
                return;
            }
            const another = () => { pick(ctx.widget.id, ctx.config, entry.id); ctx.rerender(); };
            ctx.addHeaderAction('shuffle', '换一个', another);
            if (ctx.config.rotateMinutes > 0) ctx.registerInterval(another, ctx.config.rotateMinutes * 60000);
            // “3 年前” for older memories; this year's read better as “昨天” / “9月28日 周日”.
            const when = yearsAgoLabel(entry.date) === '今年' ? dayLabel(entry.date) : yearsAgoLabel(entry.date);
            const card = renderMemoryCard(plugin, wrap, entry, when);
            card.addClass('momento-hp-fade');
        },
        renderSettings(container, ctx) {
            new Setting(container).setName('只选带照片的记录').addToggle(toggle => toggle
                .setValue(ctx.config.photosOnly).onChange(value => ctx.update({ photosOnly: value })));
            new Setting(container).setName('自动换一条').addDropdown(dropdown => dropdown
                .addOptions({ '0': '不自动', '5': '每 5 分钟', '15': '每 15 分钟', '60': '每小时' })
                .setValue(String(ctx.config.rotateMinutes))
                .onChange(value => ctx.update({ rotateMinutes: Number(value) })));
        },
    };
}

/** What “在首页添加拾光组件” pins. 「今日拾光」 is left out: 「拾光」 already lists WeChat candidates. */
const WIDGETS: Array<{ kind: string; title: string; w: number; h: number }> = [
    { kind: 'momento-capture', title: '拾光', w: 6, h: 9 },
    { kind: 'momento-onthisday', title: '那年今日', w: 6, h: 5 },
    { kind: 'momento-random', title: '随机回忆', w: 6, h: 4 },
];

/** Registers the widgets whenever Home Pages is (or becomes) available, and keeps them fresh. */
export function registerHomeWidgets(plugin: ChildTimelinePlugin): { pinAll(): Promise<boolean> } {
    let home: HomeApi | null = null;
    let unregister: Array<() => void> = [];
    const detach = () => { unregister.forEach(fn => fn()); unregister = []; };
    const attach = (api: unknown) => {
        if (!isHomeApi(api)) return;
        detach();
        home = api;
        const widgets: HomeWidget<Record<string, unknown>>[] = [
            streamWidget(plugin, api),
            todayWidget(plugin, api),
            onThisDayWidget(plugin, api),
            randomWidget(plugin, api),
        ];
        unregister = widgets.map(widget => api.registerWidget(widget, plugin.manifest.id));
    };
    const workspace = plugin.app.workspace as unknown as { on(name: string, callback: (...args: unknown[]) => unknown): EventRef };
    const plugins = (plugin.app as unknown as { plugins?: { plugins?: Record<string, { api?: unknown }> } }).plugins?.plugins;
    attach(plugins?.['home-pages']?.api);
    plugin.registerEvent(workspace.on('home-pages:ready', attach));
    plugin.registerEvent(workspace.on(MOMENTO_CHANGED, () => {
        for (const kind of DATA_KINDS) {
            // Never redraw under someone typing in 「拾光」; catch up when the composer loses focus.
            if (kind === 'momento-capture' && composing.size) { deferredRedraw = () => home?.refresh('momento-capture'); continue; }
            home?.refresh(kind);
        }
    }));
    plugin.register(detach);
    return {
        /** Adds the Momento widgets to the current homepage (Home Pages skips ones already there). */
        async pinAll() {
            if (!home?.pinWidget) return false;
            for (const [i, widget] of WIDGETS.entries()) {
                await home.pinWidget(widget.kind, {}, { title: widget.title, w: widget.w, h: widget.h, provider: plugin.manifest.id, open: i === WIDGETS.length - 1 });
            }
            return true;
        },
    };
}
