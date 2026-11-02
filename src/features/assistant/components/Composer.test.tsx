// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            ({
                'assistant.composer_placeholder': 'Write a message',
                'assistant.send': 'Send',
                'assistant.stop': 'Stop'
            })[key] ?? key
    })
}));

import { Composer } from './Composer';

describe('Composer', () => {
    afterEach(cleanup);

    it('enables send only for non-whitespace input and submits trimmed text', () => {
        const onSend = vi.fn();
        render(
            <Composer
                busy={false}
                disabled={false}
                onSend={onSend}
                onStop={vi.fn()}
            />
        );

        const input = screen.getByPlaceholderText(
            'Write a message'
        ) as HTMLTextAreaElement;
        const send = screen.getByTitle('Send') as HTMLButtonElement;

        expect(send.disabled).toBe(true);
        fireEvent.change(input, { target: { value: '   ' } });
        expect(send.disabled).toBe(true);

        fireEvent.change(input, { target: { value: '  hello there  ' } });
        expect(send.disabled).toBe(false);
        fireEvent.click(send);

        expect(onSend).toHaveBeenCalledWith('hello there');
        expect(input.value).toBe('');
    });

    it('sends on Enter but not while an IME composition is open', () => {
        const onSend = vi.fn();
        render(
            <Composer
                busy={false}
                disabled={false}
                toolbar={<button type="button">Model</button>}
                onSend={onSend}
                onStop={vi.fn()}
            />
        );
        const input = screen.getByPlaceholderText('Write a message');
        fireEvent.change(input, { target: { value: 'こんにちは' } });

        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        expect(onSend).not.toHaveBeenCalled();

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSend).toHaveBeenCalledWith('こんにちは');
        expect(screen.getByRole('button', { name: 'Model' })).toBeTruthy();
    });

    it('sends a suggestion shown above the input as is', () => {
        const onSend = vi.fn();
        render(
            <Composer
                busy={false}
                disabled={false}
                suggestions={['Who did I play with most this week?']}
                onSend={onSend}
                onStop={vi.fn()}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'Who did I play with most this week?'
            })
        );

        expect(onSend).toHaveBeenCalledWith(
            'Who did I play with most this week?'
        );
    });

    it('keeps stop available while a disabled busy turn is running', () => {
        const onStop = vi.fn();
        render(<Composer busy disabled onSend={vi.fn()} onStop={onStop} />);

        expect(screen.queryByTitle('Send')).toBeNull();
        expect(
            (
                screen.getByPlaceholderText(
                    'Write a message'
                ) as HTMLTextAreaElement
            ).disabled
        ).toBe(true);

        const stop = screen.getByTitle('Stop') as HTMLButtonElement;
        expect(stop.disabled).toBe(false);
        fireEvent.click(stop);
        expect(onStop).toHaveBeenCalledOnce();
    });
});
