import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type * as EntityQueryCache from '@/lib/entityQueryCache';

const commandMocks = vi.hoisted(() => ({
    appVrchatMediaCosmeticsIndexGet: vi.fn(),
    appVrchatMediaFilesGet: vi.fn(),
    appVrchatMediaFileDelete: vi.fn(),
    appVrchatMediaInventoryItemsCollect: vi.fn(),
    appVrchatMediaInventoryItemsGet: vi.fn(),
    appVrchatMediaInventoryTemplateGet: vi.fn(),
    appVrchatMediaProfileDecorationEquip: vi.fn(),
    appVrchatMediaProfileDecorationUnequip: vi.fn(),
    appVrchatMediaPrintUpload: vi.fn(),
    appVrchatMediaUserInventoryItemGet: vi.fn(),
    appVrchatPrintsFavoriteSet: vi.fn(),
    appVrchatMediaAvatarImageUploadLegacy: vi.fn()
}));

const cacheMocks = vi.hoisted(() => ({
    fetchCachedData: vi.fn(
        async (
            options: Parameters<typeof EntityQueryCache.fetchCachedData>[0]
        ) => options.queryFn()
    )
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: commandMocks }));
vi.mock('@/lib/entityQueryCache', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@/lib/entityQueryCache')>();
    return {
        ...actual,
        fetchCachedData: cacheMocks.fetchCachedData
    };
});

import vrchatMediaRepository from './vrchatMediaRepository';

function success(data: unknown = { ok: true }) {
    return {
        status: 200,
        data: typeof data === 'string' ? data : JSON.stringify(data)
    };
}

