import { Setting, setIcon, type App, type EventRef } from 'obsidian';
import type ChildTimelinePlugin from './main';
import type { TimelineEntry } from './settings';
import { MOMENTO_CHANGED } from './momento-api';
import type { WechatGroup } from './wechat-candidates';
import { longDate, mediaSummary, memoriesAround, pickRandom, plainText, yearsAgoLabel } from './memories';

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
const DATA_KINDS = ['momento-today', 'momento-onthisday', 'momento-random'];
const LEAVE_MS = 200;
const UNDO_MS = 8000;
const DAY = 86400000;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, reducedMotion() ? 0 : ms));

function isHomeApi(value: unknown): value is HomeApi {
    const api = value as Partial<HomeApi> | null;
    return !!api && api.version === 1 && typeof api.registerWidget === 'function' && typeof api.refresh === 'function';
}

function clock(time: number): string {
    const d = new Date(time), today = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY);
    return days === 0 ? `今天 ${hm}` : days === 1 ? `昨天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
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

// ---- Media tiles ----

/** Up to four photos in a mosaic (“+N” on the last), or a tile for video / voice. */
function renderMosaic(plugin: ChildTimelinePlugin, parent: HTMLElement, media: { images: string[]; videos: string[]; audios: string[] }, cover?: string): void {
    const tile = parent.createDiv('momento-hp-mosaic');
    const photos = cover ? [cover, ...media.images.filter(p => p !== cover)] : media.images;
    const shown = photos.slice(0, 4);
    if (shown.length) {
        tile.addClass(`is-${shown.length}`);
        shown.forEach((path, index) => {
            const cell = tile.createDiv('momento-hp-mosaic-cell');
            const url = plugin.resourceUrl(path);
            if (url) cell.createEl('img', { attr: { src: url, alt: '', loading: 'lazy', draggable: 'false' } });
            const extra = photos.length - shown.length;
            if (index === shown.length - 1 && extra > 0) cell.createDiv({ cls: 'momento-hp-mosaic-more', text: `+${extra}` });
        });
        if (media.videos.length) setIcon(tile.createDiv('momento-hp-mosaic-badge'), 'play');
        return;
    }
    tile.addClass('is-icon');
    if (media.videos.length) {
        tile.addClass('is-video');
        setIcon(tile.createDiv('momento-hp-mosaic-symbol'), 'play');
    } else {
        tile.addClass('is-voice');
        const wave = tile.createDiv('momento-hp-wave');
        for (let i = 0; i < 9; i++) wave.createSpan().style.setProperty('--h', `${30 + ((i * 37) % 60)}%`);
    }
}

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

// ---- 今日拾光: WeChat candidates, shown only while some wait ----

interface TodayConfig extends Record<string, unknown> { limit: number }
/** Captions typed before keeping, by group key; kept across redraws. */
const captions = new Map<string, string>();

function todayWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<TodayConfig> {
    const captionFor = (group: WechatGroup) => captions.get(group.key);
    const keep = async (ctx: HomeContext<TodayConfig>, groups: WechatGroup[]) => {
        const ids = await plugin.wechat.keepEach(groups, captionFor);
        groups.forEach(g => captions.delete(g.key));
        if (!ids.length) return;
        showUndo(ctx.widget.id, {
            text: ids.length > 1 ? `已收下 ${ids.length} 组` : '已存为拾光',
            view: () => void plugin.openEntry(ids[0]),
            undo: () => plugin.wechat.unkeep(ids),
        });
        // The keep already redrew this card (momento:changed) before the undo existed; draw the current card again.
        home.refresh('momento-today');
    };
    const dismiss = async (ctx: HomeContext<TodayConfig>, group: WechatGroup) => {
        await plugin.wechat.dismiss([group]);
        showUndo(ctx.widget.id, { text: '已忽略', undo: () => plugin.wechat.restore(group.keys) });
        home.refresh('momento-today');
    };

    const editCaption = (ctx: HomeContext<TodayConfig>, holder: HTMLElement, group: WechatGroup) => {
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
            if (ctx.isAlive()) ctx.rerender();
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
    };

    return {
        kind: 'momento-today',
        name: '今日拾光',
        description: '微信里新收到的照片、视频和语音，按会话自动分组；可先写一句话再收下，处理后可撤销。没有待收内容时自动隐藏。',
        icon: 'sparkles',
        accent: '#14b8a6',
        defaultSize: { w: 6, h: 6 },
        defaultConfig: () => ({ limit: 6 }),
        normalizeConfig: (raw) => ({ limit: Math.min(20, Math.max(1, Math.round(Number(raw.limit) || 6))) }),
        liveRefresh: false,
        render(body, ctx) {
            const groups = plugin.wechat.candidates();
            const wrap = body.createDiv('momento-hp momento-hp-today');
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
            if (groups.length > 1) ctx.addHeaderAction('check-check', `全部收下（${groups.length} 组）`, () => void keep(ctx, groups));

            const list = wrap.createDiv({ cls: 'momento-hp-candidates', attr: { role: 'list' } });
            for (const group of groups.slice(0, ctx.config.limit)) {
                const row = list.createDiv({ cls: 'momento-hp-candidate', attr: { role: 'listitem', tabindex: '0', 'aria-label': `${group.summary}。Enter 收下，Delete 忽略` } });
                renderMosaic(plugin, row, group.draft, group.cover);
                const info = row.createDiv('momento-hp-candidate-info');
                const holder = info.createDiv('momento-hp-caption');
                const caption = captions.get(group.key) ?? group.draft.content;
                const transcript = Object.values(group.draft.audioTranscripts)[0];
                if (caption) holder.createDiv({ cls: 'momento-hp-caption-text', text: caption });
                else if (transcript) holder.createDiv({ cls: 'momento-hp-caption-text is-transcript', text: transcript });
                else holder.createDiv({ cls: 'momento-hp-caption-text is-placeholder', text: '添加一句话…' });
                if (captions.has(group.key)) holder.createSpan({ cls: 'momento-hp-edited', text: '已编辑' });
                holder.setAttribute('title', '点击编辑这句话');
                holder.onclick = (event) => { event.stopPropagation(); editCaption(ctx, holder, group); };
                info.createDiv({ cls: 'momento-hp-meta', text: [clock(group.firstAt), mediaSummary(group.draft)].filter(Boolean).join(' · ') });

                const actions = row.createDiv('momento-hp-candidate-actions');
                const skipBtn = button(actions, { icon: 'x', label: '忽略（Delete）', cls: 'is-ghost' });
                const keepBtn = button(actions, { icon: 'check', label: '收下（Enter）', text: '收下', cls: 'is-primary' });
                const leave = async (action: () => Promise<void>) => {
                    keepBtn.disabled = skipBtn.disabled = true;
                    row.addClass('is-leaving');
                    await wait(LEAVE_MS);
                    await action();
                };
                keepBtn.onclick = (event) => { event.stopPropagation(); void leave(() => keep(ctx, [group])); };
                skipBtn.onclick = (event) => { event.stopPropagation(); void leave(() => dismiss(ctx, group)); };
                row.onkeydown = (event) => {
                    if (event.target !== row) return;
                    if (event.key === 'Enter') { event.preventDefault(); keepBtn.click(); }
                    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); skipBtn.click(); }
                    if (event.key === 'ArrowDown') (row.nextElementSibling as HTMLElement | null)?.focus();
                    if (event.key === 'ArrowUp') (row.previousElementSibling as HTMLElement | null)?.focus();
                };
                row.onclick = () => void plugin.openDate(group.draft.date);
            }
            if (groups.length > ctx.config.limit) {
                const more = wrap.createEl('button', { cls: 'momento-hp-more', text: `还有 ${groups.length - ctx.config.limit} 组，在拾光里查看`, attr: { type: 'button' } });
                more.onclick = () => void plugin.activateView();
            }
        },
        renderSettings(container, ctx) {
            new Setting(container).setName('最多显示组数').addSlider(slider => slider
                .setLimits(1, 20, 1).setValue(ctx.config.limit).setDynamicTooltip()
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
            const card = renderMemoryCard(plugin, wrap, entry, yearsAgoLabel(entry.date));
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

// ---- 拾光快记 ----

interface CaptureFile { name: string; type: string; buffer: ArrayBuffer; url: string }
interface CaptureDraft { text: string; tags: Set<string>; files: CaptureFile[] }
/** Drafts by widget id, so typing survives redraws and page switches. */
const drafts = new Map<string, CaptureDraft>();

function captureWidget(plugin: ChildTimelinePlugin): HomeWidget<Record<string, unknown>> {
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
    const save = async (ctx: HomeContext<Record<string, unknown>>, draft: CaptureDraft) => {
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
        await plugin.addEntry(entry);
        draft.files.forEach(f => URL.revokeObjectURL(f.url));
        drafts.delete(ctx.widget.id);
        showUndo(ctx.widget.id, { text: '已记下', view: () => void plugin.openEntry(entry.id), undo: () => plugin.deleteEntry(entry.id) });
        if (ctx.isAlive()) ctx.rerender();
    };

    return {
        kind: 'momento-capture',
        name: '拾光快记',
        description: '在首页直接记一笔：文字、粘贴或拖入照片、选标签，Ctrl/⌘ + Enter 保存。',
        icon: 'pen-line',
        accent: '#0ea5e9',
        defaultSize: { w: 6, h: 5 },
        defaultConfig: () => ({}),
        liveRefresh: false,
        render(body, ctx) {
            const draft = draftFor(ctx.widget.id);
            const wrap = body.createDiv('momento-hp momento-hp-capture');
            renderUndo(wrap, ctx);
            const box = wrap.createDiv('momento-hp-capture-box');
            const input = box.createEl('textarea', { cls: 'momento-hp-capture-input', attr: { rows: '3', placeholder: '记下此刻…（可粘贴或拖入照片，Ctrl/⌘ + Enter 保存）', 'aria-label': '拾光快记' } });
            input.value = draft.text;
            const files = box.createDiv('momento-hp-capture-files');
            const footer = wrap.createDiv('momento-hp-capture-footer');
            const tags = footer.createDiv('momento-hp-capture-tags');
            const saveBtn = button(footer, { icon: 'send-horizontal', label: '保存（Ctrl/⌘ + Enter）', text: '记下', cls: 'is-primary' });

            const refresh = () => {
                saveBtn.disabled = !draft.text.trim() && !draft.files.length;
                files.empty();
                draft.files.forEach((file, i) => {
                    const thumb = files.createDiv('momento-hp-capture-thumb');
                    if (file.type.startsWith('image/')) thumb.createEl('img', { attr: { src: file.url, alt: '' } });
                    else setIcon(thumb, file.type.startsWith('video/') ? 'video' : 'mic');
                    const remove = thumb.createEl('button', { cls: 'momento-hp-capture-remove', attr: { type: 'button', 'aria-label': '移除' } });
                    setIcon(remove, 'x');
                    remove.onclick = () => { URL.revokeObjectURL(file.url); draft.files.splice(i, 1); refresh(); };
                });
                const add = files.createEl('label', { cls: 'momento-hp-capture-add', attr: { title: '添加照片、视频或录音', 'aria-label': '添加照片、视频或录音' } });
                setIcon(add.createSpan(), 'image-plus');
                const picker = add.createEl('input', { attr: { type: 'file', accept: 'image/*,video/*,audio/*', multiple: 'true' } });
                picker.onchange = async () => { if (picker.files) { await addFiles(draft, picker.files); refresh(); } };
            };
            for (const tag of (plugin.data.settings.customTags || []).slice(0, 8)) {
                const chip = tags.createEl('button', { cls: `momento-hp-tag${draft.tags.has(tag) ? ' is-on' : ''}`, text: tag, attr: { type: 'button', 'aria-pressed': String(draft.tags.has(tag)) } });
                chip.onclick = () => {
                    if (draft.tags.has(tag)) draft.tags.delete(tag); else draft.tags.add(tag);
                    chip.toggleClass('is-on', draft.tags.has(tag));
                    chip.setAttribute('aria-pressed', String(draft.tags.has(tag)));
                };
            }

            const submit = async () => {
                if (saveBtn.disabled) return;
                saveBtn.disabled = true;
                try { await save(ctx, draft); }
                catch (err) { saveBtn.disabled = false; console.error('Momento: quick capture failed', err); box.addClass('has-error'); }
            };
            input.oninput = () => { draft.text = input.value; saveBtn.disabled = !draft.text.trim() && !draft.files.length; box.removeClass('has-error'); };
            input.onkeydown = (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); }
            };
            input.onpaste = async (event) => {
                const pasted = Array.from(event.clipboardData?.files ?? []);
                if (!pasted.length) return;
                event.preventDefault();
                await addFiles(draft, pasted);
                refresh();
            };
            box.ondragover = (event) => { event.preventDefault(); box.addClass('is-dragover'); };
            box.ondragleave = () => box.removeClass('is-dragover');
            box.ondrop = async (event) => {
                event.preventDefault();
                box.removeClass('is-dragover');
                if (event.dataTransfer?.files.length) { await addFiles(draft, event.dataTransfer.files); refresh(); }
            };
            saveBtn.onclick = () => void submit();
            refresh();
        },
        renderSettings(container) {
            container.createDiv({ cls: 'setting-item-description', text: '标签取自拾光设置里的「场景标签列表」前 8 个；照片保存到拾光的媒体文件夹。' });
        },
    };
}

const WIDGETS: Array<{ kind: string; title: string; w: number; h: number }> = [
    { kind: 'momento-capture', title: '拾光快记', w: 6, h: 5 },
    { kind: 'momento-today', title: '今日拾光', w: 6, h: 6 },
    { kind: 'momento-onthisday', title: '那年今日', w: 6, h: 7 },
    { kind: 'momento-random', title: '随机回忆', w: 4, h: 7 },
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
            captureWidget(plugin),
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
        // Quick capture holds a draft and shows no entries, so it is not redrawn here.
        for (const kind of DATA_KINDS) home?.refresh(kind);
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
