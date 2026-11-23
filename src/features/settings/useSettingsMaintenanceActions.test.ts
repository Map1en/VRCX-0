import { describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import { createSettingsMaintenanceActions } from './useSettingsMaintenanceActions';

const shellMocks = vi.hoisted(() => ({
    deleteAllScreenshotMetadata: vi.fn(async () => undefined)
}));

vi.mock('@/services/shellIntegrationService', async (importOriginal) => ({
    ...(await importOriginal<
        typeof import('@/services/shellIntegrationService')
    >()),
    deleteAllScreenshotMetadata: shellMocks.deleteAllScreenshotMetadata
}));

function createMaintenanceActions({
    cleanupAvatarFeedHistory = async () => ({
        deletedRows: 0,
        status: 'completed' as const,
        optimizationError: null
    }),
    confirm,
    isGameRunning = false,
    setGameLogPersistenceDisabledPreference = async () => undefined,
    setFeedPersistenceDisabledPreference = async () => undefined,
    setPurgeDialogOpen = () => undefined,
    toastWarning = () => undefined,
    toastError = () => undefined
}: {
    cleanupAvatarFeedHistory?: () => Promise<{
        deletedRows: number;
        status: 'completed' | 'optimizationFailed';
        optimizationError: string | null;
    }>;
    confirm: (options: {
        title: string;
        description: string;
    }) => Promise<{ ok: boolean }>;
    isGameRunning?: boolean;
    setGameLogPersistenceDisabledPreference?: (
        disabled: boolean
    ) => Promise<void>;
    setFeedPersistenceDisabledPreference?: (disabled: boolean) => Promise<void>;
    setPurgeDialogOpen?: (open: boolean) => void;
    toastWarning?: (options: AppToastOptions) => void;
    toastError?: (options: AppToastOptions) => void;
}) {
    const prefs = createDefaultSettingsPrefs();
    return createSettingsMaintenanceActions({
        alert: async () => ({ ok: true, reason: 'ok' }),
        cleanupAvatarFeedHistory,
        commit: async () => true,
        confirm,
        gameState: {
            isGameRunning
        },
        cropAllPrints: async () => null,
        getUgcPhotoLocation: async () => '',
        prefs: {
            ...prefs,
            notificationTTS: 'Never'
        },
        prompt: async () => ({ ok: false }),
        purgePeriod: '180',
        savePreferenceValue: async (_key, _value, action) => {
            await action();
            return true;
        },
        saveStringPreference: async () => undefined,
        setAppDataDirState: () => undefined,
        setCropInstancePrintsPreference: async () => undefined,
        setGameLogPersistenceDisabledPreference,
        setFeedPersistenceDisabledPreference,
        setIntConfigPreference: async () => 0,
        setPrefs: () => undefined,
        setPurgeDialogOpen,
        setPurgeInProgress: () => undefined,
        setUserGeneratedContentPathPreference: async () => '',
        speakNotificationTts: async () => undefined,
        t: (key) => key,
        toast: {
            add: (options: AppToastOptions) => {
                switch (options.type) {
                    case 'warning':
                        return toastWarning(options);
                    case 'error':
                        return toastError(options);
                    default:
                        throw new Error(
                            'Unhandled toast type: ' + options.type
                        );
                }
            }
        }
    });
}

describe('handleGameLogDisabledChange', () => {
    it('keeps GameLog enabled when disabling is not confirmed', async () => {
        const confirm = vi.fn(async () => ({ ok: false }));
        const setGameLogPersistenceDisabledPreference = vi.fn(
            async () => undefined
        );
        const actions = createMaintenanceActions({
            confirm,
            setGameLogPersistenceDisabledPreference
        });

        await actions.handleGameLogDisabledChange(true);

        expect(confirm).toHaveBeenCalledOnce();
        expect(setGameLogPersistenceDisabledPreference).not.toHaveBeenCalled();
    });

    it('enables GameLog without showing the disable confirmation', async () => {
        const confirm = vi.fn(async () => ({ ok: false }));
        const setGameLogPersistenceDisabledPreference = vi.fn(
            async () => undefined
        );
        const actions = createMaintenanceActions({
            confirm,
            setGameLogPersistenceDisabledPreference
        });

        await actions.handleGameLogDisabledChange(false);

        expect(confirm).not.toHaveBeenCalled();
        expect(setGameLogPersistenceDisabledPreference).toHaveBeenCalledWith(
            false
        );
    });

    it('rejects changes while VRChat is running', async () => {
        const confirm = vi.fn(async () => ({ ok: true }));
        const setGameLogPersistenceDisabledPreference = vi.fn(
            async () => undefined
        );
        const toastError = vi.fn();
        const actions = createMaintenanceActions({
            confirm,
            isGameRunning: true,
            setGameLogPersistenceDisabledPreference,
            toastError
        });

        await actions.handleGameLogDisabledChange(true);

        expect(confirm).not.toHaveBeenCalled();
        expect(setGameLogPersistenceDisabledPreference).not.toHaveBeenCalled();
        expect(toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                title: 'message.gamelog.vrchat_must_be_closed'
            })
        );
    });
});

describe('handleFeedPersistenceDisabledChange', () => {
    it('keeps Feed history enabled when disabling is not confirmed', async () => {
        const setFeedPersistenceDisabledPreference = vi.fn(
            async () => undefined
        );
        const actions = createMaintenanceActions({
            confirm: async () => ({ ok: false }),
            setFeedPersistenceDisabledPreference
        });

        await actions.handleFeedPersistenceDisabledChange(true);

        expect(setFeedPersistenceDisabledPreference).not.toHaveBeenCalled();
    });

    it('can switch Feed persistence while VRChat is running', async () => {
        const setFeedPersistenceDisabledPreference = vi.fn(
            async () => undefined
        );
        const actions = createMaintenanceActions({
            confirm: async () => ({ ok: true }),
            isGameRunning: true,
            setFeedPersistenceDisabledPreference
        });

        await actions.handleFeedPersistenceDisabledChange(true);

        expect(setFeedPersistenceDisabledPreference).toHaveBeenCalledWith(true);
    });
});

describe('deleteAllScreenshotMetadata', () => {
    it('reports a failed metadata clear instead of claiming success', async () => {
        shellMocks.deleteAllScreenshotMetadata.mockRejectedValueOnce(
            new Error('clear screenshot cache: disk I/O error')
        );
        const toastError = vi.fn();
        const actions = createMaintenanceActions({
            confirm: async () => ({ ok: true }),
            toastError
        });

        await actions.deleteAllScreenshotMetadata();

        expect(toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                title: 'clear screenshot cache: disk I/O error'
            })
        );
    });
});

describe('purgeAvatarFeedData', () => {
    it('reports a completed purge separately from a failed optimization', async () => {
        const setPurgeDialogOpen = vi.fn();
        const toastWarning = vi.fn();
        const actions = createMaintenanceActions({
            cleanupAvatarFeedHistory: async () => ({
                deletedRows: 12,
                status: 'optimizationFailed',
                optimizationError: 'vacuum failed'
            }),
            confirm: async () => ({ ok: false }),
            setPurgeDialogOpen,
            toastWarning
        });

        await actions.purgeAvatarFeedData();

        expect(setPurgeDialogOpen).toHaveBeenCalledWith(false);
        expect(toastWarning).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'warning',
                title: 'view.settings.advanced.advanced.database_cleanup.purge_optimization_failed'
            })
        );
    });
});
