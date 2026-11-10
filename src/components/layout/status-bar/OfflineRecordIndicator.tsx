import {
    CloudCheckIcon,
    CloudExclamationPointIcon,
    CloudIcon,
    CloudOffIcon,
    CloudSyncIcon
} from 'lucide-react';
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

import { useOfflineRecordSyncAnimation } from './useOfflineRecordSyncAnimation';

const LEVEL_CLASS: Record<OfflineRecordHealthLevel, string> = {
    ok: 'text-muted-foreground hover:text-muted-foreground',
    warning: 'text-[var(--status-askme)] hover:text-[var(--status-askme)]',
    error: 'text-[var(--status-busy)] hover:text-[var(--status-busy)]'
};

export function OfflineRecordIndicator() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const probe = useOfflineRecordStore((state) => state.health);
    const syncProgress = useOfflineRecordStore((state) => state.syncProgress);
    const syncOutcome = useOfflineRecordStore((state) => state.syncOutcome);
    const { iconRef, phase } = useOfflineRecordSyncAnimation(currentUserId);
    const health = resolveOfflineRecordHealth(probe, currentUserId);
    if (!currentUserId) {
        return null;
    }
    const inactive =
        !probe ||
        probe.state === 'notConfigured' ||
        (probe.state === 'connected' &&
            probe.status.session.state === 'noCredentials');
    let Icon = CloudIcon;
    let level = health?.level ?? 'ok';
    if (inactive) {
        Icon = CloudOffIcon;
        level = 'ok';
    } else if (syncOutcome === 'failed' || level !== 'ok') {
        Icon = CloudExclamationPointIcon;
        if (syncOutcome === 'failed') {
            level = 'error';
        }
    }
    if (phase === 'syncing') {
        Icon = CloudSyncIcon;
    } else if (phase === 'success') {
        Icon = CloudCheckIcon;
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
                            phase === 'idle'
                                ? LEVEL_CLASS[level]
                                : 'text-foreground hover:text-foreground'
                        )}
                        onClick={() =>
                            setSystemHostOpen('offlineRecordOpen', true)
                        }
                    >
                        <span
                            ref={iconRef}
                            data-icon={progressLabel ? 'inline-start' : 'icon'}
                            className={cn(
                                'inline-flex',
                                phase !== 'idle' && 'opacity-40'
                            )}
                        >
                            <Icon />
                        </span>
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
