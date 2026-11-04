import { describe, expect, it } from 'vitest';

import type {
    ChatboxConfig,
    ChatboxFormats,
    ChatboxPage,
    ChatboxPageLine,
    ChatboxStatus,
    ChatboxVariable
} from '@/platform/tauri/bindings';

import {
    applyChatboxPreset,
    chatboxCharCount,
    chatboxStatusLabelKey,
    insertAtCursor,
    moveChatboxLine,
    moveChatboxPage,
    secondsUntilNextPage,
    templateVariables,
    updateChatboxLine,
    updateChatboxPage
} from './chatboxConfig';

const FORMATS: ChatboxFormats = {
    hour12: false,
    showSeconds: false,
    cpuDecimals: 0,
    memory: 'percent',
    memoryDecimals: 0,
    memoryUnit: 'gb',
    mediaMaxChars: 0,
    gpuDecimals: 0,
    vram: 'percent',
    vramDecimals: 0,
    vramUnit: 'gb',
    temperatureUnit: 'celsius',
    progress: 'line'
};

const VARIABLES: ChatboxVariable[] = ['time', 'track', 'cpu', 'memory'];

function line(id: string, template = ''): ChatboxPageLine {
    return { id, template, formats: FORMATS };
}

function page(id: string, lines: ChatboxPageLine[] = []): ChatboxPage {
    return { id, enabled: true, seconds: 5, lines };
}

function config(pages: ChatboxPage[]): ChatboxConfig {
    return {
        statusEnabled: true,
        pages,
        afk: { text: '', showDuration: true, autoWhenHeadsetRemoved: true },
        messages: {
            typingIndicator: true,
            notifySound: false,
            quickPhrases: []
        },
        oscHost: '127.0.0.1',
        oscPort: 9000
    };
}

function status(overrides: Partial<ChatboxStatus> = {}): ChatboxStatus {
    return {
        activity: 'status',
        pauseReason: null,
        preview: 'hi',
        pageId: 'a',
        pageNumber: 1,
        pageCount: 2,
        pageDurationSeconds: 8,
        pageElapsedSeconds: 3,
        manualAfk: false,
        vrMode: false,
        ...overrides
    };
}

describe('chatbox config helpers', () => {
    it('moves a page to the position of the page it was dropped on', () => {
        const moved = moveChatboxPage(
            'a',
            'c'
        )(config([page('a'), page('b'), page('c')]));

        expect(moved.pages.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    });

    it('keeps the config when the drop target is unknown', () => {
        const original = config([page('a'), page('b')]);

        expect(moveChatboxPage('a', 'missing')(original)).toBe(original);
    });

    it('reorders lines inside one page only', () => {
        const start = config([
            page('a', [line('1'), line('2'), line('3')]),
            page('b', [line('x')])
        ]);

        const moved = moveChatboxLine('a', '3', '1')(start);

        expect(moved.pages[0].lines.map((entry) => entry.id)).toEqual([
            '3',
            '1',
            '2'
        ]);
        expect(moved.pages[1]).toBe(start.pages[1]);
    });

    it('applies sequential updates on top of each other', () => {
        const withText = updateChatboxLine('a', 'l1', (current) => ({
            ...current,
            template: 'hello'
        }));
        const withSeconds = updateChatboxPage('a', (current) => ({
            ...current,
            seconds: 12
        }));
        const start = config([page('a', [line('l1'), line('l2', '{time}')])]);

        const result = withSeconds(withText(start));

        expect(result.pages[0].seconds).toBe(12);
        expect(result.pages[0].lines).toEqual([
            line('l1', 'hello'),
            line('l2', '{time}')
        ]);
    });

    it('removes only the line with the matching id', () => {
        const start = config([page('a', [line('l1'), line('l2')])]);

        const result = updateChatboxLine('a', 'l1', () => null)(start);

        expect(result.pages[0].lines.map((entry) => entry.id)).toEqual(['l2']);
    });

    it('finds only the known variables a template uses', () => {
        expect(
            templateVariables(
                'CPU {cpu} · {nope}\n{memory} {cpu} { time }',
                VARIABLES
            )
        ).toEqual(new Set(['cpu', 'memory']));
    });

    it('inserts at the cursor and replaces the selection', () => {
        expect(insertAtCursor('CPU  RAM', '{cpu}', 4, 4)).toEqual({
            text: 'CPU {cpu} RAM',
            cursor: 9
        });
        expect(insertAtCursor('a XX b', '♪', 2, 4)).toEqual({
            text: 'a ♪ b',
            cursor: 3
        });
    });

    it('applies a preset template and merges only its formats', () => {
        const current = {
            ...line('l1', 'old'),
            formats: { ...FORMATS, hour12: true }
        };

        const next = applyChatboxPreset(
            current,
            {
                id: 'bar',
                template: () => 'RAM {memory}',
                formats: { memory: 'usedOfTotal' }
            },
            (preset) => preset.template((key) => key)
        );

        expect(next.template).toBe('RAM {memory}');
        expect(next.formats).toEqual({
            ...FORMATS,
            hour12: true,
            memory: 'usedOfTotal'
        });
    });

    it('counts characters the way the chatbox limit does', () => {
        expect(chatboxCharCount('あい😀')).toBe(3);
    });

    it('counts down to the next page from when the status arrived', () => {
        expect(secondsUntilNextPage(status(), 1_000, 3_500)).toBe(3);
        expect(secondsUntilNextPage(status(), 1_000, 60_000)).toBe(0);
    });

    it('has no countdown while paused, held, off or on a single page', () => {
        expect(
            secondsUntilNextPage(
                status({ pauseReason: 'gameNotRunning' }),
                0,
                0
            )
        ).toBeNull();
        expect(
            secondsUntilNextPage(status({ activity: 'manual' }), 0, 0)
        ).toBeNull();
        expect(secondsUntilNextPage(status({ pageCount: 1 }), 0, 0)).toBeNull();
    });

    it('labels a pause by its reason before the activity', () => {
        expect(chatboxStatusLabelKey(status({ pauseReason: 'isolated' }))).toBe(
            'view.tools.chatbox.status.isolated'
        );
        expect(chatboxStatusLabelKey(status({ activity: 'afk' }))).toBe(
            'view.tools.chatbox.status.afk'
        );
    });
});
