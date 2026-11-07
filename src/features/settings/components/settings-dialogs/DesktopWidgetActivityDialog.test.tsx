// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    ActivityFilterProfile,
    ActivityTypeDefinition
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appOverlayActivityDefinitionsGet: vi.fn(),
    appSavedGroupFavoritesGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appOverlayActivityDefinitionsGet:
            mocks.appOverlayActivityDefinitionsGet,
        appSavedGroupFavoritesGet: mocks.appSavedGroupFavoritesGet
    }
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <>{children}</> : null,
    DialogClose: ({ render }: { render: ReactElement }) => render,
    DialogContent: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    ),
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/tabs', () => ({
    Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('@/ui/shadcn/scroll-area', () => ({
    ScrollArea: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('@/ui/shadcn/select', () => ({
    Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectItem: ({ children }: PropsWithChildren) => <span>{children}</span>,
    SelectTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectValue: () => null
}));

vi.mock('@/ui/shadcn/dropdown-menu', () => ({
    DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DropdownMenuCheckboxItem: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    DropdownMenuContent: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    DropdownMenuGroup: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    DropdownMenuLabel: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    DropdownMenuTrigger: ({ render }: { render: ReactElement }) => render
}));

import { DesktopWidgetActivityDialog } from './WristFeedNotificationsDialog';

function definition(
    key: ActivityTypeDefinition['key'],
    scopes: Pick<
        ActivityTypeDefinition,
        | 'wristDefaultScope'
        | 'alertDefaultScope'
        | 'desktopDefaultScope'
        | 'ttsDefaultScope'
        | 'widgetDefaultScope'
    >
): ActivityTypeDefinition {
    return {
        key,
        category: 'favoriteMovement',
        allowedScopes: ['off', 'on', 'friends', 'allFavorites'],
        aliases: [],
        ...scopes
    };
}

const definitions: ActivityTypeDefinition[] = [
    definition('Online', {
        wristDefaultScope: 'off',
        alertDefaultScope: 'off',
        desktopDefaultScope: 'off',
        ttsDefaultScope: 'off',
        widgetDefaultScope: 'allFavorites'
    }),
    definition('GPS', {
        wristDefaultScope: 'friends',
        alertDefaultScope: 'friends',
        desktopDefaultScope: 'friends',
        ttsDefaultScope: 'friends',
        widgetDefaultScope: 'off'
    })
];

const customized: ActivityFilterProfile = {
    version: 1,
    types: {
        Online: { scope: 'off', favoriteGroupKeys: 'all' },
        GPS: { scope: 'on', favoriteGroupKeys: 'all' }
    }
};

describe('DesktopWidgetActivityDialog', () => {
    afterEach(cleanup);

    it('resets the desktop overlay activity to its own recommended defaults and saves them', async () => {
        mocks.appOverlayActivityDefinitionsGet.mockResolvedValue(definitions);
        mocks.appSavedGroupFavoritesGet.mockResolvedValue({ collections: [] });
        const onSave = vi.fn(async (value: ActivityFilterProfile) => value);
        const onOpenChange = vi.fn();
        render(
            <DesktopWidgetActivityDialog
                open
                onOpenChange={onOpenChange}
                value={customized}
                onSave={onSave}
            />
        );

        expect(screen.getByText('dialog.desktop_widget.title')).toBeTruthy();
        expect(
            screen.getByText('dialog.desktop_widget.description')
        ).toBeTruthy();

        const reset = screen.getByRole('button', {
            name: 'common.actions.reset'
        }) as HTMLButtonElement;
        await waitFor(() => expect(reset.disabled).toBe(false));
        fireEvent.click(reset);
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith({
                version: 1,
                types: {
                    Online: { scope: 'allFavorites', favoriteGroupKeys: 'all' },
                    GPS: { scope: 'off', favoriteGroupKeys: 'all' }
                }
            })
        );
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });
});
