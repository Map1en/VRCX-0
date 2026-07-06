import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');
    type MockProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Button: ({ children, ...props }: MockProps) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/checkbox', async () => {
    const React = await import('react');
    type MockProps = {
        checked?: boolean;
        disabled?: boolean;
    };

    return {
        Checkbox: ({ checked, disabled }: MockProps) =>
            React.createElement('input', {
                type: 'checkbox',
                checked,
                disabled,
                readOnly: true
            })
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');
    type MockProps = React.PropsWithChildren;

    return {
        Dialog: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: MockProps) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: MockProps) =>
            React.createElement('p', null, children),
        DialogHeader: ({ children }: MockProps) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: MockProps) =>
            React.createElement('h3', null, children),
        DialogTrigger: ({ children }: MockProps) => children
    };
});

vi.mock('@/ui/shadcn/input', async () => {
    const React = await import('react');
    type MockProps = Record<string, unknown>;

    return {
        Input: (props: MockProps) => React.createElement('input', props)
    };
});

vi.mock('@/ui/shadcn/select', async () => {
    const React = await import('react');
    type MockProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Select: ({ children, disabled }: MockProps) =>
            React.createElement('div', { 'data-disabled': disabled }, children),
        SelectContent: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        SelectGroup: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        SelectItem: ({ children, value }: MockProps) =>
            React.createElement('option', { value }, children),
        SelectTrigger: ({ children, id }: MockProps) =>
            React.createElement('button', { id }, children),
        SelectValue: () => React.createElement('span', null)
    };
});

vi.mock('@/ui/shadcn/switch', async () => {
    const React = await import('react');
    type MockProps = {
        checked?: boolean;
    };

    return {
        Switch: ({ checked }: MockProps) =>
            React.createElement('input', {
                type: 'checkbox',
                checked,
                readOnly: true
            })
    };
});

vi.mock('@/ui/shadcn/card', async () => {
    const React = await import('react');
    type MockProps = React.PropsWithChildren;

    return {
        Card: ({ children }: MockProps) =>
            React.createElement('section', null, children),
        CardContent: ({ children }: MockProps) =>
            React.createElement('div', null, children)
    };
});

vi.mock('@/ui/shadcn/field', async () => {
    const React = await import('react');
    type MockProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Field: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        FieldContent: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        FieldDescription: ({ children }: MockProps) =>
            React.createElement('p', null, children),
        FieldError: ({ children }: MockProps) =>
            React.createElement('p', null, children),
        FieldGroup: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        FieldLabel: ({ children, htmlFor }: MockProps) =>
            React.createElement('label', { htmlFor }, children),
        FieldTitle: ({ children }: MockProps) =>
            React.createElement('h3', null, children)
    };
});

vi.mock('@/ui/shadcn/toggle-group', async () => {
    const React = await import('react');
    type MockProps = React.PropsWithChildren;

    return {
        ToggleGroup: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        ToggleGroupItem: ({ children }: MockProps) =>
            React.createElement('button', null, children)
    };
});

import { WebhookSettingsGroup } from './WebhookSettingsGroup';

const noop = () => {};

describe('WebhookSettingsGroup', () => {
    it('keeps webhook URL and test controls enabled when only auth events are enabled', () => {
        const html = renderToStaticMarkup(
            <WebhookSettingsGroup
                prefs={{
                    webhookEnabled: false,
                    webhookAuthEventsEnabled: true,
                    webhookUrl: 'https://example.com/webhook',
                    webhookFormat: 'generic',
                    webhookFields: ''
                }}
                onWebhookEnabledChange={noop}
                onWebhookAuthEventsEnabledChange={noop}
                onWebhookUrlDraftChange={noop}
                onWebhookUrlBlur={noop}
                onWebhookFormatChange={noop}
                onWebhookFieldsChange={noop}
                onOpenWebhookNotificationFiltersDialog={noop}
                onTestWebhook={noop}
            />
        );

        expect(html).toContain('id="settings-webhook-url"');
        expect(html).not.toContain(
            'id="settings-webhook-url" class="w-full max-w-lg" disabled=""'
        );
        expect(html).toContain(
            'view.settings.notifications.notifications.webhook.send_test'
        );
        expect(html).not.toContain(
            '<button type="button" variant="outline" disabled="">view.settings.notifications.notifications.webhook.send_test</button>'
        );
    });
});
