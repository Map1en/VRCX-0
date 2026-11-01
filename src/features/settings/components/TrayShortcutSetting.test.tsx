// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    TrayShortcutBinding,
    TrayShortcutError,
    TrayShortcutUpdate
} from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useTrayShortcutStore } from '@/state/trayShortcutStore';

const mocks = vi.hoisted(() => ({
    set: vi.fn<
        (binding: TrayShortcutBinding | null) => Promise<TrayShortcutUpdate>
    >(),
    recording: vi.fn<(recording: boolean) => Promise<boolean>>(),
    check: vi.fn<
        (binding: TrayShortcutBinding) => Promise<TrayShortcutError | null>
    >(),
    subscribe:
        vi.fn<
            (
                event: string,
                handler: (binding: TrayShortcutBinding) => void
            ) => Promise<() => void>
        >(),
    unsubscribe: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSetTrayShortcut: mocks.set,
        appCheckTrayShortcut: mocks.check,
        appSetTrayShortcutRecording: mocks.recording
    }
}));
vi.mock('@/platform/tauri/events', () => ({
    tauriEvents: { subscribe: mocks.subscribe }
}));
vi.mock('@/services/shellIntegrationService', () => ({
    setTaskbarOverlayNotification: vi.fn(),
    setTrayIconNotification: vi.fn()
}));

import { TrayShortcutSetting } from './TrayShortcutSetting';

const original: TrayShortcutBinding = {
    control: true,
    alt: true,
    shift: false,
    key: 'KeyV'
};

beforeEach(() => {
    mocks.set.mockReset().mockImplementation(async (binding) => ({
        kind: 'saved',
        snapshot: { binding, status: binding ? 'active' : 'unset' }
    }));
    mocks.recording
        .mockReset()
        .mockImplementation(async (recording) => recording);
    mocks.check.mockReset().mockResolvedValue(null);
    mocks.subscribe.mockReset().mockResolvedValue(mocks.unsubscribe);
    mocks.unsubscribe.mockReset();
    useRuntimeStore.setState((state) => ({
        hostCapabilities: { ...state.hostCapabilities, platform: 'windows' }
    }));
    useTrayShortcutStore.setState({
        snapshot: { binding: original, status: 'active' }
    });
});

afterEach(async () => {
    await act(async () => cleanup());
});

async function saveRecordedShortcut() {
    const save = screen.getByRole('button', { name: 'common.actions.save' });
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    fireEvent.click(save);
}

async function openRecorder() {
    render(<TrayShortcutSetting />);
    const configure = screen.getByRole('button', {
        name: 'shortcuts.tray.configure'
    });
    act(() => configure.focus());
    fireEvent.click(configure);
    const recorder = await screen.findByRole('textbox', {
        name: 'shortcuts.tray.record'
    });
    await waitFor(() => expect(recorder.hasAttribute('disabled')).toBe(false));
    return recorder;
}

