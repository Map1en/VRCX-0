// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands, type ClipboardImage } from '@/platform/tauri/bindings';
import type { AppToastOptions } from '@/services/toastService';

const mediaMocks = vi.hoisted(() => ({
    equipProfileDecoration: vi.fn(),
    getFileList: vi.fn(),
    collectInventoryItems: vi.fn(),
    unequipProfileDecoration: vi.fn()
}));

const maintenanceMocks = vi.hoisted(() => ({
    refreshCurrentUser: vi.fn()
}));

const modalMocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    openImagePreview: vi.fn(),
    prompt: vi.fn()
}));

const runtimeState = vi.hoisted(() => ({
    auth: {
        currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
        currentUserId: 'usr_self',
        currentUserSnapshot: {},
        currentUserWebsocket: 'wss://pipeline.vrchat.cloud'
    }
}));

const toastMocks = vi.hoisted(() => ({
    error: vi.fn(),
    success: vi.fn()
}));

vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: mediaMocks
}));
vi.mock('@tauri-apps/api/webview', () => ({
    getCurrentWebview: () => ({
        onDragDropEvent: async () => () => {}
    })
}));
vi.mock('@/services/backgroundMaintenanceSessionService', () => ({
    refreshCurrentUser: maintenanceMocks.refreshCurrentUser
}));
vi.mock('@/state/modalStore', () => ({
    useModalStore: (selector: (state: typeof modalMocks) => unknown) =>
        selector(modalMocks)
}));
vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: Object.assign(
        (selector: (state: typeof runtimeState) => unknown) =>
            selector(runtimeState),
        {
            getState: () => runtimeState
        }
    )
}));
vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return toastMocks.error(options);
                case 'success':
                    return toastMocks.success(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

import { useInventoryPageState } from './useInventoryPageState';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('useInventoryPageState', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        runtimeState.auth.currentUserEndpoint =
            'https://api.vrchat.cloud/api/1';
        runtimeState.auth.currentUserId = 'usr_self';
        runtimeState.auth.currentUserSnapshot = {};
        runtimeState.auth.currentUserWebsocket = 'wss://pipeline.vrchat.cloud';
        mediaMocks.getFileList.mockResolvedValue({ json: [] });
        mediaMocks.collectInventoryItems.mockResolvedValue({
            items: [],
            truncated: false
        });
        mediaMocks.equipProfileDecoration.mockResolvedValue({
            json: { ok: true }
        });
        mediaMocks.unequipProfileDecoration.mockResolvedValue({
            json: 'OK'
        });
        maintenanceMocks.refreshCurrentUser.mockResolvedValue({
            id: 'usr_self'
        });
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it.each(['emojis', 'stickers'] as const)(
        'opens the existing crop workflow for a clipboard image in %s',
        async (target) => {
            runtimeState.auth.currentUserSnapshot = { $isVRCPlus: true };
            vi.spyOn(commands, 'appReadClipboardImage').mockResolvedValue({
                fileName: 'clipboard.png',
                mimeType: 'image/png',
                dataBase64: btoa('image')
            });
            const { result } = renderHook(() => useInventoryPageState());

            await act(async () => {
                await result.current.pasteClipboardUpload(target);
            });

            expect(result.current.cropRequest).toEqual(
                expect.objectContaining({
                    target,
                    aspectRatio: 1,
                    file: expect.any(File),
                    authTarget: {
                        userId: 'usr_self',
                        endpoint: 'https://api.vrchat.cloud/api/1',
                        websocket: 'wss://pipeline.vrchat.cloud'
                    }
                })
            );
            expect(result.current.cropRequest?.file.name).toBe('clipboard.png');
            expect(result.current.cropRequest?.file.type).toBe('image/png');
        }
    );

    it('ignores a clipboard image returned after switching accounts', async () => {
        runtimeState.auth.currentUserSnapshot = { $isVRCPlus: true };
        const clipboard = deferred<ClipboardImage | null>();
        vi.spyOn(commands, 'appReadClipboardImage').mockReturnValue(
            clipboard.promise
        );
        const { result, rerender } = renderHook(() => useInventoryPageState());
        let pendingPaste!: Promise<void>;
        act(() => {
            pendingPaste = result.current.pasteClipboardUpload('stickers');
        });
        runtimeState.auth.currentUserId = 'usr_other';
        rerender();
        await act(async () => {
            clipboard.resolve({
                fileName: 'clipboard.png',
                mimeType: 'image/png',
                dataBase64: btoa('image')
            });
            await pendingPaste;
        });
        expect(result.current.cropRequest).toBeNull();
    });

    it('ignores another clipboard paste while one is still reading', async () => {
        runtimeState.auth.currentUserSnapshot = { $isVRCPlus: true };
        const clipboard = deferred<ClipboardImage | null>();
        const readClipboard = vi
            .spyOn(commands, 'appReadClipboardImage')
            .mockReturnValue(clipboard.promise);
        const { result } = renderHook(() => useInventoryPageState());
        let pendingPaste!: Promise<void>;
        act(() => {
            pendingPaste = result.current.pasteClipboardUpload('emojis');
        });
        expect(result.current.clipboardPasting).toBe(true);
        await act(async () => {
            await result.current.pasteClipboardUpload('stickers');
        });
        expect(readClipboard).toHaveBeenCalledOnce();

        await act(async () => {
            clipboard.resolve({
                fileName: 'clipboard.png',
                mimeType: 'image/png',
                dataBase64: btoa('image')
            });
            await pendingPaste;
        });
        expect(result.current.clipboardPasting).toBe(false);
        expect(result.current.cropRequest?.target).toBe('emojis');
    });

    it('equips a profile decoration, refreshes its scope, and refreshes the self profile', async () => {
        const { result } = renderHook(() => useInventoryPageState());
        const item = {
            id: 'inv_frame',
            holderId: 'usr_self',
            itemType: 'iconFrame',
            equipSlot: '',
            equipSlots: ['iconFrame'],
            flags: ['equippable']
        };

        await act(async () => {
            await result.current.setProfileDecorationEquipped(item);
        });

        expect(mediaMocks.equipProfileDecoration).toHaveBeenCalledWith({
            expectedUserId: 'usr_self',
            inventoryId: 'inv_frame',
            equipSlot: 'iconFrame'
        });
        expect(mediaMocks.collectInventoryItems).toHaveBeenCalledWith({
            types: ['iconFrame', 'profileEffect', 'nameplateEffect'],
            notFlags: ['ugc'],
            archived: false
        });
        expect(maintenanceMocks.refreshCurrentUser).toHaveBeenCalledWith({
            expectedUserId: 'usr_self',
            expectedEndpoint: 'https://api.vrchat.cloud/api/1',
            expectedWebsocket: 'wss://pipeline.vrchat.cloud'
        });
        expect(toastMocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'dialog.inventory.equipped_success'
            })
        );
    });

    it('unequips an active profile decoration by slot', async () => {
        const { result } = renderHook(() => useInventoryPageState());

        await act(async () => {
            await result.current.setProfileDecorationEquipped({
                id: 'inv_effect',
                holderId: 'usr_self',
                itemType: 'profileEffect',
                equipSlot: 'profileEffect',
                equipSlots: ['profileEffect'],
                flags: ['equippable']
            });
        });

        expect(mediaMocks.unequipProfileDecoration).toHaveBeenCalledWith({
            expectedUserId: 'usr_self',
            equipSlot: 'profileEffect'
        });
        expect(mediaMocks.equipProfileDecoration).not.toHaveBeenCalled();
        expect(toastMocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'dialog.inventory.unequipped_success'
            })
        );
    });

    it('clears rows when the websocket auth target changes before the new request resolves', async () => {
        const nextRows = deferred<{ json: unknown[] }>();
        mediaMocks.getFileList
            .mockResolvedValueOnce({
                json: [{ id: 'file_from_old_target' }]
            })
            .mockResolvedValueOnce({ json: [] })
            .mockReturnValue(nextRows.promise);
        const { result, rerender } = renderHook(() => useInventoryPageState());

        await waitFor(() => {
            expect(result.current.rowsByScope['emojis:custom']).toEqual([
                { id: 'file_from_old_target' }
            ]);
        });

        runtimeState.auth.currentUserWebsocket =
            'wss://pipeline-alt.vrchat.cloud';
        rerender();

        await waitFor(() => {
            expect(result.current.rowsByScope).toEqual({});
        });

        await act(async () => {
            nextRows.resolve({ json: [] });
        });
        await waitFor(() => {
            expect(result.current.loadingByScope['emojis:custom']).toBe(false);
        });
    });

    it('does not restore rows from a request owned by the previous auth target', async () => {
        const staleRows = deferred<{ json: unknown[] }>();
        mediaMocks.getFileList
            .mockResolvedValueOnce({ json: [] })
            .mockResolvedValueOnce({ json: [] })
            .mockReturnValueOnce(staleRows.promise)
            .mockResolvedValue({ json: [] });
        const { result, rerender } = renderHook(() => useInventoryPageState());
        await waitFor(() => {
            expect(mediaMocks.getFileList).toHaveBeenCalledTimes(2);
        });

        let refreshPromise: Promise<void> | undefined;
        act(() => {
            refreshPromise = result.current.refreshScope('emojis', 'custom');
        });
        await waitFor(() => {
            expect(mediaMocks.getFileList).toHaveBeenCalledTimes(3);
        });

        runtimeState.auth.currentUserId = '';
        runtimeState.auth.currentUserWebsocket = '';
        rerender();
        staleRows.resolve({
            json: [{ id: 'file_from_stale_request' }]
        });
        await act(async () => {
            await refreshPromise;
        });

        expect(result.current.rowsByScope).toEqual({});
    });

    it('does not refresh or toast after a mutation changes auth owner', async () => {
        const mutation = deferred<{ json: { ok: boolean } }>();
        mediaMocks.equipProfileDecoration.mockReturnValueOnce(mutation.promise);
        const { result, rerender } = renderHook(() => useInventoryPageState());
        const item = {
            id: 'inv_frame',
            holderId: 'usr_self',
            itemType: 'iconFrame',
            equipSlot: '',
            equipSlots: ['iconFrame'],
            flags: ['equippable']
        };

        let mutationPromise: Promise<void> | undefined;
        act(() => {
            mutationPromise = result.current.setProfileDecorationEquipped(item);
        });
        await waitFor(() => {
            expect(mediaMocks.equipProfileDecoration).toHaveBeenCalledOnce();
        });

        runtimeState.auth.currentUserId = 'usr_other';
        runtimeState.auth.currentUserWebsocket =
            'wss://pipeline-other.vrchat.cloud';
        rerender();
        mutation.resolve({ json: { ok: true } });
        await act(async () => {
            await mutationPromise;
        });

        expect(mediaMocks.collectInventoryItems).not.toHaveBeenCalled();
        expect(maintenanceMocks.refreshCurrentUser).not.toHaveBeenCalled();
        expect(toastMocks.success).not.toHaveBeenCalled();
    });

    it('rejects a stale card action before sending a mutation for the new auth target', async () => {
        const { result } = renderHook(() => useInventoryPageState());
        const staleAction = result.current.setProfileDecorationEquipped;

        runtimeState.auth.currentUserId = 'usr_other';
        runtimeState.auth.currentUserWebsocket =
            'wss://pipeline-other.vrchat.cloud';
        await act(async () => {
            await staleAction({
                id: 'inv_without_holder_projection',
                itemType: 'iconFrame',
                equipSlot: '',
                equipSlots: ['iconFrame'],
                flags: ['equippable']
            });
        });

        expect(mediaMocks.equipProfileDecoration).not.toHaveBeenCalled();
        expect(mediaMocks.unequipProfileDecoration).not.toHaveBeenCalled();
    });

    it('serializes profile decoration mutations until refresh completes', async () => {
        const firstMutation = deferred<{
            json: { ok: boolean };
        }>();
        mediaMocks.equipProfileDecoration.mockReturnValueOnce(
            firstMutation.promise
        );
        const { result } = renderHook(() => useInventoryPageState());
        const firstItem = {
            id: 'inv_frame_a',
            holderId: 'usr_self',
            itemType: 'iconFrame',
            equipSlot: '',
            equipSlots: ['iconFrame'],
            flags: ['equippable']
        };
        const secondItem = {
            ...firstItem,
            id: 'inv_frame_b'
        };

        let pendingMutation: Promise<void> | undefined;
        act(() => {
            pendingMutation =
                result.current.setProfileDecorationEquipped(firstItem);
        });
        await waitFor(() => {
            expect(mediaMocks.equipProfileDecoration).toHaveBeenCalledOnce();
        });

        await act(async () => {
            await result.current.setProfileDecorationEquipped(secondItem);
        });
        expect(mediaMocks.equipProfileDecoration).toHaveBeenCalledOnce();

        firstMutation.resolve({ json: { ok: true } });
        await act(async () => {
            await pendingMutation;
        });

        await act(async () => {
            await result.current.setProfileDecorationEquipped(secondItem);
        });
        expect(mediaMocks.equipProfileDecoration).toHaveBeenCalledTimes(2);
        expect(mediaMocks.equipProfileDecoration).toHaveBeenLastCalledWith({
            expectedUserId: 'usr_self',
            inventoryId: 'inv_frame_b',
            equipSlot: 'iconFrame'
        });
    });

    it('does not report a successful write as failed when self refresh rejects', async () => {
        maintenanceMocks.refreshCurrentUser.mockRejectedValueOnce(
            new Error('refresh failed')
        );
        const { result } = renderHook(() => useInventoryPageState());

        await act(async () => {
            await result.current.setProfileDecorationEquipped({
                id: 'inv_frame',
                holderId: 'usr_self',
                itemType: 'iconFrame',
                equipSlot: '',
                equipSlots: ['iconFrame'],
                flags: ['equippable']
            });
        });

        expect(toastMocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'dialog.inventory.equipped_success'
            })
        );
        expect(toastMocks.error).not.toHaveBeenCalled();
    });
});
