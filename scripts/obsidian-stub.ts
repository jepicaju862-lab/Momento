// Minimal `obsidian` module for Node tests of the WeChat bridge (no UI rendering).
export const notices: string[] = [];
type El = { text: string; children: El[]; onclick?: () => void; createSpan(o?: { text?: string }): El; createDiv(o?: unknown): El; createEl(tag: string, o?: { text?: string }): El };
export function fakeEl(text = ''): El {
    const el: El = {
        text, children: [],
        createSpan: (o) => { const c = fakeEl(o?.text); el.children.push(c); return c; },
        createDiv: () => { const c = fakeEl(); el.children.push(c); return c; },
        createEl: (_tag, o) => { const c = fakeEl(o?.text); el.children.push(c); return c; },
    };
    return el;
}
export function allText(el: El): string { return [el.text, ...el.children.map(allText)].filter(Boolean).join(' '); }
export class Notice {
    constructor(message: unknown) { notices.push(typeof message === 'string' ? message : allText(message as El)); }
    hide(): void {}
}
export const Platform = { isDesktopApp: true };
export class TFile { path = ''; }
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class ItemView {}
export class Modal {}
export function setIcon(): void {}
export function normalizePath(p: string): string { return p; }
