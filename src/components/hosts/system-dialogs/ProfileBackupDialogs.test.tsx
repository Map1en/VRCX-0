// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { StrictMode, type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    discard: vi.fn(),
    request: vi.fn(),
    translate: (key: string) => key
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mocks.translate })
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        success: mocks.toastSuccess
    }
}));

vi.mock('@/services/profileBackupService', () => ({
    discardStagedProfileRestore: mocks.discard,
    requestProfileRestore: mocks.request
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
    AlertDialogMedia: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    AlertDialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children, ...props }: ComponentProps<'button'>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/progress', () => ({
    Progress: ({ value }: { value: number }) => (
        <div aria-label="restore-progress" data-value={value} />
    )
}));

import { useProfileBackupStore } from '@/state/profileBackupStore';

import { ProfileBackupDialogs } from './ProfileBackupDialogs';

const restoreValidation = {
    sourceFileName: 'profile.vrcx0backup',
    stagedSha256: 'abc123',
    stagedBytes: 1024,
    archive: 'valid',
    appVersion: 'compatible',
    databaseVersion: 'compatible',
    database: 'valid',
    manifest: {
        createdAt: '2026-07-15T00:00:00Z',
        appVersion: '2.13.0',
        dbVersion: 18,
        platform: 'windows',
        kind: 'manual'
    }
} as const;

describe('ProfileBackupDialogs', () => {
    beforeEach(() => {
        sessionStorage.clear();
        mocks.toastError.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.discard.mockReset();
        mocks.request.mockReset();
        useProfileBackupStore.getState().resetProfileBackupState();
    });

    afterEach(cleanup);

    it('claims an outcome once during a StrictMode mount', async () => {
        useProfileBackupStore.getState().applyStatus({
            revision: 7,
            state: 'idle',
            kind: null,
            phase: null,
            percent: null,
            error: null,
            lastOutcome: {
                revision: 7,
                kind: 'manual',
                succeeded: true,
                fileName: 'VRCX-0-manual.vrcx0backup',
                errorCode: null
            }
        });

        render(
            <StrictMode>
                <ProfileBackupDialogs />
            </StrictMode>
        );

        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
        });
        expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it('shows determinate phase progress but not a fake database percentage', () => {
        useProfileBackupStore.getState().beginRestoreValidation();
        useProfileBackupStore.getState().applyRestoreProgress({
            revision: 1,
            operation: 'validate',
            phase: 'copyArchive',
            processedBytes: 50,
            totalBytes: 100,
            percent: 50
        });
        const view = render(<ProfileBackupDialogs />);

        expect(
            screen.getByText('profile_backup.restore_progress_copy')
        ).toBeTruthy();
        expect(screen.getByText('50%')).toBeTruthy();
        expect(
            screen.getByLabelText('restore-progress').getAttribute('data-value')
        ).toBe('50');

        useProfileBackupStore.getState().applyRestoreProgress({
            revision: 2,
            operation: 'validate',
            phase: 'checkDatabase',
            processedBytes: 0,
            totalBytes: null,
            percent: null
        });
        view.rerender(<ProfileBackupDialogs />);

        expect(
            screen.getByText('profile_backup.restore_progress_database_check')
        ).toBeTruthy();
        expect(screen.queryByText('50%')).toBeNull();
        expect(screen.queryByLabelText('restore-progress')).toBeNull();
    });

    it('discards staged data when the confirmation is cancelled', async () => {
        mocks.discard.mockResolvedValue(null);
        useProfileBackupStore
            .getState()
            .showRestoreConfirmation(restoreValidation);
        render(<ProfileBackupDialogs />);

        fireEvent.click(screen.getByText('common.actions.cancel'));
        fireEvent.click(screen.getByText('common.actions.cancel'));

        await waitFor(() => expect(mocks.discard).toHaveBeenCalledTimes(1));
        expect(useProfileBackupStore.getState().restoreFlow).toBe('idle');
    });

    it('submits only the confirmed staged hash and enters preparation once', () => {
        mocks.request.mockReturnValue(new Promise(() => {}));
        useProfileBackupStore
            .getState()
            .showRestoreConfirmation(restoreValidation);
        render(<ProfileBackupDialogs />);

        fireEvent.click(screen.getByText('profile_backup.restore_and_restart'));

        expect(mocks.request).toHaveBeenCalledTimes(1);
        expect(mocks.request).toHaveBeenCalledWith('abc123');
        expect(useProfileBackupStore.getState().restoreFlow).toBe('preparing');
        expect(screen.queryByText('common.actions.cancel')).toBeNull();
    });
});
