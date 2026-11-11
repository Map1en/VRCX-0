import { UsersRoundIcon, XCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useSpokenLanguageSelection } from '@/components/dialogs/useSpokenLanguageSelection';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { useNowMs } from '@/lib/useNowMs';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { InstanceCalendarEventMarker } from './InstanceCalendarEventMarker';
import {
    instanceLanguageRows,
    instanceLanguageRowText
} from './instanceLanguages';
import type { InstanceActionRecord } from './useInstanceActionBarController';

const NO_LANGUAGE_KEYS: string[] = [];

function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function platformCount(
    instance: InstanceActionRecord | null,
    platform: string
) {
    return Number(instance?.platforms?.[platform] ?? 0);
}

function disabledContentSettings(instance: InstanceActionRecord | null) {
    return Array.isArray(instance?.$disabledContentSettings)
        ? instance.$disabledContentSettings.filter(Boolean).join(', ')
        : '';
}

function InstanceOpenDuration({ joinedAtMs }: { joinedAtMs: number }) {
    const { t } = useTranslation();
    const nowMs = useNowMs();

    return (
        <div>
            {t('dialog.instance.label.open_for_at_least', {
                duration: timeToText(nowMs - joinedAtMs)
            })}
        </div>
    );
}

function InstanceInfoTooltip({
    instance,
    disableTooltip = false,
    joinedAtMs = 0,
    children
}: {
    instance: InstanceActionRecord | null;
    disableTooltip?: boolean;
    joinedAtMs?: number;
    children: ReactElement;
}) {
    const { t } = useTranslation();
    const disabledContent = disabledContentSettings(instance);
    const { languageOptionsMap } = useSpokenLanguageSelection(NO_LANGUAGE_KEYS);
    const languages = instanceLanguageRows(
        instance,
        (key) => languageOptionsMap.get(key)?.value
    );

    if (disableTooltip) {
        return children;
    }

    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipContent className="max-w-sm text-xs">
                <div className="flex flex-col gap-1.5">
                    {instance?.closedAt ? (
                        <div>
                            {t('dialog.instance.label.closed_at')}{' '}
                            {formatDateFilter(instance.closedAt, 'long')}
                        </div>
                    ) : null}
                    {joinedAtMs ? (
                        <InstanceOpenDuration joinedAtMs={joinedAtMs} />
                    ) : null}
                    <div>
                        <span className="text-platform-pc">PC: </span>
                        {platformCount(instance, 'standalonewindows')}
                        <span className="text-platform-quest ml-2">
                            {t('dialog.instance.label.android')}{' '}
                        </span>
                        {platformCount(instance, 'android')}
                    </div>
                    <div>
                        {t('dialog.instance.label.ios')}{' '}
                        {platformCount(instance, 'ios')}
                    </div>
                    {languages.length ? (
                        <div>
                            {t('dialog.instance.label.languages')}{' '}
                            {languages.map(instanceLanguageRowText).join(' · ')}
                        </div>
                    ) : null}
                    {instance?.gameServerVersion ? (
                        <div>
                            {t('dialog.instance.label.game_version')}{' '}
                            {String(instance.gameServerVersion)}
                        </div>
                    ) : null}
                    {instance?.queueEnabled ? (
                        <div>
                            {t(
                                'dialog.instance.label.instance_queuing_enabled'
                            )}
                        </div>
                    ) : null}
                    {disabledContent ? (
                        <div>
                            {t('dialog.instance.label.disabled_content')}{' '}
                            {disabledContent}
                        </div>
                    ) : null}
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

export interface InstanceActionSummaryModel {
    instance: InstanceActionRecord | null;
    friendCount?: number;
    resolvedUserCount: number | null;
    capacity: number;
    hasUserCount: boolean;
    hasInstanceSummary: boolean;
    queueSize: number;
    hasAgeGate: boolean;
    joinedAtMs: number;
    canClose: boolean;
    busy: string;
}

export interface InstanceActionSummaryOptions {
    show: boolean;
    countAlign: 'left' | 'right';
    order: 'count-first' | 'markers-first';
    disableActionTooltip: boolean;
    disableInfoTooltip: boolean;
}

export function InstanceActionSummary({
    model,
    options,
    onClose
}: {
    model: InstanceActionSummaryModel;
    options: InstanceActionSummaryOptions;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const countSummary =
        model.hasUserCount || model.capacity ? (
            <span
                className={cn(
                    'inline-block min-w-[5ch] tabular-nums',
                    options.countAlign === 'left' ? 'text-left' : 'text-right'
                )}
            >
                {model.hasUserCount ? model.resolvedUserCount : '—'}
                {model.capacity ? `/${model.capacity}` : ''}
            </span>
        ) : null;
    const markerSummary = (
        <>
            {model.friendCount ? (
                <span className="inline-flex items-center gap-0.5">
                    <UsersRoundIcon className="size-3.5" />
                    {model.friendCount}
                </span>
            ) : null}
            {model.queueSize ? (
                <span>
                    {t('dialog.new_instance.queueEnabled')} {model.queueSize}
                </span>
            ) : null}
            {model.hasAgeGate ? (
                <Badge
                    className="h-4 bg-amber-500/15 px-1 text-[10px] text-amber-300"
                    title={t('dialog.new_instance.ageGate')}
                    aria-label={t('dialog.new_instance.ageGate')}
                >
                    18+
                </Badge>
            ) : null}
        </>
    );
    const closeInstanceLabel = t('dialog.instance.action.close_instance');
    const closeInstanceControl =
        options.show && model.canClose ? (
            <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={closeInstanceLabel}
                disabled={
                    Boolean(model.busy) || Boolean(model.instance?.closedAt)
                }
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }}
            >
                {model.busy === 'close' ? (
                    <Spinner data-icon="inline-start" />
                ) : (
                    <XCircleIcon data-icon="inline-start" />
                )}
            </Button>
        ) : null;
    const closeInstanceButton =
        closeInstanceControl && !options.disableActionTooltip ? (
            <Tooltip>
                <TooltipTrigger render={<span>{closeInstanceControl}</span>} />
                <TooltipContent>{closeInstanceLabel}</TooltipContent>
            </Tooltip>
        ) : (
            closeInstanceControl
        );
    const instanceInfoSummary =
        options.show && model.hasInstanceSummary ? (
            <InstanceInfoTooltip
                instance={model.instance}
                disableTooltip={options.disableInfoTooltip}
                joinedAtMs={model.joinedAtMs}
            >
                <div className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    {options.order === 'markers-first'
                        ? markerSummary
                        : countSummary}
                    {options.order === 'markers-first'
                        ? countSummary
                        : markerSummary}
                </div>
            </InstanceInfoTooltip>
        ) : null;

    const instance = model.instance;
    const calendarEntryId = text(instance?.calendarEntryId);
    const calendarGroupId = text(instance?.ownerId);
    const calendarMarker =
        options.show && calendarEntryId && calendarGroupId ? (
            <span className="text-muted-foreground inline-flex">
                <InstanceCalendarEventMarker
                    groupId={calendarGroupId}
                    groupName={text(instance?.group?.name)}
                    eventId={calendarEntryId}
                    canLoad={Boolean(instance?.group?.myMember)}
                />
            </span>
        ) : null;

    if (!instanceInfoSummary && !closeInstanceButton && !calendarMarker) {
        return null;
    }

    return (
        <div className="inline-flex items-center gap-1">
            {calendarMarker}
            {options.order === 'markers-first'
                ? closeInstanceButton
                : instanceInfoSummary}
            {options.order === 'markers-first'
                ? instanceInfoSummary
                : closeInstanceButton}
        </div>
    );
}
