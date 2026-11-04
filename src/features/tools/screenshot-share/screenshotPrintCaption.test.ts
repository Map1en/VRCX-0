import { describe, expect, it, vi } from 'vitest';

import type { ScreenshotShareFacts } from '@/platform/tauri/bindings';
import {
    DEFAULT_SCREENSHOT_PRINT_OPTIONS,
    type ScreenshotPrintOptions
} from '@/state/screenshotPrintOptionsStore';

import type { PrintContent, PrintText } from './screenshotPrintCaption';

vi.mock('@fontsource/noto-sans/latin-400.css', () => ({}));
vi.mock('@fontsource/noto-sans/latin-400-italic.css', () => ({}));
vi.mock('@fontsource/noto-sans/latin-500.css', () => ({}));
vi.mock('@/repositories/configRepository', () => ({ default: {} }));

const { layoutPrintCaption, PRINT_CAPTION, screenshotPrintText } =
    await import('./screenshotPrintCaption');

const measure = (value: string) => Array.from(value).length * 10;

const text: PrintText = {
    capturedBy: 'Captured by',
    byAuthor: (author) => `by ${author}`,
    withNames: (names, total) =>
        total > names.length
            ? `with ${names.join(', ')} +${total - names.length}`
            : `with ${names.join(', ')}`,
    withCount: (count) => `with ${count} others`,
    inRoom: (count) => `${count} in room`,
    stayed: () => 'stayed long'
};

const blank: PrintContent = { note: '', people: null };

const classic: ScreenshotPrintOptions = {
    ...DEFAULT_SCREENSHOT_PRINT_OPTIONS,
    style: 'classic'
};

const modern = DEFAULT_SCREENSHOT_PRINT_OPTIONS;

function fact(
    overrides: Partial<ScreenshotShareFacts> = {}
): ScreenshotShareFacts {
    return {
        path: 'a.png',
        worldId: 'wrld_a',
        worldName: 'World',
        worldAuthorName: 'Maker',
        authorName: 'Me',
        capturedAtMs: new Date(2024, 11, 7, 21, 5).getTime(),
        people: ['Akari', 'Momo', 'Ren', 'Sora'],
        playerCount: 12,
        stay: null,
        ...overrides
    };
}

function layout(
    value: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent = blank
) {
    return layoutPrintCaption(value, options, content, text, measure);
}

function texts(ops: ReturnType<typeof layout>): string[] {
    return ops.flatMap((op) => {
        if (op.kind === 'text') {
            return [op.text];
        }
        return op.kind === 'icon' ? [`[${op.icon}]`] : ['|'];
    });
}

describe('layoutPrintCaption classic', () => {
    it('keeps the official caption layout and adds our extras above it', () => {
        const ops = layout(fact(), classic);
        expect(texts(ops)).toEqual([
            'Captured by',
            '[user]',
            'Me',
            '[calendar]',
            '12/07/2024',
            '[pin]',
            'World',
            ' ',
            'by Maker',
            'with 4 others',
            '12 in room'
        ]);
        expect(ops[0]).toMatchObject({ x: PRINT_CAPTION.left });
        const maker = ops.find(
            (op) => op.kind === 'text' && op.text === 'by Maker'
        );
        expect(maker?.kind === 'text' && maker.x + measure(maker.text)).toBe(
            PRINT_CAPTION.right
        );
    });

    it('centers the note', () => {
        const ops = layout(fact(), classic, {
            note: 'Good night',
            people: null
        });
        expect(ops[0]).toMatchObject({
            text: 'Good night',
            x: PRINT_CAPTION.width / 2,
            align: 'center'
        });
    });

    it('truncates the world name first when the two sides would collide', () => {
        const ops = layout(fact({ worldName: 'W'.repeat(400) }), classic);
        const world = ops.find(
            (op) => op.kind === 'text' && op.text.startsWith('W')
        );
        expect(world?.kind === 'text' && world.text.endsWith('…')).toBe(true);
    });
});

describe('layoutPrintCaption modern', () => {
    it('puts the world on the left and the people on the right of a divider', () => {
        const ops = layout(
            fact({ stay: { ms: 7_800_000, ongoing: false } }),
            modern
        );
        expect(texts(ops)).toEqual([
            'World',
            'by Maker · 2024.12.07 21:05 · stayed long',
            '|',
            'Me',
            'with 4 others · 12 in room'
        ]);
        const name = ops.find((op) => op.kind === 'text' && op.text === 'Me');
        expect(name?.kind === 'text' && name.x + measure('Me')).toBe(
            PRINT_CAPTION.right
        );
    });

    it('falls back to the date as the title and drops what is unknown', () => {
        const ops = layout(
            fact({
                worldName: null,
                worldAuthorName: null,
                authorName: null,
                people: [],
                playerCount: null
            }),
            modern
        );
        expect(texts(ops)).toEqual(['2024.12.07 21:05']);
    });

    it('names only the chosen people and shows the rest as a count', () => {
        const names: ScreenshotPrintOptions = { ...modern, people: 'names' };
        expect(
            texts(layout(fact(), names, { note: '', people: ['Momo', 'Sora'] }))
        ).toContain('with Momo, Sora · 12 in room');
        expect(texts(layout(fact(), names))).toContain(
            'with Akari, Momo, Ren +1 · 12 in room'
        );
        expect(
            texts(layout(fact(), names, { note: '', people: [] }))
        ).toContain('12 in room');
    });
});

describe('screenshotPrintText', () => {
    it('words the frame text from the locale', () => {
        const english = screenshotPrintText();
        expect(english.withCount(1)).toBe('with 1 other');
        expect(english.withCount(4)).toBe('with 4 others');
        expect(english.withNames(['A', 'B', 'C'], 5)).toBe('with A, B, C +2');
        expect(english.byAuthor('Maker')).toBe('by Maker');
        expect(english.inRoom(12)).toBe('12 in room');
    });
});
