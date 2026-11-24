import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_SCREENSHOT_PRINT_OPTIONS,
    type ScreenshotPrintOptions,
    useScreenshotPrintOptionsStore
} from '@/state/screenshotPrintOptionsStore';

const mocks = vi.hoisted(() => ({
    getString: vi.fn(),
    setString: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: { getString: mocks.getString, setString: mocks.setString }
}));

const { loadScreenshotPrintOptions, saveScreenshotPrintOptions } =
    await import('./screenshotPrintService');

const CLASSIC: ScreenshotPrintOptions = {
    style: 'classic',
    people: 'names',
    playerCount: false,
    stay: false
};

describe('screenshot print options', () => {
    beforeEach(() => {
        mocks.getString.mockReset();
        mocks.setString.mockReset().mockResolvedValue(null);
        useScreenshotPrintOptionsStore.setState({
            options: DEFAULT_SCREENSHOT_PRINT_OPTIONS,
            loaded: false
        });
    });

    it('reads saved options once and serves later loads from the store', async () => {
        mocks.getString.mockResolvedValue(JSON.stringify(CLASSIC));

        await expect(loadScreenshotPrintOptions()).resolves.toEqual(CLASSIC);
        await expect(loadScreenshotPrintOptions()).resolves.toEqual(CLASSIC);

        expect(mocks.getString).toHaveBeenCalledOnce();
        expect(mocks.getString).toHaveBeenCalledWith(
            'VRCX_ScreenshotPrintOptions',
            ''
        );
        expect(useScreenshotPrintOptionsStore.getState()).toMatchObject({
            options: CLASSIC,
            loaded: true
        });
    });

    it('falls back to the defaults when nothing is saved', async () => {
        mocks.getString.mockResolvedValue('');

        await expect(loadScreenshotPrintOptions()).resolves.toBe(
            DEFAULT_SCREENSHOT_PRINT_OPTIONS
        );
        expect(useScreenshotPrintOptionsStore.getState().loaded).toBe(true);
    });

    it('stays unloaded when reading the config fails', async () => {
        mocks.getString.mockRejectedValue(new Error('IPC failed'));

        await expect(loadScreenshotPrintOptions()).rejects.toThrow(
            'IPC failed'
        );
        expect(useScreenshotPrintOptionsStore.getState().loaded).toBe(false);
    });

    it('applies saved options immediately and persists them as JSON', async () => {
        saveScreenshotPrintOptions(CLASSIC);

        expect(useScreenshotPrintOptionsStore.getState()).toMatchObject({
            options: CLASSIC,
            loaded: true
        });
        expect(mocks.setString).toHaveBeenCalledWith(
            'VRCX_ScreenshotPrintOptions',
            JSON.stringify(CLASSIC)
        );
        await expect(loadScreenshotPrintOptions()).resolves.toBe(CLASSIC);
        expect(mocks.getString).not.toHaveBeenCalled();
    });
});
