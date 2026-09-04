import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { InstanceRosterTimestamp } from '@/domain/instances/instanceRoster';
import { useFriendLocationTimeEpoch } from '@/lib/useFriendLocationTimeEpoch';
import { cn } from '@/lib/utils';
import {
    timestampMsFromValue,
    timeToTextWithLabels
} from '@/shared/utils/dateTime';
import { useShellStore } from '@/state/shellStore';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

const SUB_MINUTE_STEP_MS = 30_000;
const MINUTE_STEP_MS = 60_000;

export function FriendInstanceTimer({
    epoch,
    traveling = false,
    format = 'default',
    className
}: {
    epoch?: InstanceRosterTimestamp | null;
    traveling?: boolean;
    format?: 'default' | 'short';
    className?: string;
}) {
    const { t } = useTranslation();
    const timeUnitLabels = useShellStore((state) => state.timeUnitLabels);
    const [now, setNow] = useState(() => Date.now());
    const normalizedEpoch = timestampMsFromValue(epoch);
    const elapsedMs = normalizedEpoch ? Math.max(0, now - normalizedEpoch) : 0;
    const isSubMinute = elapsedMs < MINUTE_STEP_MS;
    const stepMs = isSubMinute ? SUB_MINUTE_STEP_MS : MINUTE_STEP_MS;
    const displayedMs = Math.floor(elapsedMs / stepMs) * stepMs;
    const nextStepMs = displayedMs + stepMs;
    const text = normalizedEpoch
        ? timeToTextWithLabels(displayedMs, isSubMinute, timeUnitLabels)
        : '-';
    const shortText =
        format === 'short' && normalizedEpoch
            ? timeToTextWithLabels(
                  displayedMs,
                  isSubMinute,
                  {
                      y: t('common.time_units_short.y'),
                      d: t('common.time_units_short.d'),
                      h: t('common.time_units_short.h'),
                      m: t('common.time_units_short.m'),
                      s: t('common.time_units_short.s')
                  },
                  ''
              )
            : text;

    useEffect(() => {
        if (!normalizedEpoch) {
            return;
        }
        const timeoutId = window.setTimeout(
            () => setNow(Date.now()),
            Math.max(1, nextStepMs - elapsedMs)
        );
        return () => window.clearTimeout(timeoutId);
    }, [elapsedMs, nextStepMs, normalizedEpoch]);

    const timer = (
        <span className="inline-flex min-w-0 items-center">
            {traveling ? <Spinner className="mr-1 size-3 shrink-0" /> : null}
            <span
                aria-hidden={format === 'short' ? true : undefined}
                className={cn(
                    'truncate tabular-nums',
                    isSubMinute && normalizedEpoch ? 'text-foreground' : null,
                    className
                )}
            >
                {shortText}
            </span>
            {format === 'short' ? (
                <span className="sr-only">{text}</span>
            ) : null}
        </span>
    );

    return format === 'short' && normalizedEpoch ? (
        <Tooltip>
            <TooltipTrigger render={timer} />
            <TooltipContent>{text}</TooltipContent>
        </Tooltip>
    ) : (
        timer
    );
}

export function FriendLocationTimer({
    userId,
    location,
    traveling = false,
    fallback = null,
    className
}: {
    userId: string;
    location: string;
    traveling?: boolean;
    fallback?: ReactNode;
    className?: string;
}) {
    const epoch = useFriendLocationTimeEpoch(userId, location);
    return epoch ? (
        <FriendInstanceTimer
            epoch={epoch}
            traveling={traveling}
            className={className}
        />
    ) : (
        fallback
    );
}
