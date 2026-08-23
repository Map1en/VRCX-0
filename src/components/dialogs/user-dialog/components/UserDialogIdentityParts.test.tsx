// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/ui/shadcn/hover-card', () => ({
    HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
    HoverCardTrigger: ({ render }: { render: ReactElement }) => render,
    HoverCardContent: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

import { PreviousDisplayNamesBadge } from './UserDialogIdentityParts';

afterEach(cleanup);

describe('PreviousDisplayNamesBadge', () => {
    it('copies the clicked previous display name', () => {
        const onCopyName = vi.fn();

        render(
            <PreviousDisplayNamesBadge
                names={[
                    {
                        displayName: 'Recent Name',
                        updated_at: '2026-08-24T00:00:00Z'
                    },
                    { displayName: 'Older Name' }
                ]}
                onCopyName={onCopyName}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'common.actions.copy: Recent Name (2 previous names)'
            })
        );

        expect(onCopyName).toHaveBeenCalledOnce();
        expect(onCopyName).toHaveBeenLastCalledWith('Recent Name');

        fireEvent.click(
            screen.getByRole('button', {
                name: 'common.actions.copy: Older Name'
            })
        );

        expect(onCopyName).toHaveBeenCalledTimes(2);
        expect(onCopyName).toHaveBeenLastCalledWith('Older Name');
    });
});
