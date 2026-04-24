import {
    CalendarIcon,
    DownloadIcon,
    ImageIcon,
    Share2Icon,
    StarIcon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import dayjs from '@/lib/dayjs.js';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import { toolsRepository } from '@/repositories/index.js';
import { openGroupDialog } from '@/services/dialogService.js';
import { useModalStore } from '@/state/modalStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@/ui/shadcn/popover';

import { getEndpoint, getEventGroupId, getEventId } from './toolsDialogUtils.js';

async function getCalendarIcs(event) {
    const groupId = getEventGroupId(event);
    const eventId = getEventId(event);
    if (!groupId || !eventId) {
        return '';
    }
    try {
        const content = await toolsRepository.getGroupCalendarIcs(
            { groupId, eventId },
            { endpoint: getEndpoint() }
        );
        const normalizedContent = String(content || '')
            .replace(/^\uFEFF/, '')
            .trimStart();
        if (!normalizedContent.startsWith('BEGIN:VCALENDAR')) {
            toast.error(
                t('dialog.tools.generated.failed_to_download_ics_file_invalid_icalendar_content')
            );
            return '';
        }
        return normalizedContent;
    } catch (error) {
        toast.error(
            userFacingErrorMessage(
                error,
                t('host.tools_dialogs.generated_toast.failed_to_download_ics_file')
            )
        );
        return '';
    }
}

async function openCalendarEvent(event) {
    const content = await getCalendarIcs(event);
    if (content) {
        await backend.app.OpenCalendarFile(content);
    }
}

async function downloadEventIcs(event) {
    const content = await getCalendarIcs(event);
    if (!content) {
        return;
    }
    const eventId = getEventId(event);
    const fileName = `${eventId || 'group-event'}.ics`;
    try {
        await backend.app.SaveCalendarFile(fileName, content);
    } catch (error) {
        toast.error(
            userFacingErrorMessage(
                error,
                t('host.tools_dialogs.generated_toast.failed_to_save_ics_file')
            )
        );
    }
}

async function copyEventLink(event, t) {
    const groupId = getEventGroupId(event);
    const eventId = getEventId(event);
    if (!groupId || !eventId) {
        return;
    }
    try {
        await navigator.clipboard.writeText(
            `https://vrchat.com/home/group/${groupId}/calendar/${eventId}`
        );
        toast.success(t('dialog.group_calendar.event_card.copied_event_link'));
    } catch (error) {
        toast.error(
            userFacingErrorMessage(
                error,
                t('host.tools_dialogs.generated_toast.failed_to_copy_event_link')
            )
        );
    }
}

function getEventBannerUrl(event, groupProfile) {
    return convertFileUrlToImageUrl(
        event?.imageUrl ||
            event?.thumbnailImageUrl ||
            groupProfile?.bannerUrl ||
            groupProfile?.iconUrl ||
            '',
        512
    );
}

function formatEventTimeRange(event, mode = 'timeline') {
    if (!event?.startsAt) {
        return '';
    }
    const dateFormat = mode === 'grid' ? 'MM-DD ddd HH:mm' : 'HH:mm';
    const start = dayjs(event.startsAt).format(dateFormat);
    const end = event.endsAt ? dayjs(event.endsAt).format(dateFormat) : '';
    return end ? `${start} - ${end}` : start;
}

function capitalizeFirst(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '\u2014';
}

export function GroupEventCard({
    event,
    mode = 'timeline',
    groupName,
    groupProfile,
    isFollowing,
    onToggleFollow
}) {
    const { t } = useTranslation();
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const groupId = getEventGroupId(event);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [bannerError, setBannerError] = useState(false);
    const closeTimerRef = useRef(null);
    const bannerUrl = bannerError ? '' : getEventBannerUrl(event, groupProfile);
    const title = event.title || 'Untitled event';
    const showGroupName = mode === 'timeline';
    const closeAfterMinutes =
        event.closeInstanceAfterEndMinutes ?? event.closeAfterEndMinutes ?? '';

    function openPopover() {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setPopoverOpen(true);
    }

    function scheduleClosePopover() {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
        }
        closeTimerRef.current = window.setTimeout(
            () => setPopoverOpen(false),
            100
        );
    }

    useEffect(
        () => () => {
            if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
            }
        },
        []
    );

    function stopAndRun(callback) {
        return (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            callback();
        };
    }

    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
                <div
                    className="bg-card mb-3 overflow-hidden rounded-md border"
                    onMouseEnter={openPopover}
                    onMouseLeave={scheduleClosePopover}
                >
                    {bannerUrl ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="bg-muted h-28 w-full overflow-hidden rounded-none p-0"
                            aria-label={title}
                            onClick={stopAndRun(() =>
                                openImagePreview({
                                    url: convertFileUrlToImageUrl(
                                        event.imageUrl || bannerUrl,
                                        1024
                                    ),
                                    title
                                })
                            )}
                        >
                            <img
                                src={bannerUrl}
                                alt=""
                                loading="lazy"
                                className="size-full object-cover"
                                onError={() => setBannerError(true)}
                            />
                        </Button>
                    ) : (
                        <div className="bg-muted text-muted-foreground flex h-28 items-center justify-center">
                            <ImageIcon className="size-6" />
                        </div>
                    )}
                    <div className="p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-col gap-1">
                                {showGroupName ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="text-muted-foreground hover:text-primary h-auto max-w-full justify-start p-0 text-left text-xs font-normal"
                                        onClick={stopAndRun(() =>
                                            openGroupDialog({ groupId })
                                        )}
                                    >
                                        <span className="truncate">
                                            {groupName || groupId}
                                        </span>
                                    </Button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="hover:text-primary h-auto max-w-full justify-start p-0 text-left text-sm font-medium"
                                    onClick={stopAndRun(() =>
                                        openGroupDialog({ groupId })
                                    )}
                                >
                                    <span className="truncate">{title}</span>
                                </Button>
                                <div className="text-muted-foreground text-xs">
                                    {formatEventTimeRange(event, mode)}{' '}
                                    {'\u00b7'}{' '}
                                    {capitalizeFirst(event.accessType)}
                                </div>
                                {event.description ? (
                                    <p className="text-muted-foreground line-clamp-2 text-sm">
                                        {event.description}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="outline"
                                    aria-label="Copy event link"
                                    onClick={stopAndRun(
                                        () => void copyEventLink(event, t)
                                    )}
                                >
                                    <Share2Icon data-icon="inline-start" />
                                </Button>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant={
                                        isFollowing ? 'default' : 'outline'
                                    }
                                    aria-label={
                                        isFollowing
                                            ? 'Unfollow event'
                                            : 'Follow event'
                                    }
                                    onClick={stopAndRun(onToggleFollow)}
                                >
                                    <StarIcon data-icon="inline-start" />
                                </Button>
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={stopAndRun(
                                    () => void openCalendarEvent(event)
                                )}
                            >
                                <CalendarIcon data-icon="inline-start" />
                                {t(
                                    'dialog.group_calendar.event_card.export_to_calendar'
                                )}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={stopAndRun(
                                    () => void downloadEventIcs(event)
                                )}
                            >
                                <DownloadIcon data-icon="inline-start" />
                                {t(
                                    'dialog.group_calendar.event_card.download_ics'
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </PopoverTrigger>
            <PopoverContent
                side="right"
                align="start"
                className="w-125 p-3"
                onMouseEnter={openPopover}
                onMouseLeave={scheduleClosePopover}
            >
                <div className="flex items-baseline justify-between gap-3 text-xs">
                    <div className="min-w-0 text-sm font-semibold">{title}</div>
                    <div className="shrink-0 whitespace-nowrap">
                        {formatEventTimeRange(event)}
                    </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openCalendarEvent(event)}
                    >
                        <CalendarIcon data-icon="inline-start" />
                        {t(
                            'dialog.group_calendar.event_card.export_to_calendar'
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void downloadEventIcs(event)}
                    >
                        <DownloadIcon data-icon="inline-start" />
                        {t('dialog.group_calendar.event_card.download_ics')}
                    </Button>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>
                            {t('dialog.group_calendar.event_card.category')}
                        </div>
                        <div className="font-medium">
                            {capitalizeFirst(event.category)}
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>
                            {t(
                                'dialog.group_calendar.event_card.interested_user'
                            )}
                        </div>
                        <div className="font-medium">
                            {event.interestedUserCount ?? 0}
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>
                            {t('dialog.group_calendar.event_card.close_time')}
                        </div>
                        <div className="font-medium">
                            {closeAfterMinutes !== ''
                                ? `${closeAfterMinutes} min`
                                : '\u2014'}
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>
                            {t('dialog.group_calendar.event_card.created')}
                        </div>
                        <div className="font-medium">
                            {event.createdAt
                                ? dayjs(event.createdAt).format(
                                      'YYYY-MM-DD HH:mm'
                                  )
                                : '\u2014'}
                        </div>
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-col gap-1">
                        <div>
                            {t('dialog.group_calendar.event_card.description')}
                        </div>
                        <div className="leading-snug font-normal break-words whitespace-pre-wrap">
                            {event.description || '\u2014'}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
