import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastDismiss: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'info':
                    return mocks.toastInfo(options);
                case 'success':
                    return mocks.toastSuccess(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        },
        close: mocks.toastDismiss
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
            expect.objectContaining({
                type: 'info',
                title: 'service.background_maintenance.label.vrcx_update_available',
                id: 'vrcx-update-available',
                description: '2.7.0',
                timeout: 0,
                position: 'bottom-right',
                actionProps: expect.objectContaining({
                    children: 'nav_menu.update'
                })
            })
        );

        const options = mocks.toastInfo.mock.calls[0][0];
        options.actionProps.onClick();
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
            expect.objectContaining({
                type: 'success',
                title: 'dialog.vrcx_updater.ready_for_update:{"value":"2.7.0"}',
                id: 'vrcx-update-available',
                timeout: 0,
                position: 'bottom-right',
                actionProps: expect.objectContaining({
                    children: 'nav_menu.update'
                })
            })
        );
        expect(mocks.toastInfo).not.toHaveBeenCalled();

        const options = mocks.toastSuccess.mock.calls[0][0];
        expect(options.description).toBeUndefined();
        options.actionProps.onClick();
        expect(onUpdate).toHaveBeenCalled();
    });
});
