// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HintTooltip, IntentTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

describe('HintTooltip', () => {
    afterEach(() => {
        cleanup();
    });

    it('names the trigger, shows the label on hover and keeps the click handler', async () => {
        const onClick = vi.fn();
        render(
            <HintTooltip label="Refresh">
                <Button type="button" onClick={onClick}>
                    R
                </Button>
            </HintTooltip>
        );

        fireEvent.pointerEnter(
            screen.getByRole('button', { name: 'Refresh' }),
            { pointerType: 'mouse' }
        );

        await waitFor(() => {
            expect(screen.getByText('Refresh')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('names a wrapped menu trigger without breaking the menu', async () => {
        render(
            <DropdownMenu>
                <HintTooltip label="More">
                    <DropdownMenuTrigger
                        render={<Button type="button">M</Button>}
                    />
                </HintTooltip>
                <DropdownMenuContent>
                    <DropdownMenuItem>Item</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );

        const trigger = screen.getByRole('button', { name: 'More' });
        expect(trigger.getAttribute('data-slot')).toBe('dropdown-menu-trigger');
        fireEvent.click(trigger);

        await waitFor(() => {
            expect(screen.getByRole('menuitem', { name: 'Item' })).toBeTruthy();
        });
    });

    it('shows rich content on hover without renaming the trigger', async () => {
        render(
            <IntentTooltip
                contentClassName="custom-content"
                content={<strong>Full date</strong>}
            >
                <span>3 days ago</span>
            </IntentTooltip>
        );

        const trigger = screen.getByText('3 days ago');
        expect(trigger.getAttribute('aria-label')).toBeNull();
        fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });

        const content = await screen.findByText('Full date');
        expect(content.closest('.custom-content')).not.toBeNull();
    });
});
