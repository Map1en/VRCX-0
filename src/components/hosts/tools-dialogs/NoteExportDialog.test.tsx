// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    commands: {
        appNoteExportStatus: vi.fn(),
        appNoteExportStart: vi.fn(),
        appNoteExportCancel: vi.fn()
    },
    getUserMemoMap: vi.fn(),
    userImage: vi.fn(() => ''),
    unsubscribe: vi.fn(),
    t: (key: string) => key
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/platform/tauri/bindings', () => ({ commands: mocks.commands }));
vi.mock('@/services/entityMediaService', () => ({
    userImage: mocks.userImage
}));
vi.mock('@/services/dialogService', () => ({ openUserDialog: vi.fn() }));
vi.mock('@/services/runtime-event-bridge/subscription', () => ({
    subscribeRuntimeEvent: async () => mocks.unsubscribe
}));
vi.mock('./toolsDialogUtils', () => ({
    getUserMemoMap: mocks.getUserMemoMap,
    getFriendIds: (ids: string[]) => ids,
    normalizeExportMemo: (value: string) => value,
    truncateExportMemo: (value: string) => value.slice(0, 256)
}));
vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        onOpenChangeComplete
    }: PropsWithChildren<{
        onOpenChangeComplete?: (open: boolean) => void;
    }>) => (
        <div>
            {children}
            <button onClick={() => onOpenChangeComplete?.(false)}>
                finish-close
            </button>
        </div>
    ),
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>
}));
vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipTrigger: ({ render }: { render: ReactElement }) => render,
    TooltipContent: () => null
}));

import type { NoteExportStatus } from '@/platform/tauri/bindings';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { NoteExportDialog } from './NoteExportDialog';

const running: NoteExportStatus = {
    runId: 'run_one',
    status: 'running',
    total: 1,
    processed: 0,
    succeeded: 0,
    failed: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    items: [
        {
            userId: 'usr_one',
            displayName: 'One',
            note: 'memo',
            state: 'pending',
            error: null
        }
    ]
};

beforeEach(() => {
    mocks.getUserMemoMap.mockResolvedValue(new Map([['usr_one', 'memo']]));
    mocks.commands.appNoteExportStatus.mockResolvedValue({
        ...running,
        runId: '',
        status: 'idle',
        items: []
    });
    mocks.commands.appNoteExportCancel.mockResolvedValue({
        ...running,
        status: 'cancelled'
    });
    useFriendRosterStore.getState().applyFriendPatch({
        userId: 'usr_one',
        patch: {
            displayName: 'One',
            note: 'remote',
            bio: 'large profile text',
            bioLinks: ['https://example.com']
        }
    });
});

afterEach(() => {
    cleanup();
    useFriendRosterStore.getState().resetRoster();
    vi.clearAllMocks();
});

describe('note export dialog data lifetime', () => {
    it('keeps only preview fields and discards a start response delivered after closing', async () => {
        let finishStart: ((status: NoteExportStatus) => void) | undefined;
        mocks.commands.appNoteExportStart.mockImplementation(
            () =>
                new Promise<NoteExportStatus>((resolve) => {
                    finishStart = resolve;
                })
        );
        const onOpenChange = vi.fn();
        const view = render(
            <NoteExportDialog open onOpenChange={onOpenChange} />
        );
        await screen.findByDisplayValue('memo');
        expect(mocks.userImage).toHaveBeenCalledWith(
            expect.objectContaining({ note: 'remote' }),
            false,
            '512'
        );
        expect(mocks.userImage).not.toHaveBeenCalledWith(
            expect.objectContaining({ bio: 'large profile text' }),
            false,
            '512'
        );
        fireEvent.click(
            screen.getByRole('button', { name: /dialog.note_export.export/ })
        );
        await waitFor(() =>
            expect(mocks.commands.appNoteExportStart).toHaveBeenCalledTimes(1)
        );
        view.rerender(
            <NoteExportDialog open={false} onOpenChange={onOpenChange} />
        );
        expect(screen.getByDisplayValue('memo')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'finish-close' }));
        expect(screen.queryByDisplayValue('memo')).toBeNull();
        await act(async () => {
            finishStart?.(running);
        });
        expect(screen.queryByDisplayValue('memo')).toBeNull();
        expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('still cancels an active run when closed', async () => {
        mocks.commands.appNoteExportStatus.mockResolvedValue(running);
        const onOpenChange = vi.fn();
        const view = render(
            <NoteExportDialog open onOpenChange={onOpenChange} />
        );
        await screen.findByDisplayValue('memo');
        view.rerender(
            <NoteExportDialog open={false} onOpenChange={onOpenChange} />
        );
        await waitFor(() =>
            expect(mocks.commands.appNoteExportCancel).toHaveBeenCalledTimes(1)
        );
        fireEvent.click(screen.getByRole('button', { name: 'finish-close' }));
        expect(screen.queryByDisplayValue('memo')).toBeNull();
    });

    it.each(['start', 'cancel'] as const)(
        'ignores a late %s response after reopening',
        async (operation) => {
            let finishRequest: ((status: NoteExportStatus) => void) | undefined;
            const command =
                operation === 'start'
                    ? mocks.commands.appNoteExportStart
                    : mocks.commands.appNoteExportCancel;
            command.mockImplementationOnce(
                () =>
                    new Promise<NoteExportStatus>((resolve) => {
                        finishRequest = resolve;
                    })
            );
            if (operation === 'cancel') {
                mocks.commands.appNoteExportStatus.mockResolvedValue(running);
            }
            const onOpenChange = vi.fn();
            const view = render(
                <NoteExportDialog open onOpenChange={onOpenChange} />
            );
            await screen.findByDisplayValue('memo');
            fireEvent.click(
                screen.getByRole('button', {
                    name:
                        operation === 'start'
                            ? /dialog.note_export.export/
                            : 'dialog.note_export.cancel'
                })
            );
            expect(command).toHaveBeenCalledTimes(1);
            view.rerender(
                <NoteExportDialog open={false} onOpenChange={onOpenChange} />
            );
            fireEvent.click(
                screen.getByRole('button', { name: 'finish-close' })
            );

            mocks.commands.appNoteExportStatus.mockResolvedValue({
                ...running,
                runId: '',
                status: 'idle',
                items: []
            });
            mocks.getUserMemoMap.mockResolvedValue(
                new Map([['usr_one', 'new memo']])
            );
            view.rerender(
                <NoteExportDialog open onOpenChange={onOpenChange} />
            );
            await screen.findByDisplayValue('new memo');
            await act(async () => {
                finishRequest?.({
                    ...running,
                    status: 'cancelled',
                    items: [
                        {
                            ...running.items[0],
                            state: 'failed',
                            error: 'previous session error'
                        }
                    ]
                });
            });

            expect(screen.getByDisplayValue('new memo')).toBeTruthy();
            expect(screen.queryByText(/previous session error/)).toBeNull();
            expect(
                screen
                    .getByRole('button', { name: /dialog.note_export.export/ })
                    .hasAttribute('disabled')
            ).toBe(false);
        }
    );
});
