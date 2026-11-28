// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    confirmLegacyDatabaseMigration: vi.fn(),
    createDatabaseUpgradeGitHubIssue: vi.fn(),
    openDatabaseUpgradeDiscord: vi.fn(),
    openDatabaseUpgradeFailureLogFolder: vi.fn(),
    retryDatabaseUpgrade: vi.fn(),
    startFreshDatabaseAfterUpgradeFailure: vi.fn(),
    skipLegacyDatabaseMigration: vi.fn(),
    updateAppForNewerDatabase: vi.fn(),
    restartApplication: vi.fn()
}));

vi.mock('@/services/databaseUpgradeService', () => mocks);

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
    DialogContent: ({ children }: React.PropsWithChildren) => (
        <section>{children}</section>
    ),
    DialogDescription: ({ children }: React.PropsWithChildren) => (
        <p>{children}</p>
    ),
    DialogFooter: ({ children }: React.PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    DialogHeader: ({ children }: React.PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: React.PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restartApplication
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import { DatabaseUpgradeDialog } from './DatabaseUpgradeDialog';

describe('DatabaseUpgradeDialog', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('runs an indeterminate bar that never claims a completion amount', () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'running',
            stage: 'createWorkCopy',
            progressCompleted: 50,
            progressTotal: 100
        });

        render(<DatabaseUpgradeDialog open />);

        expect(
            screen.getByRole('progressbar').getAttribute('aria-valuenow')
        ).toBeNull();
    });

    it('holds back the stage detail until the upgrade has run long enough', () => {
        vi.useFakeTimers();
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'running',
            stage: 'notificationPerformanceIndexes'
        });

        const { container } = render(<DatabaseUpgradeDialog open />);
        const detail = container.querySelector('[aria-hidden="true"]');

        expect(detail).not.toBeNull();

        act(() => {
            vi.advanceTimersByTime(8000);
        });

        expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
        expect(
            screen.getByText(
                'message.database.upgrade_stage.notification_performance_indexes'
            )
        ).not.toBeNull();
        vi.useRealTimers();
    });

    it('offers a restart when the failure is neither retryable nor recoverable', () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'error',
            retryable: false,
            freshStartAvailable: false
        });

        render(<DatabaseUpgradeDialog open />);
        fireEvent.click(screen.getByText('message.database.restart_app'));

        expect(mocks.restartApplication).toHaveBeenCalledTimes(1);
    });

    it('shows the failure record without hiding migration retry and skip actions', () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            failureLogPath: 'C:/VRCX-0/error-log.txt'
        });

        render(<DatabaseUpgradeDialog open />);

        expect(screen.getByText('C:/VRCX-0/error-log.txt')).not.toBeNull();
        expect(
            screen.getByText('message.database.migration_skip')
        ).not.toBeNull();
        expect(
            screen.getByText('dialog.system.action.migrate_and_restart')
        ).not.toBeNull();
    });

    it('leads a newer-database block with updating and keeps a fresh start secondary', async () => {
        mocks.updateAppForNewerDatabase.mockResolvedValue(
            'opened-download-page'
        );
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'newer-schema',
            freshStartAvailable: true
        });

        render(<DatabaseUpgradeDialog open />);

        expect(
            screen.getByText('message.database.newer_schema_title')
        ).not.toBeNull();
        expect(
            screen.queryByText('message.database.create_github_issue')
        ).toBeNull();

        await act(async () => {
            fireEvent.click(
                screen.getByText('message.database.update_to_latest')
            );
        });
        expect(mocks.updateAppForNewerDatabase).toHaveBeenCalledTimes(1);
        expect(
            screen.getByText('message.database.update_opened_download_page')
        ).not.toBeNull();

        fireEvent.click(screen.getByText('message.database.contact_discord'));
        expect(mocks.openDatabaseUpgradeDiscord).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('message.database.use_new_database'));
        expect(
            mocks.startFreshDatabaseAfterUpgradeFailure
        ).toHaveBeenCalledTimes(1);
    });

    it('opens the log folder and GitHub new-issue actions from a failure', () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'error',
            failureLogPath: 'C:/VRCX-0/error-log.txt'
        });

        render(<DatabaseUpgradeDialog open />);
        fireEvent.click(
            screen.getByText('message.database.open_failure_log_folder')
        );
        fireEvent.click(
            screen.getByText('message.database.create_github_issue')
        );

        expect(mocks.openDatabaseUpgradeFailureLogFolder).toHaveBeenCalledTimes(
            1
        );
        expect(mocks.createDatabaseUpgradeGitHubIssue).toHaveBeenCalledTimes(1);
    });
});
