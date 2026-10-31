// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const intakeMocks = vi.hoisted(() => ({
    onDrop: null as ((paths: string[]) => Promise<void>) | null,
    readClipboardUploadImage: vi.fn(),
    readDroppedUploadImage: vi.fn(),
    toastError: vi.fn(),
    validateImageFile: vi.fn()
}));

vi.mock('@/components/file-drop/useFileDropTarget', () => ({
    useFileDropTarget: ({
        onDrop
    }: {
        onDrop: (paths: string[]) => Promise<void>;
    }) => {
        intakeMocks.onDrop = onDrop;
        return false;
    }
}));
vi.mock('./inventoryHelpers', () => ({
    readClipboardUploadImage: intakeMocks.readClipboardUploadImage,
    readDroppedUploadImage: intakeMocks.readDroppedUploadImage,
    validateImageFile: intakeMocks.validateImageFile
}));
vi.mock('@/services/toastService', () => ({
    toast: { add: intakeMocks.toastError }
}));

import { useImageUploadIntake } from './useImageUploadIntake';

type Target = 'free' | 'supporter';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function selectFile(file: File) {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file] });
    return { target: input } as ChangeEvent<HTMLInputElement>;
}

function renderIntake({
    canUploadTo = () => true,
    isCurrentAuthTarget = () => true
}: {
    canUploadTo?: (target: Target) => boolean;
    isCurrentAuthTarget?: (authTarget: string) => boolean;
} = {}) {
    const openCropRequest = vi.fn();
    const getAuthTarget = vi.fn(() => 'usr_self');
    const hook = renderHook(() =>
        useImageUploadIntake<Target, string>({
            enabled: true,
            activeTarget: 'free',
            canUploadTo,
            getAuthTarget,
            isCurrentAuthTarget,
            openCropRequest
        })
    );
    return { ...hook, getAuthTarget, openCropRequest };
}

const image = new File(['image'], 'image.png', { type: 'image/png' });

describe('useImageUploadIntake', () => {
    beforeEach(() => {
        intakeMocks.validateImageFile.mockReturnValue(true);
        intakeMocks.readClipboardUploadImage.mockResolvedValue(image);
        intakeMocks.readDroppedUploadImage.mockResolvedValue(image);
    });

    afterEach(() => {
        cleanup();
        vi.resetAllMocks();
        intakeMocks.onDrop = null;
    });

    it('opens the picker and crops the selected file for the requested target', () => {
        const { result, openCropRequest } = renderIntake();
        const click = vi.fn();
        result.current.uploadInputRef.current = Object.assign(
            document.createElement('input'),
            { click }
        );

        result.current.beginUpload('supporter');
        result.current.uploadSelectedFile(selectFile(image));
        result.current.uploadSelectedFile(selectFile(image));

        expect(click).toHaveBeenCalledOnce();
        expect(openCropRequest).toHaveBeenCalledOnce();
        expect(openCropRequest).toHaveBeenCalledWith(
            image,
            'supporter',
            'usr_self'
        );
    });

    it('keeps restricted targets behind VRC+ before opening the picker', () => {
        const { result } = renderIntake({
            canUploadTo: (target) => target === 'free'
        });
        const click = vi.fn();
        result.current.uploadInputRef.current = Object.assign(
            document.createElement('input'),
            { click }
        );

        result.current.beginUpload('supporter');

        expect(click).not.toHaveBeenCalled();
        expect(intakeMocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'message.vrcplus.required' })
        );
    });

    it('crops a dropped image for the active target', async () => {
        const { openCropRequest } = renderIntake();

        await act(async () => {
            await intakeMocks.onDrop?.(['C:/image.png']);
        });

        expect(openCropRequest).toHaveBeenCalledWith(image, 'free', 'usr_self');
    });

    it('ignores another clipboard paste while one is still reading', async () => {
        const clipboard = deferred<File | null>();
        intakeMocks.readClipboardUploadImage.mockReturnValue(clipboard.promise);
        const { result, openCropRequest } = renderIntake();

        let firstPaste!: Promise<void>;
        act(() => {
            firstPaste = result.current.pasteClipboardUpload('free');
        });
        expect(result.current.clipboardPasting).toBe(true);
        await act(async () => {
            await result.current.pasteClipboardUpload('supporter');
        });
        expect(intakeMocks.readClipboardUploadImage).toHaveBeenCalledOnce();

        await act(async () => {
            clipboard.resolve(image);
            await firstPaste;
        });
        expect(result.current.clipboardPasting).toBe(false);
        expect(openCropRequest).toHaveBeenCalledOnce();
        expect(openCropRequest).toHaveBeenCalledWith(image, 'free', 'usr_self');
    });

    it('rejects a pasted or dropped image for a VRC+ target after reading it', async () => {
        const { result, openCropRequest } = renderIntake({
            canUploadTo: () => false
        });

        await act(async () => {
            await result.current.pasteClipboardUpload('supporter');
            await intakeMocks.onDrop?.(['C:/image.png']);
        });

        expect(openCropRequest).not.toHaveBeenCalled();
        expect(intakeMocks.toastError).toHaveBeenCalledTimes(2);
        expect(intakeMocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'message.vrcplus.required' })
        );
    });

    it('ignores a selected file after switching accounts', () => {
        let currentAccount = 'usr_self';
        const { result, openCropRequest } = renderIntake({
            isCurrentAuthTarget: (authTarget) => authTarget === currentAccount
        });

        result.current.beginUpload('free');
        currentAccount = 'usr_other';
        result.current.uploadSelectedFile(selectFile(image));

        expect(openCropRequest).not.toHaveBeenCalled();
    });

    it('ignores an image that fails validation', async () => {
        intakeMocks.validateImageFile.mockReturnValue(false);
        const { result, openCropRequest } = renderIntake();

        await act(async () => {
            await result.current.pasteClipboardUpload('free');
        });

        expect(openCropRequest).not.toHaveBeenCalled();
    });
});
