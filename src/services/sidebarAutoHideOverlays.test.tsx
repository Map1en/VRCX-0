// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';

import {
    isSidebarAutoHideInteractionBlocked,
    observeSidebarAutoHideInteractions
} from './sidebarAutoHideService';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/services/shellIntegrationService', () => ({
    setTaskbarOverlayNotification: vi.fn(),
    setTrayIconNotification: vi.fn()
}));

type OverlayKind = 'select' | 'dialog' | 'popover' | 'menu' | 'sheet';

function overlay(kind: OverlayKind, open: boolean): ReactNode {
    switch (kind) {
        case 'select':
            return (
                <Select open={open} items={[{ value: 'one', label: 'One' }]}>
                    <SelectTrigger>
                        <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                            <SelectItem value="one">One</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            );
        case 'dialog':
            return (
                <Dialog open={open}>
                    <DialogTrigger>Open</DialogTrigger>
                    <DialogContent>
                        <DialogTitle>Dialog</DialogTitle>
                    </DialogContent>
                </Dialog>
            );
        case 'popover':
            return (
                <Popover open={open}>
                    <PopoverTrigger>Open</PopoverTrigger>
                    <PopoverContent>Popover</PopoverContent>
                </Popover>
            );
        case 'menu':
            return (
                <DropdownMenu open={open}>
                    <DropdownMenuTrigger>Open</DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuGroup>
                            <DropdownMenuItem>Item</DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            );
        case 'sheet':
            return (
                <Sheet open={open} modal="trap-focus">
                    <SheetContent side="right" variant="inset">
                        <SheetHeader>
                            <SheetTitle>Notifications</SheetTitle>
                        </SheetHeader>
                    </SheetContent>
                </Sheet>
            );
    }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    container = document.createElement('div');
    container.id = 'root';
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('auto-hide with real application overlays', () => {
    it.each<OverlayKind>(['select', 'dialog', 'popover', 'menu', 'sheet'])(
        'blocks an open %s and releases it on close',
        async (kind) => {
            const changes = vi.fn<(blocked: boolean) => void>();
            const dispose = observeSidebarAutoHideInteractions(changes);
            try {
                await act(async () => root.render(overlay(kind, true)));
                if (kind === 'select') {
                    const list = document.querySelector('[role="listbox"]');
                    expect(list).not.toBeNull();
                    expect(list?.hasAttribute('data-open')).toBe(false);
                    expect(
                        list
                            ?.closest('[data-slot="select-content"]')
                            ?.hasAttribute('data-open')
                    ).toBe(true);
                }
                const measure = vi.spyOn(
                    HTMLElement.prototype,
                    'getClientRects'
                );
                expect(isSidebarAutoHideInteractionBlocked()).toBe(true);
                expect(measure).not.toHaveBeenCalled();
                measure.mockRestore();
                expect(changes).toHaveBeenLastCalledWith(true);
                await act(async () => root.render(overlay(kind, false)));
                expect(isSidebarAutoHideInteractionBlocked()).toBe(false);
                expect(changes).toHaveBeenLastCalledWith(false);
            } finally {
                dispose();
            }
        }
    );
});
