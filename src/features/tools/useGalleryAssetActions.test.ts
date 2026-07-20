import { describe, expect, it, vi } from 'vitest';

import { useGalleryAssetActions } from './useGalleryAssetActions';

function createActions(overrides: Record<string, unknown> = {}) {
    const uploadAssetImage = vi.fn().mockResolvedValue({ json: null });
    const actions = useGalleryAssetActions({
        FILE_TABS: {},
        UPLOAD_ASPECT_RATIOS: {},
        activeTab: 'prints',
        confirm: vi.fn(),
        cropRequest: {
            tab: 'prints',
            settings: {},
            authTarget: {
                userId: 'usr_self',
                endpoint: 'https://api.vrchat.cloud'
            }
        },
        currentEndpoint: 'https://api.vrchat.cloud',
        currentUserId: 'usr_self',
        emojiAnimFps: 15,
        emojiAnimFrameCount: 4,
        emojiAnimLoopPingPong: false,
        emojiAnimType: false,
        emojiAnimationStyle: 'Stop',
        getLocalTimestampString: () => '2026-06-09T10:11:12',
        isRuntimeAuthTarget: () => true,
        isVrcPlusSupporter: true,
        mediaRepository: {
            uploadAssetImage
        },
        parseEmojiUploadSettings: vi.fn(),
        readFileAsBase64: vi.fn().mockResolvedValue('base64-body'),
        setAssets: vi.fn(),
        setCropRequest: vi.fn(),
        setEmojiAnimFps: vi.fn(),
        setEmojiAnimFrameCount: vi.fn(),
        setEmojiAnimLoopPingPong: vi.fn(),
        setEmojiAnimType: vi.fn(),
        setEmojiAnimationStyle: vi.fn(),
        setLoadingByTab: vi.fn(),
        setMutatingKey: vi.fn(),
        setUploadingTab: vi.fn(),
        t: (key: string) => key,
        toast: {
            error: vi.fn(),
            success: vi.fn()
        },
        uploadAuthTargetRef: {
            current: null
        },
        uploadInputRef: {
            current: null
        },
        uploadTargetRef: {
            current: null
        },
        validateImageFile: vi.fn(),
        withUploadTimeout: (promise: Promise<unknown>) => promise,
        ...overrides
    });

    return {
        actions,
        uploadAssetImage
    };
}

describe('useGalleryAssetActions', () => {
    it('uses the crop white border option provided by the print crop dialog', async () => {
        const { actions, uploadAssetImage } = createActions();
        const blob = new Blob(['image'], { type: 'image/png' });

        await actions.confirmCroppedUpload(blob, {
            note: 'print note',
            cropWhiteBorder: false
        });

        expect(uploadAssetImage).toHaveBeenCalledWith('base64-body', {
            assetKind: 'prints',
            cropWhiteBorder: false,
            params: {
                note: 'print note',
                timestamp: '2026-06-09T10:11:12'
            }
        });
    });
});
