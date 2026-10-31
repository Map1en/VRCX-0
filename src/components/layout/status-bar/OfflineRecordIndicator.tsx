import { ServerIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
    resolveOfflineRecordHealth,
    type OfflineRecordHealthLevel
} from '@/services/offlineRecordService';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { STATUS_BAR_TOGGLE_ACTIVE } from './statusBarToggle';

const LEVEL_CLASS: Record<OfflineRecordHealthLevel, string> = {
    ok: STATUS_BAR_TOGGLE_ACTIVE,
    warning: cn(
        STATUS_BAR_TOGGLE_ACTIVE,
        'text-[var(--status-askme)] hover:text-[var(--status-askme)]'
    ),
    error: cn(
        STATUS_BAR_TOGGLE_ACTIVE,
        'text-[var(--status-busy)] hover:text-[var(--status-busy)]'
    )
};

export function OfflineRecordIndicator() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const probe = useOfflineRecordStore((state) => state.health);
    const syncProgress = useOfflineRecordStore((state) => state.syncProgress);
    const health = resolveOfflineRecordHealth(probe, currentUserId);
    if (!currentUserId || (!health && !syncProgress)) {
        return null;
    }
    const progressLabel = syncProgress
        ? t(`offline_record.status_bar.${syncProgress.phase}`, {
              count: syncProgress.frames
          })
        : null;

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size={progressLabel ? 'sm' : 'icon'}
                        aria-label={t('offline_record.header')}
                        className={cn(
                            'shrink-0 rounded-none',
                            progressLabel
                                ? 'h-6 gap-1.5 px-2 text-xs font-normal'
                                : 'size-6',
                            LEVEL_CLASS[health?.level ?? 'ok']
                        )}
                        onClick={() =>
                            setSystemHostOpen('offlineRecordOpen', true)
                        }
                    >
                        <ServerIcon
                            data-icon={progressLabel ? 'inline-start' : 'icon'}
                            className={cn(
                                syncProgress && 'motion-safe:animate-pulse'
                            )}
                        />
                        {progressLabel}
                    </Button>
                }
            />
            <TooltipContent className="flex max-w-xs flex-col gap-1 text-xs">
                <span>{t('offline_record.header')}</span>
                {health ? (
                    <span className="text-muted-foreground">
                        {t(health.messageKey)}
                    </span>
                ) : null}
            </TooltipContent>
        </Tooltip>
    );
}
