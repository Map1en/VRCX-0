import { describe, expect, it } from 'vitest';

import type {
    ScreenshotShareFacts,
    ScreenshotShareFields
} from '@/platform/tauri/bindings';

import {
    buildScreenshotShareMessages,
    SCREENSHOT_SHARE_MAX_PEOPLE,
    type ScreenshotShareText
} from './screenshotShareMessages';

const text: ScreenshotShareText = {
    playerCount: 'Players',
    people: 'With',
    stay: 'Stay',
    stayValue: (ms, ongoing) => `${ongoing ? '+' : ''}${ms}`,
    morePeople: (count) => `+${count}`
};

const allFields: ScreenshotShareFields = {
    world: true,
    time: true,
    playerCount: true,
    people: true,
    stay: true,
    spoiler: false,
    metadata: false,
    compression: 'high',
    print: false
};

function fact(
    path: string,
    overrides: Partial<ScreenshotShareFacts> = {}
): ScreenshotShareFacts {
    return {
        path,
        worldId: 'wrld_a',
        worldName: 'World A',
        worldAuthorName: null,
        authorName: null,
        capturedAtMs: 1_000_000,
        people: [],
        playerCount: null,
        stay: null,
        ...overrides
    };
}

describe('buildScreenshotShareMessages', () => {
    it('groups consecutive screenshots from the same world in capture order', () => {
        const messages = buildScreenshotShareMessages(
            [
                fact('b', { capturedAtMs: 3 }),
                fact('c', {
                    worldId: 'wrld_b',
                    worldName: 'World B',
                    capturedAtMs: 2
                }),
                fact('a', { capturedAtMs: 1 }),
                fact('d', { capturedAtMs: 4 })
            ],
            allFields,
            text
        );
        expect(messages.map((message) => message.paths)).toEqual([
            ['a'],
            ['c'],
            ['b', 'd']
        ]);
    });

    it('builds an embed from the chosen fields and leaves unknown facts out', () => {
        const [message] = buildScreenshotShareMessages(
            [
                fact('a', {
                    people: ['Alice', 'Bob'],
                    playerCount: 3,
                    stay: { ms: 600_000, ongoing: true }
                }),
                fact('b', { people: ['Bob', 'Carol'], playerCount: 5 })
            ],
            allFields,
            text
        );
        expect(message.content).toBe('');
        expect(message.embed).toEqual({
            title: 'World A',
            url: 'https://vrchat.com/home/world/wrld_a',
            timestamp: new Date(1_000_000).toISOString(),
            fields: [
                { name: 'Players', value: '5', inline: true },
                { name: 'Stay', value: '+600000', inline: true },
                { name: 'With', value: 'Alice, Bob, Carol', inline: false }
            ]
        });

        const [unknown] = buildScreenshotShareMessages(
            [fact('a', { worldName: null })],
            allFields,
            text
        );
        expect(unknown.embed).toBeNull();
        expect(unknown.content).toBe('<t:1000:f>');
    });

    it('sends bare images when every info field is off', () => {
        const [message] = buildScreenshotShareMessages(
            [fact('a', { people: ['Alice'], playerCount: 2 })],
            {
                ...allFields,
                world: false,
                time: false,
                playerCount: false,
                people: false,
                stay: false,
                spoiler: true,
                compression: 'standard'
            },
            text
        );
        expect(message).toEqual({
            paths: ['a'],
            content: '',
            embed: null,
            spoiler: true,
            metadata: false,
            compression: 'standard',
            printCaptions: []
        });
    });

    it('caps the people list', () => {
        const people = Array.from(
            { length: SCREENSHOT_SHARE_MAX_PEOPLE + 2 },
            (_, index) => `P${index}`
        );
        const [message] = buildScreenshotShareMessages(
            [fact('a', { people })],
            allFields,
            text
        );
        expect(message.embed?.fields.at(-1)?.value).toMatch(/ \+2$/);
    });
});
