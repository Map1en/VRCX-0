// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDLE_PROFILE_RESTORE_STATE } from '@/state/profileRestoreStore';

const mocks = vi.hoisted(() => ({
    acknowledge: vi.fn(),
    confirmCurrentProfile: vi.fn(),
    rollback: vi.fn(),
    useProfileRestore: vi.fn()
}));

const labels: Record<string, string> = {
    'view.settings.general.profile_backup.restore_status_awaiting_confirmation':
        'Confirm restored profile',
    'view.settings.general.profile_backup.restore_status_blocked':
        'Restore blocked',
    'view.settings.general.profile_backup.restore_notice_description':
        'Review the restored data',
    'view.settings.general.profile_backup.confirm_restored_profile':
        'Current Data Is Correct',
    'view.settings.general.profile_backup.rollback_now': 'Roll Back Now'
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => labels[key] ?? key
    })
}));

vi.mock('@/features/profile-restore/useProfileRestore', () => ({
    useProfileRestore: mocks.useProfileRestore
}));

import { ProfileRestoreNoticeHost } from './ProfileRestoreNoticeHost';

function model(overrides: Record<string, unknown> = {}) {
    return {
        acknowledge: mocks.acknowledge,
        busy: null,
        confirmCurrentProfile: mocks.confirmCurrentProfile,
        error: null,
        loaded: true,
        rollback: mocks.rollback,
        state: IDLE_PROFILE_RESTORE_STATE,
        ...overrides
    };
}

describe('ProfileRestoreNoticeHost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.useProfileRestore.mockReturnValue(model());
    });

    afterEach(() => {
        cleanup();
    });

    it('stays hidden for idle state', () => {
        const { container } = render(<ProfileRestoreNoticeHost />);

        expect(container.firstChild).toBeNull();
    });

    it('keeps confirmation and rollback actions visible globally', async () => {
        const user = userEvent.setup();
        mocks.useProfileRestore.mockReturnValue(
            model({
                state: {
                    ...IDLE_PROFILE_RESTORE_STATE,
                    status: 'restoredAwaitingConfirmation',
                    canConfirm: true,
                    canRollback: true
                }
            })
        );
        render(<ProfileRestoreNoticeHost />);

        expect(screen.getByText('Confirm restored profile')).toBeTruthy();
        expect(screen.getByText('Review the restored data')).toBeTruthy();
        await user.click(
            screen.getByRole('button', { name: 'Current Data Is Correct' })
        );
        await user.click(screen.getByRole('button', { name: 'Roll Back Now' }));
        expect(mocks.confirmCurrentProfile).toHaveBeenCalledOnce();
        expect(mocks.rollback).toHaveBeenCalledOnce();
    });

    it('shows blocked diagnostics as a persistent error', () => {
        mocks.useProfileRestore.mockReturnValue(
            model({
                state: {
                    ...IDLE_PROFILE_RESTORE_STATE,
                    status: 'blocked',
                    message:
                        "Recovery files remain in 'C:\\AppData\\profile-restore\\active'."
                }
            })
        );
        render(<ProfileRestoreNoticeHost />);

        expect(screen.getByText('Restore blocked')).toBeTruthy();
        expect(screen.getByText(/profile-restore\\active/)).toBeTruthy();
    });
});
