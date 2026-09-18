import { describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import type { GalleryInventoryActionDeps } from './galleryTypes';
import { useGalleryInventoryActions } from './useGalleryInventoryActions';

function useActions(overrides: Partial<GalleryInventoryActionDeps> = {}) {
    const updateCurrentUserProfile = vi.fn().mockResolvedValue({
        id: 'usr_self',
        userIcon: 'https://api.vrchat.cloud/api/1/file/file_icon/1'
    });
    const setAuthBootstrap = vi.fn();
    const refreshMediaProfile = vi
        .fn()
        .mockResolvedValue({ userIcon: 'canonical' });
    const toast = {
        error: vi.fn(),
        success: vi.fn(),
        add(options: AppToastOptions) {
            if (options.type === 'error') {
                toast.error(options);
                return '';
            }
            if (options.type === 'success') {
                toast.success(options);
                return '';
            }
            throw new Error('Unhandled toast type: ' + options.type);
        }
    };
    const currentUserSnapshot = {
        id: 'usr_self',
        $isVRCPlus: false,
        tags: []
    };
    const actions = useGalleryInventoryActions({
        userProfileRepository: {
            updateCurrentUserProfile
        },
        currentEndpoint: 'https://api.vrchat.cloud/api/1',
        currentUserId: 'usr_self',
        mediaProfile: {},
        refreshMediaProfile,
        confirm: vi.fn(),
        getAuthTarget: () => ({
            userId: 'usr_self',
            endpoint: 'https://api.vrchat.cloud/api/1'
        }),
        isRuntimeAuthTarget: () => true,
        mediaRepository: {
            consumeInventoryBundle: vi.fn(),
            deletePrint: vi.fn(),
            redeemReward: vi.fn(),
            setPrintFavorite: vi.fn()
        },
        prompt: vi.fn(),
        refreshInventory: vi.fn(),
        setAssets: vi.fn(),
        setMutatingKey: vi.fn(),
        t: (key: string) => key,
        toast,
        useRuntimeStore: {
            getState: () => ({
                auth: {
                    currentUserSnapshot
                },
                setAuthBootstrap
            })
        },
        ...overrides
    });

    return {
        actions,
        updateCurrentUserProfile,
        setAuthBootstrap,
        toast,
        refreshMediaProfile
    };
}

describe('useGalleryInventoryActions', () => {
    it('allows a non-VRC+ user to set profile icons and banners', async () => {
        const {
            actions,
            updateCurrentUserProfile,
            setAuthBootstrap,
            toast,
            refreshMediaProfile
        } = useActions();

        await actions.setProfileField('userIcon', 'file_icon');

        expect(updateCurrentUserProfile).toHaveBeenCalledWith({
            expectedUserId: 'usr_self',
            params: {
                userIcon: 'https://api.vrchat.cloud/api/1/file/file_icon/1'
            }
        });
        expect(setAuthBootstrap).toHaveBeenCalledWith({
            currentUserSnapshot: expect.objectContaining({
                id: 'usr_self',
                userIcon: 'canonical',
                bannerCustomUrl: ''
            }),
            currentUserDisplayName: 'usr_self'
        });
        expect(toast.error).not.toHaveBeenCalled();
        expect(refreshMediaProfile).toHaveBeenCalledOnce();
        expect(
            updateCurrentUserProfile.mock.invocationCallOrder[0]
        ).toBeLessThan(refreshMediaProfile.mock.invocationCallOrder[0]);
        expect(refreshMediaProfile.mock.invocationCallOrder[0]).toBeLessThan(
            setAuthBootstrap.mock.invocationCallOrder[0]
        );
        expect(toast.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'message.gallery.profile_icon_changed'
            })
        );

        await actions.setProfileField('banner', 'file_banner');

        expect(updateCurrentUserProfile).toHaveBeenLastCalledWith({
            expectedUserId: 'usr_self',
            params: {
                bannerType: 'customImage',
                bannerCustomUrl:
                    'https://api.vrchat.cloud/api/1/file/file_banner/1'
            }
        });
        expect(toast.success).toHaveBeenLastCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'message.gallery.profile_pic_changed'
            })
        );
    });
    it('compares the selected banner file and falls back to the avatar banner when cleared', async () => {
        const { actions, updateCurrentUserProfile } = useActions({
            mediaProfile: { bannerCustomUrl: 'https://image/file_banner/3/256' }
        });
        await actions.setProfileField('banner', 'file_banner');
        expect(updateCurrentUserProfile).not.toHaveBeenCalled();
        await actions.setProfileField('banner', '');
        expect(updateCurrentUserProfile).toHaveBeenCalledWith({
            expectedUserId: 'usr_self',
            params: { bannerType: 'avatarBanner' }
        });
    });

    it('keeps the current snapshot and reports a failed profile reread', async () => {
        const { actions, setAuthBootstrap, toast } = useActions({
            refreshMediaProfile: vi
                .fn()
                .mockRejectedValue(new Error('refresh failed'))
        });
        await actions.setProfileField('userIcon', 'file_new');
        expect(setAuthBootstrap).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'refresh failed' })
        );
    });

    it('ignores the reread completion after switching accounts', async () => {
        let current = true;
        const { actions, setAuthBootstrap, toast } = useActions({
            isRuntimeAuthTarget: () => current,
            refreshMediaProfile: async () => {
                current = false;
                return { id: 'usr_self' };
            }
        });
        await actions.setProfileField('userIcon', 'file_new');
        expect(setAuthBootstrap).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });
});
