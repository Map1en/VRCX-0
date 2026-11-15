// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccentColorPicker } from './AccentColorPicker';

afterEach(cleanup);

const baseProps = {
    themeControlsAccent: false,
    accentOverride: false,
    accentThemeName: '',
    updateAccentOverride: vi.fn<() => Promise<void>>()
};

describe('AccentColorPicker theme override', () => {
    it('hides the override switch when no theme controls the accent', () => {
        render(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeColor="default"
                updateThemeColor={vi.fn<() => Promise<void>>()}
            />
        );

        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('lets the user override a theme-controlled accent', async () => {
        const user = userEvent.setup();
        const updateAccentOverride = vi.fn<() => Promise<void>>();
        render(
            <AccentColorPicker
                {...baseProps}
                accentControlled
                themeControlsAccent
                accentThemeName="Aurora"
                themeColor="blue"
                updateThemeColor={vi.fn<() => Promise<void>>()}
                updateAccentOverride={updateAccentOverride}
            />
        );

        expect(
            screen.getByText('view.themes.accent.provided_by_theme')
        ).toBeTruthy();
        expect(
            (
                screen.getByLabelText(
                    'view.themes.accent.hex_label'
                ) as HTMLInputElement
            ).disabled
        ).toBe(true);

        await user.click(screen.getByRole('switch'));

        expect(updateAccentOverride).toHaveBeenCalledWith(true);
    });

    it('enables the picker while the theme accent is overridden', () => {
        render(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeControlsAccent
                accentOverride
                accentThemeName="Aurora"
                themeColor="blue"
                updateThemeColor={vi.fn<() => Promise<void>>()}
            />
        );

        expect(
            screen.getByText('view.themes.accent.override_hint')
        ).toBeTruthy();
        expect(
            (
                screen.getByLabelText(
                    'view.themes.accent.hex_label'
                ) as HTMLInputElement
            ).disabled
        ).toBe(false);
    });
});

describe('AccentColorPicker custom color', () => {
    it('applies colors selected by the native picker', () => {
        const updateThemeColor = vi.fn<() => Promise<void>>();
        render(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeColor="default"
                updateThemeColor={updateThemeColor}
            />
        );

        fireEvent.change(screen.getByLabelText('view.themes.accent.custom'), {
            target: { value: '#ff00aa' }
        });

        expect(updateThemeColor).toHaveBeenCalledWith('#ff00aa');
    });

    it('normalizes a typed color when the input loses focus', async () => {
        const user = userEvent.setup();
        const updateThemeColor = vi.fn<() => Promise<void>>();
        render(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeColor="default"
                updateThemeColor={updateThemeColor}
            />
        );
        const input = screen.getByLabelText('view.themes.accent.hex_label');

        await user.clear(input);
        await user.type(input, '#0af');
        await user.tab();

        expect(updateThemeColor).toHaveBeenCalledWith('#00aaff');
        expect((input as HTMLInputElement).value).toBe('#00aaff');
    });

    it('shows and activates the custom color through its button', async () => {
        const user = userEvent.setup();
        const updateThemeColor = vi.fn<() => Promise<void>>();
        const { rerender } = render(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeColor="#123456"
                updateThemeColor={updateThemeColor}
            />
        );
        const customButton = screen.getByRole('button', {
            name: 'view.themes.accent.custom'
        });
        const swatch = customButton.querySelector('[aria-hidden="true"]');

        expect((swatch as HTMLSpanElement).style.backgroundColor).toBe(
            'rgb(18, 52, 86)'
        );
        expect(customButton.getAttribute('aria-pressed')).toBe('true');

        rerender(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeColor="default"
                updateThemeColor={updateThemeColor}
            />
        );

        expect(customButton.getAttribute('aria-pressed')).toBe('false');
        await user.click(customButton);
        expect(updateThemeColor).toHaveBeenCalledWith('#123456');
    });

    it('rejects invalid typed colors and disables both inputs when controlled', async () => {
        const user = userEvent.setup();
        const updateThemeColor = vi.fn<() => Promise<void>>();
        const { rerender } = render(
            <AccentColorPicker
                {...baseProps}
                accentControlled={false}
                themeColor="#123456"
                updateThemeColor={updateThemeColor}
            />
        );
        const textInput = screen.getByLabelText('view.themes.accent.hex_label');
        const customButton = screen.getByRole('button', {
            name: 'view.themes.accent.custom'
        });

        expect(customButton.getAttribute('aria-pressed')).toBe('true');

        await user.clear(textInput);
        await user.type(textInput, '#nope');
        await user.tab();

        expect(updateThemeColor).not.toHaveBeenCalled();
        expect((textInput as HTMLInputElement).value).toBe('#123456');

        rerender(
            <AccentColorPicker
                {...baseProps}
                accentControlled
                themeColor="#123456"
                updateThemeColor={updateThemeColor}
            />
        );

        expect(customButton.getAttribute('aria-pressed')).toBe('true');
        expect((customButton as HTMLButtonElement).disabled).toBe(true);
        expect(
            (
                screen.getByLabelText(
                    'view.themes.accent.custom'
                ) as HTMLInputElement
            ).disabled
        ).toBe(true);
        expect(
            (
                screen.getByLabelText(
                    'view.themes.accent.hex_label'
                ) as HTMLInputElement
            ).disabled
        ).toBe(true);
    });
});
