import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invokeTauri: vi.fn()
}));

vi.mock('@/platform/tauri/invoke', () => ({
    invokeTauri: mocks.invokeTauri
}));

import { recordErrorLog } from './errorLogService';

function appendedEntry(text: string) {
    return ['app__append_error_log', { entry: expect.stringContaining(text) }];
}

describe('errorLogService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.invokeTauri.mockResolvedValue(null);
    });

    it('skips VRChat world fetch transport failures from the client error log', async () => {
        await recordErrorLog('rust:command', [
            'command: app__world_get',
            new Error(
                'Tauri command failed: app__world_get: error sending request for url (https://api.vrchat.cloud/api/1/worlds/wrld%5Fe42eb146%2D860d%2D469b%2D978e%2D8871cdcf85bf)'
            )
        ]);

        expect(mocks.invokeTauri).not.toHaveBeenCalled();
    });

    it('still records non-network command failures', async () => {
        await recordErrorLog('rust:command', [
            'command: app__world_get',
            new Error(
                'Tauri command failed: app__world_get: unexpected payload shape'
            )
        ]);

        expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);
        expect(mocks.invokeTauri).toHaveBeenCalledWith(
            ...appendedEntry('unexpected payload shape')
        );
    });

    it('records structured command diagnostics with the local error entry', async () => {
        const error = Object.assign(new Error('invalid snapshot'), {
            code: 'persistence_invalid_data',
            sqliteCategory: 'malformed'
        });

        await recordErrorLog('rust:command', [
            'command: app__profile_restore',
            error
        ]);

        expect(mocks.invokeTauri).toHaveBeenCalledWith(
            ...appendedEntry('code: persistence_invalid_data')
        );
        expect(mocks.invokeTauri).toHaveBeenCalledWith(
            ...appendedEntry('sqliteCategory: malformed')
        );
    });
});
