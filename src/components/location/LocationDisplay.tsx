import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import type { ReactElement, ReactNode, SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { LocationPendingText } from '@/components/location/LocationPendingText';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { MountOnIntent } from '@/components/MountOnIntent';
import { cn } from '@/lib/utils';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

function LocationTooltip({
    disabled,
    content,
    children
}: {
    disabled: boolean;
    content: ReactNode;
    children: ReactElement;
}) {
    if (disabled || !content) {
        return children;
    }

    return (
        <MountOnIntent
            trigger="hover"
            render={(child) => (
                <Tooltip>
                    <TooltipTrigger render={child} />
                    <TooltipContent>{content}</TooltipContent>
                </Tooltip>
            )}
        >
            {children}
        </MountOnIntent>
    );
}

export function LocationDisplay({
    asButton = true,
    className = '',
    disableTooltip = false,
    groupName = '',
    groupNamePending = false,
    instanceName = '',
    isAgeRestricted = false,
    isClosed = false,
    isLocationLink = false,
    isPending = false,
    isTraveling = false,
    onOpenGroup,
    onOpenLocation,
    onOpenLocationKeyDown,
    region = '',
    shouldShowInstanceId = false,
    showGroupLink = true,
    strict = false,
    text = '',
    tooltipContent = '',
    worldName = '',
    worldNameClassName = ''
}: {
    asButton?: boolean;
    className?: string;
    disableTooltip?: boolean;
    groupName?: string;
    groupNamePending?: boolean;
    instanceName?: string;
    isAgeRestricted?: boolean;
    isClosed?: boolean;
    isLocationLink?: boolean;
    isPending?: boolean;
    isTraveling?: boolean;
    onOpenGroup?: (event: SyntheticEvent<HTMLElement>) => void;
    onOpenLocation?: (event: SyntheticEvent<HTMLElement>) => void;
    onOpenLocationKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
    region?: string;
    shouldShowInstanceId?: boolean;
    showGroupLink?: boolean;
    strict?: boolean;
    text?: string;
    tooltipContent?: ReactNode;
    worldName?: string;
    worldNameClassName?: string;
}) {
    const canHighlightWorldName = Boolean(
        worldNameClassName && worldName && text.startsWith(worldName)
    );
    const { t } = useTranslation();
    const LocationTrigger = asButton ? 'button' : 'span';

    return (
        <div
            className={cn(
                'inline-flex max-w-full min-w-0 items-center',
                className
            )}
        >
            {!text ? (
                <div className="text-transparent">-</div>
            ) : isAgeRestricted ? (
                <LocationTooltip
                    disabled={disableTooltip}
                    content={t(
                        'dialog.user.info.instance_age_restricted_tooltip'
                    )}
                >
                    <div className="text-muted-foreground inline-flex min-w-0 items-center gap-1">
                        <LockIcon className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">
                            {t('dialog.user.info.instance_age_restricted')}
                        </span>
                    </div>
                </LocationTooltip>
            ) : (
                <>
                    <RegionCodeBadge region={region} />
                    <LocationTooltip
                        disabled={
                            disableTooltip ||
                            !tooltipContent ||
                            shouldShowInstanceId ||
                            isPending
                        }
                        content={tooltipContent}
                    >
                        <LocationTrigger
                            {...(asButton
                                ? { type: 'button' }
                                : {
                                      role: isLocationLink
                                          ? 'button'
                                          : undefined,
                                      tabIndex: isLocationLink ? 0 : undefined
                                  })}
                            className={cn(
                                'x-location inline-flex max-w-full min-w-0 flex-nowrap items-center truncate overflow-hidden text-left',
                                isLocationLink
                                    ? 'hover:text-foreground cursor-pointer text-inherit'
                                    : 'cursor-default'
                            )}
                            onClick={onOpenLocation}
                            onKeyDown={onOpenLocationKeyDown}
                        >
                            {isTraveling ? (
                                <Spinner
                                    aria-hidden="true"
                                    aria-label={undefined}
                                    role="presentation"
                                    className="mr-1 size-3.5 shrink-0"
                                />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">
                                <LocationPendingText pending={isPending}>
                                    {canHighlightWorldName ? (
                                        <>
                                            <span
                                                className={worldNameClassName}
                                            >
                                                {worldName}
                                            </span>
                                            <span>
                                                {text.slice(worldName.length)}
                                            </span>
                                        </>
                                    ) : (
                                        <span>{text}</span>
                                    )}
                                    {shouldShowInstanceId && instanceName ? (
                                        <span className="ml-1">{`· #${instanceName}`}</span>
                                    ) : null}
                                    {showGroupLink &&
                                    (groupName || groupNamePending) ? (
                                        <LocationPendingText
                                            pending={groupNamePending}
                                            placeholderClassName="ml-1 w-16"
                                        >
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                className="ml-0.5 cursor-pointer"
                                                onClick={onOpenGroup}
                                                onKeyDown={(event) => {
                                                    event.stopPropagation();
                                                    if (
                                                        event.key === 'Enter' ||
                                                        event.key === ' '
                                                    ) {
                                                        event.preventDefault();
                                                        onOpenGroup?.(event);
                                                    }
                                                }}
                                            >
                                                ({groupName})
                                            </span>
                                        </LocationPendingText>
                                    ) : null}
                                </LocationPendingText>
                            </span>
                        </LocationTrigger>
                    </LocationTooltip>
                    {isClosed ? (
                        <LocationTooltip
                            disabled={disableTooltip}
                            content={t('dialog.user.info.instance_closed')}
                        >
                            <AlertTriangleIcon className="text-muted-foreground ml-2 inline-block size-3.5 shrink-0" />
                        </LocationTooltip>
                    ) : null}
                    {strict ? (
                        <LockIcon className="text-muted-foreground ml-2 inline-block size-3.5 shrink-0" />
                    ) : null}
                </>
            )}
        </div>
    );
}
