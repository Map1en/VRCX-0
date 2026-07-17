import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appConfigSetValues: vi.fn(),
    appConfigListValues: vi.fn(),
    appConfigRemoveValue: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import { ConfigKeys } from './configKeys';
import { ConfigRepository } from './configRepository';

function createRepository() {
    return new ConfigRepository();
}

describe('ConfigRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appConfigSetValues.mockResolvedValue(undefined);
        commandMocks.appConfigListValues.mockResolvedValue([]);
        commandMocks.appConfigRemoveValue.mockResolvedValue(undefined);
    });

    it('loads tuple and object rows into the cache and resolves VRCX config keys', async () => {
        commandMocks.appConfigListValues.mockResolvedValueOnce([
            ['config:vrcx_thememode', 'dark'],
            {
                key: 'config:vrcx_logresourceload',
                value: 'true'
            },
            {
                key: 'config:vrcx_savedcredentials',
                value: '{"ok":true}'
            }
        ]);
        const repository = createRepository();

        await expect(repository.getString('VRCX_ThemeMode')).resolves.toBe(
            'dark'
        );
        await expect(repository.getBool('logResourceLoad')).resolves.toBe(true);
        await expect(repository.getObject('savedCredentials')).resolves.toEqual(
            {
                ok: true
            }
        );
        expect(commandMocks.appConfigSetValues).toHaveBeenCalledWith([]);
        expect(commandMocks.appConfigListValues).toHaveBeenCalledTimes(1);
    });

    it('uses explicit fallbacks before schema defaults for missing values', async () => {
        const repository = createRepository();

        await expect(
            repository.getString('unknownKey', 'fallback')
        ).resolves.toBe('fallback');
        await expect(repository.getInt('maxTableSize_v2')).resolves.toBe(500);
        await expect(repository.getBool('autoUpdateVRCX', true)).resolves.toBe(
            true
        );
    });

    it('keeps hidden VR friends panel keys out of the config schema', () => {
        expect(ConfigKeys).not.toHaveProperty('vrOverlayPanelEnabled');
        expect(ConfigKeys).not.toHaveProperty(
            'vrOverlayPanelAllFriendsIncludesFavorites'
        );
    });

    it('does not write hidden VR friends panel keys into config storage', async () => {
        const repository = createRepository();

        await repository.setBool('vrOverlayPanelEnabled', false);
        await repository.setMany([
            ['vrOverlayPanelAllFriendsIncludesFavorites', false],
            ['ThemeMode', 'dark']
        ]);

        expect(commandMocks.appConfigSetValues).toHaveBeenNthCalledWith(1, []);
        expect(commandMocks.appConfigSetValues).toHaveBeenNthCalledWith(2, [
            {
                key: 'config:vrcx_thememode',
                value: 'dark'
            }
        ]);
        expect(commandMocks.appConfigSetValues).toHaveBeenCalledTimes(2);
        await expect(
            repository.getRawValue('vrOverlayPanelEnabled')
        ).resolves.toBeNull();
        await expect(
            repository.getRawValue('vrOverlayPanelAllFriendsIncludesFavorites')
        ).resolves.toBeNull();
    });

    it('updates the cache after set, setMany, and remove operations', async () => {
        const repository = createRepository();

        await repository.setString('VRCX_ThemeMode', 'light');
        await expect(repository.getString('ThemeMode')).resolves.toBe('light');

        await repository.setMany([
            ['VRCX_ZoomLevel', 125],
            ['config:vrcx_custom', 'value']
        ]);
        await expect(repository.getInt('ZoomLevel')).resolves.toBe(125);
        await expect(repository.getString('config:vrcx_custom')).resolves.toBe(
            'value'
        );

        await repository.remove('ThemeMode');
        await expect(repository.getRawValue('ThemeMode')).resolves.toBeNull();

        expect(commandMocks.appConfigSetValues).toHaveBeenNthCalledWith(2, [
            {
                key: 'config:vrcx_thememode',
                value: 'light'
            }
        ]);
        expect(commandMocks.appConfigSetValues).toHaveBeenNthCalledWith(3, [
            {
                key: 'config:vrcx_zoomlevel',
                value: '125'
            },
            {
                key: 'config:vrcx_custom',
                value: 'value'
            }
        ]);
        expect(commandMocks.appConfigRemoveValue).toHaveBeenCalledWith(
            'config:vrcx_thememode'
        );
    });

    it('returns JSON fallbacks for invalid object and array values', async () => {
        commandMocks.appConfigListValues.mockResolvedValueOnce([
            ['config:vrcx_savedcredentials', '{bad-json'],
            ['config:vrcx_sidebarfavoritegroups', '{"not":"array"}']
        ]);
        const repository = createRepository();

        await expect(
            repository.getObject('savedCredentials', { fallback: true })
        ).resolves.toEqual({
            fallback: true
        });
        await expect(
            repository.getArray('sidebarFavoriteGroups', ['fallback'])
        ).resolves.toEqual(['fallback']);
    });
});
