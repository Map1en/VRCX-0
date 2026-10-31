import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';

import { cn } from '@/lib/utils';
import { useNavigationCacheStore } from '@/state/navigationCacheStore';
import { Card, CardContent, CardHeader } from '@/ui/shadcn/card';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';

type SettingsCardProps = {
    cardId: string;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    defaultOpen?: boolean;
    bodyClassName?: string;
    className?: string;
    children?: ReactNode;
};

export function SettingsCard({
    cardId,
    title,
    description,
    action,
    defaultOpen = true,
    bodyClassName = 'flex flex-col',
    className,
    children
}: SettingsCardProps) {
    const titleId = useId();
    const descriptionId = useId();
    const open = useNavigationCacheStore(
        (state) => state.settingsCards[cardId] ?? defaultOpen
    );
    const setOpen = useNavigationCacheStore(
        (state) => state.setSettingsCardOpen
    );

    return (
        <Collapsible
            render={<section />}
            data-settings-card-id={cardId}
            open={open}
            onOpenChange={(nextOpen) => setOpen(cardId, nextOpen)}
            className={cn('shrink-0', className)}
        >
            <Card className="bg-surface-raised text-foreground ring-stroke-subtle gap-0 py-0 shadow-none">
                <CardHeader className="flex flex-row items-center gap-2 p-0">
                    <h2 className="min-w-0 flex-1" aria-labelledby={titleId}>
                        <CollapsibleTrigger
                            aria-labelledby={titleId}
                            aria-describedby={
                                description ? descriptionId : undefined
                            }
                            className="hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex w-full items-center justify-between gap-3 rounded-t-xl px-4 py-2.5 text-left transition-colors duration-(--motion-fast) ease-(--ease-out-ui) outline-none focus-visible:ring-2 focus-visible:ring-inset active:bg-(--state-pressed-surface) motion-reduce:transition-none"
                        >
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span
                                    id={titleId}
                                    className="font-heading text-sm leading-snug font-semibold"
                                >
                                    {title}
                                </span>
                                {description ? (
                                    <span
                                        id={descriptionId}
                                        className="text-muted-foreground text-sm font-normal"
                                    >
                                        {description}
                                    </span>
                                ) : null}
                            </span>
                            <ChevronDownIcon
                                aria-hidden="true"
                                className={cn(
                                    'text-muted-foreground size-4 shrink-0 transition-transform duration-(--motion-fast) ease-(--ease-out-ui) motion-reduce:transition-none',
                                    !open && '-rotate-90'
                                )}
                            />
                        </CollapsibleTrigger>
                    </h2>
                    {action ? (
                        <div className="shrink-0 pr-4">{action}</div>
                    ) : null}
                </CardHeader>
                <CollapsibleContent keepMounted>
                    <CardContent
                        className={cn(
                            'bg-surface-panel border-stroke-subtle rounded-t-xl border-t px-4 py-2.5',
                            bodyClassName
                        )}
                    >
                        {children}
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}
