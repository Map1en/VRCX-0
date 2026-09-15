// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { AriaAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AppLauncherEntry,
    AppLauncherRun,
    AppLauncherSnapshot
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    platform: 'windows',
    snapshot: vi.fn(),
    setEnabled: vi.fn(),
    setEntries: vi.fn(),
    pickTarget: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values?.code === undefined ? key : `${key}:${values.code}`
    })
}));

vi.mock('@/repositories/appLauncherRepository', () => ({
    default: {
        snapshot: mocks.snapshot,
        setEnabled: mocks.setEnabled,
        setEntries: mocks.setEntries,
        pickTarget: mocks.pickTarget
    }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: { hostCapabilities: { platform: string } }) => unknown
    ) => selector({ hostCapabilities: { platform: mocks.platform } })
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/scroll-area', () => ({
    ScrollArea: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('@/ui/shadcn/switch', () => ({
    Switch: ({
        checked,
        disabled,
        onCheckedChange,
        ...props
    }: AriaAttributes & {
        checked: boolean;
        disabled?: boolean;
        onCheckedChange?: (checked: boolean) => void;
    }) => (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onCheckedChange?.(!checked)}
            {...props}
        />
    )
}));

vi.mock('@/ui/shadcn/toggle-group', () => ({
    ToggleGroupSeparator: () => null,
    ToggleGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ToggleGroupItem: ({
        children,
        disabled
    }: PropsWithChildren<{ disabled?: boolean }>) => (
        <button type="button" disabled={disabled}>
            {children}
        </button>
    )
}));

import { AppLauncherDialog } from './AppLauncherDialog';

function appEntry(patch: Partial<AppLauncherEntry> = {}): AppLauncherEntry {
    return {
        id: 'tool',
        enabled: true,
        name: 'Tool',
        kind: 'localApp',
        scope: 'all',
        target: String.raw`C:\Tools\Tool.exe`,
        args: '',
        launchDelaySeconds: 0,
        runPolicy: 'always',
        stopPolicy: 'closeByVrcx',
        runAsAdministrator: false,
        processName: 'Tool',
        workingDirectory: String.raw`C:\Tools`,
        ...patch
    };
}

function appRun(patch: Partial<AppLauncherRun>): AppLauncherRun {
    return {
        id: 'run',
        entryId: 'tool',
        entryName: 'Tool',
        kind: 'localApp',
        target: String.raw`C:\Tools\Tool.exe`,
        status: 'failed',
        stopPolicy: 'closeByVrcx',
        test: false,
        rootPid: null,
        trackedPids: [],
        startedAt: 1,
        finishedAt: 2,
        error: 'failed to launch Tool.exe',
        osErrorCode: null,
        skippedReason: null,
        ...patch
    };
}

function appSnapshot(run?: AppLauncherRun): AppLauncherSnapshot {
    return {
        enabled: true,
        entries: [appEntry()],
        activeSession: {
            id: 'session',
            steamvrRunning: false,
            startedAt: 1,
            runs: run ? [run] : []
        },
        testRuns: []
    };
}

describe('AppLauncherDialog Windows launch diagnostics', () => {
    beforeEach(() => {
        mocks.platform = 'windows';
        mocks.snapshot.mockReset();
        mocks.setEnabled.mockReset();
        mocks.setEntries.mockReset();
        mocks.pickTarget.mockReset();
    });

    afterEach(() => cleanup());

    it('shows actionable elevation guidance for Windows error 740', async () => {
        mocks.snapshot.mockResolvedValue(
            appSnapshot(appRun({ osErrorCode: 740 }))
        );

        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);

        expect(
            await screen.findByText(
                'dialog.app_launcher.run_error_elevation_required:740'
            )
        ).toBeTruthy();
    });

    it('shows that the user cancelled the UAC prompt for error 1223', async () => {
        mocks.snapshot.mockResolvedValue(
            appSnapshot(appRun({ osErrorCode: 1223 }))
        );

        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);

        expect(
            await screen.findByText(
                'dialog.app_launcher.run_error_elevation_cancelled:1223'
            )
        ).toBeTruthy();
    });

    it('shows the newest run after an active entry configuration is replaced', async () => {
        const snapshot = appSnapshot();
        snapshot.activeSession!.runs = [
            appRun({ id: 'old', status: 'running', error: null }),
            appRun({ id: 'new', status: 'failed' })
        ];
        mocks.snapshot.mockResolvedValue(snapshot);

        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);

        expect(
            await screen.findAllByText('dialog.app_launcher.run_status_failed')
        ).toHaveLength(1);
        expect(
            screen.queryByText('dialog.app_launcher.run_status_running')
        ).toBeNull();
    });

    it('keeps a row toggle in the draft so the next field commit does not revert it', async () => {
        const initial = appSnapshot();
        mocks.snapshot.mockResolvedValue(initial);
        mocks.setEntries.mockImplementation(
            async (entries: AppLauncherEntry[]) => ({
                ...initial,
                entries
            })
        );

        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);

        fireEvent.click(
            await screen.findByRole('switch', {
                name: 'dialog.app_launcher.enabled'
            })
        );
        await waitFor(() => expect(mocks.setEntries).toHaveBeenCalledTimes(1));

        const name = screen.getByLabelText('dialog.app_launcher.name');
        fireEvent.change(name, { target: { value: 'Renamed' } });
        fireEvent.blur(name);
        await waitFor(() => expect(mocks.setEntries).toHaveBeenCalledTimes(2));

        const [entries] = mocks.setEntries.mock.calls[1] as [
            AppLauncherEntry[]
        ];
        expect(entries[0]).toMatchObject({ enabled: false, name: 'Renamed' });
    });

    it('offers elevation only for Windows local apps, saves on toggle and keeps them running', async () => {
        const initial = appSnapshot();
        mocks.snapshot.mockResolvedValue(initial);
        mocks.setEntries.mockImplementation(
            async (entries: AppLauncherEntry[]) => ({
                ...initial,
                entries
            })
        );

        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);

        const elevation = await screen.findByRole('switch', {
            name: 'dialog.app_launcher.run_as_administrator'
        });
        fireEvent.click(elevation);

        await waitFor(() => expect(mocks.setEntries).toHaveBeenCalledTimes(1));
        const [entries] = mocks.setEntries.mock.calls[0] as [
            AppLauncherEntry[]
        ];
        expect(entries[0]).toMatchObject({
            runAsAdministrator: true,
            stopPolicy: 'keepRunning',
            workingDirectory: String.raw`C:\Tools`
        });

        cleanup();
        mocks.snapshot.mockResolvedValue({
            ...initial,
            entries: [
                appEntry({
                    kind: 'steamApp',
                    target: '438100'
                })
            ]
        });
        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);
        await screen.findAllByText('Tool');
        expect(
            screen.queryByRole('switch', {
                name: 'dialog.app_launcher.run_as_administrator'
            })
        ).toBeNull();
        expect(
            screen.getByText('dialog.app_launcher.stop_locked_steam')
        ).toBeTruthy();

        cleanup();
        mocks.platform = 'linux';
        mocks.snapshot.mockResolvedValue(initial);
        render(<AppLauncherDialog open onOpenChange={vi.fn()} />);
        await screen.findAllByText('Tool');
        expect(
            screen.queryByRole('switch', {
                name: 'dialog.app_launcher.run_as_administrator'
            })
        ).toBeNull();
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
