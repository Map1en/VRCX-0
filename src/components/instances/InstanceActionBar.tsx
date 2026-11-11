import {
    CalendarPlusIcon,
    Gamepad2Icon,
    HistoryIcon,
    LogInIcon,
    MailIcon,
    PencilIcon,
    RefreshCwIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LocationObjectRecord } from '@/components/location/locationModel';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { InstanceActionSummary } from './InstanceActionSummary';
import { InstanceCalendarLinkDialog } from './InstanceCalendarLinkDialog';
import {
    useInstanceActionBarController,
    type InstanceActionBarControllerInput
} from './useInstanceActionBarController';

function ActionButton({
    label,
    disabled = false,
    disableTooltip = false,
    loading = false,
    icon: Icon,
    onClick
}: {
    label: string;
    disabled?: boolean;
    disableTooltip?: boolean;
    loading?: boolean;
    icon: LucideIcon;
    onClick?: () => void;
}) {
    const button = (
        <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            disabled={disabled || loading}
            onClick={onClick}
        >
            {loading ? (
                <Spinner data-icon="inline-start" />
            ) : (
                <Icon data-icon="inline-start" />
            )}
        </Button>
    );

    if (disableTooltip) {
        return button;
    }

    return (
        <Tooltip>
            <TooltipTrigger render={<span>{button}</span>} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function InstanceActionBar({
    className,
    target = null,
    instance = null,
    friendCount,
    playerCount,
    capacity: providedCapacity,
    showLaunch = true,
    showInvite = true,
    showRefresh = true,
    showHistory = false,
    showInstanceInfo = true,
    instanceInfoPlacement = 'end',
    instanceCountAlign = 'right',
    instanceSummaryOrder = 'count-first',
    disableTooltip = false,
    disableInstanceInfoTooltip = disableTooltip,
    refreshTooltip = 'Refresh instance info',
    historyTooltip = 'Previous instance history',
    onRefresh,
    onHistory
}: {
    className?: string;
    target?: LocationObjectRecord | null;
    instance?: unknown;
    friendCount?: number;
    playerCount?: number | string | null;
    capacity?: number | string | null;
    showLaunch?: boolean;
    showInvite?: boolean;
    showRefresh?: boolean;
    showHistory?: boolean;
    showInstanceInfo?: boolean;
    instanceInfoPlacement?: 'start' | 'end';
    instanceCountAlign?: 'left' | 'right';
    instanceSummaryOrder?: 'count-first' | 'markers-first';
    disableTooltip?: boolean;
    disableInstanceInfoTooltip?: boolean;
    refreshTooltip?: string;
    historyTooltip?: string;
    onRefresh?: InstanceActionBarControllerInput['onRefresh'];
    onHistory?: () => void;
}) {
    const { t } = useTranslation();
    const [calendarLinkOpen, setCalendarLinkOpen] = useState(false);

    const {
        actionTarget,
        busy,
        calendarEntryId,
        calendarGroupId,
        canCloseCurrentInstance,
        canLinkCalendarEvent,
        canOpenInstanceInGame,
        canRename,
        canShowLaunchAction,
        capacity,
        closeInstance,
        hasAgeGate,
        hasInstanceSummary,
        hasUserCount,
        instanceInfo,
        joinedAtMs,
        launchInstance,
        openInstanceInGame,
        queueSize,
        refreshInstance,
        renameInstance,
        resolvedUserCount,
        selfInvite,
        setCalendarLink
    } = useInstanceActionBarController({
        target,
        instance,
        friendCount,
        playerCount,
        providedCapacity,
        showLaunch,
        onRefresh
    });

    if (
        !actionTarget.instanceLocation &&
        !actionTarget.launchLocation &&
        !actionTarget.inviteLocation
    ) {
        return null;
    }

    const instanceSummary = (
        <InstanceActionSummary
            model={{
                instance: instanceInfo,
                friendCount,
                resolvedUserCount,
                capacity,
                hasUserCount,
                hasInstanceSummary,
                queueSize,
                hasAgeGate,
                joinedAtMs,
                canClose: canCloseCurrentInstance,
                busy
            }}
            options={{
                show: showInstanceInfo,
                countAlign: instanceCountAlign,
                order: instanceSummaryOrder,
                disableActionTooltip: disableTooltip,
                disableInfoTooltip: disableInstanceInfoTooltip
            }}
            onClose={() => {
                closeInstance();
            }}
        />
    );

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 align-middle',
                className
            )}
        >
            {instanceInfoPlacement === 'start' ? instanceSummary : null}
            {canShowLaunchAction ? (
                <ActionButton
                    label={t('dialog.instance.action.launch_instance')}
                    icon={LogInIcon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'launch'}
                    disabled={Boolean(busy)}
                    onClick={launchInstance}
                />
            ) : null}
            {canOpenInstanceInGame ? (
                <ActionButton
                    label={t('dialog.instance.action.open_in_game')}
                    icon={Gamepad2Icon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'open-in-game'}
                    disabled={Boolean(busy)}
                    onClick={() => {
                        openInstanceInGame();
                    }}
                />
            ) : null}
            {showInvite && actionTarget.isRealInviteLocation ? (
                <ActionButton
                    label={t('dialog.instance.label.self_invite')}
                    icon={MailIcon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'invite'}
                    disabled={Boolean(busy)}
                    onClick={() => {
                        selfInvite();
                    }}
                />
            ) : null}
            {canRename && actionTarget.isRealInstanceLocation ? (
                <ActionButton
                    label={t('component.instance_action_bar.rename.header')}
                    icon={PencilIcon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'rename'}
                    disabled={Boolean(busy)}
                    onClick={() => {
                        void renameInstance();
                    }}
                />
            ) : null}
            {canLinkCalendarEvent && actionTarget.isRealInstanceLocation ? (
                <ActionButton
                    label={t(
                        'component.instance_action_bar.calendar_link.header'
                    )}
                    icon={CalendarPlusIcon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'calendar-link'}
                    disabled={Boolean(busy)}
                    onClick={() => setCalendarLinkOpen(true)}
                />
            ) : null}
            {showRefresh && actionTarget.isRealInstanceLocation ? (
                <ActionButton
                    label={refreshTooltip}
                    icon={RefreshCwIcon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'refresh'}
                    disabled={Boolean(busy)}
                    onClick={() => {
                        refreshInstance();
                    }}
                />
            ) : null}
            {showHistory ? (
                <ActionButton
                    label={historyTooltip}
                    icon={HistoryIcon}
                    disableTooltip={disableTooltip}
                    disabled={Boolean(busy)}
                    onClick={onHistory}
                />
            ) : null}
            {instanceInfoPlacement === 'start' ? null : instanceSummary}
            {canLinkCalendarEvent ? (
                <InstanceCalendarLinkDialog
                    open={calendarLinkOpen}
                    groupId={calendarGroupId}
                    currentEventId={calendarEntryId}
                    busy={busy === 'calendar-link'}
                    onOpenChange={setCalendarLinkOpen}
                    onSubmit={setCalendarLink}
                />
            ) : null}
        </div>
    );
}
