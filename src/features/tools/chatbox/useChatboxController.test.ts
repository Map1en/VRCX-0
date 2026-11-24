// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    editorStateGet: vi.fn(),
    statusGet: vi.fn(),
    previewingSet: vi.fn()
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appChatboxEditorStateGet: mocks.editorStateGet,
        appChatboxStatusGet: mocks.statusGet,
        appChatboxPreviewingSet: mocks.previewingSet
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

import { useChatboxController } from './useChatboxController';

const config = { messages: { quickPhrases: [] } };

describe('useChatboxController initial load', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.previewingSet.mockResolvedValue(undefined);
        mocks.statusGet.mockResolvedValue(null);
    });

    afterEach(cleanup);

    it('reports a failed load and loads again on retry', async () => {
        mocks.editorStateGet
            .mockRejectedValueOnce(new Error('backend unavailable'))
            .mockResolvedValueOnce({ config, limits: { maxChars: 144 } });

        const { result } = renderHook(() => useChatboxController());

        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        expect(result.current.config).toBeNull();

        act(() => {
            result.current.reload();
        });

        await waitFor(() => expect(result.current.config).toEqual(config));
        expect(result.current.loadFailed).toBe(false);
        expect(result.current.meta).toEqual({ limits: { maxChars: 144 } });
    });
});
