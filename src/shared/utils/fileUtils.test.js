import { describe, expect, it } from 'vitest';

import { extractFileId, extractFileVersion, extractVariantVersion } from './fileUtils.js';

describe('fileUtils', () => {
    it('extracts VRChat file ids from arbitrary URLs', () => {
        expect(extractFileId('https://api.vrchat.cloud/api/1/file/file_abc-123/4/file')).toBe('file_abc-123');
        expect(extractFileId('/api/1/file/file_XYZ/1')).toBe('file_XYZ');
        expect(extractFileId('not a file url')).toBe('');
    });

    it('extracts the file version only from file path segments', () => {
        expect(extractFileVersion('https://api.vrchat.cloud/api/1/file/file_abc-123/4/file')).toBe('4');
        expect(extractFileVersion('/file/file_abc/0/file')).toBe('0');
        expect(extractFileVersion('https://example.com/file_abc?version=4')).toBe('');
    });

    it('extracts variant version from query string and falls back to zero', () => {
        expect(extractVariantVersion('https://example.com/api/1/file/file_abc/4/file?v=7')).toBe('7');
        expect(extractVariantVersion('https://example.com/api/1/file/file_abc/4/file')).toBe('0');
        expect(extractVariantVersion('not a url')).toBe('0');
        expect(extractVariantVersion('')).toBe('0');
    });
});
