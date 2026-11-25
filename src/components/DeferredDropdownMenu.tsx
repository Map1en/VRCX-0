import { useRender } from '@base-ui/react/use-render';
import { useState, type ReactElement, type ReactNode } from 'react';

import { HintTooltip } from '@/ui/hint-tooltip';
import { DropdownMenu, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function DeferredDropdownMenu({
    trigger,
    label,
    children
}: {
    trigger: ReactElement;
    label: string;
    children: ReactNode;
}) {
    const [mounted, setMounted] = useState(false);
    const placeholder = useRender({
        render: trigger,
        props: {
            'aria-haspopup': 'menu',
            'aria-expanded': false,
            onClick: () => setMounted(true)
        }
    });

    if (!mounted) {
        return <HintTooltip label={label}>{placeholder}</HintTooltip>;
    }

    return (
        <DropdownMenu defaultOpen>
            <Tooltip>
                <TooltipTrigger
                    aria-label={label}
                    render={<DropdownMenuTrigger render={trigger} />}
                />
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            {children}
        </DropdownMenu>
    );
}
