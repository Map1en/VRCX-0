import { Badge } from '@/ui/shadcn/badge';

import { moderationStatusTone } from './groupModerationRows';

const MODERATION_STATUS_TONE_CLASS_NAME: Record<string, string> = {
    neutral: 'text-muted-foreground border-border',
    active: 'text-emerald-600 dark:text-emerald-400 border-transparent bg-emerald-500/10',
    pending:
        'text-amber-600 dark:text-amber-400 border-transparent bg-amber-500/10'
};

export function ModerationStatusBadge({
    status,
    label
}: {
    status: string;
    label?: string;
}) {
    if (!status || status === '—') {
        return <span>—</span>;
    }
    const tone = moderationStatusTone(status);
    const displayLabel = label ?? status;
    if (tone === 'danger') {
        return <Badge variant="destructive">{displayLabel}</Badge>;
    }
    return (
        <Badge
            variant="outline"
            className={MODERATION_STATUS_TONE_CLASS_NAME[tone]}
        >
            {displayLabel}
        </Badge>
    );
}
