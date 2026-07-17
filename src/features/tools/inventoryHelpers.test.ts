import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    MAX_IMAGE_UPLOAD_BYTES,
    getLatestFileUrl,
    getUsefulDisplayName,
    parseEmojiUploadSettings,
    resolveInventoryDescription,
    resolveInventoryImageUrl,
    resolveInventoryName,
    resolveInventoryType,
    sanitizeInventoryGridDensity,
    validateImageFile
} from './inventoryHelpers';

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn()
    }
}));

const { toast } = await import('sonner');

describe('inventory helpers', () => {
    beforeEach(() => {
        vi.mocked(toast.error).mockClear();
    });

    it('parses emoji upload settings from filename tokens and clamps numeric bounds', () => {
        expect(
            parseEmojiUploadSettings(
                'avatar_BounceanimationStyle_99frames_0fps_pingpongloopStyle.png',
                {
                    isAnimated: false,
                    animationStyle: 'Stop',
                    fps: 15,
                    frames: 4,
                    loopPingPong: false
                }
            )
        ).toEqual({
            isAnimated: true,
            animationStyle: 'Bounce',
            fps: 1,
            frames: 64,
            loopPingPong: true
        });
    });

    it('keeps current emoji defaults when filename tokens are missing or invalid', () => {
        expect(
            parseEmojiUploadSettings('plain-upload.png', {
                isAnimated: true,
                animationStyle: 'Wave',
                fps: 24,
                frames: 8,
                loopPingPong: true
            })
        ).toEqual({
            isAnimated: true,
            animationStyle: 'Wave',
            fps: 24,
            frames: 8,
            loopPingPong: true
        });
    });

    it('accepts supported images below the 20 MB limit', () => {
        const file = new Blob(['image'], { type: 'image/png' });

        expect(validateImageFile(file, (key: string) => key)).toBe(true);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('rejects files at the 20 MB limit and non-image file types with localized toast keys', () => {
        const tooLarge = new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES)], {
            type: 'image/png'
        });
        const textFile = new Blob(['not image'], { type: 'text/plain' });

        expect(validateImageFile(tooLarge, (key: string) => key)).toBe(false);
        expect(validateImageFile(textFile, (key: string) => key)).toBe(false);
        expect(toast.error).toHaveBeenNthCalledWith(
            1,
            'message.file.too_large'
        );
        expect(toast.error).toHaveBeenNthCalledWith(
            2,
            'message.file.not_image'
        );
    });

    it('sanitizes inventory grid density through gallery density options', () => {
        expect(sanitizeInventoryGridDensity('compact')).toBe('compact');
        expect(sanitizeInventoryGridDensity(' dense ')).toBe('dense');
        expect(sanitizeInventoryGridDensity('comfortable')).toBe('standard');
    });

    it('resolves inventory display fallbacks from nested item, template, and metadata fields', () => {
        const item = {
            id: 'inv_1',
            item: {
                name: 'Nested Item',
                description: 'Nested description',
                type: 'sticker',
                thumbnailUrl: 'https://example.test/item-thumb.png'
            },
            template: {
                name: 'Template Name',
                description: 'Template description',
                imageUrl: 'https://example.test/template.png'
            },
            metadata: {
                imageUrl: 'https://example.test/metadata.png'
            }
        };

        expect(resolveInventoryName(item)).toBe('Nested Item');
        expect(resolveInventoryDescription(item)).toBe('Nested description');
        expect(resolveInventoryType(item)).toBe('sticker');
        expect(resolveInventoryImageUrl(item)).toBe(
            'https://example.test/item-thumb.png'
        );
    });

    it('resolves latest file urls and hides generated file blob names', () => {
        expect(
            getLatestFileUrl({
                versions: [
                    { file: { url: 'https://example.test/old.png' } },
                    { file: { url: 'https://example.test/new.png' } }
                ]
            })
        ).toBe('https://example.test/new.png');

        expect(
            getUsefulDisplayName({
                id: 'file_123',
                displayName: 'file_123_blob',
                name: 'Readable Name'
            })
        ).toBe('');
        expect(
            getUsefulDisplayName({
                id: 'file_123',
                displayName: '',
                name: 'Readable Name'
            })
        ).toBe('Readable Name');
    });
});
