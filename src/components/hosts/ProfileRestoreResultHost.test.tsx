// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    takeLastResult: vi.fn(),
    getRollbackState: vi.fn(),
    clearRollback: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastDismiss: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            ({
                'common.actions.close': 'Close',
                'profile_backup.restore_failed_rolled_back':
                    'VRCX-0 returned to the data from before the restore.',
                'profile_backup.restore_failed_title':
                    'The backup could not be restored',
                'profile_backup.restore_failure.db_open_failed':
                    'The restored database could not be opened.',
                'profile_backup.restore_succeeded': 'Data restored from backup',
                'profile_backup.restore_completed': 'Restore complete',
                'profile_backup.rollback_retained_description':
                    'Pre-restore data retained.',
                'profile_backup.clear_rollback': 'Clear rollback data',
                'profile_backup.rollback_cleanup_confirm_title':
                    'Clear rollback data?',
                'profile_backup.rollback_cleanup_confirm_description':
                    'This cannot be undone.',
                'common.actions.cancel': 'Cancel'
            })[key] ?? key
    })
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError,
        dismiss: mocks.toastDismiss
    }
}));

vi.mock('@/services/profileBackupService', () => ({
    takeLastProfileRestoreResult: mocks.takeLastResult,
    getProfileRestoreRollbackState: mocks.getRollbackState,
    clearProfileRestoreRollback: mocks.clearRollback
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            shell: { backendRuntimeSnapshotHydrated: boolean };
        }) => unknown
    ) => selector({ shell: { backendRuntimeSnapshotHydrated: true } })
}));

vi.mock('@/ui/shadcn/alert-dialog', () => ({
    AlertDialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    AlertDialogContent: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    ),
    AlertDialogDescription: ({ children }: PropsWithChildren) => (
        <p>{children}</p>
    ),
    AlertDialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    AlertDialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    AlertDialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children, ...props }: ComponentProps<'button'>) => (
        <button {...props}>{children}</button>
    )
}));

import { useModalStore } from '@/state/modalStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';

import { ProfileRestoreResultHost } from './ProfileRestoreResultHost';

describe('ProfileRestoreResultHost', () => {
    beforeEach(() => {
        mocks.takeLastResult.mockReset();
        mocks.getRollbackState.mockReset();
        mocks.getRollbackState.mockResolvedValue({
            count: 0,
            cleanupAllowed: false
        });
        mocks.clearRollback.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.toastError.mockReset();
        mocks.toastDismiss.mockReset();
        useModalStore.getState().resetModalState();
        useProfileBackupStore.getState().resetProfileBackupState();
    });

    afterEach(cleanup);

    it('takes the startup result only once across rerenders', async () => {
        mocks.takeLastResult.mockResolvedValue(null);
        const view = render(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.takeLastResult).toHaveBeenCalledTimes(1);
        });
        view.rerender(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.takeLastResult).toHaveBeenCalledTimes(1);
        });
    });

    it('takes the startup result only once during a StrictMode mount', async () => {
        mocks.takeLastResult.mockResolvedValue({
            status: 'succeeded',
            dataDisposition: 'replaced',
            sourceFileName: 'backup.vrcx0backup',
            failure: null
        });

        render(
            <StrictMode>
                <ProfileRestoreResultHost />
            </StrictMode>
        );

        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
        });
        expect(mocks.takeLastResult).toHaveBeenCalledTimes(1);
    });

    it('shows one permanent bottom-right cleanup toast for retained rollback data', async () => {
        mocks.takeLastResult.mockResolvedValue({
            status: 'succeeded',
            dataDisposition: 'replaced',
            sourceFileName: 'backup.vrcx0backup',
            failure: null
        });
        mocks.getRollbackState.mockResolvedValue({
            count: 1,
            cleanupAllowed: true
        });
        const view = render(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
        });
        const [title, options] = mocks.toastSuccess.mock.calls[0];
        expect(title).toBe('Restore complete');
        expect(options).toMatchObject({
            id: 'profile-restore-rollback-retained',
            description: 'Pre-restore data retained.',
            duration: Infinity,
            position: 'bottom-right',
            closeButton: true,
            action: { label: 'Clear rollback data' }
        });

        const preventDefault = vi.fn();
        options.action.onClick({ preventDefault });
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(mocks.clearRollback).not.toHaveBeenCalled();

        view.rerender(<ProfileRestoreResultHost />);
        expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    });

    it('uses the ordinary success toast when rollback data cannot be offered for cleanup', async () => {
        mocks.takeLastResult.mockResolvedValue({
            status: 'succeeded',
            dataDisposition: 'replaced',
            sourceFileName: 'backup.vrcx0backup',
            failure: null
        });
        mocks.getRollbackState.mockRejectedValue(new Error('unavailable'));

        render(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledWith(
                'Data restored from backup',
                { description: 'backup.vrcx0backup' }
            );
        });
    });

    it('does not offer cleanup while rollback data is protected', async () => {
        mocks.takeLastResult.mockResolvedValue({
            status: 'succeeded',
            dataDisposition: 'replaced',
            sourceFileName: 'backup.vrcx0backup',
            failure: null
        });
        mocks.getRollbackState.mockResolvedValue({
            count: 1,
            cleanupAllowed: false
        });

        render(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledWith(
                'Data restored from backup',
                { description: 'backup.vrcx0backup' }
            );
        });
    });

    it('can show the cleanup reminder again for a new restore result', async () => {
        mocks.takeLastResult.mockResolvedValue({
            status: 'succeeded',
            dataDisposition: 'replaced',
            sourceFileName: 'backup.vrcx0backup',
            failure: null
        });
        mocks.getRollbackState.mockResolvedValue({
            count: 1,
            cleanupAllowed: true
        });
        const first = render(<ProfileRestoreResultHost />);
        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
        });
        first.unmount();

        useProfileBackupStore.getState().resetProfileBackupState();
        render(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(2);
        });
        expect(mocks.takeLastResult).toHaveBeenCalledTimes(2);
    });

    it('shows a dedicated typed failure dialog after rollback', async () => {
        mocks.takeLastResult.mockResolvedValue({
            status: 'failed',
            dataDisposition: 'rolledBack',
            sourceFileName: 'backup.vrcx0backup',
            failure: {
                code: 'databaseOpenFailed',
                path: null
            }
        });
        render(<ProfileRestoreResultHost />);

        expect(
            await screen.findByRole('heading', {
                name: 'The backup could not be restored'
            })
        ).toBeTruthy();
        expect(
            screen.getByText(
                'VRCX-0 returned to the data from before the restore.'
            )
        ).toBeTruthy();
        expect(
            screen.getByText('The restored database could not be opened.')
        ).toBeTruthy();
        expect(screen.getByText('backup.vrcx0backup')).toBeTruthy();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('ignores a failed startup result read without breaking the host', async () => {
        mocks.takeLastResult.mockRejectedValue(new Error('unavailable'));

        render(<ProfileRestoreResultHost />);

        await waitFor(() => {
            expect(mocks.takeLastResult).toHaveBeenCalledTimes(1);
        });
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        expect(
            screen.queryByRole('heading', {
                name: 'The backup could not be restored'
            })
        ).toBeNull();
    });
});
