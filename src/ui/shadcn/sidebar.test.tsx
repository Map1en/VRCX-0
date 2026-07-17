import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider
} from './sidebar';

function getSlotClassName(markup: string, slot: string): string {
    const element = Array.from(markup.matchAll(/<[^>]+>/g))
        .map((match) => match[0])
        .find((tag) => tag.includes(`data-slot="${slot}"`));
    const className = element?.match(/class="([^"]+)"/)?.[1];
    if (!className) {
        throw new Error(`Missing ${slot} class name.`);
    }
    return className;
}

function renderSidebarTransitions(instantSidebarTransition: boolean): string {
    return renderToStaticMarkup(
        <SidebarProvider instantSidebarTransition={instantSidebarTransition}>
            <SidebarGroupLabel>Group</SidebarGroupLabel>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton>Item</SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarProvider>
    );
}

describe('Sidebar transitions', () => {
    it('disables group-label and menu-button layout transitions when instant', () => {
        const markup = renderSidebarTransitions(true);

        expect(getSlotClassName(markup, 'sidebar-group-label')).toContain(
            'transition-none'
        );
        expect(getSlotClassName(markup, 'sidebar-menu-button')).toContain(
            'transition-none'
        );
    });

    it('keeps group-label and menu-button layout transitions aligned at 200ms', () => {
        const markup = renderSidebarTransitions(false);

        expect(getSlotClassName(markup, 'sidebar-group-label')).toContain(
            'transition-[margin,opacity] duration-200'
        );
        expect(getSlotClassName(markup, 'sidebar-menu-button')).toContain(
            'transition-[width,height,padding,color,background-color] duration-200'
        );
    });
});
