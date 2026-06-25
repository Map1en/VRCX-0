import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
    const translations: Record<string, string> = {
        'common.actions.close': 'Close',
        'support_vrcx.description':
            'Support future VRCX-0 development through GitHub Sponsors or Ko-fi.',
        'support_vrcx.github_sponsors': 'GitHub Sponsors',
        'support_vrcx.kofi': 'Ko-fi',
        'support_vrcx.title': 'Support VRCX-0'
    };

    return {
        useTranslation: () => ({
            t: (key: string) => translations[key] || key
        })
    };
});

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

vi.mock('@/ui/shadcn/card', async () => {
    const React = await import('react');

    return {
        Card: ({ children }: any) =>
            React.createElement('section', null, children),
        CardContent: ({ children }: any) =>
            React.createElement('div', null, children),
        CardDescription: ({ children }: any) =>
            React.createElement('p', null, children),
        CardHeader: ({ children }: any) =>
            React.createElement('header', null, children),
        CardTitle: ({ children }: any) =>
            React.createElement('h2', null, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: any) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: any) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: any) =>
            React.createElement('p', null, children),
        DialogFooter: ({ children, showCloseButton }: any) =>
            React.createElement(
                'footer',
                null,
                children,
                showCloseButton
                    ? React.createElement('button', null, 'Close')
                    : null
            ),
        DialogHeader: ({ children }: any) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: any) =>
            React.createElement('h1', null, children)
    };
});

import { SupportVrcxDialog } from './SupportVrcxDialog';

describe('SupportVrcxDialog', () => {
    it('renders independent support actions and a close action', () => {
        const html = renderToStaticMarkup(
            React.createElement(SupportVrcxDialog, {
                open: true,
                onOpenChange: vi.fn()
            })
        );

        expect(html).toContain('Support VRCX-0');
        expect(html).toContain('GitHub Sponsors');
        expect(html).toContain('Ko-fi');
        expect(html).toContain('爱发电');
        expect(html).toContain('Close');
    });
});
