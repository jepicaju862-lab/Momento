import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import ChildTimelinePlugin from './main';

export interface ChildInfo {
    name: string;
    dob: string;
    avatar: string;
}


export interface TimelineEntry {
    id: string;
    date: string;
    subjectName?: string;
    childName: string;
    content: string;
    images: string[];
    videos: string[];
    audios?: string[];
    files?: string[];
    audioTranscripts?: Record<string, string>;
    likes: number;
    comments?: TimelineComment[];
    createdAt: number;
    tags?: string[];
}

export interface TimelineComment {
    id: string;
    text: string;
    createdAt: number;
    author?: string;
}

export interface ChildTimelineSettings {
    children: ChildInfo[];
    attachmentFolder: string;
    sortOrder: 'desc' | 'asc';
    sidebarWidth?: number;
    customTags: string[];
    sttEndpoint: string;
    sttAutoTranscribe: boolean;
    randomRoamEnabled: boolean;
    batchImportTimeMode: 'creation' | 'import';
    batchImportDefaultTag: string;
    batchImportDefaultText: string;
    dailyNoteSyncEnabled: boolean;
    dailyNotePathTemplate: string;
}

export interface PluginData {
    settings: ChildTimelineSettings;
    entries: TimelineEntry[];
}

export const DEFAULT_SETTINGS: ChildTimelineSettings = {
    children: [],
    attachmentFolder: 'life-media',
    sortOrder: 'desc',
    sidebarWidth: 260,
    sttEndpoint: 'http://127.0.0.1:8765/transcribe',
    sttAutoTranscribe: false,
    randomRoamEnabled: false,
    batchImportTimeMode: 'creation',
    batchImportDefaultTag: 'inbox',
    batchImportDefaultText: '',
    dailyNoteSyncEnabled: false,
    dailyNotePathTemplate: 'YYYY-MM-DD.md',
    customTags: [
        '旅行',
        '学习',
        '日常',
        '健康',
        '工作',
        '票据',
        '重要'
    ],
}

export const DEFAULT_DATA: PluginData = {
    settings: DEFAULT_SETTINGS,
    entries: [],
}

export class ChildTimelineSettingTab extends PluginSettingTab {
    plugin: ChildTimelinePlugin;

