import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    ScreenshotShareTarget,
    ScreenshotShareTargetInput
} from '@/platform/tauri/bindings';
import { useScreenshotShareStore } from '@/state/screenshotShareStore';

const mocks = vi.hoisted(() => ({
    getTargets: vi.fn(),
    saveTarget: vi.fn(),
    deleteTarget: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetScreenshotShareTargets: mocks.getTargets,
        appSaveScreenshotShareTarget: mocks.saveTarget,
        appDeleteScreenshotShareTarget: mocks.deleteTarget
    }
}));

const {
    deleteScreenshotShareTarget,
    loadScreenshotShareTargets,
    saveScreenshotShareTarget
} = await import('./screenshotShareService');

function target(
    id: string,
    overrides: Partial<ScreenshotShareTarget> = {}
): ScreenshotShareTarget {
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
            spoiler: false,
            metadata: false,
            compression: 'high',
            print: false
        },
        quick: false,
        invalid: false,
        ...overrides
    };
}

function input(id: string | null): ScreenshotShareTargetInput {
    const { fields, quick } = target(id ?? 'new');
    return { id, name: 'Renamed', url: null, fields, quick };
}

describe('screenshot share targets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useScreenshotShareStore.setState({
            targets: [],
            loaded: false,
            sending: false
        });
    });

    it('loads targets into the store and marks them loaded', async () => {
        const targets = [target('a'), target('b')];
        mocks.getTargets.mockResolvedValue(targets);

        await expect(loadScreenshotShareTargets()).resolves.toBe(targets);

        expect(useScreenshotShareStore.getState()).toMatchObject({
            targets,
            loaded: true
        });
    });

    it('leaves the store unloaded when loading fails', async () => {
        mocks.getTargets.mockRejectedValue(new Error('IPC failed'));

        await expect(loadScreenshotShareTargets()).rejects.toThrow(
            'IPC failed'
        );

        expect(useScreenshotShareStore.getState()).toMatchObject({
            targets: [],
            loaded: false
        });
    });

    it('replaces a saved target in place and appends a new one', async () => {
        useScreenshotShareStore.setState({
            targets: [target('a'), target('b')]
        });
        const renamed = target('a', { name: 'Renamed' });
        const created = target('c');
        mocks.saveTarget
            .mockResolvedValueOnce(renamed)
            .mockResolvedValueOnce(created);

        await expect(saveScreenshotShareTarget(input('a'))).resolves.toBe(
            renamed
        );
        await expect(saveScreenshotShareTarget(input(null))).resolves.toBe(
            created
        );

        expect(mocks.saveTarget).toHaveBeenNthCalledWith(1, input('a'));
        expect(useScreenshotShareStore.getState().targets).toEqual([
            renamed,
            target('b'),
            created
        ]);
    });

    it('keeps targets unchanged when saving fails', async () => {
        useScreenshotShareStore.setState({ targets: [target('a')] });
        mocks.saveTarget.mockRejectedValue(new Error('invalid'));

        await expect(saveScreenshotShareTarget(input('a'))).rejects.toThrow(
            'invalid'
        );

        expect(useScreenshotShareStore.getState().targets).toEqual([
            target('a')
        ]);
    });

    it('drops a target only after the backend deletes it', async () => {
        useScreenshotShareStore.setState({
            targets: [target('a'), target('b')]
        });
        mocks.deleteTarget
            .mockRejectedValueOnce(new Error('IPC failed'))
            .mockResolvedValueOnce(null);

        await expect(deleteScreenshotShareTarget('a')).rejects.toThrow(
            'IPC failed'
        );
        expect(useScreenshotShareStore.getState().targets).toHaveLength(2);

        await deleteScreenshotShareTarget('a');

        expect(mocks.deleteTarget).toHaveBeenLastCalledWith('a');
        expect(useScreenshotShareStore.getState().targets).toEqual([
            target('b')
        ]);
    });
});
