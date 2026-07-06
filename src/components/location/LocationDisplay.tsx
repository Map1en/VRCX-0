import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

function LocationTooltip({ disabled, content, children }: any) {
    if (disabled || !content) {
        return children;
    }

    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipContent>{content}</TooltipContent>
        </Tooltip>
    );
}

export function LocationDisplay({
    asButton = true,
    className = '',
    disableTooltip = false,
    groupName = '',
    instanceName = '',
    isAgeRestricted = false,
    isClosed = false,
    isLocationLink = false,
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
}: any) {
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
                            shouldShowInstanceId
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
                                    ? 'hover:text-primary cursor-pointer text-inherit underline-offset-4'
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
                                {canHighlightWorldName ? (
                                    <>
                                        <span className={worldNameClassName}>
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
                            </span>
                        </LocationTrigger>
                    </LocationTooltip>
                    {showGroupLink && groupName ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary ml-0.5 h-auto min-w-0 p-0 text-left [font-size:inherit] [line-height:inherit] font-normal text-inherit"
                            onClick={onOpenGroup}
                            onKeyDown={(event) => event.stopPropagation()}
                        >
                            ({groupName})
                        </Button>
                    ) : null}
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
