import { SaveOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function FeedPersistenceDisabledIndicator() {
    const { t } = useTranslation();
    const label = t('view.feed.feed_persistence_disabled_tooltip');

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        role="img"
                        aria-label={label}
                        className="text-muted-foreground inline-flex size-8 items-center justify-center"
                    >
                        <SaveOffIcon className="size-4" />
                    </span>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
