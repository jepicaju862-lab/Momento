import { Setting, setIcon, type App, type EventRef } from 'obsidian';
import type ChildTimelinePlugin from './main';
import type { TimelineEntry } from './settings';
import { MOMENTO_CHANGED } from './momento-api';
import type { WechatGroup } from './wechat-candidates';

/** The parts of Home Pages' host API (version 1) that Momento uses. */
interface HomeApi {
    version: 1;
    registerWidget(definition: HomeWidget<Record<string, unknown>>, provider?: string): () => void;
    refresh(kind?: string): void;
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

const KINDS = ['momento-today', 'momento-onthisday', 'momento-random'];
const DAY = 86400000;

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

function yearsAgo(date: string): string {
    const years = new Date().getFullYear() - Number(date.slice(0, 4));
    return years > 0 ? `${years} 年前` : '今年';
}

function excerpt(entry: TimelineEntry): string {
    const text = entry.content || Object.values(entry.audioTranscripts || {})[0] || '';
    if (text) return text.replace(/[#>*_`~[\]!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const media = (entry.images?.length || 0) + (entry.videos?.length || 0);
    return media ? `${media} 张照片 / 视频` : entry.audios?.length ? '一段语音' : '一条记录';
}

function thumb(plugin: ChildTimelinePlugin, parent: HTMLElement, path: string | undefined, fallbackIcon: string): void {
    const url = path ? plugin.resourceUrl(path) : '';
    if (url) parent.createEl('img', { attr: { src: url, alt: '', loading: 'lazy' } });
    else setIcon(parent, fallbackIcon);
}

// ---- 今日拾光: WeChat candidates, only shown while some exist ----

interface TodayConfig extends Record<string, unknown> { limit: number }

function todayWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<TodayConfig> {
    const keep = async (groups: WechatGroup[]) => {
        const ids = await plugin.wechat.keepEach(groups);
        if (ids.length) plugin.wechat.notifyKept(ids);
    };
    return {
        kind: 'momento-today',
        name: '今日拾光',
        description: '微信里新收到的照片、视频和语音，按会话自动分组；轻点收下成为拾光。没有待收内容时自动隐藏。',
        icon: 'sparkles',
        accent: '#14b8a6',
        defaultSize: { w: 6, h: 5 },
        defaultConfig: () => ({ limit: 6 }),
        normalizeConfig: (raw) => ({ limit: Math.min(20, Math.max(1, Math.round(Number(raw.limit) || 6))) }),
        liveRefresh: false,
        render(body, ctx) {
            const groups = plugin.wechat.candidates();
            ctx.setHidden?.(groups.length === 0);
            if (!groups.length) {
                home.ui.renderEmpty(body, {
                    icon: 'sparkles',
                    text: plugin.wechat.available()
                        ? '暂无待收的微信回忆。收到新的照片、视频或语音时，这张卡片会自动出现。'
                        : '启用带插件 API 的 WeChat2Ob 后，微信里的照片、视频和语音会出现在这里。',
                });
                return;
            }
            ctx.setSubtitle(`${groups.length} 组待收`);
            ctx.addHeaderAction('check-check', '全部收下', () => void keep(groups));
            const list = body.createDiv('momento-hp-today');
            for (const group of groups.slice(0, ctx.config.limit)) {
                const row = list.createDiv('momento-hp-candidate');
                const pics = row.createDiv('momento-hp-thumbs');
                const photos = group.draft.images.slice(0, 3);
                if (photos.length) for (const path of photos) thumb(plugin, pics.createDiv('momento-hp-thumb'), path, 'image');
                else thumb(plugin, pics.createDiv('momento-hp-thumb is-icon'), undefined, group.draft.videos.length ? 'video' : 'mic');
                const info = row.createDiv('momento-hp-info');
                info.createDiv({ cls: 'momento-hp-text', text: group.summary });
                info.createDiv({ cls: 'momento-hp-meta', text: clock(group.firstAt) });
                const actions = row.createDiv('momento-hp-actions');
                const keepBtn = actions.createEl('button', { cls: 'mod-cta', text: '收下' });
                keepBtn.onclick = (event) => { event.stopPropagation(); keepBtn.disabled = true; void keep([group]); };
                const skipBtn = actions.createEl('button', { text: '忽略' });
                skipBtn.onclick = (event) => {
                    event.stopPropagation();
                    skipBtn.disabled = true;
                    void plugin.wechat.dismiss([group]).then(() => plugin.wechat.notifyDismissed([group]));
                };
                row.onclick = () => void plugin.openDate(group.draft.date);
            }
            if (groups.length > ctx.config.limit) {
                const more = list.createDiv({ cls: 'momento-hp-more', text: `还有 ${groups.length - ctx.config.limit} 组，在拾光里查看` });
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

function onThisDayWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<Record<string, unknown>> {
    return {
        kind: 'momento-onthisday',
        name: '那年今日',
        description: '往年的今天，拾光里记下了什么。',
        icon: 'history',
        accent: '#f59e0b',
        defaultSize: { w: 6, h: 5 },
        defaultConfig: () => ({}),
        liveRefresh: false,
        render(body, ctx) {
            const entries = plugin.api?.onThisDay() ?? [];
            if (!entries.length) {
                home.ui.renderEmpty(body, {
                    icon: 'history',
                    text: '往年的今天还没有记录。',
                    action: { label: '随机回看一条', onClick: () => { const e = plugin.api?.random(); if (e) void plugin.openEntry(e.id); } },
                });
                return;
            }
            ctx.setSubtitle(`${entries.length} 条`);
            const list = body.createDiv('momento-hp-memories');
            for (const summary of entries) {
                const entry = plugin.data.entries.find(e => e.id === summary.id);
                if (!entry) continue;
                const row = list.createDiv('momento-hp-memory');
                thumb(plugin, row.createDiv('momento-hp-thumb'), entry.images?.[0], entry.videos?.length ? 'video' : entry.audios?.length ? 'mic' : 'quote');
                const info = row.createDiv('momento-hp-info');
                info.createDiv({ cls: 'momento-hp-year', text: `${yearsAgo(entry.date)} · ${entry.date.slice(0, 4)}` });
                info.createDiv({ cls: 'momento-hp-text', text: excerpt(entry) });
                row.onclick = () => void plugin.openEntry(entry.id);
            }
        },
        renderSettings(container) {
            container.createDiv({ cls: 'setting-item-description', text: '没有可配置项：按今天的月和日自动匹配往年记录。' });
        },
    };
}

// ---- 随机回忆 ----

interface RandomConfig extends Record<string, unknown> { photosOnly: boolean }

function randomWidget(plugin: ChildTimelinePlugin, home: HomeApi): HomeWidget<RandomConfig> {
    // Keeps the same memory across redraws until the user asks for another one.
    const picked = new Map<string, string>();
    const pool = (config: RandomConfig) => plugin.data.entries.filter(e => !config.photosOnly || e.images?.length);
    const pick = (widgetId: string, config: RandomConfig, exclude?: string) => {
        const all = pool(config), choices = all.length > 1 ? all.filter(e => e.id !== exclude) : all;
        const entry = choices[Math.floor(Math.random() * choices.length)];
        if (entry) picked.set(widgetId, entry.id);
        return entry;
    };
    return {
        kind: 'momento-random',
        name: '随机回忆',
        description: '从拾光里随机翻出一条回忆，点“换一个”再看下一条。',
        icon: 'shuffle',
        accent: '#8b5cf6',
        defaultSize: { w: 4, h: 6 },
        defaultConfig: () => ({ photosOnly: true }),
        normalizeConfig: (raw) => ({ photosOnly: raw.photosOnly !== false }),
        liveRefresh: false,
        render(body, ctx) {
            const current = picked.get(ctx.widget.id);
            const entry = pool(ctx.config).find(e => e.id === current) ?? pick(ctx.widget.id, ctx.config);
            if (!entry) {
                home.ui.renderEmpty(body, { icon: 'shuffle', text: ctx.config.photosOnly ? '拾光里还没有带照片的记录。' : '拾光里还没有记录。' });
                return;
            }
            ctx.addHeaderAction('shuffle', '换一个', () => { pick(ctx.widget.id, ctx.config, entry.id); ctx.rerender(); });
            ctx.setSubtitle(yearsAgo(entry.date));
            const card = body.createDiv('momento-hp-random');
            if (entry.images?.length) thumb(plugin, card.createDiv('momento-hp-cover'), entry.images[0], 'image');
            card.createDiv({ cls: 'momento-hp-year', text: entry.date });
            card.createDiv({ cls: 'momento-hp-text', text: excerpt(entry) });
            card.onclick = () => void plugin.openEntry(entry.id);
        },
        renderSettings(container, ctx) {
            new Setting(container).setName('只选带照片的记录').addToggle(toggle => toggle
                .setValue(ctx.config.photosOnly).onChange(value => ctx.update({ photosOnly: value })));
        },
    };
}

/** Registers the widgets whenever Home Pages is (or becomes) available, and keeps them fresh. */
export function registerHomeWidgets(plugin: ChildTimelinePlugin): void {
    let home: HomeApi | null = null;
    let unregister: Array<() => void> = [];
    const detach = () => { unregister.forEach(fn => fn()); unregister = []; };
    const attach = (api: unknown) => {
        if (!isHomeApi(api)) return;
        detach();
        home = api;
        const widgets: HomeWidget<Record<string, unknown>>[] = [
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
        // Redraws keep the random card's current pick unless that entry was deleted.
        for (const kind of KINDS) home?.refresh(kind);
    }));
    plugin.register(detach);
}