    constructor(app: App, plugin: ChildTimelinePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ---- Header ----
        new Setting(containerEl)
            .setName('拾光设置')
            .setHeading();
        containerEl.createEl('p', {
            text: '配置媒体存储位置和常用标签。',
            cls: 'setting-item-description'
        });

        // ---- Storage ----
        new Setting(containerEl)
            .setName('📁 存储设置')
            .setHeading();

        new Setting(containerEl)
            .setName('媒体存储文件夹')
            .setDesc('通过插件添加的图片、视频、录音和文件将保存到此库内相对路径，便于电脑、iPad 与手机共用。')
            .addText(text => text
                .setPlaceholder('例如：life-media')
                .setValue(this.plugin.data.settings.attachmentFolder)
                .onChange(async (value) => {
                    this.plugin.data.settings.attachmentFolder = value.trim();
                    const safeFolder = this.plugin.getAttachmentFolder();
                    if (safeFolder !== this.plugin.data.settings.attachmentFolder) {
                        this.plugin.data.settings.attachmentFolder = safeFolder;
                        text.setValue(safeFolder);
                        new Notice('媒体文件夹必须是仓库内相对路径，已改为 life-media。');
                    }
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('排列顺序')
            .setDesc('时间轴中记录的排列方式。')
            .addDropdown(dropdown => dropdown
                .addOption('desc', '最新的在前（倒序）')
                .addOption('asc', '最早的在前（正序）')
                .setValue(this.plugin.data.settings.sortOrder)
                .onChange(async (value: string) => {
                    this.plugin.data.settings.sortOrder = value as 'desc' | 'asc';
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('自动写入对应日期的日记')
            .setDesc('新增、编辑或批量导入记录后，将内容同步到记录日期对应的 Markdown 日记。')
            .addToggle(toggle => toggle
                .setValue(!!this.plugin.data.settings.dailyNoteSyncEnabled)
                .onChange(async (value) => {
                    this.plugin.data.settings.dailyNoteSyncEnabled = value;
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('日记路径模板')
            .setDesc('支持 YYYY、MM、DD，例如：日记/YYYY-MM-DD.md。已有日记会保留原内容并追加“拾光”区块。')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD.md')
                .setValue(this.plugin.data.settings.dailyNotePathTemplate || 'YYYY-MM-DD.md')
                .onChange(async (value) => {
                    this.plugin.data.settings.dailyNotePathTemplate = value.trim() || 'YYYY-MM-DD.md';
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('随机漫游')
            .setDesc('开启后可从菜单随机跳转到一条过往记录，并在首次打开时间轴时自动漫游一次。')
            .addToggle(toggle => toggle
                .setValue(!!this.plugin.data.settings.randomRoamEnabled)
                .onChange(async (value) => {
                    this.plugin.data.settings.randomRoamEnabled = value;
                    await this.plugin.savePluginData();
                }));

        // ---- Batch Import ----
        new Setting(containerEl)
            .setName('📥 批量导入设置')
            .setHeading();

        new Setting(containerEl)
            .setName('默认时间模式')
            .setDesc('批量导入图片时，使用图片的修改时间还是当前的导入时间。')
            .addDropdown(dropdown => dropdown
                .addOption('creation', '图片修改/创建时间 (lastModified)')
                .addOption('import', '当前导入时间')
                .setValue(this.plugin.data.settings.batchImportTimeMode)
                .onChange(async (value: string) => {
                    this.plugin.data.settings.batchImportTimeMode = value as 'creation' | 'import';
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('默认标签')
            .setDesc('批量导入的图片默认添加的标签，多标签可用逗号分隔。')
            .addText(text => text
                .setPlaceholder('inbox')
                .setValue(this.plugin.data.settings.batchImportDefaultTag)
                .onChange(async (value) => {
                    this.plugin.data.settings.batchImportDefaultTag = value;
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('默认文字')
            .setDesc('批量导入时的默认文字内容，留空则不添加文字。')
            .addTextArea(text => text
                .setPlaceholder('默认留空')
                .setValue(this.plugin.data.settings.batchImportDefaultText)
                .onChange(async (value) => {
                    this.plugin.data.settings.batchImportDefaultText = value;
                    await this.plugin.savePluginData();
                }));

        // ---- Speech To Text ----
        new Setting(containerEl)
            .setName('语音转文字')
            .setHeading();

        new Setting(containerEl)
            .setName('语音转文字接口')
            .setDesc('本地或局域网 HTTP 接口地址。插件会以 POST 原始音频二进制调用该接口。')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:8765/transcribe')
                .setValue(this.plugin.data.settings.sttEndpoint || '')
                .onChange(async (value) => {
                    this.plugin.data.settings.sttEndpoint = value.trim();
                    await this.plugin.savePluginData();
                }));

        new Setting(containerEl)
            .setName('保存录音后自动转写')
            .setDesc('开启后，新增含录音的记录会在后台自动调用接口生成文字。')
            .addToggle(toggle => toggle
                .setValue(!!this.plugin.data.settings.sttAutoTranscribe)
                .onChange(async (value) => {
                    this.plugin.data.settings.sttAutoTranscribe = value;
                    await this.plugin.savePluginData();
                }));

        // ---- Custom Tags ----
        new Setting(containerEl)
            .setName('🏷️ 自定义标签')
            .setHeading();
        containerEl.createEl('p', {
            text: '编辑常用生活标签，每个标签一行。',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('场景标签列表')
            .addTextArea(text => {
                text.inputEl.rows = 8;
                text.inputEl.cols = 40;
                text.setValue(this.plugin.data.settings.customTags.join('\n'));
                text.onChange(async (value) => {
                    this.plugin.data.settings.customTags = value.split('\n').map(t => t.trim()).filter(t => t);
                    await this.plugin.savePluginData();
                });
            });

        // ---- Data Stats ----
        new Setting(containerEl)
            .setName('📊 数据统计')
            .setHeading();
        const statsEl = containerEl.createDiv('life-settings-stats');

        const totalEntries = this.plugin.data.entries.length;
        const totalMedia = this.plugin.data.entries.reduce((sum, e) => sum + (e.images?.length || 0) + (e.videos?.length || 0) + (e.audios?.length || 0) + (e.files?.length || 0), 0);
        statsEl.appendText('共 ');
        statsEl.createEl('strong', { text: String(totalEntries) });
        statsEl.appendText(' 条记录，');
        statsEl.createEl('strong', { text: String(totalMedia) });
        statsEl.appendText(' 个媒体/文件');
    }
}
