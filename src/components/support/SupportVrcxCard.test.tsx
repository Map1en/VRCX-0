import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
    const translations: Record<string, string> = {
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

import { SupportVrcxCard } from './SupportVrcxCard';

describe('SupportVrcxCard', () => {
    it('renders the hardcoded Afdian support action', () => {
        const html = renderToStaticMarkup(React.createElement(SupportVrcxCard));

        expect(html).toContain('爱发电');
    });

    it('renders GitHub Sponsors and Ko-fi support actions', () => {
        const html = renderToStaticMarkup(React.createElement(SupportVrcxCard));

        expect(html).toContain('Support VRCX-0');
        expect(html).toContain('GitHub Sponsors');
        expect(html).toContain('Ko-fi');
    });
});
