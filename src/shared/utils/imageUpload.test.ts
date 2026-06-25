import { describe, expect, it } from 'vitest';

import { IMAGE_UPLOAD_ACCEPT, validateImageUploadFile } from './imageUpload';

describe('imageUpload validation', () => {
    it('accepts supported raster image types below the size limit', () => {
        for (const type of IMAGE_UPLOAD_ACCEPT.split(',')) {
            expect(validateImageUploadFile(new Blob(['x'], { type }))).toEqual({
                ok: true,
                reason: ''
            });
        }
    });

    it('rejects missing, oversized, and unsafe file types', () => {
        expect(validateImageUploadFile(null)).toEqual({
            ok: false,
            reason: 'missing'
        });
        expect(
            validateImageUploadFile(
                new Blob(['12345'], { type: 'image/png' }),
                {
                    maxSize: 5
                }
            )
        ).toEqual({
            ok: false,
            reason: 'too_large'
        });
        expect(
            validateImageUploadFile(
                new Blob(['<svg />'], { type: 'image/svg+xml' })
            )
        ).toEqual({
            ok: false,
            reason: 'not_image'
        });
    });
});
