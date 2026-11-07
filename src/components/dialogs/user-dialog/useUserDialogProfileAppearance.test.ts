// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getProfileDecorationTemplate: vi.fn()
}));

vi.mock('@/repositories/vrchatMediaRepository', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/repositories/vrchatMediaRepository')
        >();
    return {
        ...actual,
        default: {
            ...actual.default,
            getProfileDecorationTemplate: mocks.getProfileDecorationTemplate
        }
    };
});

import { useUserDialogProfileAppearance } from './useUserDialogProfileAppearance';

const VISIBLE_PROFILE_DECORATIONS = {
    avatarFrame: true,
    profileEffect: true,
    nameplateEffect: true
};

describe('useUserDialogProfileAppearance', () => {
    beforeEach(() => {
        mocks.getProfileDecorationTemplate.mockReset();
        mocks.getProfileDecorationTemplate.mockImplementation(
            async (_slot: string, inventoryTemplateId: string) => ({
                id: inventoryTemplateId,
                metadata: {
                    assets: [
                        {
                            type: 'mainAnimation',
                            url: `https://example.test/${inventoryTemplateId}.webp`
                        }
                    ]
                }
            })
        );
    });

    it('loads the three equipped template ids and maps them to their slots', async () => {
        const { result } = renderHook(() =>
            useUserDialogProfileAppearance({
                profile: {
                    id: 'usr_target',
                    iconFrame: 'invt_frame',
                    profileEffect: 'invt_profile',
                    nameplateEffect: 'invt_nameplate'
                },
                visibility: VISIBLE_PROFILE_DECORATIONS
            })
        );

        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_frame');
            expect(result.current.profileEffect?.id).toBe('invt_profile');
            expect(result.current.nameplateEffect?.id).toBe('invt_nameplate');
        });
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledTimes(3);
    });

    it('keeps unchanged slots while requesting only the changed template', async () => {
        let resolveNextFrame: ((value: { id: string }) => void) | undefined;
        mocks.getProfileDecorationTemplate.mockImplementation(
            (_slot: string, inventoryTemplateId: string) => {
                if (inventoryTemplateId === 'invt_frame_next') {
                    return new Promise<{ id: string }>((resolve) => {
                        resolveNextFrame = resolve;
                    });
                }
                return Promise.resolve({
                    id: inventoryTemplateId
                });
            }
        );

        const { result, rerender } = renderHook(
            ({ iconFrame }: { iconFrame: string }) =>
                useUserDialogProfileAppearance({
                    profile: {
                        id: 'usr_target',
                        iconFrame,
                        profileEffect: 'invt_profile',
                        nameplateEffect: 'invt_nameplate'
                    },
                    visibility: VISIBLE_PROFILE_DECORATIONS
                }),
            {
                initialProps: {
                    iconFrame: 'invt_frame'
                }
            }
        );

        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_frame');
            expect(result.current.profileEffect?.id).toBe('invt_profile');
            expect(result.current.nameplateEffect?.id).toBe('invt_nameplate');
        });
        const profileEffect = result.current.profileEffect;
        const nameplateEffect = result.current.nameplateEffect;
        mocks.getProfileDecorationTemplate.mockClear();

        rerender({ iconFrame: 'invt_frame_next' });

        expect(result.current.iconFrame).toBeUndefined();
        expect(result.current.profileEffect).toBe(profileEffect);
        expect(result.current.nameplateEffect).toBe(nameplateEffect);
        await waitFor(() => {
            expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledOnce();
        });
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledWith(
            'iconFrame',
            'invt_frame_next'
        );

        resolveNextFrame?.({
            id: 'invt_frame_next'
        });
        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_frame_next');
        });
        expect(result.current.profileEffect).toBe(profileEffect);
        expect(result.current.nameplateEffect).toBe(nameplateEffect);
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledOnce();
    });

    it('deduplicates template requests and tolerates one failed decoration', async () => {
        mocks.getProfileDecorationTemplate.mockImplementation(
            async (_slot: string, inventoryTemplateId: string) => {
                if (inventoryTemplateId === 'invt_failed') {
                    throw new Error('not available');
                }
                return {
                    id: inventoryTemplateId
                };
            }
        );

        const { result } = renderHook(() =>
            useUserDialogProfileAppearance({
                profile: {
                    id: 'usr_target',
                    iconFrame: 'invt_shared',
                    profileEffect: 'invt_failed',
                    nameplateEffect: 'invt_shared'
                },
                visibility: VISIBLE_PROFILE_DECORATIONS
            })
        );

        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_shared');
            expect(result.current.nameplateEffect?.id).toBe('invt_shared');
        });
        expect(result.current.profileEffect).toBeUndefined();
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledTimes(2);
    });

    it('does not expose a previous target while the next target is loading', async () => {
        let resolveNext: ((value: { id: string }) => void) | undefined;
        mocks.getProfileDecorationTemplate.mockImplementation(
            (_slot: string, inventoryTemplateId: string) => {
                if (inventoryTemplateId === 'invt_next') {
                    return new Promise<{ id: string }>((resolve) => {
                        resolveNext = resolve;
                    });
                }
                return Promise.resolve({
                    id: inventoryTemplateId
                });
            }
        );

        const { result, rerender } = renderHook(
            ({ userId, iconFrame }: { iconFrame: string; userId: string }) =>
                useUserDialogProfileAppearance({
                    profile: {
                        id: userId,
                        iconFrame
                    },
                    visibility: VISIBLE_PROFILE_DECORATIONS
                }),
            {
                initialProps: {
                    userId: 'usr_first',
                    iconFrame: 'invt_first'
                }
            }
        );

        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_first');
        });

        rerender({
            userId: 'usr_next',
            iconFrame: 'invt_next'
        });

        expect(result.current.iconFrame).toBeUndefined();
        resolveNext?.({
            id: 'invt_next'
        });
        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_next');
        });
    });

    it('does not request empty decoration ids', () => {
        const { result } = renderHook(() =>
            useUserDialogProfileAppearance({
                profile: {
                    id: 'usr_target',
                    iconFrame: '',
                    profileEffect: '',
                    nameplateEffect: ''
                },
                visibility: VISIBLE_PROFILE_DECORATIONS
            })
        );

        expect(result.current).toEqual({});
        expect(mocks.getProfileDecorationTemplate).not.toHaveBeenCalled();
    });

    it('requests and exposes only the visible profile decoration slots', async () => {
        const { result, rerender } = renderHook(
            ({
                avatarFrame,
                profileEffect,
                nameplateEffect
            }: {
                avatarFrame: boolean;
                profileEffect: boolean;
                nameplateEffect: boolean;
            }) =>
                useUserDialogProfileAppearance({
                    profile: {
                        id: 'usr_target',
                        iconFrame: 'invt_frame',
                        profileEffect: 'invt_profile',
                        nameplateEffect: 'invt_nameplate'
                    },
                    visibility: {
                        avatarFrame,
                        profileEffect,
                        nameplateEffect
                    }
                }),
            {
                initialProps: {
                    avatarFrame: false,
                    profileEffect: false,
                    nameplateEffect: false
                }
            }
        );

        expect(result.current).toEqual({});
        expect(mocks.getProfileDecorationTemplate).not.toHaveBeenCalled();

        rerender({
            avatarFrame: true,
            profileEffect: false,
            nameplateEffect: false
        });

        await waitFor(() => {
            expect(result.current.iconFrame?.id).toBe('invt_frame');
        });
        expect(result.current.profileEffect).toBeUndefined();
        expect(result.current.nameplateEffect).toBeUndefined();
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledOnce();

        rerender({
            avatarFrame: false,
            profileEffect: true,
            nameplateEffect: false
        });

        expect(result.current.iconFrame).toBeUndefined();
        await waitFor(() => {
            expect(result.current.profileEffect?.id).toBe('invt_profile');
        });
        expect(result.current.nameplateEffect).toBeUndefined();
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledTimes(2);

        rerender({
            avatarFrame: false,
            profileEffect: false,
            nameplateEffect: true
        });

        expect(result.current.profileEffect).toBeUndefined();
        await waitFor(() => {
            expect(result.current.nameplateEffect?.id).toBe('invt_nameplate');
        });
        expect(mocks.getProfileDecorationTemplate).toHaveBeenCalledTimes(3);

        rerender({
            avatarFrame: false,
            profileEffect: false,
            nameplateEffect: false
        });

        expect(result.current).toEqual({});
    });
});
