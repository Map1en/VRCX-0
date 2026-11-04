// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    translate: vi.fn(),
    getTranslationConfig: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appTranslationTranslate: mocks.translate }
}));

vi.mock('@/services/translationService', () => ({
    getTranslationConfig: mocks.getTranslationConfig
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn().mockResolvedValue('ja'),
        setString: vi.fn()
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

import { InviteMessageTranslator } from './InviteMessageTranslator';

describe('InviteMessageTranslator', () => {
    beforeEach(() => {
        mocks.getTranslationConfig.mockResolvedValue({ enabled: true });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('translates on click and applies the result to the draft', async () => {
        mocks.translate.mockResolvedValue({
            text: 'すぐ戻るよ',
            provider: 'google'
        });
        const onApply = vi.fn();
        render(
            <InviteMessageTranslator
                source="  back soon  "
                maxLength={64}
                disabled={false}
                onApply={onApply}
            />
        );
        const user = userEvent.setup();

        await user.click(
            await screen.findByRole('button', {
                name: 'dialog.invite_message.translate.translate'
            })
        );
        expect(mocks.translate).toHaveBeenCalledWith({
            text: 'back soon',
            targetLanguage: 'ja',
            overrides: null
        });
        await user.click(
            await screen.findByRole('button', {
                name: 'dialog.invite_message.translate.use'
            })
        );

        expect(onApply).toHaveBeenCalledWith('すぐ戻るよ');
    });

    it('blocks a translation over the limit and offers AI shortening', async () => {
        mocks.translate.mockResolvedValueOnce({
            text: 'x'.repeat(10),
            provider: 'openai'
        });
        mocks.translate.mockResolvedValueOnce({
            text: 'short',
            provider: 'openai'
        });
        const onApply = vi.fn();
        render(
            <InviteMessageTranslator
                source="back soon"
                maxLength={8}
                disabled={false}
                onApply={onApply}
            />
        );
        const user = userEvent.setup();

        await user.click(
            await screen.findByRole('button', {
                name: 'dialog.invite_message.translate.translate'
            })
        );
        const use = await screen.findByRole('button', {
            name: 'dialog.invite_message.translate.use'
        });
        expect((use as HTMLButtonElement).disabled).toBe(true);

        await user.click(
            screen.getByRole('button', {
                name: 'dialog.invite_message.translate.shorten'
            })
        );
        expect(mocks.translate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                overrides: expect.objectContaining({
                    prompt: expect.stringContaining('at most 8 characters')
                })
            })
        );
        await user.click(
            await screen.findByRole('button', {
                name: 'dialog.invite_message.translate.use'
            })
        );
        expect(onApply).toHaveBeenCalledWith('short');
    });

    it('stays hidden while translation is turned off', async () => {
        mocks.getTranslationConfig.mockResolvedValue({ enabled: false });
        render(
            <InviteMessageTranslator
                source="back soon"
                maxLength={64}
                disabled={false}
                onApply={vi.fn()}
            />
        );

        await Promise.resolve();
        expect(
            screen.queryByRole('button', {
                name: 'dialog.invite_message.translate.translate'
            })
        ).toBeNull();
    });
});
