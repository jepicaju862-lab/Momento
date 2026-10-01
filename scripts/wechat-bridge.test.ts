import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { notices, fakeEl, Platform } from './obsidian-stub';  // the same module the bundle aliases `obsidian` to
import { WechatBridge, WECHAT_UPDATED_EVENT } from '../wechat-bridge';
import { createMomentoApi } from '../momento-api';
import { findSourcedEntry, newSourcedEntry, type EntryDraft } from '../entry-source';
import type { EntrySource, TimelineEntry } from '../settings';
import type { WechatMessage } from '../wechat-candidates';

(globalThis as unknown as { createFragment: () => unknown }).createFragment = () => fakeEl();

const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const m = (key: string, minutesAgo: number, o: Partial<WechatMessage> = {}): WechatMessage => ({
    key, kind: 'text', title: '', content: '', transcript: '', receivedAt: at(minutesAgo), sessionId: 'chat', senderId: 'me', attachments: [], ...o,
});
const img = (path: string) => ({ kind: 'image', path, mimeType: 'image/jpeg' });

/** A plugin double with the same entry rules as main.ts (via entry-source.ts). */
function setup(messages: WechatMessage[]) {
    const events: string[] = [];
    const data = { entries: [] as TimelineEntry[], settings: { wechatAutoKeep: false }, wechatDismissed: {} as Record<string, number> };
    const wechatApi = { version: 1, query: async () => ({ messages }) };
    const plugin = {
        data,
        app: {
            plugins: { plugins: { wechat2ob: { api: wechatApi } } },
            vault: { getAbstractFileByPath: () => null },
            workspace: { trigger: (name: string) => events.push(name) },
        },
        savePluginData: async () => {},
        captureEntry: async (draft: EntryDraft, source: EntrySource) => {
            const existing = findSourcedEntry(data.entries, source);
            if (existing) return { id: existing.id, created: false };
            const entry = newSourcedEntry(draft, source);
            data.entries.push(entry);
            return { id: entry.id, created: true };
        },
        deleteEntry: async (id: string) => { data.entries = data.entries.filter(e => e.id !== id); },
        openEntry: async () => {},
        resourceUrl: () => '',
        wechat: undefined as unknown as WechatBridge,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin.wechat = new WechatBridge(plugin as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = createMomentoApi(plugin as any);
    return { plugin, data, api, events, messages };
}

const burst = () => [
    m('p1', 30, { kind: 'image', attachments: [img('WeChat2Ob/附件/a.jpg')], notePath: '日记/today.md' }),
    m('p2', 29, { kind: 'image', attachments: [img('WeChat2Ob/附件/b.jpg')] }),
    m('cap', 28, { content: '第一次骑车' }),
    m('milk', 5, { content: '记得买牛奶' }),
];

test('photos plus caption become one candidate; plain text waits without a reminder', async () => {
    const { plugin, events } = setup(burst());
    await plugin.wechat.refresh();
    assert.ok(events.includes(WECHAT_UPDATED_EVENT));
    const candidates = plugin.wechat.candidates();
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0].keys, ['p1', 'p2', 'cap']);
    assert.equal(plugin.wechat.pending().length, 2, 'text is listed in 来自微信 but not reminded');
});

test('keeping creates one sourced entry, is idempotent and is visible through the API', async () => {
    const { plugin, data, api } = setup(burst());
    await plugin.wechat.refresh();
    const id = await api.wechat.keep('p2', { notify: true });
    assert.ok(id);
    assert.equal(data.entries.length, 1);
    const entry = data.entries[0];
    assert.deepEqual(entry.images, ['WeChat2Ob/附件/a.jpg', 'WeChat2Ob/附件/b.jpg']);
    assert.equal(entry.content, '第一次骑车');
    assert.deepEqual(entry.tags, ['微信']);
    assert.deepEqual(entry.source, { plugin: 'wechat2ob', keys: ['p1', 'p2', 'cap'], notePath: '日记/today.md' });
    assert.ok(notices.some(n => n.includes('已存为拾光') && n.includes('撤销')), 'notice offers undo');
    assert.equal(await api.wechat.keep('cap'), id, 'second keep returns the same entry');
    assert.equal(data.entries.length, 1);
    assert.deepEqual(api.findBySource('wechat2ob', ['p1', 'cap', 'milk']), { p1: id, cap: id });
    assert.equal(api.wechat.candidates().length, 0);
});

