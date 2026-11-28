// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ModerationTypeIndicator } from './ModerationViewParts';

describe('ModerationTypeIndicator', () => {
    afterEach(() => {
        cleanup();
    });

    it('constrains the label wrapper to cell width and shows the full label on hover', async () => {
        const label = 'アバターインタラクションを許可';
        render(<ModerationTypeIndicator type="interactOn" label={label} />);

        const labelNode = screen.getByText(label);
        const wrapper = labelNode.parentElement;
        expect(labelNode.className).toContain('truncate');
        expect(wrapper).not.toBeNull();
        expect(wrapper?.className).toContain('flex');
        expect(wrapper?.className).toContain('w-full');
        expect(wrapper?.className).toContain('min-w-0');
        expect(wrapper?.className).not.toContain('inline-flex');
        expect(wrapper?.getAttribute('aria-label')).toBeNull();

        fireEvent.pointerEnter(wrapper!, { pointerType: 'mouse' });

        await waitFor(() => {
            const tooltip = document.querySelector(
                '[data-slot="tooltip-content"]'
            );
            expect(tooltip?.textContent).toBe(label);
        });
    });
});