describe('vrchatMediaRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        for (const command of Object.values(commandMocks)) {
            command.mockResolvedValue(success());
        }
        cacheMocks.fetchCachedData.mockImplementation(async (options) =>
            options.queryFn()
        );
    });

    it('forwards file query params and echoes them with the response metadata', async () => {
        commandMocks.appVrchatMediaFilesGet.mockResolvedValueOnce(
            success([{ id: 'file_1' }])
        );
        const params = { tag: 'gallery', n: 25 } as const;

        await expect(
            vrchatMediaRepository.getFiles(params)
        ).resolves.toMatchObject({
            json: [{ id: 'file_1' }],
            params,
            status: 200
        });
        expect(commandMocks.appVrchatMediaFilesGet).toHaveBeenCalledWith({
            params
        });
        expect(params).toEqual({ tag: 'gallery', n: 25 });
    });

    it('preserves media error context on 401', async () => {
        const payload = { error: { message: 'Missing credentials' } };
        commandMocks.appVrchatMediaFilesGet.mockResolvedValueOnce({
            status: 401,
            data: JSON.stringify(payload)
        });
        await expect(vrchatMediaRepository.getFiles()).rejects.toMatchObject({
            message: 'Missing credentials',
            status: 401,
            endpoint: 'media',
            payload
        });
    });

    it('rejects missing identifiers before invoking destructive commands', async () => {
        await expect(vrchatMediaRepository.deleteFile('   ')).rejects.toThrow(
            'requires a file id'
        );
        expect(commandMocks.appVrchatMediaFileDelete).not.toHaveBeenCalled();
    });

    it('passes print upload options and returns normalized params', async () => {
        commandMocks.appVrchatMediaPrintUpload.mockResolvedValueOnce(
            success({ id: 'print_1' })
        );

        await expect(
            vrchatMediaRepository.uploadPrint('data:image/png;base64,abc', {
                cropWhiteBorder: false,
                params: {
                    note: 'hello',
                    timestamp: '2026-08-19T00:00:00Z'
                }
            })
        ).resolves.toMatchObject({
            json: { id: 'print_1' },
            params: {
                note: 'hello',
                timestamp: '2026-08-19T00:00:00Z'
            }
        });
        expect(commandMocks.appVrchatMediaPrintUpload).toHaveBeenCalledWith({
            imageData: 'data:image/png;base64,abc',
            cropWhiteBorder: false,
            params: {
                note: 'hello',
                timestamp: '2026-08-19T00:00:00Z'
            }
        });
    });

    it('delegates user inventory requests through the shared entity cache', async () => {
        commandMocks.appVrchatMediaUserInventoryItemGet.mockResolvedValueOnce(
            success({ id: 'inv_1' })
        );

        await expect(
            vrchatMediaRepository.getUserInventoryItem(
                { inventoryId: ' inv_1 ', userId: ' usr_1 ' },
                { force: true }
            )
        ).resolves.toMatchObject({ json: { id: 'inv_1' } });

        expect(cacheMocks.fetchCachedData).toHaveBeenCalledWith(
            expect.objectContaining({
                queryKey: [
                    'inventory',
                    'item',
                    'usr_1',
                    'inv_1',
                    { endpoint: 'https://api.vrchat.cloud/api/1' }
                ],
                force: true
            })
        );
        expect(
            commandMocks.appVrchatMediaUserInventoryItemGet
        ).toHaveBeenCalledWith({
            userId: 'usr_1',
            inventoryId: 'inv_1'
        });
    });

    it('loads inventory templates by template id through the shared cache', async () => {
        commandMocks.appVrchatMediaInventoryTemplateGet.mockResolvedValueOnce(
            success({
                id: 'invt_frame',
                metadata: {
                    assets: [
                        {
                            type: 'mainAnimation',
                            url: 'https://example.test/frame.webp'
                        }
                    ]
                }
            })
        );

        await expect(
            vrchatMediaRepository.getInventoryTemplate(' invt_frame ')
        ).resolves.toMatchObject({
            json: {
                id: 'invt_frame'
            }
        });

        expect(cacheMocks.fetchCachedData).toHaveBeenCalledWith(
            expect.objectContaining({
                queryKey: [
                    'inventory',
                    'template',
                    'invt_frame',
                    { endpoint: 'https://api.vrchat.cloud/api/1' }
                ]
            })
        );
        expect(
            commandMocks.appVrchatMediaInventoryTemplateGet
        ).toHaveBeenCalledWith({
            inventoryTemplateId: 'invt_frame'
        });
    });

    it('resolves profile decorations from the cosmetics index of their type', async () => {
        commandMocks.appVrchatMediaCosmeticsIndexGet.mockResolvedValueOnce(
            success([
                { id: 'invt_other', name: 'Other' },
                { id: 'invt_frame', name: 'Frame' }
            ])
        );

        await expect(
            vrchatMediaRepository.getProfileDecorationTemplate(
                'iconFrame',
                ' invt_frame '
            )
        ).resolves.toEqual({ id: 'invt_frame', name: 'Frame' });

        expect(cacheMocks.fetchCachedData).toHaveBeenCalledWith(
            expect.objectContaining({
                queryKey: [
                    'cosmetics',
                    'index',
                    'iconFrame',
                    { endpoint: 'https://api.vrchat.cloud/api/1' }
                ]
            })
        );
        expect(
            commandMocks.appVrchatMediaCosmeticsIndexGet
        ).toHaveBeenCalledWith({ itemType: 'iconFrame' });
        expect(
            commandMocks.appVrchatMediaInventoryTemplateGet
        ).not.toHaveBeenCalled();
    });

    it('falls back to the template request when the cosmetics index misses or fails', async () => {
        commandMocks.appVrchatMediaCosmeticsIndexGet
            .mockResolvedValueOnce(success([{ id: 'invt_other' }]))
            .mockResolvedValueOnce({ status: 500, data: '{}' });
        commandMocks.appVrchatMediaInventoryTemplateGet
            .mockResolvedValueOnce(success({ id: 'invt_retired' }))
            .mockResolvedValueOnce(success({ id: 'invt_effect' }));

        await expect(
            vrchatMediaRepository.getProfileDecorationTemplate(
                'nameplateEffect',
                'invt_retired'
            )
        ).resolves.toEqual({ id: 'invt_retired' });
        await expect(
            vrchatMediaRepository.getProfileDecorationTemplate(
                'profileEffect',
                'invt_effect'
            )
        ).resolves.toEqual({ id: 'invt_effect' });

        expect(
            commandMocks.appVrchatMediaInventoryTemplateGet
        ).toHaveBeenNthCalledWith(1, { inventoryTemplateId: 'invt_retired' });
        expect(
            commandMocks.appVrchatMediaInventoryTemplateGet
        ).toHaveBeenNthCalledWith(2, { inventoryTemplateId: 'invt_effect' });
    });

    it('caches a failed cosmetics index so later decorations go straight to their template', async () => {
        const cache = await vi.importActual<
            typeof import('@/lib/entityQueryCache')
        >('@/lib/entityQueryCache');
        await cache.clearEntityQueryCache();
        cacheMocks.fetchCachedData.mockImplementation(cache.fetchCachedData);
        commandMocks.appVrchatMediaCosmeticsIndexGet.mockResolvedValue({
            status: 403,
            data: '{}'
        });
        commandMocks.appVrchatMediaInventoryTemplateGet
            .mockResolvedValueOnce(success({ id: 'invt_a' }))
            .mockResolvedValueOnce(success({ id: 'invt_b' }));

        await expect(
            vrchatMediaRepository.getProfileDecorationTemplate(
                'iconFrame',
                'invt_a'
            )
        ).resolves.toEqual({ id: 'invt_a' });
        await expect(
            vrchatMediaRepository.getProfileDecorationTemplate(
                'iconFrame',
                'invt_b'
            )
        ).resolves.toEqual({ id: 'invt_b' });

        expect(
            commandMocks.appVrchatMediaCosmeticsIndexGet
        ).toHaveBeenCalledOnce();
        await cache.clearEntityQueryCache();
    });

    it('preserves typed profile decoration inventory fields', async () => {
        commandMocks.appVrchatMediaInventoryItemsGet.mockResolvedValueOnce(
            success({
                data: [
                    {
                        id: 'inv_frame',
                        itemType: 'iconFrame',
                        equipSlot: '',
                        equipSlots: ['iconFrame'],
                        templateId: 'invt_frame',
                        last_equipped: {
                            iconFrame: '2026-07-26T15:12:39.373Z'
                        },
                        metadata: {
                            gradientEnd: '241254',
                            gradientStart: '120e1b',
                            assets: [
                                {
                                    type: 'mainAnimation',
                                    url: 'https://example.test/frame.webp',
                                    frameCount: 71,
                                    framesPerSecond: 24.01,
                                    loopCount: 0,
                                    totalDurationMs: 2957
                                },
                                {
                                    type: 'base',
                                    url: 'https://example.test/frame.png',
                                    fileId: 'file_frame'
                                }
                            ]
                        }
                    }
                ],
                totalCount: 1
            })
        );

        const { json } = await vrchatMediaRepository.getInventoryItems();
        const item = json.data[0];

        expect(item).toMatchObject({
            equipSlot: '',
            templateId: 'invt_frame',
            last_equipped: {
                iconFrame: '2026-07-26T15:12:39.373Z'
            }
        });
        expectTypeOf(item).toMatchTypeOf<{
            last_equipped?: Record<string, string> | null;
            metadata?: {
                assets?: Array<{
                    fileId?: string;
                    frameCount?: number;
                    framesPerSecond?: number;
                    loopCount?: number;
                    totalDurationMs?: number;
                    type?: string;
                    url?: string;
                }>;
                gradientEnd?: string;
                gradientStart?: string;
            };
            templateId?: string;
        }>();
    });

    it('collects inventory items and drops entries without a string id', async () => {
        commandMocks.appVrchatMediaInventoryItemsCollect.mockResolvedValueOnce({
            items: [{ id: 'inv_1' }, null, ['inv_array'], { id: 42 }, {}],
            truncated: true
        });

        await expect(
            vrchatMediaRepository.collectInventoryItems({
                types: ['emoji']
            })
        ).resolves.toEqual({
            items: [{ id: 'inv_1' }],
            truncated: true
        });
        expect(
            commandMocks.appVrchatMediaInventoryItemsCollect
        ).toHaveBeenCalledWith({
            types: ['emoji']
        });
    });

    it('equips a profile decoration by inventory id and slot without sending the owner id', async () => {
        await vrchatMediaRepository.equipProfileDecoration({
            expectedUserId: ' usr_self ',
            inventoryId: ' inv_frame ',
            equipSlot: 'iconFrame'
        });

        expect(
            commandMocks.appVrchatMediaProfileDecorationEquip
        ).toHaveBeenCalledWith({
            inventoryId: 'inv_frame',
            equipSlot: 'iconFrame'
        });
    });

    it('unequips a profile decoration by slot, not inventory id', async () => {
        commandMocks.appVrchatMediaProfileDecorationUnequip.mockResolvedValueOnce(
            {
                status: 200,
                data: JSON.stringify('OK')
            }
        );

        await expect(
            vrchatMediaRepository.unequipProfileDecoration({
                expectedUserId: ' usr_self ',
                equipSlot: 'profileEffect'
            })
        ).resolves.toMatchObject({ json: 'OK' });

        expect(
            commandMocks.appVrchatMediaProfileDecorationUnequip
        ).toHaveBeenCalledWith({
            equipSlot: 'profileEffect'
        });
    });

    it('rejects an empty profile decoration owner before invoking commands', async () => {
        await expect(
            vrchatMediaRepository.equipProfileDecoration({
                expectedUserId: '',
                inventoryId: 'inv_frame',
                equipSlot: 'iconFrame'
            })
        ).rejects.toThrow('requires a user id');
        expect(
            commandMocks.appVrchatMediaProfileDecorationEquip
        ).not.toHaveBeenCalled();
    });

    it('passes typed print favorite values to the command', async () => {
        commandMocks.appVrchatPrintsFavoriteSet.mockResolvedValue({
            favoritePrintIds: []
        });

        await vrchatMediaRepository.setPrintFavorite(' print_1 ', false);
        await vrchatMediaRepository.setPrintFavorite('print_1', true);

        expect(commandMocks.appVrchatPrintsFavoriteSet).toHaveBeenNthCalledWith(
            1,
            { printId: 'print_1', favorite: false }
        );
        expect(commandMocks.appVrchatPrintsFavoriteSet).toHaveBeenNthCalledWith(
            2,
            { printId: 'print_1', favorite: true }
        );
    });

    it('projects legacy avatar upload responses without leaking transport fields', async () => {
        commandMocks.appVrchatMediaAvatarImageUploadLegacy.mockResolvedValueOnce(
            success({
                avatar: { id: 'avtr_1' },
                imageUrl: 'https://example.test/image.png',
                fileId: 'file_1',
                fileVersion: 3,
                ignored: true
            })
        );

        await expect(
            vrchatMediaRepository.uploadAvatarImageLegacy({
                avatarId: ' avtr_1 ',
                imageUrl: 'old.png',
                base64File: 'abc'
            })
        ).resolves.toEqual({
            avatar: { id: 'avtr_1' },
            imageUrl: 'https://example.test/image.png',
            fileId: 'file_1',
            fileVersion: 3
        });
        expect(
            commandMocks.appVrchatMediaAvatarImageUploadLegacy
        ).toHaveBeenCalledWith({
            entityId: 'avtr_1',
            imageUrl: 'old.png',
            base64File: 'abc',
            fileSizeInBytes: null
        });
    });
});
