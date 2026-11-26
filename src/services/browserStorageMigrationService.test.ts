import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: new Map<string, string>(),
    profileFile: new Map<string, string>()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getRawValue: vi.fn(
            async (key: string) => mocks.config.get(key) ?? null
        ),
        remove: vi.fn(async (key: string) => {
            mocks.config.delete(key);
            return 1;
        })
    }
}));

vi.mock('@/repositories/storageRepository', () => ({
    default: {
        getString: vi.fn(
            async (key: string, fallback: string | null) =>
                mocks.profileFile.get(key) ?? fallback
        ),
        remove: vi.fn(async (key: string) => {
            mocks.profileFile.delete(key);
        })
    }
}));

import { STORAGE_KEYS, readStoredText } from '@/lib/browserStorage';

import { moveLayoutPreferencesToBrowserStorage } from './browserStorageMigrationService';

describe('moveLayoutPreferencesToBrowserStorage', () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.config.clear();
        mocks.profileFile.clear();
    });

    it('moves layout values out of the database and the profile file', async () => {
        mocks.config.set('VRCX_navPanelWidth', '320');
        mocks.config.set('VRCX_FavoritesWorldSplitter', '180');
        mocks.config.set('MutualGraphEdgeCurvature', '0.25');
        mocks.config.set('VRCX_themeColor', 'blue');
        mocks.profileFile.set('tool:vrchatLog:prefs', '{"searchQuery":"x"}');
        mocks.profileFile.set('VRCX_CloseToTray', 'true');

        await moveLayoutPreferencesToBrowserStorage();

        expect(readStoredText(STORAGE_KEYS.navPanelWidth)).toBe('320');
        expect(readStoredText(STORAGE_KEYS.favoritesWorldSplitter)).toBe('180');
        expect(readStoredText(STORAGE_KEYS.mutualGraphEdgeCurvature)).toBe(
            '0.25'
        );
        expect(readStoredText(STORAGE_KEYS.vrchatLogViewerPrefs)).toBe(
            '{"searchQuery":"x"}'
        );
        expect([...mocks.config.entries()]).toEqual([
            ['VRCX_themeColor', 'blue']
        ]);
        expect([...mocks.profileFile.entries()]).toEqual([
            ['VRCX_CloseToTray', 'true']
        ]);
    });

    it('leaves browser storage untouched when nothing was stored before', async () => {
        localStorage.setItem(STORAGE_KEYS.navPanelWidth, '300');

        await moveLayoutPreferencesToBrowserStorage();

        expect(readStoredText(STORAGE_KEYS.navPanelWidth)).toBe('300');
        expect(readStoredText(STORAGE_KEYS.favoritesFriendDensity)).toBeNull();
    });
});
