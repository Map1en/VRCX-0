import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appAppendErrorLog: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import { recordErrorLog } from './errorLogService';

describe('errorLogService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appAppendErrorLog.mockResolvedValue(null);
    });

    it('skips VRChat world fetch transport failures from the client error log', async () => {
        await recordErrorLog('rust:command', [
            'command: app__vrchat_world_get',
            new Error(
                'Tauri command failed: app__vrchat_world_get: error sending request for url (https://api.vrchat.cloud/api/1/worlds/wrld%5Fe42eb146%2D860d%2D469b%2D978e%2D8871cdcf85bf)'
            )
        ]);

        expect(commandMocks.appAppendErrorLog).not.toHaveBeenCalled();
    });

    it('still records non-network command failures', async () => {
        await recordErrorLog('rust:command', [
            'command: app__vrchat_world_get',
            new Error(
                'Tauri command failed: app__vrchat_world_get: unexpected payload shape'
            )
        ]);

        expect(commandMocks.appAppendErrorLog).toHaveBeenCalledTimes(1);
        expect(commandMocks.appAppendErrorLog).toHaveBeenCalledWith(
            expect.stringContaining('unexpected payload shape')
        );
    });
});
