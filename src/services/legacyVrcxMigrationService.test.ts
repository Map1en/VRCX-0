import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appGetLegacyVrcxForceMigrationStatus: vi.fn(),
    appIsLegacyVrcxRunning: vi.fn(),
    appRequestLegacyVrcxForceMigration: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import { promptLegacyVrcxForceMigration } from './legacyVrcxMigrationService';

function createPromptOptions() {
    return {
        alert: vi.fn(),
        confirm: vi.fn(),
        t: vi.fn((key: string, params?: Record<string, unknown>) =>
            params?.error
                ? `${key}:${String(params.error)}`
                : params?.path
                  ? `${key}:${String(params.path)}`
                  : key
        ),
        toast: { add: vi.fn() }
    };
}

describe('legacyVrcxMigrationService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appGetLegacyVrcxForceMigrationStatus.mockResolvedValue({
            available: true,
            dbPath: 'C:/Users/Example/AppData/Roaming/VRCX/VRCX.sqlite3'
        });
        commandMocks.appIsLegacyVrcxRunning.mockResolvedValue(false);
        commandMocks.appRequestLegacyVrcxForceMigration.mockResolvedValue(true);
    });

    it('shows an error when the force-migration status command fails', async () => {
        const options = createPromptOptions();
        commandMocks.appGetLegacyVrcxForceMigrationStatus.mockRejectedValueOnce(
            new Error('status failed')
        );

        await promptLegacyVrcxForceMigration(options);

        expect(options.alert).toHaveBeenCalledWith({
            title: 'view.settings.advanced.advanced.database_cleanup.legacy_migration',
            description:
                'view.settings.advanced.advanced.database_cleanup.legacy_migration_failed:status failed',
            confirmText: 'common.actions.close'
        });
        expect(options.toast.add).not.toHaveBeenCalled();
        expect(options.confirm).not.toHaveBeenCalled();
    });

    it('shows the unavailable reason without opening confirmation', async () => {
        const options = createPromptOptions();
        commandMocks.appGetLegacyVrcxForceMigrationStatus.mockResolvedValueOnce(
            {
                available: false,
                reason: 'Legacy DB is too new.'
            }
        );

        await promptLegacyVrcxForceMigration(options);

        expect(options.alert).toHaveBeenCalledWith(
            expect.objectContaining({
                description: 'Legacy DB is too new.'
            })
        );
        expect(options.confirm).not.toHaveBeenCalled();
    });

    it('does not request migration when confirmation is cancelled', async () => {
        const options = createPromptOptions();
        options.confirm.mockResolvedValueOnce({
            ok: false
        });

        await promptLegacyVrcxForceMigration(options);

        expect(options.confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                destructive: true,
                description:
                    'view.settings.advanced.advanced.database_cleanup.legacy_migration_confirm_description:C:/Users/Example/AppData/Roaming/VRCX/VRCX.sqlite3'
            })
        );
        expect(
            commandMocks.appRequestLegacyVrcxForceMigration
        ).not.toHaveBeenCalled();
    });

    it('warns when a confirmed force migration writes the flag but does not restart', async () => {
        const options = createPromptOptions();
        options.confirm.mockResolvedValueOnce({
            ok: true
        });
        commandMocks.appRequestLegacyVrcxForceMigration.mockResolvedValueOnce(
            false
        );

        await promptLegacyVrcxForceMigration(options);

        expect(
            commandMocks.appRequestLegacyVrcxForceMigration
        ).toHaveBeenCalledWith(false);
        expect(options.toast.add).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'warning',
                title: 'view.settings.advanced.advanced.database_cleanup.legacy_migration_restart_manually'
            })
        );
    });

    it('reports request failures with the thrown error message', async () => {
        const options = createPromptOptions();
        options.confirm.mockResolvedValueOnce({
            ok: true
        });
        commandMocks.appRequestLegacyVrcxForceMigration.mockRejectedValueOnce(
            new Error('request failed')
        );

        await promptLegacyVrcxForceMigration(options);

        expect(options.alert).toHaveBeenCalledWith(
            expect.objectContaining({
                description:
                    'view.settings.advanced.advanced.database_cleanup.legacy_migration_failed:request failed'
            })
        );
    });

    it('retries the process check after the user closes original VRCX', async () => {
        const options = createPromptOptions();
        options.confirm.mockResolvedValueOnce({ ok: true });
        options.alert.mockResolvedValueOnce({
            ok: true,
            reason: 'alternative'
        });
        commandMocks.appIsLegacyVrcxRunning
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        await promptLegacyVrcxForceMigration(options);

        expect(options.alert).toHaveBeenCalledWith({
            title: 'message.database.legacy_vrcx_running_title',
            description: 'message.database.legacy_vrcx_running_description',
            confirmText: 'message.database.legacy_vrcx_force_migration',
            alternativeText: 'message.database.legacy_vrcx_check_again',
            dismissible: false,
            destructive: true
        });
        expect(commandMocks.appIsLegacyVrcxRunning).toHaveBeenCalledTimes(2);
        expect(
            commandMocks.appRequestLegacyVrcxForceMigration
        ).toHaveBeenCalledWith(false);
    });

    it('allows force migration while original VRCX is still running', async () => {
        const options = createPromptOptions();
        options.confirm.mockResolvedValueOnce({ ok: true });
        options.alert.mockResolvedValueOnce({ ok: true, reason: 'ok' });
        commandMocks.appIsLegacyVrcxRunning.mockResolvedValueOnce(true);

        await promptLegacyVrcxForceMigration(options);

        expect(commandMocks.appIsLegacyVrcxRunning).toHaveBeenCalledOnce();
        expect(
            commandMocks.appRequestLegacyVrcxForceMigration
        ).toHaveBeenCalledWith(true);
    });

    it('does not authorize force migration when the process alert is replaced', async () => {
        const options = createPromptOptions();
        options.confirm.mockResolvedValueOnce({ ok: true });
        options.alert.mockResolvedValueOnce({
            ok: false,
            reason: 'replaced'
        });
        commandMocks.appIsLegacyVrcxRunning.mockResolvedValueOnce(true);

        await promptLegacyVrcxForceMigration(options);

        expect(
            commandMocks.appRequestLegacyVrcxForceMigration
        ).toHaveBeenCalledWith(false);
    });
});
