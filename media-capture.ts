import { App, Menu, Modal, Notice, setIcon } from 'obsidian';

export function prefersNativeCameraPicker(): boolean {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isTouchMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod/i.test(ua) || isTouchMac;
}

export function openImageSourceMenu(
    anchor: HTMLElement,
    chooseLibrary: () => void,
    takePhoto: () => void
) {
    const menu = new Menu();
    menu.addItem(item => {
        item.setTitle('选择图片');
        item.setIcon('images');
        item.onClick(chooseLibrary);
    });
    menu.addItem(item => {
        item.setTitle('随手拍');
        item.setIcon('camera');
        item.onClick(takePhoto);
    });
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 8, width: rect.width });
}

export class CameraCaptureModal extends Modal {
    private stream: MediaStream | null = null;
    private videoEl: HTMLVideoElement | null = null;

    constructor(
        app: App,
        private onCapture: (file: File) => Promise<void> | void,
        private fallback?: () => void
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('life-camera-modal');

        const hero = contentEl.createDiv('life-camera-hero');
        const badge = hero.createDiv('life-camera-badge');
        setIcon(badge, 'camera');
        const text = hero.createDiv('life-camera-title-wrap');
        text.createEl('h2', { text: '随手拍', cls: 'life-camera-title' });
        text.createDiv('life-camera-subtitle').setText('拍下当前画面，直接收进记录。');

        const preview = contentEl.createDiv('life-camera-preview');
        this.videoEl = preview.createEl('video', {
            attr: {
                autoplay: 'true',
                playsinline: 'true',
                muted: 'true'
            }
        });

        const actions = contentEl.createDiv('life-camera-actions');
        const cancelBtn = actions.createEl('button', { cls: 'life-camera-cancel', text: '取消' });
        const captureBtn = actions.createEl('button', { cls: 'life-camera-capture' });
        setIcon(captureBtn.createSpan('life-camera-capture-icon'), 'camera');
        captureBtn.createSpan().setText('拍照');

        cancelBtn.onclick = () => this.close();
        captureBtn.onclick = async () => this.capture();

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false
            });
            this.videoEl.srcObject = this.stream;
            await this.videoEl.play();
        } catch (err) {
            new Notice('无法打开摄像头，已切换为系统图片选择。');
            this.close();
            this.fallback?.();
        }
    }

    async capture() {
        if (!this.videoEl || !this.videoEl.videoWidth || !this.videoEl.videoHeight) {
            new Notice('摄像头画面尚未准备好。');
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.videoEl.videoWidth;
        canvas.height = this.videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!blob) {
            new Notice('拍照失败，请重试。');
            return;
        }

        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        await this.onCapture(file);
        this.close();
    }

    onClose() {
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.videoEl = null;
        this.contentEl.empty();
    }
}
