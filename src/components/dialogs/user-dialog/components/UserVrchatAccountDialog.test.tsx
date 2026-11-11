// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserVrchatAccountDialog } from './UserVrchatAccountDialog';

const mocks = vi.hoisted(() => ({
    standingGet: vi.fn(),
    toastAdd: vi.fn(),
    updateCurrentUser: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatCurrentUserAccountStandingGet: mocks.standingGet
    }
}));

vi.mock('@/repositories/vrchatRequest', () => ({
    unwrapVrchatResponse: (response: unknown) => ({ json: response })
}));

vi.mock('@/services/currentUserProfileService', () => ({
    default: { updateCurrentUser: mocks.updateCurrentUser }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

afterEach(cleanup);

beforeEach(() => {
    mocks.standingGet.mockReset();
    mocks.standingGet.mockResolvedValue({ standing: 'good' });
    mocks.toastAdd.mockReset();
    mocks.updateCurrentUser.mockReset();
});

function renderDialog(
    overrides: Partial<Parameters<typeof UserVrchatAccountDialog>[0]> = {}
) {
    return render(
        <UserVrchatAccountDialog
            open
            onOpenChange={vi.fn()}
            currentUserId="usr_self"
            contentFilters={['content_horror']}
            hideContentFilterSettings={false}
            {...overrides}
        />
    );
}

function openContentFilters() {
    fireEvent.click(
        screen.getByRole('tab', {
            name: 'dialog.user.vrchat_account.tabs.content_filters'
        })
    );
}

function filterSwitch(item: string) {
    return screen.getByRole('switch', {
        name: `dialog.user.vrchat_account.content_filters.items.${item}`
    });
}

describe('UserVrchatAccountDialog content filters', () => {
    it('sends the existing filters plus the newly enabled one', async () => {
        mocks.updateCurrentUser.mockResolvedValue({
            contentFilters: ['content_horror', 'content_gore']
        });
        renderDialog();
        openContentFilters();

        expect(filterSwitch('horror').getAttribute('aria-checked')).toBe(
            'true'
        );
        fireEvent.click(filterSwitch('gore'));

        expect(mocks.updateCurrentUser).toHaveBeenCalledWith({
            userId: 'usr_self',
            params: { contentFilters: ['content_horror', 'content_gore'] }
        });
        await waitFor(() =>
            expect(filterSwitch('gore').getAttribute('aria-checked')).toBe(
                'true'
            )
        );
    });

    it('removes only the disabled filter', () => {
        mocks.updateCurrentUser.mockResolvedValue({
            contentFilters: ['content_gore']
        });
        renderDialog({ contentFilters: ['content_horror', 'content_gore'] });
        openContentFilters();

        fireEvent.click(filterSwitch('horror'));

        expect(mocks.updateCurrentUser).toHaveBeenCalledWith({
            userId: 'usr_self',
            params: { contentFilters: ['content_gore'] }
        });
    });

    it('restores the previous state when the update fails', async () => {
        mocks.updateCurrentUser.mockRejectedValue(new Error('network'));
        renderDialog();
        openContentFilters();

        fireEvent.click(filterSwitch('gore'));

        await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledOnce());
        expect(mocks.toastAdd.mock.calls[0]?.[0]).toMatchObject({
            type: 'error'
        });
        expect(filterSwitch('gore').getAttribute('aria-checked')).toBe('false');
        expect(filterSwitch('horror').getAttribute('aria-checked')).toBe(
            'true'
        );
    });

    it('shows a notice instead of switches when VRChat hides the settings', () => {
        renderDialog({ hideContentFilterSettings: true });
        openContentFilters();

        expect(
            screen.getByText(
                'dialog.user.vrchat_account.content_filters.unavailable'
            )
        ).toBeTruthy();
        expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });
});

describe('UserVrchatAccountDialog account standing', () => {
    it('opens on the account standing tab', async () => {
        mocks.standingGet.mockResolvedValue({
            standing: 'restricted',
            sanctions: [{}]
        });
        renderDialog();

        expect(await screen.findByText('restricted')).toBeTruthy();
        expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });
});
