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
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LocationObjectRecord } from '@/components/location/locationModel';
import { cn } from '@/lib/utils';
import { IntentTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { InstanceActionSummary } from './InstanceActionSummary';
import { InstanceCalendarLinkDialog } from './InstanceCalendarLinkDialog';
import {
    useInstanceActionBarController,
    type InstanceActionBarControllerInput
} from './useInstanceActionBarController';

type InstanceActionVariant = 'compact' | 'prominent';

function ActionButton({
    label,
    text,
    variant = 'compact',
    disabled = false,
    disableTooltip = false,
    loading = false,
    icon: Icon,
    onClick
}: {
    label: string;
    text?: string;
    variant?: InstanceActionVariant;
    disabled?: boolean;
    disableTooltip?: boolean;
    loading?: boolean;
    icon: LucideIcon;
    onClick?: () => void;
}) {
    const prominent = variant === 'prominent';
    const showText = prominent && Boolean(text);
    const button = (
        <Button
            type="button"
            size={showText ? 'sm' : prominent ? 'icon-sm' : 'icon-xs'}
            variant="ghost"
            className={
                prominent
                    ? "text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
                    : undefined
            }
            aria-label={showText ? undefined : label}
            title={showText && label !== text ? label : undefined}
            disabled={disabled || loading}
            onClick={onClick}
        >
            {loading ? (
                <Spinner data-icon="inline-start" />
            ) : (
                <Icon data-icon="inline-start" />
            )}
            {showText ? text : null}
        </Button>
    );

    if (disableTooltip || showText) {
        return button;
    }

    return (
        <IntentTooltip content={label}>
            <span>{button}</span>
        </IntentTooltip>
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
    onHistory,
    actionVariant = 'compact',
    renderLayout
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
    actionVariant?: InstanceActionVariant;
    renderLayout?: (parts: {
        summary: ReactNode;
        actions: ReactNode;
    }) => ReactNode;
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

    const actionButtons = (
        <>
            {canShowLaunchAction ? (
                <ActionButton
                    variant={actionVariant}
                    label={t('dialog.instance.action.launch_instance')}
                    text={t('component.instance_action_bar.join')}
                    icon={LogInIcon}
                    disableTooltip={disableTooltip}
                    loading={busy === 'launch'}
                    disabled={Boolean(busy)}
                    onClick={launchInstance}
                />
            ) : null}
            {canOpenInstanceInGame ? (
                <ActionButton
                    variant={actionVariant}
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
                    variant={actionVariant}
                    label={t('dialog.instance.label.self_invite')}
                    text={t('dialog.instance.label.self_invite')}
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
                    variant={actionVariant}
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
                    variant={actionVariant}
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
                    variant={actionVariant}
                    label={refreshTooltip}
                    text={t('common.actions.refresh')}
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
                    variant={actionVariant}
                    label={historyTooltip}
                    icon={HistoryIcon}
                    disableTooltip={disableTooltip}
                    disabled={Boolean(busy)}
                    onClick={onHistory}
                />
            ) : null}
        </>
    );
    const calendarLinkDialog = canLinkCalendarEvent ? (
        <InstanceCalendarLinkDialog
            open={calendarLinkOpen}
            groupId={calendarGroupId}
            currentEventId={calendarEntryId}
            busy={busy === 'calendar-link'}
            onOpenChange={setCalendarLinkOpen}
            onSubmit={setCalendarLink}
        />
    ) : null;

    if (renderLayout) {
        return (
            <>
                {renderLayout({
                    summary: instanceSummary,
                    actions: actionButtons
                })}
                {calendarLinkDialog}
            </>
        );
    }

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 align-middle',
                className
            )}
        >
            {instanceInfoPlacement === 'start' ? instanceSummary : null}
            {actionButtons}
            {instanceInfoPlacement === 'start' ? null : instanceSummary}
            {calendarLinkDialog}
        </div>
    );
}