describe('global tray shortcut setting', () => {
    it('reports event subscription failure as a recorder startup failure', async () => {
        mocks.subscribe.mockRejectedValueOnce(
            new Error('listener unavailable')
        );
        render(<TrayShortcutSetting />);
        fireEvent.click(
            screen.getByRole('button', { name: 'shortcuts.tray.configure' })
        );
        expect((await screen.findByRole('alert')).textContent).toBe(
            'shortcuts.tray.recording_failed'
        );
        expect(
            screen
                .getByRole('textbox', { name: 'shortcuts.tray.record' })
                .hasAttribute('disabled')
        ).toBe(true);
        expect(
            screen
                .getByRole('button', { name: 'common.actions.save' })
                .hasAttribute('disabled')
        ).toBe(true);
        expect(mocks.recording).not.toHaveBeenCalledWith(true);
    });

    it('focuses the recorder after delayed native readiness', async () => {
        let finishRecording: (active: boolean) => void = () => undefined;
        mocks.recording.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    finishRecording = resolve;
                })
        );
        render(<TrayShortcutSetting />);
        fireEvent.click(
            screen.getByRole('button', { name: 'shortcuts.tray.configure' })
        );
        const recorder = await screen.findByRole('textbox', {
            name: 'shortcuts.tray.record'
        });
        await waitFor(() => expect(mocks.recording).toHaveBeenCalledWith(true));
        expect(recorder.hasAttribute('disabled')).toBe(true);
        screen.getByRole('dialog').focus();
        await act(async () => finishRecording(true));
        await waitFor(() => expect(document.activeElement).toBe(recorder));
        fireEvent.keyDown(document.activeElement ?? document.body, {
            code: 'KeyM',
            key: 'm',
            ctrlKey: true,
            altKey: true
        });
        await saveRecordedShortcut();
        expect(mocks.set).toHaveBeenCalledWith({
            control: true,
            alt: true,
            shift: false,
            key: 'KeyM'
        });
    });

    it('reports inactive native recording as a failure and recovers on focus', async () => {
        mocks.recording.mockResolvedValueOnce(false);
        render(<TrayShortcutSetting />);
        fireEvent.click(
            screen.getByRole('button', { name: 'shortcuts.tray.configure' })
        );
        const recorder = await screen.findByRole('textbox', {
            name: 'shortcuts.tray.record'
        });
        expect((await screen.findByRole('alert')).textContent).toBe(
            'shortcuts.tray.recording_failed'
        );
        expect(mocks.recording).toHaveBeenCalledWith(true);
        expect(recorder.hasAttribute('disabled')).toBe(true);
        expect(
            screen
                .getByRole('button', { name: 'common.actions.save' })
                .hasAttribute('disabled')
        ).toBe(true);

        fireEvent.focus(window);

        await waitFor(() => expect(document.activeElement).toBe(recorder));
        expect(recorder.hasAttribute('disabled')).toBe(false);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not record Windows-key combinations through the DOM path', async () => {
        const recorder = await openRecorder();
        const checks = mocks.check.mock.calls.length;
        fireEvent.keyDown(recorder, {
            code: 'KeyK',
            key: 'K',
            metaKey: true,
            shiftKey: true
        });
        expect(mocks.check).toHaveBeenCalledTimes(checks);
        expect(recorder.getAttribute('value')).toBe('Ctrl + Alt + V');
    });

    it('checks an occupied combination captured natively without a DOM keydown and prevents saving it', async () => {
        mocks.check.mockImplementation(async (binding) =>
            binding.key === 'KeyM' ? 'inUse' : null
        );
        await openRecorder();
        const occupied = { ...original, key: 'KeyM', alt: false, shift: true };
        const handler = mocks.subscribe.mock.calls.find(
            ([event]) => event === 'trayShortcutRecorded'
        )?.[1];
        act(() => handler?.(occupied));

        expect((await screen.findByRole('alert')).textContent).toBe(
            'shortcuts.tray.error.inUse'
        );
        expect(
            screen
                .getByRole('button', { name: 'common.actions.save' })
                .hasAttribute('disabled')
        ).toBe(true);
        expect(mocks.check).toHaveBeenCalledWith(occupied);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(useTrayShortcutStore.getState().snapshot?.binding).toEqual(
            original
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.cancel' })
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.queryByText('shortcuts.tray.error.inUse')).toBeNull();
    });

    it('ignores a late availability response after a different combination was recorded', async () => {
        let finishCheck: (error: TrayShortcutError | null) => void = () =>
            undefined;
        const slowCheck = new Promise<TrayShortcutError | null>((resolve) => {
            finishCheck = resolve;
        });
        mocks.check.mockImplementation((binding) =>
            binding.key === 'KeyM' ? slowCheck : Promise.resolve(null)
        );
        const recorder = await openRecorder();
        fireEvent.keyDown(recorder, {
            code: 'KeyM',
            key: 'm',
            ctrlKey: true,
            altKey: true
        });
        await waitFor(() =>
            expect(mocks.check).toHaveBeenCalledWith({
                ...original,
                key: 'KeyM'
            })
        );
        fireEvent.keyDown(recorder, {
            code: 'KeyP',
            key: 'p',
            ctrlKey: true,
            altKey: true
        });
        await act(async () => finishCheck('inUse'));

        await waitFor(() =>
            expect(
                screen
                    .getByRole('button', { name: 'common.actions.save' })
                    .hasAttribute('disabled')
            ).toBe(false)
        );
        expect(screen.queryByRole('alert')).toBeNull();
        expect(useTrayShortcutStore.getState().snapshot?.binding).toEqual(
            original
        );
    });

    it('records physical keys and keeps the previous binding on registration failure', async () => {
        mocks.set.mockResolvedValue({
            kind: 'failed',
            error: 'unavailable',
            snapshot: { binding: original, status: 'active' }
        });
        const recorder = await openRecorder();
        fireEvent.keyDown(recorder, {
            code: 'KeyM',
            key: 'M',
            ctrlKey: true,
            shiftKey: true
        });
        await saveRecordedShortcut();

        expect((await screen.findByRole('alert')).textContent).toBe(
            'shortcuts.tray.error.unavailable'
        );
        expect(mocks.set).toHaveBeenCalledWith({
            control: true,
            alt: false,
            shift: true,
            key: 'KeyM'
        });
        expect(useTrayShortcutStore.getState().snapshot?.binding).toEqual(
            original
        );
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(mocks.recording).not.toHaveBeenCalledWith(false);
    });

    it('can record the already registered shortcut through the native event', async () => {
        await openRecorder();
        const handler = mocks.subscribe.mock.calls.find(
            ([event]) => event === 'trayShortcutRecorded'
        )?.[1];
        expect(handler).toBeDefined();
        act(() => handler?.(original));
        await saveRecordedShortcut();

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mocks.set).toHaveBeenCalledWith(original);
        expect(mocks.recording).toHaveBeenLastCalledWith(false);
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });

    it('cancels recording without changing the configured key', async () => {
        const recorder = await openRecorder();
        fireEvent.keyDown(recorder, {
            code: 'KeyM',
            key: 'm',
            ctrlKey: true,
            altKey: true
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.cancel' })
        );

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.recording).toHaveBeenLastCalledWith(false);
        expect(useTrayShortcutStore.getState().snapshot?.binding).toEqual(
            original
        );
    });

    it('clears the global binding', async () => {
        render(<TrayShortcutSetting />);
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.clear' })
        );

        await waitFor(() =>
            expect(useTrayShortcutStore.getState().snapshot?.status).toBe(
                'unset'
            )
        );
        expect(mocks.set).toHaveBeenCalledWith(null);
    });

    it('retries a saved shortcut that could not be registered on startup', async () => {
        useTrayShortcutStore.setState({
            snapshot: { binding: original, status: 'unavailable' }
        });
        render(<TrayShortcutSetting />);
        fireEvent.click(
            screen.getByRole('button', { name: 'common.action.retry' })
        );

        await waitFor(() =>
            expect(useTrayShortcutStore.getState().snapshot?.status).toBe(
                'active'
            )
        );
        expect(mocks.set).toHaveBeenCalledWith(original);
    });
});
