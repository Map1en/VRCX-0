import type {
    ChatboxConfig,
    ChatboxFormats,
    ChatboxPage,
    ChatboxPageLine,
    ChatboxStatus,
    ChatboxVariable
} from '@/platform/tauri/bindings';

import type { ChatboxPreset } from './chatboxPresets';

export type ChatboxConfigUpdate = (config: ChatboxConfig) => ChatboxConfig;
export type ChatboxLineUpdate = (
    line: ChatboxPageLine
) => ChatboxPageLine | null;

export const CHATBOX_VARIABLE_LABEL_KEYS: Record<ChatboxVariable, string> = {
    time: 'view.tools.chatbox.variables.time',
    track: 'view.tools.chatbox.variables.track',
    title: 'view.tools.chatbox.variables.title',
    artist: 'view.tools.chatbox.variables.artist',
    album: 'view.tools.chatbox.variables.album',
    progress: 'view.tools.chatbox.variables.progress',
    position: 'view.tools.chatbox.variables.position',
    duration: 'view.tools.chatbox.variables.duration',
    cpu: 'view.tools.chatbox.variables.cpu',
    memory: 'view.tools.chatbox.variables.memory',
    gpu: 'view.tools.chatbox.variables.gpu',
    vram: 'view.tools.chatbox.variables.vram',
    gputemp: 'view.tools.chatbox.variables.gputemp',
    session: 'view.tools.chatbox.variables.session'
};

export function createChatboxLine(
    defaultFormats: ChatboxFormats,
    preset: ChatboxPreset | null,
    renderPreset: (preset: ChatboxPreset) => string
): ChatboxPageLine {
    return {
        id: crypto.randomUUID(),
        template: preset ? renderPreset(preset) : '',
        formats: { ...defaultFormats, ...preset?.formats }
    };
}

export function applyChatboxPreset(
    line: ChatboxPageLine,
    preset: ChatboxPreset,
    renderPreset: (preset: ChatboxPreset) => string
): ChatboxPageLine {
    return {
        ...line,
        template: renderPreset(preset),
        formats: { ...line.formats, ...preset.formats }
    };
}

export function createChatboxPage(): ChatboxPage {
    return { id: crypto.randomUUID(), enabled: true, seconds: 8, lines: [] };
}

export function templateVariables(
    template: string,
    known: ChatboxVariable[]
): Set<ChatboxVariable> {
    const found = new Set<ChatboxVariable>();
    for (const match of template.matchAll(/\{([a-zA-Z]+)\}/g)) {
        const variable = known.find((candidate) => candidate === match[1]);
        if (variable) {
            found.add(variable);
        }
    }
    return found;
}

export function insertAtCursor(
    text: string,
    insertion: string,
    selectionStart: number,
    selectionEnd: number
): { text: string; cursor: number } {
    return {
        text:
            text.slice(0, selectionStart) +
            insertion +
            text.slice(selectionEnd),
        cursor: selectionStart + insertion.length
    };
}

export function chatboxCharCount(text: string): number {
    return Array.from(text).length;
}

export function updateChatboxPage(
    pageId: string,
    update: (page: ChatboxPage) => ChatboxPage
): ChatboxConfigUpdate {
    return (config) => ({
        ...config,
        pages: config.pages.map((page) =>
            page.id === pageId ? update(page) : page
        )
    });
}

export function updateChatboxLine(
    pageId: string,
    lineId: string,
    update: ChatboxLineUpdate
): ChatboxConfigUpdate {
    return updateChatboxPage(pageId, (page) => ({
        ...page,
        lines: page.lines.flatMap((line) => {
            if (line.id !== lineId) {
                return [line];
            }
            const next = update(line);
            return next ? [next] : [];
        })
    }));
}

function moveById<T extends { id: string }>(
    items: T[],
    activeId: string,
    overId: string
): T[] | null {
    const from = items.findIndex((item) => item.id === activeId);
    const to = items.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0 || from === to) {
        return null;
    }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

export function moveChatboxPage(
    activeId: string,
    overId: string
): ChatboxConfigUpdate {
    return (config) => {
        const pages = moveById(config.pages, activeId, overId);
        return pages ? { ...config, pages } : config;
    };
}

export function moveChatboxLine(
    pageId: string,
    activeId: string,
    overId: string
): ChatboxConfigUpdate {
    return updateChatboxPage(pageId, (page) => {
        const lines = moveById(page.lines, activeId, overId);
        return lines ? { ...page, lines } : page;
    });
}

export function chatboxStatusLabelKey(status: ChatboxStatus): string {
    if (status.pauseReason === 'isolated') {
        return 'view.tools.chatbox.status.isolated';
    }
    if (status.pauseReason === 'gameNotRunning') {
        return 'view.tools.chatbox.status.game_not_running';
    }
    switch (status.activity) {
        case 'off':
            return 'view.tools.chatbox.status.off';
        case 'status':
            return 'view.tools.chatbox.status.showing';
        case 'manual':
            return 'view.tools.chatbox.status.manual';
        case 'afk':
            return 'view.tools.chatbox.status.afk';
    }
}

export function secondsUntilNextPage(
    status: ChatboxStatus,
    receivedAt: number,
    now: number
): number | null {
    if (
        status.activity !== 'status' ||
        status.pageCount < 2 ||
        status.pauseReason !== null ||
        status.pageDurationSeconds === null ||
        status.pageElapsedSeconds === null
    ) {
        return null;
    }
    const elapsed =
        status.pageElapsedSeconds + Math.floor((now - receivedAt) / 1000);
    return Math.max(0, status.pageDurationSeconds - elapsed);
}
