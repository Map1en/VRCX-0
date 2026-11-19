import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { MountOnIntent } from '@/components/MountOnIntent';
import { Tooltip, TooltipContent } from '@/ui/shadcn/tooltip';

export function IntentTooltip({
    content,
    side,
    contentClassName,
    'aria-label': ariaLabel,
    children
}: {
    content: ReactNode;
    side?: ComponentProps<typeof TooltipContent>['side'];
    contentClassName?: string;
    'aria-label'?: string;
    children: ReactElement;
}) {
    return (
        <MountOnIntent
            trigger="hover"
            aria-label={ariaLabel}
            render={(child) => (
                <Tooltip>
                    <TooltipPrimitive.Trigger render={child} />
                    <TooltipContent side={side} className={contentClassName}>
                        {content}
                    </TooltipContent>
                </Tooltip>
            )}
        >
            {children}
        </MountOnIntent>
    );
}

export function HintTooltip({
    label,
    children
}: {
    label: string;
    children: ReactElement;
}) {
    return (
        <IntentTooltip content={label} aria-label={label}>
            {children}
        </IntentTooltip>
    );
}
