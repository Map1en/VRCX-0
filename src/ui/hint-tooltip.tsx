import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement } from 'react';

import { MountOnIntent } from '@/components/MountOnIntent';
import { Tooltip, TooltipContent } from '@/ui/shadcn/tooltip';

export function HintTooltip({
    label,
    children
}: {
    label: string;
    children: ReactElement;
}) {
    return (
        <MountOnIntent
            trigger="hover"
            aria-label={label}
            render={(child) => (
                <Tooltip>
                    <TooltipPrimitive.Trigger render={child} />
                    <TooltipContent>{label}</TooltipContent>
                </Tooltip>
            )}
        >
            {children}
        </MountOnIntent>
    );
}
