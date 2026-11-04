import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    ScreenshotShareFacts,
    ScreenshotShareMessage,
    ScreenshotShareProgress,
    ScreenshotShareSendResult,
    ScreenshotShareTarget
} from '@/platform/tauri/bindings';
import type { AppToastOptions } from '@/services/toastService';
import { useScreenshotShareStore } from '@/state/screenshotShareStore';

const mocks = vi.hoisted(() => ({
    toast: vi.fn<(options: AppToastOptions) => void>(),
    appGetScreenshotShareFacts:
        vi.fn<(paths: string[]) => Promise<ScreenshotShareFacts[]>>(),
    appShareScreenshots:
        vi.fn<
            (
                targetId: string,
                messages: ScreenshotShareMessage[]
            ) => Promise<ScreenshotShareSendResult>
        >(),
    appGetScreenshotShareProgress:
        vi.fn<() => Promise<ScreenshotShareProgress>>(),
    appDeleteScreenshotShareRecord: vi.fn<(id: string) => Promise<null>>()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => mocks.toast(options),
        close: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetScreenshotShareFacts: mocks.appGetScreenshotShareFacts,
        appShareScreenshots: mocks.appShareScreenshots,
        appGetScreenshotShareProgress: mocks.appGetScreenshotShareProgress,
        appDeleteScreenshotShareRecord: mocks.appDeleteScreenshotShareRecord
    }
}));

const { screenshotShareErrorText, shareScreenshots } =
    await import('./screenshotShareService');

function target(id: string, overrides: Partial<ScreenshotShareTarget> = {}) {
    return {
        id,
        name: `Channel ${id}`,
        urlHint: '…abcd',
        fields: {
            world: true,
            time: false,
            playerCount: false,
            people: false,
            stay: false,
            spoiler: id === 'b',
            metadata: false,
            compression: 'high' as const,
            print: false
        },
        quick: true,
        invalid: false,
        ...overrides
    };
}

function record(id: string) {
    return {
        id,
        targetId: 'a',
        targetName: 'Channel a',
        messageUrl: null,
        sentAt: '2026-11-04T00:00:00Z',
        fileNames: ['a.png']
    };
}

describe('shareScreenshots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.appGetScreenshotShareFacts.mockResolvedValue([
            {
                path: 'a.png',
                worldId: 'wrld_a',
                worldName: 'World A',
                worldAuthorName: null,
                authorName: null,
                capturedAtMs: 1,
                people: [],
                playerCount: null,
                stay: null
            }
        ]);
        mocks.appGetScreenshotShareProgress.mockResolvedValue({
            running: false,
            processedFiles: 0,
            totalFiles: 0
        });
    });

    it('sends to each target with its own defaults and undoes every record', async () => {
        mocks.appShareScreenshots
            .mockResolvedValueOnce({
                records: [record('r1')],
                error: null,
                targetInvalid: false
            })
            .mockResolvedValueOnce({
                records: [record('r2')],
                error: null,
                targetInvalid: false
            });

        await shareScreenshots({
            paths: ['a.png'],
            targets: [target('a'), target('b')]
        });

        const sentMessages = mocks.appShareScreenshots.mock.calls.map(
            ([targetId, messages]) => [targetId, messages[0].spoiler]
        );
        expect(sentMessages).toEqual([
            ['a', false],
            ['b', true]
        ]);
        const undo = mocks.toast.mock.calls
            .map(([options]) => options)
            .find((options) => options.type === 'success')
            ?.actionProps?.onClick;
        expect(undo).toBeDefined();

        if (undo) {
            Reflect.apply(undo, undefined, [{}]);
        }
        await vi.waitFor(() =>
            expect(
                mocks.appDeleteScreenshotShareRecord.mock.calls.map(
                    ([id]) => id
                )
            ).toEqual(['r1', 'r2'])
        );
    });

    it('marks a rejected webhook invalid and reports the failure', async () => {
        useScreenshotShareStore.setState({
            targets: [target('a')],
            loaded: true
        });
        mocks.appShareScreenshots.mockResolvedValue({
            records: [],
            error: 'invalid',
            targetInvalid: true
        });

        await shareScreenshots({ paths: ['a.png'], targets: [target('a')] });

        expect(useScreenshotShareStore.getState().targets[0].invalid).toBe(
            true
        );
        const types = mocks.toast.mock.calls.map(([options]) => options.type);
        expect(types).toContain('error');
        expect(types).not.toContain('success');
    });

    it('reads the error code out of a wrapped command error', () => {
        expect(
            screenshotShareErrorText(
                'Tauri command failed: app__save_screenshot_share_target: invalid'
            )
        ).toBe('This webhook URL is wrong or the webhook was deleted');
        expect(screenshotShareErrorText('http500')).toBe(
            'Discord returned HTTP 500'
        );
        expect(screenshotShareErrorText('something else')).toBe(
            'something else'
        );
    });
});
