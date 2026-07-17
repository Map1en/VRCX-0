// @vitest-environment jsdom

import { render } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    refreshRollbackState: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/features/tools/useProfileBackupSettings', () => ({
    useProfileBackupSettings: () => ({
        settings: {
            autoEnabled: false,
            autoIntervalDays: 7,
            autoRetainExtra: 2,
            autoTargetDir: '',
            lastAutoAt: null
        },
        loading: false,
        saving: false,
        startingManualBackup: false,
        validatingRestore: false,
        numericDraftValue: () => '3',
        setNumericDraft: vi.fn(),
        commitNumericDraft: vi.fn(),
        setAutoEnabled: vi.fn(),
        chooseAutomaticBackupFolder: vi.fn(),
        startManualBackup: vi.fn(),
        selectBackupToRestore: vi.fn()
    })
}));

vi.mock('@/features/tools/useProfileRestoreRollback', () => ({
    useProfileRestoreRollback: () => ({
        rollbackState: null,
        cleanupRunning: false,
        refreshRollbackState: mocks.refreshRollbackState,
        confirmAndClearRollback: vi.fn()
    })
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

import { ProfileBackupDialog } from './ProfileBackupDialog';

describe('ProfileBackupDialog rollback refresh', () => {
    beforeEach(() => {
        mocks.refreshRollbackState.mockReset();
        mocks.refreshRollbackState.mockResolvedValue(null);
    });

    it('refreshes rollback state independently every time the dialog opens', () => {
        const view = render(
            <ProfileBackupDialog open onOpenChange={vi.fn()} />
        );
        expect(mocks.refreshRollbackState).toHaveBeenCalledTimes(1);

        view.rerender(<ProfileBackupDialog open onOpenChange={vi.fn()} />);
        expect(mocks.refreshRollbackState).toHaveBeenCalledTimes(1);

        view.rerender(
            <ProfileBackupDialog open={false} onOpenChange={vi.fn()} />
        );
        view.rerender(<ProfileBackupDialog open onOpenChange={vi.fn()} />);
        expect(mocks.refreshRollbackState).toHaveBeenCalledTimes(2);
    });
});
