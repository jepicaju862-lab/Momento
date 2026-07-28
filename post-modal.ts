import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import ChildTimelinePlugin from './main';
import { TimelineEntry } from './settings';
import { CameraCaptureModal, openImageSourceMenu, prefersNativeCameraPicker } from './media-capture';

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.webm', '.ogg'];

function isVideoFile(name: string): boolean {
    const lower = name.toLowerCase();
    return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isAudioFile(name: string): boolean {
    const lower = name.toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isLikelyVoiceFile(name: string): boolean {
    return /(^|[/\\_-])(voice|audio|record|recording|录音)([/\\_.-]|$)/i.test(name);
}

function mediaKind(file: File): 'image' | 'video' | 'audio' | 'file' {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('video/')) return 'video';
    if (isLikelyVoiceFile(file.name) && isAudioFile(file.name)) return 'audio';
    if (isVideoFile(file.name)) return 'video';
    if (isAudioFile(file.name)) return 'audio';
    return 'file';
}

function createAudioRecorder(stream: MediaStream): MediaRecorder {
    const preferredTypes = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const supportedType = typeof MediaRecorder.isTypeSupported === 'function'
        ? preferredTypes.find(type => MediaRecorder.isTypeSupported(type))
        : undefined;
    return supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
}

async function recordedAudioFile(chunks: Blob[], recorder: MediaRecorder): Promise<{ file: File; buffer: ArrayBuffer }> {
    const rawType = recorder.mimeType || chunks.find(chunk => !!chunk.type)?.type || 'audio/webm';
    const mimeType = rawType.split(';')[0] || 'audio/webm';
    const extension = mimeType.includes('mpeg') || mimeType.includes('mp3')
        ? 'mp3'
        : mimeType.includes('mp4') || mimeType.includes('m4a')
            ? 'm4a'
            : mimeType.includes('ogg')
                ? 'ogg'
                : mimeType.includes('wav')
                    ? 'wav'
                    : 'webm';
    const blob = new Blob(chunks, { type: mimeType });
    return {
        file: new File([blob], `voice_${Date.now()}.${extension}`, { type: mimeType }),
        buffer: await blob.arrayBuffer(),
    };
}

function setCompactIcon(element: HTMLElement, icon: string) {
    element.empty();
    setIcon(element.createSpan('add-post-button-icon'), icon);
}

function formatAudioTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class AddPostModal extends Modal {
    plugin: ChildTimelinePlugin;
    date: string;
    childName: string;
    content: string;
    selectedFiles: { file: File, buffer: ArrayBuffer }[] = [];
    previewContainer: HTMLElement | null = null;
    onPostCreated: () => void;
    entryToEdit?: TimelineEntry;
    existingImages: string[] = [];
    existingVideos: string[] = [];
    existingAudios: string[] = [];
    existingFiles: string[] = [];
    tags: string[] = [];
    recorder: MediaRecorder | null = null;
    audioChunks: Blob[] = [];
    discardRecording = false;
    recordingTimer: number | null = null;
    previewUrls: string[] = [];

    constructor(app: App, plugin: ChildTimelinePlugin, onPostCreated: () => void, entryToEdit?: TimelineEntry) {
        super(app);
        this.plugin = plugin;
        this.onPostCreated = onPostCreated;
        this.entryToEdit = entryToEdit;

        if (entryToEdit) {
            this.date = entryToEdit.date;
            this.childName = entryToEdit.childName || '';
            this.content = entryToEdit.content || '';
            this.existingImages = [...(entryToEdit.images || [])];
            this.existingVideos = [...(entryToEdit.videos || [])];
            this.existingAudios = [...(entryToEdit.audios || [])];
            this.existingFiles = [...(entryToEdit.files || [])];
            this.tags = [...(entryToEdit.tags || [])];
        } else {
            const now = new Date();
            this.date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            this.childName = '';
            this.content = '';
            this.tags = [];
        }
    }

    onOpen() {
        this.discardRecording = false;
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('add-post-modal');

        const titleText = this.entryToEdit ? '编辑拾光记录' : '新增拾光记录';
        const hero = contentEl.createDiv('add-post-hero');
        const heroBadge = hero.createDiv('add-post-hero-badge');
        setIcon(heroBadge.createSpan('add-post-button-icon'), this.entryToEdit ? 'pencil' : 'plus');
        const heroText = hero.createDiv('add-post-hero-text');
        heroText.createEl('h2', { text: titleText, cls: 'add-post-modal-title' });
        heroText.createDiv('add-post-modal-subtitle').setText('先记录下来，稍后再整理。');

        // Date Picker
        const dateSetting = new Setting(contentEl)
            .setName('日期')
            .addText(text => {
                text.inputEl.type = 'date';
                text.setValue(this.date);
                text.onChange((value) => { this.date = value; });
            });
        dateSetting.settingEl.addClass('inline-setting', 'add-post-date-setting');

        // Scene Tags Picker
        const tagsSetting = new Setting(contentEl)
            .setName('标签')
            .setDesc('选择已有或输入新标签');
        tagsSetting.settingEl.addClass('add-post-tag-setting');

        tagsSetting.controlEl.style.flexDirection = 'column';
        tagsSetting.controlEl.style.alignItems = 'flex-end';
        tagsSetting.controlEl.style.width = '100%';

        const selectedTagsContainer = tagsSetting.controlEl.createDiv('add-post-selected-tags');
        
        const dropdownContainer = tagsSetting.controlEl.createDiv('add-post-tag-dropdown');
        
        const customInputContainer = tagsSetting.controlEl.createDiv('add-post-custom-tag-container');
        
        const availableTagsSet = new Set(this.plugin.data.settings.customTags || []);
        this.tags.forEach(t => availableTagsSet.add(t)); // Ensure current tags are shown

        // Dropdown for existing tags
        const selectEl = dropdownContainer.createEl('select', { cls: 'dropdown' });
        selectEl.createEl('option', { text: '标签', value: '' });
        availableTagsSet.forEach(t => {
            selectEl.createEl('option', { text: t, value: t });
        });
        selectEl.onchange = () => {
            const val = selectEl.value;
            if (val && !this.tags.includes(val)) {
                this.tags.push(val);
                renderSelectedTags();
            }
            selectEl.value = ''; // reset
        };
        
        const inputEl = customInputContainer.createEl('input', { attr: { type: 'text', placeholder: '新标签' } });
        const addTagBtn = customInputContainer.createEl('button', { attr: { title: '添加标签', 'aria-label': '添加标签' } });
        setCompactIcon(addTagBtn, 'plus');
        
        const renderSelectedTags = () => {
            selectedTagsContainer.empty();
            this.tags.forEach(t => {
                const chip = selectedTagsContainer.createDiv('add-post-tag-chip');
                chip.setText(t);
                const removeBtn = chip.createEl('button', { attr: { title: `移除 ${t}`, 'aria-label': `移除 ${t}` } });
                setCompactIcon(removeBtn, 'x');
                removeBtn.onclick = () => {
                    this.tags = this.tags.filter(item => item !== t);
                    renderSelectedTags();
                };
            });
        };
        renderSelectedTags(); // Initial render for selected tags

        const addCustomTag = () => {
            const val = inputEl.value.trim();
            if (val) {
                if (!availableTagsSet.has(val)) {
                    availableTagsSet.add(val);
                    selectEl.createEl('option', { text: val, value: val }); // add to dropdown
                }
                if (!this.tags.includes(val)) {
                    this.tags.push(val);
                }
                inputEl.value = '';
                renderSelectedTags();
            }
        };

        addTagBtn.onclick = addCustomTag;
        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomTag();
            }
        };
        
        // Ensure the setting control element stacks them vertically
        tagsSetting.controlEl.style.flexDirection = 'column';
        tagsSetting.controlEl.style.alignItems = 'flex-start';

        // Content Text Area
        const textAreaLabel = contentEl.createDiv('add-post-content-label');
        textAreaLabel.setText('内容');

        const textArea = contentEl.createEl('textarea', {
            cls: 'add-post-textarea add-post-content',
            attr: { placeholder: '写一条拾光记录...', rows: '6' }
        });
        textArea.value = this.content;
        textArea.addEventListener('input', () => { this.content = textArea.value; });

        // Support pasting images
        textArea.addEventListener('paste', async (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            let added = false;
            
            if (e.clipboardData.files.length > 0) {
                e.preventDefault();
                for (let i = 0; i < e.clipboardData.files.length; i++) {
                    const file = e.clipboardData.files[i];
                    if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/') || file.name) {
                        try {
                            const buffer = await file.arrayBuffer();
                            const ext = file.type.split('/')[1] || 'png';
                            const name = file.name === 'image.png' || !file.name ? `Pasted_Image_${Date.now()}_${i}.${ext}` : file.name;
                            const newFile = new File([buffer], name, { type: file.type });
                            this.selectedFiles.push({ file: newFile, buffer });
                            added = true;
                        } catch (err) {}
                    }
                }
            } else if (e.clipboardData.items.length > 0) {
                for (let i = 0; i < e.clipboardData.items.length; i++) {
                    const item = e.clipboardData.items[i];
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (file) {
                            try {
                                const buffer = await file.arrayBuffer();
                                const ext = file.type.split('/')[1] || 'png';
                                const name = `Pasted_Image_${Date.now()}_${i}.${ext}`;
                                const newFile = new File([buffer], name, { type: file.type });
                                this.selectedFiles.push({ file: newFile, buffer });
                                added = true;
                            } catch(err) {}
                        }
                    }
                }
            }

            if (!added) {
                const text = e.clipboardData.getData('text');
                if (text && text.length > 1000) {
                    if (text.startsWith('data:image/')) {
                        e.preventDefault();
                        try {
                            const matches = text.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
                            if (matches && matches.length === 3) {
                                const mime = matches[1];
                                const base64Data = matches[2];
                                const byteString = atob(base64Data);
                                const ab = new ArrayBuffer(byteString.length);
                                const ia = new Uint8Array(ab);
                                for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                const ext = mime.split('/')[1] || 'png';
                                const name = `Pasted_Base64_${Date.now()}.${ext}`;
                                const newFile = new File([ab], name, { type: mime });
                                this.selectedFiles.push({ file: newFile, buffer: ab });
                                added = true;
                            }
                        } catch (err) { console.error('Base64 parse error', err); }
                    } else if (!text.includes(' ') && text.length > 2000) {
                        e.preventDefault();
                        new Notice('已拦截乱码粘贴，如果是图片请使用下方+号添加');
                    }
                }
            }

            if (added) {
                this.renderPreviews();
            }
        });

        // Media Picker
        const mediaSection = contentEl.createDiv('add-post-img-section');
        const mediaHeader = mediaSection.createDiv('add-post-media-header');
        mediaHeader.createSpan('add-post-media-title').setText('资源');
        mediaHeader.createSpan('add-post-media-hint').setText('粘贴图片或添加附件');

        const mediaActions = mediaSection.createDiv('add-post-img-actions');

        const fileInput = mediaActions.createEl('input', {
            attr: {
                type: 'file',
                multiple: 'true'
            }
        });
        fileInput.style.display = 'none';

        const imageInput = mediaActions.createEl('input', {
            attr: {
                type: 'file',
                accept: 'image/*',
                multiple: 'true'
            }
        });
        imageInput.style.display = 'none';

        const cameraInput = mediaActions.createEl('input', {
            attr: {
                type: 'file',
                accept: 'image/*',
                capture: 'environment'
            }
        });
        cameraInput.style.display = 'none';

        const handleFiles = async (files: FileList | File[] | null) => {
            if (files) {
                for (const file of Array.from(files)) {
                    try {
                        const buffer = await file.arrayBuffer();
                        this.selectedFiles.push({ file, buffer });
                    } catch (e) {
                        new Notice('读取文件失败: ' + e);
                        console.error('File read error:', e);
                    }
                }
                this.renderPreviews();
            }
        };

        fileInput.addEventListener('change', async () => {
            await handleFiles(fileInput.files);
            fileInput.value = '';
        });
        imageInput.addEventListener('change', async () => {
            await handleFiles(imageInput.files);
            imageInput.value = '';
        });
        cameraInput.addEventListener('change', async () => {
            await handleFiles(cameraInput.files);
            cameraInput.value = '';
        });

        const attachBtn = mediaActions.createEl('button', { cls: 'add-post-media-btn', attr: { title: '添加附件', 'aria-label': '添加附件' } });
        setCompactIcon(attachBtn, 'paperclip');
        attachBtn.onclick = () => fileInput.click();

        const photoBtn = mediaActions.createEl('button', { cls: 'add-post-media-btn', attr: { title: '添加图片或随手拍', 'aria-label': '添加图片或随手拍' } });
        setCompactIcon(photoBtn, 'image');
        photoBtn.onclick = () => {
            const takePhoto = () => {
                if (prefersNativeCameraPicker() || !navigator.mediaDevices?.getUserMedia) {
                    cameraInput.click();
                    return;
                }
                new CameraCaptureModal(this.app, async file => {
                    await handleFiles([file]);
                }, () => cameraInput.click()).open();
            };
            openImageSourceMenu(photoBtn, () => imageInput.click(), takePhoto);
        };

        const recordBtn = mediaActions.createEl('button', { cls: 'add-post-media-btn', attr: { title: '开始录音', 'aria-label': '开始录音' } });
        setCompactIcon(recordBtn, 'mic');

        const recordingStatus = mediaSection.createDiv('add-post-recording-status is-hidden');
        recordingStatus.createSpan('add-post-recording-dot');
        const recordingLabel = recordingStatus.createSpan('add-post-recording-label');
        const recordingTime = recordingStatus.createSpan('add-post-recording-time');
        const clearRecordingTimer = () => {
            if (this.recordingTimer !== null) {
                window.clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
        };
        const showRecordingStatus = (label: string, elapsedMs: number, complete = false) => {
            recordingStatus.removeClass('is-hidden');
            recordingStatus.toggleClass('is-complete', complete);
            recordingLabel.setText(label);
            recordingTime.setText(formatAudioTime(elapsedMs / 1000));
        };
        recordBtn.onclick = async () => {
            if (this.recorder && this.recorder.state === 'recording') {
                this.recorder.stop();
                setCompactIcon(recordBtn, 'mic');
                recordBtn.setAttr('title', '开始录音');
                recordBtn.setAttr('aria-label', '开始录音');
                recordBtn.removeClass('is-recording');
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (this.discardRecording) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                this.audioChunks = [];
                this.recorder = createAudioRecorder(stream);
                const startedAt = Date.now();
                this.recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) this.audioChunks.push(event.data);
                };
                this.recorder.onstop = async () => {
                    clearRecordingTimer();
                    stream.getTracks().forEach(track => track.stop());
                    if (this.discardRecording) {
                        this.audioChunks = [];
                        return;
                    }
                    const recorded = await recordedAudioFile(this.audioChunks, this.recorder!);
                    this.selectedFiles.push(recorded);
                    showRecordingStatus('录音已加入', Date.now() - startedAt, true);
                    this.renderPreviews();
                };
                this.recorder.start();
                showRecordingStatus('正在录音', 0);
                clearRecordingTimer();
                this.recordingTimer = window.setInterval(() => showRecordingStatus('正在录音', Date.now() - startedAt), 200);
                setCompactIcon(recordBtn, 'square');
                recordBtn.setAttr('title', '停止录音');
                recordBtn.setAttr('aria-label', '停止录音');
                recordBtn.addClass('is-recording');
            } catch (err) {
                new Notice(`录音失败：${err}`);
            }
        };

        this.previewContainer = mediaSection.createDiv('add-post-img-previews');
        this.renderPreviews();

        // Footer
        const footer = contentEl.createDiv('add-post-footer');
        const saveBtnText = this.entryToEdit ? '✨ 更新记录' : '✨ 保存记录';
        const saveBtn = footer.createEl('button', { text: saveBtnText, cls: 'add-post-save-btn' });
        saveBtn.onclick = () => this.savePost();
        const cancelBtn = footer.createEl('button', { text: '取消', cls: 'add-post-cancel-btn' });
        cancelBtn.onclick = () => this.close();
    }

    renderPreviews() {
        if (!this.previewContainer) return;
        this.previewUrls.forEach(url => URL.revokeObjectURL(url));
        this.previewUrls = [];
        this.previewContainer.empty();

        const totalItems = this.existingImages.length + this.existingVideos.length + this.existingAudios.length + this.existingFiles.length + this.selectedFiles.length;
        this.previewContainer.toggleClass('is-empty', totalItems === 0);
        if (totalItems === 0) return;

        const header = this.previewContainer.createDiv('add-post-preview-header');
        header.createSpan().setText('已添加');
        header.createSpan('add-post-preview-count').setText(`${totalItems} 项`);
        const grid = this.previewContainer.createDiv('add-post-media-grid');
        const list = this.previewContainer.createDiv('add-post-media-list');

        const sourceForExisting = (name: string) => {
            const path = this.plugin.resolveMediaPath(name);
            const file = this.app.vault.getAbstractFileByPath(path);
            return file ? this.app.vault.getResourcePath(file as any) : path;
        };
        const titleFor = (name: string) => name.split('/').pop() || name;
        const removeButton = (wrapper: HTMLElement, onClick: () => void) => {
            const button = wrapper.createEl('button', { cls: 'add-post-img-remove', attr: { title: '移除', 'aria-label': '移除' } });
            setCompactIcon(button, 'x');
            button.onclick = (event) => {
                event.stopPropagation();
                onClick();
                this.renderPreviews();
            };
        };
        const renderVisual = (src: string, name: string, kind: 'image' | 'video', onRemove: () => void) => {
            const wrapper = grid.createDiv(`add-post-img-preview-item add-post-${kind}-preview`);
            if (kind === 'image') {
                const img = wrapper.createEl('img', { attr: { alt: titleFor(name) } });
                img.src = src;
            } else {
                const video = wrapper.createEl('video');
                video.src = src;
                video.muted = true;
                video.preload = 'metadata';
                const badge = wrapper.createSpan('add-post-video-badge');
                setIcon(badge, 'play');
            }
            wrapper.createSpan('add-post-preview-name').setText(titleFor(name));
            removeButton(wrapper, onRemove);
        };
        const renderAudio = (src: string, name: string, onRemove: () => void) => {
            const card = list.createDiv('add-post-audio-preview');
            const audio = card.createEl('audio');
            audio.src = src;
            audio.preload = 'metadata';
            const play = card.createEl('button', { cls: 'add-post-audio-play', attr: { title: '播放录音', 'aria-label': '播放录音' } });
            setCompactIcon(play, 'play');
            const body = card.createDiv('add-post-audio-body');
            body.createSpan('add-post-audio-name').setText(titleFor(name));
            const wave = body.createDiv('add-post-audio-wave');
            for (let i = 0; i < 18; i++) {
                const bar = wave.createSpan('add-post-audio-bar');
                bar.style.height = `${5 + ((i * 9) % 17)}px`;
                bar.style.setProperty('--preview-wave-delay', `${(i % 8) * 65}ms`);
            }
            const time = card.createSpan('add-post-audio-time');
            time.setText('0:00');
            const syncTime = () => {
                const duration = audio.duration || 0;
                time.setText(duration
                    ? `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`
                    : formatAudioTime(audio.currentTime));
            };
            play.onclick = async () => {
                if (audio.paused) {
                    try {
                        await audio.play();
                    } catch (err) {
                        new Notice(`无法播放录音：${err}`);
                    }
                } else {
                    audio.pause();
                }
            };
            audio.onplay = () => {
                setCompactIcon(play, 'pause');
                card.addClass('is-playing');
            };
            audio.onpause = audio.onended = () => {
                setCompactIcon(play, 'play');
                card.removeClass('is-playing');
            };
            audio.ontimeupdate = syncTime;
            audio.onloadedmetadata = syncTime;
            removeButton(card, onRemove);
        };
        const renderFile = (name: string, sizeText: string, onRemove: () => void) => {
            const row = list.createDiv('add-post-file-preview-item');
            setIcon(row.createSpan('add-post-file-icon'), 'paperclip');
            row.createSpan('add-post-file-name').setText(titleFor(name));
            row.createSpan('add-post-file-meta').setText(sizeText);
            removeButton(row, onRemove);
        };

        this.existingImages.forEach((name, index) => renderVisual(sourceForExisting(name), name, 'image', () => this.existingImages.splice(index, 1)));
        this.existingVideos.forEach((name, index) => renderVisual(sourceForExisting(name), name, 'video', () => this.existingVideos.splice(index, 1)));
        this.existingAudios.forEach((name, index) => renderAudio(sourceForExisting(name), name, () => this.existingAudios.splice(index, 1)));
        this.existingFiles.forEach((name, index) => renderFile(name, '已保存', () => this.existingFiles.splice(index, 1)));
        this.selectedFiles.forEach((item, index) => {
            const url = URL.createObjectURL(item.file);
            this.previewUrls.push(url);
            const kind = mediaKind(item.file);
            const remove = () => this.selectedFiles.splice(index, 1);
            if (kind === 'image' || kind === 'video') {
                renderVisual(url, item.file.name, kind, remove);
            } else if (kind === 'audio') {
                renderAudio(url, item.file.name, remove);
            } else {
                renderFile(item.file.name, formatFileSize(item.file.size), remove);
            }
        });
    }

    async savePost() {
        if (this.recorder && this.recorder.state === 'recording') {
            new Notice('请先停止录音再保存。');
            return;
        }
        if (!this.date) { new Notice('请选择日期'); return; }
        if (!this.content && this.selectedFiles.length === 0 && this.existingImages.length === 0 && this.existingVideos.length === 0 && this.existingAudios.length === 0 && this.existingFiles.length === 0) {
            new Notice('❌ 请输入内容或选择文件');
            return;
        }

        try {
            const imageNames: string[] = this.entryToEdit ? [...this.existingImages] : [];
            const videoNames: string[] = this.entryToEdit ? [...this.existingVideos] : [];
            const audioNames: string[] = this.entryToEdit ? [...this.existingAudios] : [];
            const fileNames: string[] = this.entryToEdit ? [...this.existingFiles] : [];

            for (const item of this.selectedFiles) {
                let safeName = this.sanitizeName(item.file.name);
                if (!safeName || !safeName.includes('.')) {
                    const ext = item.file.type ? item.file.type.split('/')[1] : 'jpg';
                    safeName = `capture_${Date.now()}.${ext}`;
                }
                const savedPath = await this.plugin.saveMediaBinary(safeName, item.buffer);

                const kind = mediaKind(item.file);
                if (kind === 'video') {
                    videoNames.push(savedPath);
                } else if (kind === 'image') {
                    imageNames.push(savedPath);
                } else if (kind === 'audio') {
                    audioNames.push(savedPath);
                } else {
                    fileNames.push(savedPath);
                }
            }

            if (this.entryToEdit) {
                const updatedEntry: TimelineEntry = {
                    ...this.entryToEdit,
                    date: this.date,
                    subjectName: undefined,
                    childName: '',
                    content: this.content,
                    images: imageNames,
                    videos: videoNames,
                    audios: audioNames,
                    files: fileNames,
                    audioTranscripts: this.entryToEdit.audioTranscripts || {},
                    tags: this.tags.length > 0 ? this.tags : undefined,
                };
                await this.plugin.updateEntry(updatedEntry);
                new Notice('✅ 记录已更新');
            } else {
                const entry: TimelineEntry = {
                    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    date: this.date,
                    subjectName: undefined,
                    childName: '',
                    content: this.content,
                    images: imageNames,
                    videos: videoNames,
                    audios: audioNames,
                    files: fileNames,
                    audioTranscripts: {},
                    likes: 0,
                    comments: [],
                    createdAt: Date.now(),
                    tags: this.tags.length > 0 ? this.tags : undefined,
                };
                await this.plugin.addEntry(entry);
                new Notice('✅ 记录已保存');
            }

            this.close();
            this.onPostCreated();
        } catch (err) {
            console.error('Failed to save post:', err);
            new Notice(`❌ 保存失败: ${err}`);
        }
    }

    sanitizeName(name: string): string {
        return name.replace(/[\\/:*?"<>|#\[\]]/g, '_');
    }

    onClose() {
        this.discardRecording = true;
        if (this.recordingTimer !== null) {
            window.clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        if (this.recorder && this.recorder.state === 'recording') {
            this.recorder.ondataavailable = null;
            this.recorder.onstop = null;
            this.recorder.stop();
        }
        this.recorder?.stream.getTracks().forEach(track => track.stop());
        this.audioChunks = [];
        this.selectedFiles = [];
        this.previewUrls.forEach(url => URL.revokeObjectURL(url));
        this.previewUrls = [];
        this.contentEl.empty();
    }
}
