// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cancelMigration: vi.fn(),
    requestMigration: vi.fn(),
    restartApplication: vi.fn(),
    setSystemHostOpen: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en' }
    })
}));

vi.mock('sonner', () => ({
    toast: { error: mocks.toastError }
}));

vi.mock('@/services/dataDirMigrationService', () => ({
    cancelDataDirMigration: mocks.cancelMigration,
    requestDataDirMigration: mocks.requestMigration
}));

vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restartApplication
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            setSystemHostOpen: typeof mocks.setSystemHostOpen;
        }) => T
    ) => selector({ setSystemHostOpen: mocks.setSystemHostOpen })
}));

vi.mock('@/ui/shadcn/alert-dialog', () => ({
    AlertDialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <>{children}</> : null,
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
    Button: ({
        children,
        variant: _variant,
        ...props
    }: PropsWithChildren<ComponentProps<'button'> & { variant?: string }>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/progress', () => ({
    Progress: ({ value }: { value: number }) => (
        <div
            role="progressbar"
            aria-label="migration-progress"
            aria-valuenow={value}
        />
    )
}));

import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';

import { DataDirMigrationDialog } from './DataDirMigrationDialog';

const plan = {
    targetPath: 'D:\\VRCX-0',
    requiredBytes: 2048,
    availableBytes: 1024,
    targetState: 'empty' as const
};

describe('DataDirMigrationDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useDataDirMigrationStore.getState().closeDialog();
        useDataDirMigrationStore.setState({
            status: { revision: 0, state: 'idle' },
            lastAppliedRevision: -1
        });
    });

    afterEach(cleanup);

    it('does not render without an active migration plan', () => {
        render(<DataDirMigrationDialog />);
        expect(
            screen.queryByRole('heading', { name: 'data_dir_migration.title' })
        ).toBeNull();
    });

    it('marks storage risks as dangerous and blocks only an unsafe migrate start', () => {
        useDataDirMigrationStore.getState().openDialog(plan);
        render(<DataDirMigrationDialog />);

        expect(
            screen
                .getByText('data_dir_migration.insufficient_space')
                .classList.contains('text-destructive')
        ).toBe(true);
        expect(
            screen
                .getByText('data_dir_migration.unsupported_storage_warning')
                .classList.contains('text-destructive')
        ).toBe(true);
        expect(
            (
                screen.getByRole('button', {
                    name: 'data_dir_migration.start'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);

        fireEvent.click(
            screen.getByRole('radio', {
                name: 'data_dir_migration.mode.freshStart'
            })
        );
        expect(
            screen.queryByText('data_dir_migration.insufficient_space')
        ).toBeNull();
        expect(
            screen
                .getByText('data_dir_migration.unsupported_storage_warning')
                .classList.contains('text-destructive')
        ).toBe(true);
        expect(
            (
                screen.getByRole('button', {
                    name: 'data_dir_migration.start_fresh'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
        expect(
            screen.queryByText('data_dir_migration.space_summary')
        ).toBeNull();
        expect(
            screen.getByText('data_dir_migration.mode_description.freshStart')
        ).toBeTruthy();
    });

    it('allows cancellation only during the copying phase', () => {
        const store = useDataDirMigrationStore.getState();
        store.openDialog({ ...plan, availableBytes: 4096 });
        store.applyStatus({
            revision: 1,
            state: 'running',
            phase: 'verifying',
            percent: 80
        });
        render(<DataDirMigrationDialog />);

        expect(
            (
                screen.getByRole('button', {
                    name: 'common.actions.cancel'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByText('80%')).toBeNull();

        act(() => {
            useDataDirMigrationStore.getState().applyStatus({
                revision: 2,
                state: 'running',
                phase: 'copying',
                percent: 40
            });
        });
        expect(
            (
                screen.getByRole('button', {
                    name: 'common.actions.cancel'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
        expect(
            screen.getByRole('progressbar').getAttribute('aria-valuenow')
        ).toBe('40');
    });

    it.each([
        ['preparing', 0],
        ['freezing', undefined],
        ['verifying', 100],
        ['committing', 100]
    ] as const)(
        'does not show copy percentages during %s',
        (phase, percent) => {
            const store = useDataDirMigrationStore.getState();
            store.openDialog(plan);
            store.applyStatus({
                revision: 1,
                state: 'running',
                phase,
                percent
            });
            render(<DataDirMigrationDialog />);

            expect(screen.queryByRole('progressbar')).toBeNull();
            expect(screen.queryByText(/\d+%/)).toBeNull();
            expect(
                screen.getByText(`data_dir_migration.phase.${phase}`)
            ).toBeTruthy();
            expect(
                screen.getByText('data_dir_migration.running_description')
            ).toBeTruthy();
        }
    );

    it('shows cancellation in progress and prevents repeated cancellation', () => {
        const store = useDataDirMigrationStore.getState();
        store.openDialog(plan);
        store.applyStatus({
            revision: 1,
            state: 'cancelling',
            phase: 'copying',
            percent: 40
        });
        render(<DataDirMigrationDialog />);

        const cancel = screen.getByRole('button', {
            name: 'data_dir_migration.cancelling'
        }) as HTMLButtonElement;
        expect(cancel.disabled).toBe(true);
        fireEvent.click(cancel);
        expect(mocks.cancelMigration).not.toHaveBeenCalled();
    });

    it.each([
        ['\\\\?\\D:\\VRCX-0', 'D:\\VRCX-0'],
        ['\\\\?\\UNC\\server\\share\\VRCX-0', '\\\\server\\share\\VRCX-0']
    ])(
        'keeps the original path %s when requesting a copy',
        async (targetPath, displayedPath) => {
            useDataDirMigrationStore
                .getState()
                .openDialog({ ...plan, targetPath, availableBytes: 4096 });
            mocks.requestMigration.mockResolvedValue({
                accepted: true,
                status: { revision: 1, state: 'completed' }
            });
            render(<DataDirMigrationDialog />);

            expect(screen.getByText(displayedPath)).toBeTruthy();
            expect(screen.queryByText(targetPath)).toBeNull();
            fireEvent.click(
                screen.getByRole('button', { name: 'data_dir_migration.start' })
            );
            await waitFor(() =>
                expect(mocks.requestMigration).toHaveBeenCalledWith(
                    targetPath,
                    'migrate'
                )
            );
        }
    );

    it('only warns about replacing existing data when copying into that folder', async () => {
        useDataDirMigrationStore
            .getState()
            .openDialog({ ...plan, targetState: 'existingProfile' });
        mocks.requestMigration.mockResolvedValue({
            accepted: true,
            status: { revision: 1, state: 'completed' }
        });
        render(<DataDirMigrationDialog />);

        expect(
            screen.getByText('data_dir_migration.target.existingProfile')
        ).toBeTruthy();
        expect(
            screen.queryByRole('radio', {
                name: 'data_dir_migration.mode.freshStart'
            })
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('radio', {
                name: 'data_dir_migration.mode.adoptExisting'
            })
        );
        expect(
            screen.queryByText('data_dir_migration.target.existingProfile')
        ).toBeNull();
        expect(
            screen.queryByText('data_dir_migration.space_summary')
        ).toBeNull();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'data_dir_migration.start_existing'
            })
        );
        await waitFor(() =>
            expect(mocks.requestMigration).toHaveBeenCalledWith(
                plan.targetPath,
                'adoptExisting'
            )
        );
    });

    it('starts fresh without requesting a data copy', async () => {
        useDataDirMigrationStore.getState().openDialog(plan);
        mocks.requestMigration.mockResolvedValue({
            accepted: true,
            status: { revision: 1, state: 'completed' }
        });
        render(<DataDirMigrationDialog />);

        fireEvent.click(
            screen.getByText('data_dir_migration.mode_description.freshStart')
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'data_dir_migration.start_fresh'
            })
        );
        await waitFor(() =>
            expect(mocks.requestMigration).toHaveBeenCalledWith(
                plan.targetPath,
                'freshStart'
            )
        );
    });

    it('opens the backup tool without starting a migration', () => {
        useDataDirMigrationStore.getState().openDialog(plan);
        render(<DataDirMigrationDialog />);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'data_dir_migration.create_backup_first'
            })
        );
        expect(mocks.setSystemHostOpen).toHaveBeenCalledWith(
            'profileBackupOpen',
            true
        );
        expect(useDataDirMigrationStore.getState().dialogOpen).toBe(false);
        expect(mocks.requestMigration).not.toHaveBeenCalled();
    });

    it('replaces migration controls with restart choices after completion', async () => {
        const store = useDataDirMigrationStore.getState();
        store.openDialog({ ...plan, availableBytes: 4096 });
        store.applyStatus({ revision: 1, state: 'completed' });
        render(<DataDirMigrationDialog />);

        expect(
            screen.queryByRole('button', { name: 'data_dir_migration.start' })
        ).toBeNull();
        for (const name of [
            'data_dir_migration.restart_later',
            'data_dir_migration.restart_now'
        ]) {
            expect(
                (screen.getByRole('button', { name }) as HTMLButtonElement)
                    .disabled
            ).toBe(false);
        }

        fireEvent.click(
            screen.getByRole('button', {
                name: 'data_dir_migration.restart_now'
            })
        );
        await waitFor(() =>
            expect(mocks.restartApplication).toHaveBeenCalledOnce()
        );
        expect(mocks.requestMigration).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'data_dir_migration.restart_later'
            })
        );
        expect(useDataDirMigrationStore.getState().dialogOpen).toBe(false);
    });
});
