import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatMediaFilesGet: vi.fn(),
    appVrchatMediaFileDelete: vi.fn(),
    appVrchatMediaPrintUpload: vi.fn(),
    appVrchatMediaUserInventoryItemGet: vi.fn(),
    appVrchatPrintsFavoriteSet: vi.fn(),
    appVrchatMediaAvatarImageUploadLegacy: vi.fn()
}));

const cacheMocks = vi.hoisted(() => ({
    fetchCachedData: vi.fn(
        async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn()
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
        cacheMocks.fetchCachedData.mockImplementation(
            async (options: { queryFn: () => Promise<unknown> }) =>
                options.queryFn()
        );
    });

    it('normalizes file query params and preserves response metadata', async () => {
        commandMocks.appVrchatMediaFilesGet.mockResolvedValueOnce(
            success([{ id: 'file_1' }])
        );
        const params = { tag: 'gallery', n: 25 };

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
                params: { note: 'hello' }
            })
        ).resolves.toMatchObject({
            json: { id: 'print_1' },
            params: { note: 'hello' }
        });
        expect(commandMocks.appVrchatMediaPrintUpload).toHaveBeenCalledWith({
            imageData: 'data:image/png;base64,abc',
            cropWhiteBorder: false,
            params: { note: 'hello' }
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

    it('treats only literal true as a print favorite write', async () => {
        commandMocks.appVrchatPrintsFavoriteSet.mockResolvedValue({
            favoritePrintIds: []
        });

        await vrchatMediaRepository.setPrintFavorite(' print_1 ', 1);
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
