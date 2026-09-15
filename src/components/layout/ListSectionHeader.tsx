import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Collapsible, CollapsibleTrigger } from '@/ui/shadcn/collapsible';

export function ListSectionHeader({
    id,
    title,
    count,
    open,
    isFirst = false,
    onToggle
}: {
    id?: string;
    title?: string;
    count?: number;
    open?: boolean;
    isFirst?: boolean;
    onToggle: (id: string) => void;
}) {
    const isOpen = Boolean(open);

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={(nextOpen) => {
                if (nextOpen !== isOpen) {
                    onToggle(id || '');
                }
            }}
            className={isFirst ? undefined : 'pt-2'}
        >
            <CollapsibleTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="aria-expanded:hover:text-foreground w-full justify-between aria-expanded:bg-transparent aria-expanded:text-inherit aria-expanded:hover:bg-(--state-hover-surface) dark:aria-expanded:bg-transparent"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">
                            {title}
                        </span>
                        {count !== null && count !== undefined ? (
                            <Badge
                                variant="outline"
                                className="text-muted-foreground shrink-0 font-normal tabular-nums"
                            >
                                {count}
                            </Badge>
                        ) : null}
                        <ChevronDownIcon
                            data-icon="inline-end"
                            className={cn(
                                'transition-transform',
                                !isOpen && '-rotate-90'
                            )}
                        />
                    </Button>
                }
            />
        </Collapsible>
    );
}
