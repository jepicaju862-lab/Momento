import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    GROUP_WINDOW_MS, groupMessages, imageSize, localDate, looksLikeScreenshot, mergeGroups, pendingGroups, remindable,
    type WechatMessage,
} from '../wechat-candidates';

const base = Date.parse('2026-09-30T10:00:00+08:00');
let seq = 0;
function msg(offsetMs: number, overrides: Partial<WechatMessage> = {}): WechatMessage {
    seq += 1;
    return {
        key: `k${seq}`, kind: 'text', title: '', content: '', transcript: '',
        receivedAt: new Date(base + offsetMs).toISOString(), sessionId: 'chat', senderId: 'me', attachments: [], ...overrides,
    };
}
const photo = (path: string) => ({ kind: 'image', path, mimeType: 'image/jpeg' });

test('a burst of photos followed by a caption becomes one memorable group', () => {
    const messages = [
        msg(0, { kind: 'image', attachments: [photo('W/a.jpg')], notePath: '日记/2026-09-30.md' }),
        msg(20_000, { kind: 'image', attachments: [photo('W/b.jpg')] }),
        msg(60_000, { content: '第一次骑车' }),
    ];
    const [group, ...rest] = groupMessages(messages);
    assert.equal(rest.length, 0);
    assert.deepEqual(group.keys, messages.map(m => m.key));
    assert.equal(group.key, messages[0].key, 'group key is the first message');
    assert.deepEqual(group.draft.images, ['W/a.jpg', 'W/b.jpg']);
    assert.equal(group.draft.content, '第一次骑车');
    assert.equal(group.draft.date, localDate(base));
    assert.equal(group.draft.createdAt, base);
    assert.equal(group.notePath, '日记/2026-09-30.md');
    assert.ok(group.memorable);
    assert.equal(group.cover, 'W/a.jpg');
    assert.equal(group.summary, '第一次骑车');
});

test('gaps, other conversations and plain text split or stay out of candidates', () => {
    const groups = groupMessages([
        msg(0, { kind: 'image', attachments: [photo('W/a.jpg')] }),
        msg(GROUP_WINDOW_MS + 1, { content: '晚到的文字' }),
        msg(GROUP_WINDOW_MS + 2_000, { content: '另一个会话', sessionId: 'other' }),
    ]);
    assert.equal(groups.length, 3, 'window and session both split');
    assert.equal(groups[0].summary, '另一个会话', 'newest first');
    assert.deepEqual(groups.map(g => g.memorable), [false, false, true], 'text alone is not offered');
});

test('voice transcripts stay with their recording and screenshots are not memories', () => {
    const [voice] = groupMessages([msg(0, { kind: 'voice', transcript: '明天开会', attachments: [{ kind: 'voice', path: 'W/v.m4a', mimeType: 'audio/mp4' }] })]);
    assert.deepEqual(voice.draft.audios, ['W/v.m4a']);
    assert.deepEqual(voice.draft.audioTranscripts, { 'W/v.m4a': '明天开会' });
    assert.equal(voice.draft.content, '', 'transcript is not duplicated into the text');
    assert.ok(voice.memorable);
    assert.equal(voice.summary, '明天开会');

    const [textVoice] = groupMessages([msg(0, { kind: 'voice', transcript: '只有转写' })]);
    assert.equal(textVoice.draft.content, '只有转写', 'transcript without a recording becomes the text');

    const shots = new Set(['W/shot.png']);
    const [shot] = groupMessages([msg(0, { kind: 'image', attachments: [{ kind: 'image', path: 'W/shot.png', mimeType: 'image/png' }] })], p => shots.has(p));
    assert.equal(shot.memorable, false);
    assert.deepEqual(shot.draft.images, ['W/shot.png'], 'kept groups still include screenshots');
    assert.equal(shot.cover, undefined);
});

test('handled messages never re-form a group and reminders stop after 7 days', () => {
    const a = msg(0, { kind: 'image', attachments: [photo('W/a.jpg')] });
    const b = msg(30_000, { kind: 'image', attachments: [photo('W/b.jpg')] });
    const late = msg(60_000, { content: '后来补的一句' });
    const pending = pendingGroups([a, b, late], key => key === a.key || key === b.key);
    assert.deepEqual(pending.map(g => g.keys), [[late.key]], 'kept photos do not swallow later text');
    const groups = groupMessages([a]);
    assert.equal(remindable(groups, base + 6 * 86400000).length, 1);
    assert.equal(remindable(groups, base + 8 * 86400000).length, 0);
});

test('merging selected groups keeps order, media and the earliest date', () => {
    const groups = groupMessages([
        msg(0, { kind: 'image', attachments: [photo('W/1.jpg')], content: '上午' }),
        msg(4 * 3600_000, { kind: 'image', attachments: [photo('W/2.jpg')], content: '下午' }),
    ]);
    const merged = mergeGroups(groups);
    assert.deepEqual(merged.draft.images, ['W/1.jpg', 'W/2.jpg']);
    assert.equal(merged.draft.content, '上午\n\n下午');
    assert.equal(merged.firstAt, base);
    assert.equal(merged.keys.length, 2);
});

test('image headers give sizes; tall phone captures and screenshot names are detected', () => {
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47], 0); png.set([0, 0, 4, 0x38], 16); png.set([0, 0, 9, 0x24], 20);
    assert.deepEqual(imageSize(png), { width: 1080, height: 2340 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3, 0, 0, 0, 0]);
    assert.deepEqual(imageSize(jpeg), { width: 4000, height: 3000 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 1, 0xf0, 0]);
    assert.deepEqual(imageSize(gif), { width: 320, height: 240 });
    assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
    assert.ok(looksLikeScreenshot('W/x.png', { width: 1080, height: 2340 }));
    assert.ok(!looksLikeScreenshot('W/x.jpg', { width: 4000, height: 3000 }));
    assert.ok(!looksLikeScreenshot('W/x.jpg', { width: 1920, height: 1080 }), '16:9 photos stay photos');
    assert.ok(looksLikeScreenshot('W/Screenshot_2026.jpg', null));
    assert.ok(looksLikeScreenshot('W/微信截图_1.png'));
});
