// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatboxFormats } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    samplesRender: vi.fn()
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appChatboxSamplesRender: mocks.samplesRender
    }
}));

import { usePresetSamples } from './usePresetSamples';

const formats: ChatboxFormats = {
    hour12: false,
    showSeconds: false,
    cpuDecimals: 0,
    memory: 'percent',
    memoryDecimals: 0,
    memoryUnit: 'gb',
    mediaMaxChars: 40,
    gpuDecimals: 0,
    vram: 'percent',
    vramDecimals: 0,
    vramUnit: 'gb',
    temperatureUnit: 'celsius',
    progress: 'line'
};

describe('usePresetSamples', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('logs a failed sample render once and keeps the samples empty', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.samplesRender.mockRejectedValue(new Error('render failed'));

        const { result } = renderHook(() => usePresetSamples(formats));

        await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
        expect(result.current).toEqual({});
    });
});
