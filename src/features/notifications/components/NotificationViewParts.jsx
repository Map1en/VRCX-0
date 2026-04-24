import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    BanIcon,
    BellOffIcon,
    BoxIcon,
    CalendarIcon,
    CheckIcon,
    ExternalLinkIcon,
    GlobeIcon,
    MessageCircleIcon,
    RefreshCcwIcon,
    ReplyIcon,
    SendIcon,
    TagIcon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useTranslation } from 'react-i18next';
import { Location } from '@/components/Location.jsx';
import {
    mediaRepository,
    NOTIFICATION_TYPES
} from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { getFileImageUrl } from '../notificationRows.js';
import {
    sanitizeNotificationFilters
} from '../notificationTableState.js';

export function getResponseIcon(response, notificationType) {
    if (response?.type === 'link') {
        return ExternalLinkIcon;
    }
    switch (response?.icon) {
        case 'check':
            return CheckIcon;
        case 'cancel':
            return XIcon;
        case 'ban':
            return BanIcon;
        case 'bell-slash':
            return BellOffIcon;
        case 'reply':
            return notificationType === 'boop' ? MessageCircleIcon : ReplyIcon;
        default:
            return TagIcon;
    }
}

function getNotificationLinkScheme(link) {
    const value = String(link || '').trim();
    const separatorIndex = value.indexOf(':');
    if (separatorIndex <= 0) {
        return '';
    }
    return value.slice(0, separatorIndex).toLowerCase();
}

export function getNotificationLinkIcon(link) {
    switch (getNotificationLinkScheme(link)) {
        case 'user':
            return UserIcon;
        case 'group':
            return UsersIcon;
        case 'event':
            return CalendarIcon;
        case 'world':
            return GlobeIcon;
        case 'avatar':
            return BoxIcon;
        default:
            return ExternalLinkIcon;
    }
}

export function notificationLinkIsInternal(link) {
    return ['user', 'group', 'event', 'world', 'avatar'].includes(
        getNotificationLinkScheme(link)
    );
}

