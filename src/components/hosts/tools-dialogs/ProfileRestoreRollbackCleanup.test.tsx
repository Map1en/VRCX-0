// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) =>
                ({
                    'profile_backup.rollback_data_retained':
                        'Pre-restore data retained',
                    'profile_backup.rollback_retained_description':
                        'Can be cleared after checking the restore.',
                    'profile_backup.rollback_cleanup_protected':
                        'Protected while restore is pending.',
                    'profile_backup.clear_rollback': 'Clear rollback data'
                })[key] ?? key
        })
    };
});

import { ProfileRestoreRollbackCleanup } from './ProfileBackupDialog';

describe('ProfileRestoreRollbackCleanup', () => {
    afterEach(cleanup);

    it('renders no region for loading, failed, or empty state', () => {
        const { rerender } = render(
            <ProfileRestoreRollbackCleanup
                state={null}
                cleanupRunning={false}
                onClear={vi.fn()}
            />
        );
        expect(screen.queryByText('Pre-restore data retained')).toBeNull();

        rerender(
            <ProfileRestoreRollbackCleanup
                state={{ count: 0, cleanupAllowed: false }}
                cleanupRunning={false}
                onClear={vi.fn()}
            />
        );
        expect(screen.queryByText('Pre-restore data retained')).toBeNull();
    });

    it('renders an enabled cleanup action when rollback data is available', () => {
        const onClear = vi.fn();
        render(
            <ProfileRestoreRollbackCleanup
                state={{ count: 1, cleanupAllowed: true }}
                cleanupRunning={false}
                onClear={onClear}
            />
        );

        expect(screen.getByText('Pre-restore data retained')).toBeTruthy();
        const button = screen.getByRole('button', {
            name: 'Clear rollback data'
        });
        expect((button as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(button);
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('disables cleanup and explains protection while a restore is active', () => {
        render(
            <ProfileRestoreRollbackCleanup
                state={{ count: 1, cleanupAllowed: false }}
                cleanupRunning={false}
                onClear={vi.fn()}
            />
        );

        expect(
            screen.getByText('Protected while restore is pending.')
        ).toBeTruthy();
        expect(
            (
                screen.getByRole('button', {
                    name: 'Clear rollback data'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
    });
});
