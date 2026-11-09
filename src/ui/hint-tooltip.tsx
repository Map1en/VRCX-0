import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement } from 'react';

import { Tooltip, TooltipContent } from '@/ui/shadcn/tooltip';

export function HintTooltip({
    label,
    children
}: {
    label: string;
    children: ReactElement;
}) {
    return (
        <Tooltip>
            <TooltipPrimitive.Trigger aria-label={label} render={children} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