export function SortButton({ column, label }) {
    const direction = column.getIsSorted();
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto justify-start px-1 py-0 text-left"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

export function NotificationLocationLink({
    location,
    worldName = '',
    groupName = ''
}) {
    const value = String(location || '').trim();
    if (!value) {
        return null;
    }

    return (
        <div className="text-muted-foreground max-w-xl text-xs">
            <Location
                location={value}
                hint={worldName}
                grouphint={groupName}
                asButton={false}
            />
        </div>
    );
}

export function NotificationTypeFilterDropdown({
    value,
    onChange,
    getTypeLabel = (type) => type
}) {
    const { t } = useTranslation();

    const activeTypes = Array.isArray(value) ? value : [];
    const filterLabel = t('view.notification.filter_placeholder');
    const label = activeTypes.length
        ? `${filterLabel} (${activeTypes.length})`
        : filterLabel;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-0 flex-1 basis-64 justify-start truncate"
                >
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="max-h-96 w-80 overflow-y-auto"
            >
                <DropdownMenuGroup>
                    {NOTIFICATION_TYPES.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={activeTypes.includes(type)}
                            onCheckedChange={(checked) => {
                                const nextTypes = checked
                                    ? [...activeTypes, type]
                                    : activeTypes.filter(
                                          (entry) => entry !== type
                                      );
                                onChange(
                                    sanitizeNotificationFilters(
                                        nextTypes,
                                        NOTIFICATION_TYPES
                                    )
                                );
                            }}
                            onSelect={(event) => event.preventDefault()}
                        >
                            {getTypeLabel(type)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function BoopReplyDialog({
    request,
    endpoint,
    isLocalUserVrcPlusSupporter,
    onOpenChange,
    onSend
}) {
    const { t } = useTranslation();

    const navigate = useNavigate();
    const open = Boolean(request);
    const notification = request || null;
    const [emojiId, setEmojiId] = useState('');
    const [emojiSearch, setEmojiSearch] = useState('');
    const [emojiRows, setEmojiRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    async function loadEmojiRows() {
        if (!open || !isLocalUserVrcPlusSupporter) {
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const { json } = await mediaRepository.getFileList(
                { n: 100, tag: 'emoji' },
                { endpoint }
            );
            if (requestIdRef.current !== requestId) {
                return;
            }
            setEmojiRows(Array.isArray(json) ? [...json].reverse() : []);
        } catch (nextError) {
            if (requestIdRef.current !== requestId) {
                return;
            }
            setEmojiRows([]);
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : 'Failed to load emojis.'
            );
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (open) {
            setEmojiId('');
            void loadEmojiRows();
        } else {
            requestIdRef.current += 1;
            setEmojiId('');
            setEmojiSearch('');
            setEmojiRows([]);
            setLoading(false);
            setSending(false);
            setError('');
        }
    }, [endpoint, isLocalUserVrcPlusSupporter, open]);

    async function handleSend() {
        if (!notification) {
            return;
        }
        setSending(true);
        setError('');
        try {
            await onSend(notification, emojiId);
            onOpenChange(false);
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : 'Failed to send boop.'
            );
        } finally {
            setSending(false);
        }
    }

    const displayName = notification?.senderUsername || 'this user';
    const filteredEmojiRows = useMemo(() => {
        const query = emojiSearch.trim().toLowerCase();
        if (!query) {
            return emojiRows;
        }
        return emojiRows.filter((emoji) =>
            [emoji?.name, emoji?.id].some((value) =>
                String(value || '')
                    .toLowerCase()
                    .includes(query)
            )
        );
    }, [emojiRows, emojiSearch]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,46rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.notification.generated.send_boop')}
                    </DialogTitle>
                    <DialogDescription>{displayName}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    {!emojiId ? (
                        <div className="text-muted-foreground rounded-md border p-3 text-sm">
                            {t('view.notification.generated.no_custom_emoji_selected_the_default_boop_will_be_sent')}
                        </div>
                    ) : null}
                    {isLocalUserVrcPlusSupporter ? (
                        <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    value={emojiSearch}
                                    placeholder={t('view.notification.generated.search_emoji')}
                                    disabled={sending}
                                    className="h-9 min-w-48 flex-1"
                                    onChange={(event) =>
                                        setEmojiSearch(event.target.value)
                                    }
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={sending || !emojiId}
                                    onClick={() => setEmojiId('')}
                                >
                                    {t('view.notification.generated.clear_selection')}
                                </Button>
                            </div>
                            <div className="max-h-[48vh] min-h-0 overflow-y-auto rounded-md border p-2">
                                {loading ? (
                                    <div className="text-muted-foreground flex h-28 items-center justify-center gap-2 text-sm">
                                        <Spinner className="size-4" />
                                        {t('view.notification.generated.loading_emojis')}
                                    </div>
                                ) : filteredEmojiRows.length ? (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                                        {filteredEmojiRows.map((emoji) => {
                                            const imageUrl =
                                                getFileImageUrl(emoji);
                                            if (!imageUrl || !emoji?.id) {
                                                return null;
                                            }
                                            const selected =
                                                emojiId === emoji.id;
                                            return (
                                                <Button
                                                    key={emoji.id}
                                                    type="button"
                                                    variant={
                                                        selected
                                                            ? 'secondary'
                                                            : 'outline'
                                                    }
                                                    className="h-auto w-full flex-col p-2"
                                                    aria-pressed={selected}
                                                    disabled={sending}
                                                    onClick={() =>
                                                        setEmojiId(
                                                            selected
                                                                ? ''
                                                                : emoji.id
                                                        )
                                                    }
                                                >
                                                    <img
                                                        src={imageUrl}
                                                        alt={
                                                            emoji.name ||
                                                            emoji.id
                                                        }
                                                        className="mx-auto size-20 object-contain"
                                                    />
                                                </Button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-muted-foreground flex h-28 items-center justify-center text-sm">
                                        {emojiRows.length
                                            ? 'No custom emojis match the search.'
                                            : 'No custom emojis.'}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                    {error ? (
                        <div className="text-destructive text-sm">{error}</div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={sending}
                        onClick={() => {
                            onOpenChange(false);
                            navigate('/tools/gallery');
                        }}
                    >
                        {t('view.notification.generated.emoji_manager')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || sending}
                        onClick={() => void loadEmojiRows()}
                    >
                        <RefreshCcwIcon data-icon="inline-start" />
                        {t('common.actions.refresh')}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={sending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={sending || !notification?.senderUserId}
                        onClick={() => void handleSend()}
                    >
                        {sending ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <SendIcon data-icon="inline-start" />
                        )}
                        {t('view.notification.generated.send')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
