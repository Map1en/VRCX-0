// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dialogs = vi.hoisted(() => ({
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));
vi.mock('@/services/dialogService', () => dialogs);

import { AssistantMarkdown } from './AssistantMarkdown';

describe('AssistantMarkdown', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders fenced code as a copyable code block', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const code = '{\n  "id": "usr_1"\n}';

        const { container } = render(
            <AssistantMarkdown
                text={`Result:\n\n\`\`\`json\n${code}\n\`\`\``}
            />
        );

        const lines = container.querySelectorAll(
            '[data-slot="code-block-line"]'
        );
        expect(Array.from(lines, (line) => line.textContent)).toEqual(
            code.split('\n')
        );

        expect(
            container.querySelector('[data-slot="code-block-title"]')
                ?.textContent
        ).toBe('JSON');

        const copyButton = container.querySelector(
            '[data-slot="code-block-copy-button"]'
        );
        expect(copyButton).not.toBeNull();
        fireEvent.click(copyButton as Element);
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    });

    it('styles unfinished Markdown while the answer is streaming', () => {
        const { container } = render(
            <AssistantMarkdown
                text={'Online now:\n\n**Three friends, see [the list'}
                streaming
            />
        );

        expect(container.querySelector('strong')?.textContent).toBe(
            'Three friends, see the list'
        );
        expect(container.querySelector('button')).toBeNull();
        expect(container.textContent).not.toContain('*');
        expect(container.textContent).not.toContain('[');
    });

    it('keeps blank-line separated lists and code in one element', () => {
        const code = 'first\n\n    indented\n\nlast';
        const { container } = render(
            <AssistantMarkdown
                text={`1. Alice\n\n2. Bob\n\n   joined later\n\n\`\`\`text\n${code}\n\`\`\`\n\nDone.`}
            />
        );

        expect(container.querySelectorAll('ol')).toHaveLength(1);
        expect(container.querySelectorAll('li')).toHaveLength(2);
        expect(
            Array.from(
                container.querySelectorAll('[data-slot="code-block-line"]'),
                (line) => line.textContent?.trimEnd()
            )
        ).toEqual(code.split('\n'));
        expect(container.lastElementChild?.textContent).toBe('Done.');
    });

    it('turns names the tools returned into chips that open them', () => {
        const { container } = render(
            <AssistantMarkdown
                text={
                    'Most with **K0519** (not K05190), at 米白温馨小屋. Also `K0519` and [x](vrcx-0://user/open?id=usr_fake).'
                }
                entities={[
                    { kind: 'user', id: 'usr_k', displayName: 'K0519' },
                    {
                        kind: 'world',
                        id: 'wrld_m',
                        displayName: '米白温馨小屋'
                    },
                    { kind: 'user', id: 'usr_al', displayName: 'Al' },
                    { kind: 'user', id: 'usr_1', displayName: '孤' }
                ]}
            />
        );

        const buttons = Array.from(container.querySelectorAll('button'));
        expect(buttons.map((button) => button.textContent)).toEqual([
            'K0519',
            '米白温馨小屋',
            'x'
        ]);

        fireEvent.click(buttons[0]);
        expect(dialogs.openUserDialog).toHaveBeenCalledWith({
            userId: 'usr_k'
        });
        fireEvent.click(buttons[1]);
        expect(dialogs.openWorldDialog).toHaveBeenCalledWith({
            worldId: 'wrld_m'
        });
        fireEvent.click(buttons[2]);
        expect(dialogs.openUserDialog).toHaveBeenCalledTimes(1);
    });
});
