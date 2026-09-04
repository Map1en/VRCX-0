// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const mocks = vi.hoisted(() => ({
    launchVrchat: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => (key === 'dialog.launch.tile.vr' ? 'VR' : 'Desktop')
    })
}));

vi.mock('@/ui/shadcn/context-menu', () => ({
    ContextMenuGroup: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
    ),
    ContextMenuItem: ({
        children,
        ...props
    }: React.ComponentProps<'button'>) => (
        <button type="button" {...props}>
            {children}
        </button>
    )
}));

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn()
    }
}));

vi.mock('@/services/launchService', () => ({
    launchVrchat: mocks.launchVrchat
}));

import { LaunchModeContextMenuGroup } from './LaunchModeContextMenuGroup';

describe('LaunchModeContextMenuGroup', () => {
    it('maps the VR and Desktop choices to the existing launch service flag', async () => {
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled={false}
                errorMessage="Failed"
                location="wrld_test:123"
                shortName="token"
            />
        );

        fireEvent.click(getByRole('button', { name: 'VR' }));
        fireEvent.click(getByRole('button', { name: 'Desktop' }));

        await waitFor(() => {
            expect(mocks.launchVrchat).toHaveBeenNthCalledWith(
                1,
                'wrld_test:123',
                'token',
                false
            );
            expect(mocks.launchVrchat).toHaveBeenNthCalledWith(
                2,
                'wrld_test:123',
                'token',
                true
            );
        });
    });

    it('disables both launch modes together', () => {
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled
                errorMessage="Failed"
                location="wrld_test:123"
            />
        );

        expect(
            getByRole('button', { name: 'VR' }).hasAttribute('disabled')
        ).toBe(true);
        expect(
            getByRole('button', { name: 'Desktop' }).hasAttribute('disabled')
        ).toBe(true);
    });
});
