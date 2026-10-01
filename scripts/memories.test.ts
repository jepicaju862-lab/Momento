import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { longDate, mediaSummary, memoriesAround, pickRandom, plainText, yearsAgoLabel } from '../memories';
import type { TimelineEntry } from '../settings';

const entry = (date: string, content = date, createdAt = 0): TimelineEntry => ({
    id: date + content, date, content, childName: '', images: [], videos: [], audios: [], files: [], likes: 0, comments: [], createdAt,
});

test('this day in earlier years, newest year first, never this year', () => {
    const today = new Date(2026, 9, 1);
    const { exact, entries } = memoriesAround([entry('2023-10-01'), entry('2025-10-01'), entry('2026-10-01'), entry('2025-10-02')], today);
    assert.equal(exact, true);
    assert.deepEqual(entries.map(e => e.date), ['2025-10-01', '2023-10-01']);
});

test('falls back to nearby days, including across the year end', () => {
    const near = memoriesAround([entry('2024-10-03'), entry('2024-10-09'), entry('2025-09-29')], new Date(2026, 9, 1));
    assert.equal(near.exact, false);
    assert.deepEqual(near.entries.map(e => e.date), ['2025-09-29', '2024-10-03']);
    const newYear = memoriesAround([entry('2024-12-30'), entry('2025-12-30')], new Date(2026, 0, 1));
    assert.deepEqual(newYear.entries.map(e => e.date), ['2024-12-30'], 'two days ago is not a past-years memory');
    assert.deepEqual(memoriesAround([entry('2024-10-03')], new Date(2026, 9, 1), 0).entries, [], 'window 0 disables fallback');
});

test('labels and summaries', () => {
    assert.equal(yearsAgoLabel('2023-05-01', new Date(2026, 0, 1)), '3 年前');
    assert.equal(yearsAgoLabel('2026-05-01', new Date(2026, 0, 1)), '今年');
    assert.equal(longDate('2026-10-01'), '2026年10月1日 · 周四');
    assert.equal(mediaSummary({ images: ['a', 'b'], audios: ['v'] }), '2 张照片 · 1 段语音');
    assert.equal(mediaSummary({}), '');
    assert.equal(plainText({ content: '## 标题\n**加粗** ![[a.png]] [链接](http://x)' }), '标题 加粗 链接');
    assert.equal(plainText({ content: '', audioTranscripts: { a: '语音转写' } }), '语音转写');
});

test('random pick avoids the current item when it can', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    assert.equal(pickRandom(items, 'a', () => 0)?.id, 'b');
    assert.equal(pickRandom([{ id: 'a' }], 'a', () => 0)?.id, 'a');
    assert.equal(pickRandom([], undefined), undefined);
});
