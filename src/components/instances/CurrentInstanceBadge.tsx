import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';

export function CurrentInstanceBadge({ className }: { className?: string }) {
    const { t } = useTranslation();

    return (
        <Badge
            variant="outline"
            className={cn(
                'border-border/70 bg-muted/70 text-muted-foreground h-4 rounded px-1 py-0 text-[10px] leading-none font-semibold',
                className
            )}
        >
            {t('side_panel.you_are_here')}
        </Badge>
    );
}
