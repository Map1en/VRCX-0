// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HintTooltip } from '@/ui/hint-tooltip';
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

        const button = screen.getByRole('button', { name: 'Refresh' });
        fireEvent.pointerEnter(button, { pointerType: 'mouse' });
        fireEvent.mouseEnter(button);
        fireEvent.mouseMove(button);

        await waitFor(() => {
            expect(screen.getByText('Refresh')).toBeTruthy();
        });

        fireEvent.click(button);
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
});
