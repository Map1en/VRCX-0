import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastDismiss: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        info: mocks.toastInfo,
        success: mocks.toastSuccess,
        dismiss: mocks.toastDismiss
    }
}));

vi.mock('@/services/updateInstallService', () => ({
    UPDATE_AVAILABLE_TOAST_ID: 'vrcx-update-available',
    openOrInstallLatestAvailableUpdate: vi.fn()
}));

import {
    showUpdateAvailableToast,
    showUpdateReadyToast
} from './UpdateAvailableToastHost';

type UpdateLoopRelease = Parameters<
    typeof showUpdateAvailableToast
>[0]['latestUpdaterRelease'];

function updateRelease(
    overrides: Partial<UpdateLoopRelease> = {}
): UpdateLoopRelease {
    return {
        displayName: 'VRCX-0 2.7.0',
        tagName: 'v2.7.0',
        htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
        publishedAt: '2026-08-20T00:00:00.000Z',
        body: '',
        canonicalVersion: '2.7.0',
        displayVersion: '2.7.0',
        channel: 'stable',
        manifestUrl: '',
        target: '',
        updaterType: 'manual',
        currentVersion: '2.6.0',
        latestVersion: '2.7.0',
        title: 'VRCX-0 2.7.0',
        ...overrides
    };
}

describe('showUpdateAvailableToast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows a bottom-right update toast wired to the supplied update action', () => {
        const onUpdate = vi.fn();

        showUpdateAvailableToast({
            latestUpdaterRelease: updateRelease(),
            t: (key) => key,
            onUpdate
        });

        expect(mocks.toastInfo).toHaveBeenCalledWith(
            'service.background_maintenance.label.vrcx_update_available',
            expect.objectContaining({
                id: 'vrcx-update-available',
                description: '2.7.0',
                duration: Infinity,
                position: 'bottom-right',
                action: expect.objectContaining({
                    label: 'nav_menu.update'
                })
            })
        );

        const options = mocks.toastInfo.mock.calls[0][1];
        options.action.onClick();
        expect(onUpdate).toHaveBeenCalled();
    });

    it('shows a ready toast for a downloaded update without using the info toast', () => {
        const onUpdate = vi.fn();

        showUpdateReadyToast({
            latestUpdaterRelease: updateRelease({ updaterType: 'tauri' }),
            t: (key, values) =>
                values ? `${key}:${JSON.stringify(values)}` : key,
            onUpdate
        });

        expect(mocks.toastSuccess).toHaveBeenCalledWith(
            'dialog.vrcx_updater.ready_for_update:{"value":"2.7.0"}',
            expect.objectContaining({
                id: 'vrcx-update-available',
                duration: Infinity,
                position: 'bottom-right',
                action: expect.objectContaining({
                    label: 'nav_menu.update_downloaded'
                })
            })
        );
        expect(mocks.toastInfo).not.toHaveBeenCalled();

        const options = mocks.toastSuccess.mock.calls[0][1];
        expect(options.description).toBeUndefined();
        options.action.onClick();
        expect(onUpdate).toHaveBeenCalled();
    });
});
