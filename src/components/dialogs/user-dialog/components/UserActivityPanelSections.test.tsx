import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { UserActivityStatusDistributionSection } from './UserActivityPanelSections';

const translations = vi.hoisted<Record<string, string>>(() => ({
    'dialog.user.activity.status_distribution.header':
        'Status change log share',
    'dialog.user.activity.status_distribution.description':
        'Recorded changes, not online time.',
    'dialog.user.activity.status_distribution.chart_center_label': 'logs',
    'dialog.user.activity.status_distribution.no_data': 'No status changes',
    'dialog.user.status.join_me': 'Join Me',
    'dialog.user.status.online': 'Online',
    'dialog.user.status.ask_me': 'Ask Me',
    'dialog.user.status.busy': 'Do Not Disturb'
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        i18n: { resolvedLanguage: 'en' },
        t: (key: string) => translations[key] || key
    })
}));

describe('UserActivityStatusDistributionSection', () => {
    it('renders all four friend-status colors with log percentages and counts', () => {
        const html = renderToStaticMarkup(
            <UserActivityStatusDistributionSection
                distribution={{
                    joinMeCount: 4,
                    activeCount: 2,
                    askMeCount: 1,
                    busyCount: 1,
                    totalCount: 8
                }}
            />
        );

        expect(html).toContain('Status change log share');
        expect(html).toContain('Recorded changes, not online time.');
        expect(html).toContain('stroke="var(--status-joinme)"');
        expect(html).toContain('stroke="var(--status-online)"');
        expect(html).toContain('stroke="var(--status-askme)"');
        expect(html).toContain('stroke="var(--status-busy)"');
        expect(html).toContain('Join Me 50%');
        expect(html).toContain('(4)');
        expect(html).toContain('role="img"');
    });

    it('shows a status-log-specific empty message when online history exists alone', () => {
        const html = renderToStaticMarkup(
            <UserActivityStatusDistributionSection
                distribution={{
                    joinMeCount: 0,
                    activeCount: 0,
                    askMeCount: 0,
                    busyCount: 0,
                    totalCount: 0
                }}
            />
        );

        expect(html).toContain('No status changes');
        expect(html).not.toContain('role="img"');
    });
});
