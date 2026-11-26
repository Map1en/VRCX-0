// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
        CardHeader: ({ children }: MockProps) =>
            React.createElement('header', null, children),
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
        ToggleGroupSeparator: () => null,
        ToggleGroup: ({ children }: MockProps) =>
            React.createElement('div', null, children),
        ToggleGroupItem: ({ children }: MockProps) =>
            React.createElement('button', null, children)
    };
});

import { WebhookSettingsGroup } from './WebhookSettingsGroup';

const noop = () => {};

describe('WebhookSettingsGroup', () => {
    afterEach(cleanup);

    it('keeps webhook URL and test controls enabled when only auth events are enabled', () => {
        render(
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
                onWebhookPauseWithDoNotDisturbChange={noop}
                onWebhookUrlCommit={noop}
                onWebhookFormatChange={noop}
                onWebhookFieldsChange={noop}
                onOpenWebhookNotificationFiltersDialog={noop}
                onTestWebhook={noop}
                deliverySnapshot={null}
                deliveryStatusLoading={false}
                onRefreshDeliveryStatus={noop}
            />
        );

        const urlInput = document.getElementById('settings-webhook-url');
        expect(urlInput).toBeInstanceOf(HTMLInputElement);
        expect((urlInput as HTMLInputElement).disabled).toBe(false);
        expect(
            (
                screen.getByRole('button', {
                    name: 'view.settings.notifications.notifications.webhook.send_test'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
    });

    it('saves the webhook URL only when the edit is committed', () => {
        const onWebhookUrlCommit = vi.fn();
        render(
            <WebhookSettingsGroup
                prefs={{
                    webhookEnabled: true,
                    webhookAuthEventsEnabled: false,
                    webhookUrl: 'https://example.com/old',
                    webhookFormat: 'generic',
                    webhookFields: ''
                }}
                onWebhookEnabledChange={noop}
                onWebhookAuthEventsEnabledChange={noop}
                onWebhookPauseWithDoNotDisturbChange={noop}
                onWebhookUrlCommit={onWebhookUrlCommit}
                onWebhookFormatChange={noop}
                onWebhookFieldsChange={noop}
                onOpenWebhookNotificationFiltersDialog={noop}
                onTestWebhook={noop}
                deliverySnapshot={null}
                deliveryStatusLoading={false}
                onRefreshDeliveryStatus={noop}
            />
        );

        const urlInput = document.getElementById(
            'settings-webhook-url'
        ) as HTMLInputElement;
        fireEvent.change(urlInput, {
            target: { value: 'https://example.com/new' }
        });
        expect(onWebhookUrlCommit).not.toHaveBeenCalled();
        expect(urlInput.value).toBe('https://example.com/new');

        fireEvent.keyDown(urlInput, { key: 'Enter' });
        expect(onWebhookUrlCommit).toHaveBeenCalledExactlyOnceWith(
            'https://example.com/new'
        );
    });
});
