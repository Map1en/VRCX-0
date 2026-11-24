// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

import { SecretInput } from '@/ui/secret-input';

describe('SecretInput', () => {
    afterEach(cleanup);

    it('masks the value until the user asks to show it, and can hide it again', () => {
        render(
            <SecretInput
                aria-label="API key"
                value="sk-secret"
                onChange={vi.fn()}
            />
        );
        const input = screen.getByLabelText('API key');
        expect(input.getAttribute('type')).toBe('password');

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.show_secret' })
        );
        expect(input.getAttribute('type')).toBe('text');

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.hide_secret' })
        );
        expect(input.getAttribute('type')).toBe('password');
    });
});