test('ignore and undo, keep and undo', async () => {
    const { plugin, data } = setup(burst());
    await plugin.wechat.refresh();
    const [group] = plugin.wechat.candidates();
    await plugin.wechat.dismiss([group]);
    assert.equal(plugin.wechat.candidates().length, 0);
    await plugin.wechat.restore(group.keys);
    assert.equal(plugin.wechat.candidates().length, 1, 'undo brings the candidate back');
    const id = await plugin.wechat.keep([group]);
    await plugin.wechat.unkeep([id!]);
    assert.equal(data.entries.length, 0, 'undo removes the entry');
    assert.equal(plugin.wechat.candidates().length, 1, 'a manual keep undone is offered again');
    const again = await plugin.wechat.keep([group]);
    await plugin.wechat.unkeep([again!], { dismiss: true });
    assert.equal(plugin.wechat.candidates().length, 0, 'undoing an auto-keep does not offer it again');

    const captioned = setup(burst());
    await captioned.plugin.wechat.refresh();
    const [g] = captioned.plugin.wechat.candidates();
    await captioned.plugin.wechat.keepEach([g], () => '自己写的一句话');
    assert.equal(captioned.data.entries[0].content, '自己写的一句话', 'caption typed before keeping is saved');
});

test('selected groups merge into one entry', async () => {
    const { plugin, data } = setup([
        m('morning', 300, { kind: 'image', attachments: [img('W/1.jpg')], content: '上午' }),
        m('evening', 10, { kind: 'image', attachments: [img('W/2.jpg')], content: '傍晚' }),
    ]);
    await plugin.wechat.refresh();
    const groups = plugin.wechat.pending();
    assert.equal(groups.length, 2);
    await plugin.wechat.keep(groups);
    assert.equal(data.entries.length, 1);
    assert.deepEqual(data.entries[0].images, ['W/1.jpg', 'W/2.jpg']);
    assert.equal(data.entries[0].content, '上午\n\n傍晚');
});

test('auto-keep after a sync keeps candidates on desktop only', async () => {
    const desktop = setup(burst());
    desktop.data.settings.wechatAutoKeep = true;
    await desktop.plugin.wechat.onSynced();
    assert.equal(desktop.data.entries.length, 1, 'photo group kept, text left alone');

    Platform.isDesktopApp = false;
    const mobile = setup(burst());
    mobile.data.settings.wechatAutoKeep = true;
    await mobile.plugin.wechat.onSynced();
    assert.equal(mobile.data.entries.length, 0);
    Platform.isDesktopApp = true;
});

test('missing or incompatible WeChat2Ob API simply offers nothing', async () => {
    const { plugin } = setup(burst());
    (plugin.app.plugins.plugins.wechat2ob.api as { version: number }).version = 2;
    assert.equal(plugin.wechat.available(), false);
    await plugin.wechat.refresh();
    assert.equal(plugin.wechat.pending().length, 0);
});

test('API lists entries and finds those from this day in earlier years', async () => {
    const { data, api } = setup([]);
    const today = new Date();
    const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const add = (date: string, content: string) => data.entries.push({ ...newSourcedEntry({ date, content, createdAt: Date.parse(date) }, { plugin: 'test', keys: [content] }) });
    add(`2023-${md}`, 'old'); add(`2025-${md}`, 'recent'); add(`${today.getFullYear()}-${md}`, 'this year'); add('2024-01-01', 'other');
    assert.deepEqual(api.onThisDay(today).map(e => e.content), ['recent', 'old']);
    assert.equal(api.list({ limit: 2 }).length, 2);
    assert.equal(api.list({ from: '2024-01-01', to: '2024-12-31' })[0].content, 'other');
    const copy = api.list()[0];
    copy.images.push('mutated');
    assert.equal(api.list()[0].images.length, 0, 'API returns copies');
});
