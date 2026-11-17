import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

import { MountOnIntent } from '@/components/MountOnIntent';
import { ContextMenu, ContextMenuTrigger } from '@/ui/shadcn/context-menu';

type DeferredContextMenuProps = Omit<
    ComponentPropsWithRef<'div'>,
    'children'
> & {
    trigger: ReactElement;
    children: ReactNode;
};

export function DeferredContextMenu({
    trigger,
    children,
    ...forwardedProps
}: DeferredContextMenuProps) {
    return (
        <MountOnIntent
            {...forwardedProps}
            trigger="contextmenu"
            render={(child) => (
                <ContextMenu>
                    <ContextMenuTrigger render={child} />
                    {children}
                </ContextMenu>
            )}
        >
            {trigger}
        </MountOnIntent>
    );
}
