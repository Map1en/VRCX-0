import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
    const translations: Record<string, string> = {
        'common.actions.close': 'Close',
        'dialog.change_log.empty': 'No changelog',
        'dialog.change_log.header': 'Change Log',
        'dialog.change_log.latest_release': 'Latest release',
        'dialog.change_log.star_on_github': 'Star on GitHub',
        'dialog.change_log.support_description':
            'A GitHub Star is the easiest way to support the project.',
        'dialog.change_log.support_development': 'Support development',
        'dialog.change_log.support_title': 'If VRCX-0 helps you'
    };

    return {
        useTranslation: () => ({
            i18n: {
                language: 'en',
                resolvedLanguage: 'en'
            },
            t: (key: string) => translations[key] || key
        })
    };
});

vi.mock('@/services/changelogService', () => ({
    fetchChangelogRelease: vi.fn(),
    parseChangelog: () => ({
        entries: [] as unknown[],
        note: ''
    }),
    resolvePreferredChangelogLanguage: () => 'en'
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({ children, ...props }: any) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: any) =>
            React.createElement('div', null, children),
        DialogClose: ({ children }: any) =>
            React.createElement(React.Fragment, null, children),
        DialogContent: ({ children }: any) =>
            React.createElement('section', null, children),
        DialogFooter: ({ children }: any) =>
            React.createElement('footer', null, children),
        DialogHeader: ({ children }: any) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: any) =>
            React.createElement('h1', null, children)
    };
});

vi.mock('@/ui/shadcn/scroll-area', async () => {
    const React = await import('react');

    return {
        ScrollArea: ({ children }: any) =>
            React.createElement('div', null, children)
    };
});

vi.mock('@/ui/shadcn/spinner', async () => {
    const React = await import('react');

    return {
        Spinner: () => React.createElement('span', null, 'loading')
    };
});

vi.mock('@/ui/shadcn/tabs', async () => {
    const React = await import('react');

    return {
        Tabs: ({ children }: any) => React.createElement('div', null, children),
        TabsContent: ({ children }: any) =>
            React.createElement('div', null, children),
        TabsList: ({ children }: any) =>
            React.createElement('div', null, children),
        TabsTrigger: ({ children }: any) =>
            React.createElement('button', null, children)
    };
});

import { ChangelogDialog } from './ChangelogDialog';

describe('ChangelogDialog', () => {
    it('orders support actions before the close action in the footer', () => {
        const html = renderToStaticMarkup(
            React.createElement(ChangelogDialog, {
                open: true,
                onOpenChange: vi.fn()
            })
        );

        const supportIndex = html.indexOf('Support development');
        const starIndex = html.indexOf('Star on GitHub');
        const closeIndex = html.indexOf('Close');

        expect(supportIndex).toBeGreaterThan(-1);
        expect(starIndex).toBeGreaterThan(-1);
        expect(closeIndex).toBeGreaterThan(-1);
        expect(html).not.toContain('Ko-fi');
        expect(supportIndex).toBeLessThan(starIndex);
        expect(starIndex).toBeLessThan(closeIndex);
    });
});
