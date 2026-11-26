import { GripVerticalIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

export type DataTableColumnDragHandleProps = Partial<
    ComponentProps<typeof Button>
>;

export function DataTableColumnDragHandle({
    className,
    label,
    ...props
}: DataTableColumnDragHandleProps & { label: string }) {
    const { t } = useTranslation();
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('accessibility.reorder_column', { column: label })}
            className={cn(
                'text-muted-foreground/60 hover:text-muted-foreground shrink-0 cursor-grab opacity-0 group-hover:opacity-100 hover:bg-transparent focus-visible:opacity-100 active:cursor-grabbing',
                className
            )}
            {...props}
        >
            <GripVerticalIcon data-icon="inline-end" />
        </Button>
    );
}
