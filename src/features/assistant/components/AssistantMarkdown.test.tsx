// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
