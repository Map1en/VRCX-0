// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    confirm: vi.fn(),
    deleteAllCache: vi.fn(),
    getCacheSize: vi.fn()
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        assetBundleDeleteAllCache: mocks.deleteAllCache,
        assetBundleGetCacheSize: mocks.getCacheSize
    }
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openExternalLink: vi.fn(),
    openFolderSelectorDialog: vi.fn(),
    readVrchatConfigFileSafe: vi.fn(() => Promise.resolve('{}')),
    vrchatCacheLocationWouldChange: vi.fn(),
    writeVrchatConfigFile: vi.fn(),
    writeVrchatConfigFileWithCacheCleanup: vi.fn()
}));

import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { VRChatConfigDialog } from './VRChatConfigDialog';

describe('VRChatConfigDialog cache cleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useModalStore.setState({ confirm: mocks.confirm });
        mocks.confirm.mockResolvedValue({ ok: true, reason: 'ok' });
        mocks.getCacheSize.mockResolvedValue(45 * 1024 ** 3);
        mocks.deleteAllCache.mockResolvedValue(undefined);
    });

    afterEach(cleanup);

    it('refuses to delete the whole cache while VRChat is running', async () => {
        useRuntimeStore.getState().setGameState({ isGameRunning: true });
        render(<VRChatConfigDialog open onOpenChange={vi.fn()} />);
        const button = await screen.findByRole('button', {
            name: 'dialog.config_json.delete_cache'
        });
        await waitFor(() => expect(button).toHaveProperty('disabled', false));

        fireEvent.click(button);

        await waitFor(() =>
            expect(mocks.toastError).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'dialog.config_json.close_vrchat_before_cleanup'
                })
            )
        );
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(mocks.deleteAllCache).not.toHaveBeenCalled();
    });

    it('deletes the whole cache after confirmation while VRChat is closed', async () => {
        render(<VRChatConfigDialog open onOpenChange={vi.fn()} />);
        const button = await screen.findByRole('button', {
            name: 'dialog.config_json.delete_cache'
        });
        await waitFor(() => expect(button).toHaveProperty('disabled', false));

        fireEvent.click(button);

        await waitFor(() => expect(mocks.deleteAllCache).toHaveBeenCalled());
        expect(mocks.confirm).toHaveBeenCalled();
    });
});
