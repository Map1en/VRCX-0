// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

import { LoginServerStatusAlert } from './LoginServerStatusAlert';

describe('LoginServerStatusAlert', () => {
    afterEach(cleanup);

    it('stays hidden while servers are operational', () => {
        const { container } = render(
            <LoginServerStatusAlert
                indicator="none"
                status=""
                summary=""
                onOpenStatusPage={() => undefined}
            />
        );

        expect(container.childElementCount).toBe(0);
    });

    it('shows the incident summary and opens the status page', () => {
        const onOpenStatusPage = vi.fn();
        render(
            <LoginServerStatusAlert
                indicator="major"
                status="Major Service Outage"
                summary="Authentication is unavailable"
                onOpenStatusPage={onOpenStatusPage}
            />
        );

        expect(screen.getByRole('alert').textContent).toContain(
            'Authentication is unavailable'
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'status_bar.view_status' })
        );
        expect(onOpenStatusPage).toHaveBeenCalledTimes(1);
    });
});
