// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsCard } from '@/components/layout/SettingsCard';
import { useNavigationCacheStore } from '@/state/navigationCacheStore';

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppCache: 16 },
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    readTextFile: vi.fn().mockResolvedValue('{}')
}));

function Draft() {
    const [value, setValue] = useState('');
    return (
        <input
            aria-label="Draft"
            value={value}
            onChange={(event) => setValue(event.target.value)}
        />
    );
}

describe('SettingsCard', () => {
    afterEach(cleanup);
    beforeEach(() => {
        useNavigationCacheStore.setState({ hydrated: true, settingsCards: {} });
    });

    it('toggles independently by keyboard, preserves drafts and remembers across remounts', async () => {
        const user = userEvent.setup();
        const view = render(
            <>
                <SettingsCard cardId="general" title="General">
                    <Draft />
                </SettingsCard>
                <SettingsCard cardId="display" title="Display">
                    <button>Display action</button>
                </SettingsCard>
            </>
        );
        await user.type(
            screen.getByRole('textbox', { name: 'Draft' }),
            'unsaved'
        );
        const trigger = screen.getByRole('button', { name: 'General' });
        trigger.focus();
        await user.keyboard('{Enter}');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('textbox', { name: 'Draft' })).toBeNull();
        expect(
            screen
                .getByRole('button', { name: 'Display' })
                .getAttribute('aria-expanded')
        ).toBe('true');
        await user.tab();
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Display' })
        );
        trigger.focus();
        await user.keyboard(' ');
        expect(
            screen.getByRole('textbox', { name: 'Draft' }).getAttribute('value')
        ).toBe('unsaved');
        await user.click(trigger);
        view.unmount();
        render(
            <SettingsCard cardId="general" title="Translated title">
                <Draft />
            </SettingsCard>
        );
        expect(
            screen
                .getByRole('button', { name: 'Translated title' })
                .getAttribute('aria-expanded')
        ).toBe('false');
    });

    it('honors stored states over defaults and keeps header actions independent', async () => {
        useNavigationCacheStore.setState({
            settingsCards: { diagnostics: true }
        });
        const user = userEvent.setup();
        const configure = vi.fn();
        render(
            <>
                <SettingsCard
                    cardId="diagnostics"
                    title="Diagnostics"
                    defaultOpen={false}
                    description="Diagnostic tools"
                    action={<button onClick={configure}>Configure</button>}
                >
                    <button>Refresh</button>
                </SettingsCard>
                <SettingsCard
                    cardId="unused"
                    title="Unused"
                    defaultOpen={false}
                >
                    Hidden
                </SettingsCard>
            </>
        );
        await user.click(screen.getByRole('button', { name: 'Configure' }));
        expect(configure).toHaveBeenCalledOnce();
        expect(
            screen
                .getByRole('button', { name: 'Diagnostics' })
                .getAttribute('aria-expanded')
        ).toBe('true');
        expect(
            screen
                .getByRole('button', { name: 'Unused' })
                .getAttribute('aria-expanded')
        ).toBe('false');
    });
});
