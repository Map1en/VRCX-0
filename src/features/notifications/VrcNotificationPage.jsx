import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    BanIcon,
    BellOffIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CheckIcon,
    ExternalLinkIcon,
    LoaderCircleIcon,
    MessageCircleIcon,
    PencilIcon,
    RefreshCcwIcon,
    ReplyIcon,
    SendIcon,
    TagIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';

import { convertFileUrlToImageUrl, openExternalLink } from '@/lib/entityMedia.js';
import { formatDateFilter } from '@/lib/dateTime.js';
import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    ResizableTableCell,
    ResizableTableHead
} from '@/components/data-table/ResizableTableParts.jsx';
import { Location } from '@/components/Location.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import {
    configRepository,
    mediaRepository,
    NOTIFICATION_TYPES,
    notificationRepository,
    toolsRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';

const STORAGE_KEY = 'vrcx:table:notifications';
const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SORTING = [{ id: 'created_at', desc: true }];
const COLUMN_IDS = ['created_at', 'type', 'senderUsername', 'groupName', 'photo', 'message', 'action', 'trailing'];
const LEGACY_COLUMN_ID_MAP = {
    createdAt: 'created_at',
    sender: 'senderUsername',
    group: 'groupName',
    actions: 'action'
};

function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function readPersistedState() {
    if (typeof window === 'undefined') {
        return {};
    }

    return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
}

function writePersistedState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    const current = readPersistedState();
    window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            ...current,
            ...patch,
            updatedAt: Date.now()
        })
    );
}

function normalizeColumnId(columnId) {
    return LEGACY_COLUMN_ID_MAP[columnId] || columnId;
}

function sanitizeSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }

    const allowedIds = new Set(['created_at', 'type', 'senderUsername', 'groupName']);
    const filtered = value
        .map((entry) => ({
            ...entry,
            id: normalizeColumnId(entry?.id)
        }))
        .filter((entry) => entry && typeof entry.id === 'string' && allowedIds.has(entry.id));
    return filtered.length ? filtered : DEFAULT_SORTING;
}

function sanitizeNotificationFilters(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((type) => NOTIFICATION_TYPES.includes(type));
}

function sanitizeColumnVisibility(value) {
    const visibility = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const [columnId, visible] of Object.entries(value)) {
        const normalizedColumnId = normalizeColumnId(columnId);
        if (COLUMN_IDS.includes(normalizedColumnId) && typeof visible === 'boolean') {
            visibility[normalizedColumnId] = visible;
        }
    }
    return visibility;
}

function sanitizeColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const order = [];
    for (const columnId of value) {
        const normalizedColumnId = normalizeColumnId(columnId);
        if (COLUMN_IDS.includes(normalizedColumnId) && !order.includes(normalizedColumnId)) {
            order.push(normalizedColumnId);
        }
    }
    return order;
}

function sanitizeColumnSizing(value) {
    const sizing = {};
    if (!value || typeof value !== 'object') {
        return sizing;
    }

    for (const [columnId, rawSize] of Object.entries(value)) {
        const normalizedColumnId = normalizeColumnId(columnId);
        const size = Number(rawSize);
        if (COLUMN_IDS.includes(normalizedColumnId) && Number.isFinite(size) && size > 0) {
            sizing[normalizedColumnId] = size;
        }
    }

    return sizing;
}

function resolvePageSize(candidate) {
    const parsed = Number.parseInt(candidate, 10);
    return Number.isFinite(parsed) && DEFAULT_PAGE_SIZES.includes(parsed)
        ? parsed
        : DEFAULT_PAGE_SIZES[1];
}

function getNotificationCreatedAt(notification) {
    return notification?.createdAt || notification?.created_at || '';
}

function getNotificationMessage(notification) {
    const generatedInviteMessage = notification.details?.worldName
        ? `This is a generated invite to ${notification.details.worldName}`
        : '';
    const message = notification.message === generatedInviteMessage ? '' : notification.message;
    return [
        notification.title,
        message,
        notification.details?.inviteMessage,
        notification.details?.requestMessage,
        notification.details?.responseMessage
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(notification.title && notification.message ? ', ' : ' ');
}

function getGroupLabel(notification, includeLinkText = false) {
    return (
        notification.data?.groupName ||
        notification.details?.groupName ||
        notification.groupName ||
        (includeLinkText ? notification.linkText : '') ||
        ''
    );
}

function getNotificationGroupColumnLabel(notification) {
    const isGroupLink = notification?.link?.startsWith('group:') || notification?.link?.startsWith('event:');
    const explicitGroupLabel = getGroupLabel(notification, isGroupLink);
    if (notification?.senderUserId?.startsWith('grp_') || notification?.type === 'groupChange') {
        return notification?.senderUsername || explicitGroupLabel || '';
    }
    return explicitGroupLabel;
}

function matchesNotificationSearch(notification, search) {
    const query = String(search || '').trim().toLowerCase();
    if (!query) {
        return true;
    }

    return [
        notification.type,
        notification.senderUsername,
        notification.senderUserId,
        notification.title,
        notification.message,
        notification.linkText,
        notification.link,
        notification.details?.worldName,
        notification.details?.worldId,
        notification.details?.inviteMessage,
        notification.details?.requestMessage,
        notification.details?.responseMessage,
        notification.data?.groupName
    ].some((value) => String(value || '').toLowerCase().includes(query));
}

function filterNotificationRows(rows, filters, search) {
    const activeFilters = Array.isArray(filters) ? filters : [];
    return (Array.isArray(rows) ? rows : []).filter((notification) => {
        if (activeFilters.length && !activeFilters.includes(notification.type)) {
            return false;
        }
        return matchesNotificationSearch(notification, search);
    });
}

function normalizeWorldTarget(value) {
    const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    return parseLocation(text).worldId || text.split(':')[0] || text;
}

function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    if (currentLocation === 'traveling') {
        return String(gameState?.currentDestination || '').trim();
    }
    return (
        currentLocation ||
        String(gameState?.currentDestination || '').trim() ||
        String(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location || '').trim()
    );
}

function canDeclineNotification(notification) {
    const type = notification?.type || '';
    const link = notification?.link || '';
    return (
        type !== 'requestInviteResponse' &&
        type !== 'inviteResponse' &&
        type !== 'message' &&
        type !== 'boop' &&
        type !== 'groupChange' &&
        !type.includes('group.') &&
        !type.includes('moderation.') &&
        !type.includes('instance.') &&
        !link.startsWith('economy.')
    );
}

function getResponseLabel(response) {
    return response?.text || response?.type || 'Respond';
}

function getResponseIcon(response, notificationType) {
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

function getFileImageUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    const version = versions.at(-1);
    const url = version?.file?.url || file?.url || file?.imageUrl || '';
    return url ? convertFileUrlToImageUrl(url, 128) : '';
}

function getCachedInstanceLocation(instance) {
    return String(instance?.location || instance?.instance?.location || instance?.instanceId || '').trim();
}

function buildCachedInstanceMap(instances) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const location = getCachedInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

function SortButton({ column, label }) {
    const direction = column.getIsSorted();
    return (
        <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => column.toggleSorting(direction === 'asc')}>
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon className="size-3.5" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon className="size-3.5" />
            ) : (
                <ArrowUpDownIcon className="size-3.5" />
            )}
        </button>
    );
}

function NotificationLocationLink({ location, worldName = '', groupName = '' }) {
    const value = String(location || '').trim();
    if (!value) {
        return null;
    }

    return (
        <div className="max-w-xl text-xs text-muted-foreground">
            <Location location={value} hint={worldName} grouphint={groupName} asButton={false} />
        </div>
    );
}

function NotificationTypeFilterDropdown({ value, onChange, getTypeLabel = (type) => type }) {
    const activeTypes = Array.isArray(value) ? value : [];
    const label = activeTypes.length
        ? `${activeTypes.length} notification filters`
        : 'Notification filters';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-9 min-w-[260px] flex-1 justify-start truncate">
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
                {NOTIFICATION_TYPES.map((type) => (
                    <DropdownMenuCheckboxItem
                        key={type}
                        checked={activeTypes.includes(type)}
                        onCheckedChange={(checked) => {
                            const nextTypes = checked
                                ? [...activeTypes, type]
                                : activeTypes.filter((entry) => entry !== type);
                            onChange(sanitizeNotificationFilters(nextTypes));
                        }}
                        onSelect={(event) => event.preventDefault()}>
                        {getTypeLabel(type)}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function normalizeInviteMessageRows(value, messageType) {
    const rows = Array.isArray(value)
        ? value
        : Array.isArray(value?.messages)
            ? value.messages
            : value && typeof value === 'object'
                ? Object.values(value).filter((row) => row && typeof row === 'object')
                : [];

    return rows
        .map((row, index) => ({
            ...row,
            slot: Number.parseInt(row?.slot ?? index, 10),
            message: String(row?.message || row?.text || ''),
            messageType
        }))
        .filter((row) => Number.isFinite(row.slot))
        .sort((left, right) => left.slot - right.slot);
}

function getInviteCooldownLabel(updatedAt) {
    if (!updatedAt) {
        return '';
    }
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) {
        return String(updatedAt);
    }
    const remainingMs = updatedTime + 60 * 60 * 1000 - Date.now();
    if (remainingMs <= 0) {
        return '';
    }
    const minutes = Math.ceil(remainingMs / 60000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function InviteResponseMessageDialog({
    request,
    currentUserId,
    endpoint,
    isLocalUserVrcPlusSupporter,
    onOpenChange,
    onSend
}) {
    const open = Boolean(request);
    const messageType = request?.messageType || 'response';
    const notification = request?.notification || null;
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [confirmRow, setConfirmRow] = useState(null);
    const [editingRow, setEditingRow] = useState(null);
    const [editMessage, setEditMessage] = useState('');
    const [imageData, setImageData] = useState('');
    const [imageName, setImageName] = useState('');
    const requestIdRef = useRef(0);

    async function loadRows() {
        if (!open || !currentUserId) {
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const response = await toolsRepository.getInviteMessages(
                { currentUserId, messageType },
                { endpoint }
            );
            if (requestIdRef.current !== requestId) {
                return;
            }
            setRows(normalizeInviteMessageRows(response, messageType));
        } catch (nextError) {
            if (requestIdRef.current !== requestId) {
                return;
            }
            setRows([]);
            setError(nextError instanceof Error ? nextError.message : 'Failed to load invite response messages.');
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (open) {
            void loadRows();
        } else {
            requestIdRef.current += 1;
            setRows([]);
            setLoading(false);
            setSending(false);
            setError('');
            setConfirmRow(null);
            setEditingRow(null);
            setEditMessage('');
            setImageData('');
            setImageName('');
        }
    }, [currentUserId, endpoint, messageType, open]);

    async function handleImageChange(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            setError(validation.reason === 'too_large' ? 'Selected image is too large.' : 'Selected file is not an image.');
            return;
        }
        try {
            setImageData(await readFileAsBase64(file));
            setImageName(file.name || 'image');
            setError('');
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Failed to read image.');
        }
    }

    async function sendRow(row, message = row?.message || '') {
        if (!row || !notification) {
            return;
        }
        setSending(true);
        setError('');
        try {
            await onSend({
                notification,
                row,
                messageType,
                message,
                imageData
            });
            onOpenChange(false);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Failed to send invite response.');
        } finally {
            setSending(false);
        }
    }

    function beginEdit(row) {
        setConfirmRow(null);
        setEditingRow(row);
        setEditMessage(row?.message || '');
    }

    const title = messageType === 'requestResponse'
        ? 'Invite request response message'
        : 'Invite response message';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,56rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Select a message slot, optionally edit it, then confirm the response.
                    </DialogDescription>
                </DialogHeader>
                {isLocalUserVrcPlusSupporter ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            type="file"
                            accept={IMAGE_UPLOAD_ACCEPT}
                            className="max-w-sm"
                            disabled={sending}
                            onChange={(event) => void handleImageChange(event)}
                        />
                        {imageName ? (
                            <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => {
                                setImageData('');
                                setImageName('');
                            }}>
                                Clear image: {imageName}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
                {error ? <div className="text-sm text-destructive">{error}</div> : null}
                <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-20">Slot</TableHead>
                                <TableHead>Message</TableHead>
                                <TableHead className="w-32 text-right">Cool down</TableHead>
                                <TableHead className="w-24 text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                        <LoaderCircleIcon className="mr-2 inline size-4 animate-spin" />
                                        Loading invite messages.
                                    </TableCell>
                                </TableRow>
                            ) : rows.length ? rows.map((row) => (
                                <TableRow
                                    key={`${messageType}:${row.slot}`}
                                    className={confirmRow?.slot === row.slot ? 'cursor-pointer bg-muted/70' : 'cursor-pointer'}
                                    onClick={() => {
                                        setEditingRow(null);
                                        setConfirmRow(row);
                                    }}>
                                    <TableCell className="font-mono text-xs">{row.slot}</TableCell>
                                    <TableCell className="whitespace-normal">{row.message || '—'}</TableCell>
                                    <TableCell className="text-right text-xs text-muted-foreground">
                                        {getInviteCooldownLabel(row.updatedAt)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            disabled={sending}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                beginEdit(row);
                                            }}>
                                            <PencilIcon className="size-3.5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                        No invite response messages.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                {editingRow ? (
                    <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">Edit and send slot {editingRow.slot}</div>
                        <Textarea
                            value={editMessage}
                            maxLength={64}
                            rows={2}
                            disabled={sending}
                            onChange={(event) => setEditMessage(event.target.value)}
                        />
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground">{editMessage.length}/64</span>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => setEditingRow(null)}>
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={sending || !editMessage.trim()}
                                    onClick={() => void sendRow(editingRow, editMessage.trim())}>
                                    {sending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
                                    Send
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : confirmRow ? (
                    <div className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0 text-sm">
                            Send slot <span className="font-mono">{confirmRow.slot}</span>
                            {confirmRow.message ? <span className="ml-2 text-muted-foreground">{confirmRow.message}</span> : null}
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => setConfirmRow(null)}>
                                Cancel
                            </Button>
                            <Button type="button" size="sm" disabled={sending} onClick={() => void sendRow(confirmRow)}>
                                {sending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
                                Confirm
                            </Button>
                        </div>
                    </div>
                ) : null}
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={loading || sending} onClick={() => void loadRows()}>
                        <RefreshCcwIcon className="size-3.5" />
                        Refresh
                    </Button>
                    <Button type="button" variant="secondary" disabled={sending} onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function BoopReplyDialog({
    request,
    endpoint,
    isLocalUserVrcPlusSupporter,
    onOpenChange,
    onSend
}) {
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
            setError(nextError instanceof Error ? nextError.message : 'Failed to load emojis.');
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
            setError(nextError instanceof Error ? nextError.message : 'Failed to send boop.');
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
            [emoji?.name, emoji?.id]
                .some((value) => String(value || '').toLowerCase().includes(query))
        );
    }, [emojiRows, emojiSearch]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,46rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>Send boop</DialogTitle>
                    <DialogDescription>{displayName}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {!emojiId ? (
                        <div className="rounded-md border p-3 text-sm text-muted-foreground">
                            No custom emoji selected. The default boop will be sent.
                        </div>
                    ) : null}
                    {isLocalUserVrcPlusSupporter ? (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    value={emojiSearch}
                                    placeholder="Search emoji"
                                    disabled={sending}
                                    className="h-9 min-w-48 flex-1"
                                    onChange={(event) => setEmojiSearch(event.target.value)}
                                />
                                <Button type="button" variant="outline" size="sm" disabled={sending || !emojiId} onClick={() => setEmojiId('')}>
                                    Clear selection
                                </Button>
                            </div>
                        <div className="min-h-0 max-h-[48vh] overflow-y-auto rounded-md border p-2">
                            {loading ? (
                                <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                                    <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
                                    Loading emojis.
                                </div>
                            ) : filteredEmojiRows.length ? (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                                    {filteredEmojiRows.map((emoji) => {
                                        const imageUrl = getFileImageUrl(emoji);
                                        if (!imageUrl || !emoji?.id) {
                                            return null;
                                        }
                                        const selected = emojiId === emoji.id;
                                        return (
                                            <button
                                                key={emoji.id}
                                                type="button"
                                                className={
                                                    selected
                                                        ? 'rounded-xl border border-primary bg-primary/10 p-2'
                                                        : 'rounded-xl border border-transparent p-2 hover:border-border hover:bg-muted'
                                                }
                                                disabled={sending}
                                                onClick={() => setEmojiId(selected ? '' : emoji.id)}>
                                                <img
                                                    src={imageUrl}
                                                    alt={emoji.name || emoji.id}
                                                    className="mx-auto size-20 object-contain"
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                                    {emojiRows.length ? 'No custom emojis match the search.' : 'No custom emojis.'}
                                </div>
                            )}
                        </div>
                        </div>
                    ) : null}
                    {error ? <div className="text-sm text-destructive">{error}</div> : null}
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={sending}
                        onClick={() => {
                            onOpenChange(false);
                            navigate('/tools/gallery');
                        }}>
                        Emoji manager
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || sending}
                        onClick={() => void loadEmojiRows()}>
                        <RefreshCcwIcon className="size-3.5" />
                        Refresh
                    </Button>
                    <Button type="button" variant="secondary" disabled={sending} onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={sending || !notification?.senderUserId} onClick={() => void handleSend()}>
                        {sending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
                        Send
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function VrcNotificationPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const runtimeAuth = useRuntimeStore((state) => state.auth);
    const gameState = useRuntimeStore((state) => state.gameState);
    const modalStore = useModalStore();
    const notificationRows = useVrcNotificationStore((state) => state.rows);
    const notificationLoadStatus = useVrcNotificationStore((state) => state.loadStatus);
    const notificationDetail = useVrcNotificationStore((state) => state.detail);
    const loadNotificationsForCurrentUser = useVrcNotificationStore((state) => state.loadForCurrentUser);
    const groupInstancesState = useRuntimeStore((state) => state.groupInstances);
    const currentUserId = runtimeAuth.currentUserId;
    const endpoint = runtimeAuth.currentUserEndpoint;
    const groupInstanceRows = groupInstancesState.endpoint === endpoint ? groupInstancesState.instances : [];
    const currentUserSnapshot = runtimeAuth.currentUserSnapshot;
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter') ||
            globalThis?.$debug?.debugVrcPlus
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstanceRows),
        [groupInstanceRows]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances
            }),
        [cachedInstances, currentInviteLocation, currentUserId]
    );
    const notificationTypeLabel = useMemo(
        () => (type) => {
            const fallback = type || 'unknown';
            const key = `view.notification.filters.${fallback}`;
            const label = t(key);
            return label && label !== key ? label : fallback;
        },
        [t]
    );
    const persistedState = useMemo(() => readPersistedState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenColumnVisibilityRef = useRef(false);
    const hasWrittenTableLayoutRef = useRef(false);
    const [rows, setRows] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [activeTypes, setActiveTypes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [sorting, setSorting] = useState(() => sanitizeSorting(persistedState.sorting));
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeColumnSizing(persistedState.columnSizing)
    );
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: resolvePageSize(persistedState.pageSize)
    });
    const [reloadToken, setReloadToken] = useState(0);
    const [inviteResponseRequest, setInviteResponseRequest] = useState(null);
    const [boopReplyRequest, setBoopReplyRequest] = useState(null);
    const [shiftHeld, setShiftHeld] = useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        }

        function handleKeyUp(event) {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        }

        function handleBlur() {
            setShiftHeld(false);
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    useEffect(() => {
        let active = true;
        configRepository
            .getString('VRCX_notificationTableFilters', '[]')
            .then((savedFilters) => {
                if (!active) {
                    return;
                }

                setActiveTypes(sanitizeNotificationFilters(safeJsonParse(savedFilters)));
                setPreferencesReady(true);
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setPreferencesReady(true);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        void configRepository.setString(
            'VRCX_notificationTableFilters',
            JSON.stringify(activeTypes)
        );
    }, [activeTypes, preferencesReady]);

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }

        writePersistedState({
            sorting: sanitizeSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }

        writePersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenColumnVisibilityRef.current) {
            hasWrittenColumnVisibilityRef.current = true;
            return;
        }

        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility)
        });
    }, [columnVisibility]);

    useEffect(() => {
        if (!hasWrittenTableLayoutRef.current) {
            hasWrittenTableLayoutRef.current = true;
            return;
        }

        writePersistedState({
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing)
        });
    }, [columnOrder, columnSizing]);

    useEffect(() => {
        let active = true;
        if (!preferencesReady) {
            return () => {
                active = false;
            };
        }
        if (!currentUserId) {
            setRows([]);
            setLoadStatus('idle');
            setDetail('No current user session is available.');
            return () => {
                active = false;
            };
        }

        loadNotificationsForCurrentUser()
            .catch((error) => {
                if (!active) {
                    return;
                }
                toast.error(error instanceof Error ? error.message : 'Failed to load notifications.');
            });

        return () => {
            active = false;
        };
    }, [currentUserId, loadNotificationsForCurrentUser, preferencesReady, reloadToken]);

    useEffect(() => {
        if (!preferencesReady || !currentUserId) {
            return;
        }

        const nextRows = filterNotificationRows(notificationRows, activeTypes, deferredSearchQuery);
        setRows(nextRows);
        setLoadStatus(notificationLoadStatus);
        setDetail(notificationDetail || '');
    }, [
        activeTypes,
        currentUserId,
        deferredSearchQuery,
        notificationDetail,
        notificationLoadStatus,
        notificationRows,
        preferencesReady
    ]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [activeTypes, deferredSearchQuery]);

    function openNotificationLink(link) {
        const value = String(link || '').trim();
        if (!value) return;
        if (value.startsWith('user:')) {
            const userId = value.slice('user:'.length);
            openUserDialog({ userId });
            return;
        }
        if (value.startsWith('group:')) {
            const groupId = value.slice('group:'.length);
            openGroupDialog({ groupId });
            return;
        }
        if (value.startsWith('event:')) {
            const [groupId] = value.slice('event:'.length).split(',');
            if (groupId) {
                openGroupDialog({ groupId });
                return;
            }
        }
        if (value.startsWith('world:')) {
            const worldId = normalizeWorldTarget(value.slice('world:'.length));
            openWorldDialog({ worldId });
            return;
        }
        if (value.startsWith('avatar:')) {
            const avatarId = value.slice('avatar:'.length);
            openAvatarDialog({ avatarId });
            return;
        }
        void openExternalLink(value);
    }

    function openNotificationTypeTarget(notification) {
        if (
            (notification.type === 'group.queueReady' || notification.type === 'instance.closed') &&
            notification.location
        ) {
            openWorldDialog({
                worldId: notification.location,
                title: notification.worldName || notification.details?.worldName || undefined
            });
            return;
        }
        if (notification.link) {
            openNotificationLink(notification.link);
        }
    }

    function notificationTypeIsClickable(notification) {
        return Boolean(
            notification.link ||
            (
                (notification.type === 'group.queueReady' || notification.type === 'instance.closed') &&
                notification.location
            )
        );
    }

    function openNotificationImagePreview(notification) {
        const imageUrl = notification.details?.imageUrl || notification.imageUrl || '';
        if (!imageUrl || imageUrl.startsWith('default_')) {
            return;
        }
        modalStore.openImagePreview({
            url: convertFileUrlToImageUrl(imageUrl, 1024),
            title: notification.title || notification.message || notification.type || 'Notification image'
        });
    }

    async function markSeen(notification) {
        try {
            await notificationRepository.markSeen({
                userId: currentUserId,
                id: notification.id,
                version: notification.version,
                endpoint
            });
            setReloadToken((value) => value + 1);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to mark notification as seen.');
        }
    }

    async function deleteNotification(notification, { skipConfirm = false } = {}) {
        try {
            if (!skipConfirm) {
                const result = await modalStore.confirm({
                    title: 'Delete notification log entry',
                    description: `Delete the local ${notification.type || 'notification'} log entry?`,
                    confirmText: 'Delete',
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            await notificationRepository.deleteNotification({
                userId: currentUserId,
                id: notification.id,
                version: notification.version
            });
            setReloadToken((value) => value + 1);
            toast.success('Notification log entry deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete notification.');
        }
    }

    async function expireNotificationLocally(notification) {
        await notificationRepository.expireNotification({
            userId: currentUserId,
            id: notification.id
        });
        setReloadToken((value) => value + 1);
    }

    async function acceptFriendRequest(notification) {
        try {
            const result = await modalStore.confirm({
                title: 'Accept friend request',
                description: `Accept the friend request from ${notification.senderUsername || 'this user'}?`
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.acceptFriendRequest({
                id: notification.id,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success('Friend request accepted.');
        } catch (error) {
            if (error?.status === 404) {
                await expireNotificationLocally(notification);
                return;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to accept friend request.');
        }
    }

    async function hideNotification(notification, { skipConfirm = false } = {}) {
        try {
            if (!skipConfirm) {
                const result = await modalStore.confirm({
                    title: 'Decline notification',
                    description: `Decline the ${notification.type || 'notification'} notification?`,
                    confirmText: 'Decline',
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            await notificationRepository.hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success('Notification declined.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to decline notification.');
        }
    }

    async function acceptRequestInvite(notification) {
        try {
            if (!currentInviteLocation) {
                toast.error('Cannot invite: no current VRChat location is available.');
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.error('Cannot invite from the current instance type.');
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.error('Cannot invite: current location is not a concrete instance.');
                return;
            }
            const result = await modalStore.confirm({
                title: 'Send invite',
                description: `Send an invite to ${notification.senderUsername || 'this user'}?`
            });
            if (!result.ok) {
                return;
            }

            const worldResponse = await vrchatSearchRepository.getWorlds({}, parsedLocation.worldId, { endpoint });
            await notificationRepository.sendInvite({
                receiverUserId: notification.senderUserId,
                endpoint,
                params: {
                    instanceId: currentInviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName: worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            await notificationRepository.hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success('Invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite.');
        }
    }

    function sendInviteResponseWithMessage(notification, messageType) {
        if (!currentUserId) {
            toast.error('Cannot send invite response: no current user session is available.');
            return;
        }
        setInviteResponseRequest({
            notification,
            messageType
        });
    }

    async function sendInviteResponseSlot({
        notification,
        row,
        messageType,
        message,
        imageData
    }) {
        if (!currentUserId) {
            throw new Error('Cannot send invite response: no current user session is available.');
        }

        const responseSlot = Number.parseInt(row?.slot, 10);
        if (!Number.isFinite(responseSlot)) {
            throw new Error('Response slot must be a number.');
        }

        const nextMessage = String(message || '').trim();
        if (nextMessage && nextMessage !== String(row?.message || '')) {
            const json = await toolsRepository.editInviteMessage(
                {
                    currentUserId,
                    messageType,
                    slot: responseSlot,
                    message: nextMessage
                },
                { endpoint }
            );
            if (json?.[responseSlot]?.message === row?.message) {
                throw new Error('Invite response message update failed.');
            }
        }

        if (imageData) {
            await withUploadTimeout(
                notificationRepository.sendInviteResponsePhoto({
                    id: notification.id,
                    responseSlot,
                    imageData,
                    endpoint
                })
            );
        } else {
            await notificationRepository.sendInviteResponse({
                id: notification.id,
                responseSlot,
                endpoint
            });
        }

        await notificationRepository.hideRemoteNotification({
            id: notification.id,
            version: notification.version,
            type: notification.type,
            senderUserId: notification.senderUserId,
            endpoint
        });
        await expireNotificationLocally(notification);
        toast.success(imageData ? 'Invite response photo sent.' : 'Invite response sent.');
    }

    async function dismissBoopNotifications(senderUserId) {
        if (!currentUserId || !senderUserId) {
            return;
        }
        const matchingRows = await notificationRepository.queryNotifications({
            userId: currentUserId,
            filters: ['boop']
        }).then((items) =>
            (Array.isArray(items) ? items : []).filter((item) =>
                item?.type === 'boop' &&
                !item.expired &&
                item.link === `user:${senderUserId}`
            )
        );

        await Promise.allSettled(
            matchingRows.map(async (item) => {
                try {
                    await notificationRepository.hideRemoteNotification({
                        id: item.id,
                        version: item.version,
                        type: item.type,
                        senderUserId: item.senderUserId,
                        endpoint
                    });
                } finally {
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: item.id
                    });
                }
            })
        );
    }

    async function sendBoopReply(notification, emojiId = '') {
        if (!notification?.senderUserId) {
            throw new Error('Cannot send boop: no sender user id is available.');
        }
        await dismissBoopNotifications(notification.senderUserId);
        await notificationRepository.sendBoop({
            userId: notification.senderUserId,
            emojiId,
            endpoint
        });
        await notificationRepository.hideRemoteNotification({
            id: notification.id,
            version: notification.version,
            type: notification.type,
            senderUserId: notification.senderUserId,
            endpoint
        }).catch(() => {});
        await expireNotificationLocally(notification);
        toast.success('Boop sent.');
    }

    async function sendNotificationResponse(notification, response) {
        try {
            const responseType = String(response?.type || '').toLowerCase();
            if (response?.type === 'link') {
                openNotificationLink(response.data);
                return;
            }
            if (
                notification.type === 'boop' &&
                (responseType === 'reply' || responseType === 'boop' || response?.icon === 'reply')
            ) {
                setBoopReplyRequest(notification);
                return;
            }
            await notificationRepository.sendNotificationResponse({
                id: notification.id,
                responseType: response?.type,
                responseData: response?.data || '',
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success('Notification response sent.');
        } catch (error) {
            if (notification.version >= 2) {
                await expireNotificationLocally(notification);
            }
            toast.error(error instanceof Error ? error.message : 'Failed to send notification response.');
        }
    }

    const columns = useMemo(
        () => [
            {
                id: 'created_at',
                accessorFn: (row) => new Date(getNotificationCreatedAt(row) || 0).valueOf() || 0,
                meta: { label: t('table.notification.date') },
                header: ({ column }) => <SortButton column={column} label={t('table.notification.date')} />,
                cell: ({ row }) => {
                    const createdAt = getNotificationCreatedAt(row.original);
                    const shortText = formatDateFilter(createdAt, 'short');
                    const longText = formatDateFilter(createdAt, 'long');
                    return (
                        <div className="min-w-32 text-sm text-muted-foreground" title={longText}>
                            {shortText}
                        </div>
                    );
                }
            },
            {
                id: 'type',
                accessorFn: (row) => String(row?.type || ''),
                meta: { label: t('table.notification.type') },
                header: ({ column }) => <SortButton column={column} label={t('table.notification.type')} />,
                cell: ({ row }) => {
                    const notification = row.original;
                    const label = notificationTypeLabel(notification.type);
                    const badge = (
                        <Badge variant={notification.expired ? 'secondary' : 'outline'}>
                            {label}
                        </Badge>
                    );
                    return notificationTypeIsClickable(notification) ? (
                        <button type="button" className="text-left" onClick={() => openNotificationTypeTarget(notification)}>
                            {badge}
                        </button>
                    ) : badge;
                }
            },
            {
                id: 'senderUsername',
                accessorFn: (row) => String(row?.senderUsername || row?.senderUserId || ''),
                meta: { label: t('table.notification.user') },
                header: ({ column }) => <SortButton column={column} label={t('table.notification.user')} />,
                cell: ({ row }) => {
                    const notification = row.original;
                    if (notification.senderUserId && !notification.senderUserId.startsWith('grp_')) {
                        return (
                            <button type="button" className="block max-w-48 truncate text-left text-sm hover:underline" onClick={() => openUserDialog({ userId: notification.senderUserId, title: notification.senderUsername || undefined })}>
                                {notification.senderUsername || 'User'}
                            </button>
                        );
                    }
                    if (notification.link?.startsWith('user:')) {
                        const userId = notification.link.slice('user:'.length);
                        return (
                            <button type="button" className="block max-w-48 truncate text-left text-sm hover:underline" onClick={() => openUserDialog({ userId, title: notification.linkText || notification.senderUsername || undefined })}>
                                {notification.linkText || notification.senderUsername || 'User'}
                            </button>
                        );
                    }
                    if (notification.senderUsername && !notification.senderUserId?.startsWith('grp_')) {
                        return <div className="max-w-48 truncate text-sm">{notification.senderUsername}</div>;
                    }
                    return null;
                }
            },
            {
                id: 'groupName',
                accessorFn: (row) => getNotificationGroupColumnLabel(row),
                meta: { label: t('table.notification.group') },
                header: t('table.notification.group'),
                cell: ({ row }) => {
                    const notification = row.original;
                    const label = getNotificationGroupColumnLabel(notification);
                    const groupId = notification.senderUserId?.startsWith('grp_')
                        ? notification.senderUserId
                        : notification.link?.startsWith('group:')
                            ? notification.link.slice('group:'.length)
                            : notification.link?.startsWith('event:')
                                ? notification.link.slice('event:'.length).split(',')[0]
                                : '';
                    if (!label) return null;
                    return groupId ? (
                        <button type="button" className="block max-w-48 truncate text-left text-sm hover:underline" onClick={() => openGroupDialog({ groupId, title: label })}>
                            {label}
                        </button>
                    ) : (
                        <div className="max-w-48 truncate text-sm">{label}</div>
                    );
                }
            },
            {
                id: 'photo',
                enableSorting: false,
                meta: { label: t('table.notification.photo') },
                header: t('table.notification.photo'),
                cell: ({ row }) => {
                    const imageUrl = row.original.details?.imageUrl || row.original.imageUrl || '';
                    if (!imageUrl || imageUrl.startsWith('default_')) return null;
                    return (
                        <button type="button" className="block" onClick={() => openNotificationImagePreview(row.original)}>
                            <img src={convertFileUrlToImageUrl(imageUrl, 64)} alt="" className="size-10 rounded-md object-cover" />
                        </button>
                    );
                }
            },
            {
                id: 'message',
                accessorFn: (row) => getNotificationMessage(row),
                enableSorting: false,
                meta: { label: t('table.notification.message') },
                header: t('table.notification.message'),
                cell: ({ row }) => {
                    const notification = row.original;
                    const message = getNotificationMessage(notification);
                    const worldId = notification.details?.worldId || notification.data?.worldId || notification.location || '';
                    return (
                        <div className="min-w-0 space-y-1">
                            {message ? <div className="max-w-xl truncate text-sm">{message}</div> : null}
                            {worldId ? (
                                <NotificationLocationLink
                                    location={worldId}
                                    worldName={notification.details?.worldName || notification.worldName || ''}
                                    groupName={notification.details?.groupName || notification.groupName || notification.data?.groupName || ''}
                                />
                            ) : null}
                            {notification.link ? (
                                <button type="button" className="inline-flex max-w-xl items-center gap-1 truncate text-left text-xs text-muted-foreground hover:underline" onClick={() => openNotificationLink(notification.link)}>
                                    <ExternalLinkIcon className="size-3" />
                                    {notification.linkText || notification.link}
                                </button>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'action',
                enableSorting: false,
                meta: { label: t('table.notification.action') },
                header: t('table.notification.action'),
                cell: ({ row }) => {
                    const notification = row.original;
                    const remoteActionsVisible =
                        notification.senderUserId !== currentUserId && !notification.expired;
                    const responses = Array.isArray(notification.responses) ? notification.responses : [];
                    const localDeleteVisible =
                        notification.type !== 'friendRequest' &&
                        notification.type !== 'ignoredFriendRequest';
                    return (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {remoteActionsVisible && notification.type === 'friendRequest' ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Accept" onClick={() => void acceptFriendRequest(notification)}>
                                    <CheckIcon className="size-3" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible && notification.type === 'requestInvite' && canInviteFromCurrentLocation ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Invite" onClick={() => void acceptRequestInvite(notification)}>
                                    <SendIcon className="size-3" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible && notification.type === 'invite' ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Decline with message" onClick={() => void sendInviteResponseWithMessage(notification, 'response')}>
                                    <SendIcon className="size-3" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible && notification.type === 'requestInvite' ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Decline with message" onClick={() => void sendInviteResponseWithMessage(notification, 'requestResponse')}>
                                    <SendIcon className="size-3" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible
                                ? responses.map((response) => {
                                    const ResponseIcon = getResponseIcon(response, notification.type);
                                    return (
                                        <Button
                                            key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            title={getResponseLabel(response)}
                                            onClick={() => void sendNotificationResponse(notification, response)}>
                                            <ResponseIcon className="size-3" />
                                        </Button>
                                    );
                                })
                                : null}
                            {remoteActionsVisible && canDeclineNotification(notification) ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Decline" onClick={(event) => void hideNotification(notification, { skipConfirm: shiftHeld || event.shiftKey })}>
                                    <XIcon className={shiftHeld ? 'size-3 text-destructive' : 'size-3'} />
                                </Button>
                            ) : null}
                            {notification.version === 2 && !notification.seen ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Seen" onClick={() => void markSeen(notification)}>
                                    <CheckIcon className="size-3" />
                                </Button>
                            ) : null}
                            {localDeleteVisible ? (
                                <Button type="button" variant="ghost" size="icon-xs" title="Delete log" onClick={(event) => void deleteNotification(notification, { skipConfirm: shiftHeld || event.shiftKey })}>
                                    {shiftHeld ? <XIcon className="size-3.5 text-destructive" /> : <Trash2Icon className="size-3.5" />}
                                </Button>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'trailing',
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null,
                size: 5
            }
        ],
        [canInviteFromCurrentLocation, currentInviteLocation, currentUserId, endpoint, notificationTypeLabel, shiftHeld, t]
    );

    const table = useReactTable({
        data: rows,
        columns,
        state: { columnVisibility, columnOrder, columnSizing, sorting, pagination },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        onPaginationChange: setPagination,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel()
    });

    return (
        <>
        <div
            className={
                embedded
                    ? 'flex h-full min-h-0 flex-col gap-3 p-3'
                    : 'x-container x-container--auto-height flex h-full min-h-0 flex-col gap-3 p-4 pb-0'
            }>
            <div className="flex flex-wrap items-center gap-2">
                <NotificationTypeFilterDropdown
                    value={activeTypes}
                    onChange={setActiveTypes}
                    getTypeLabel={notificationTypeLabel}
                />
                <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search"
                    className="h-9 w-[150px] flex-[0.4]"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full"
                    disabled={loadStatus === 'running'}
                    onClick={() => setReloadToken((value) => value + 1)}>
                    <RefreshCcwIcon className={loadStatus === 'running' ? 'size-4 animate-spin' : 'size-4'} />
                </Button>
                <TableColumnVisibilityMenu table={table} />
                <Select
                    value={String(pagination.pageSize)}
                    onValueChange={(value) => setPagination({ pageIndex: 0, pageSize: resolvePageSize(value) })}>
                    <SelectTrigger className="h-9 w-24">
                        <SelectValue placeholder="Rows" />
                    </SelectTrigger>
                    <SelectContent>
                        {DEFAULT_PAGE_SIZES.map((value) => (
                            <SelectItem key={value} value={String(value)}>
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {activeTypes.length ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setActiveTypes([])}>
                        Clear
                    </Button>
                ) : null}
            </div>

            {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}

            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                <div className="h-full overflow-auto">
                    <Table className="vrcx-data-table table-fixed">
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <ResizableTableHead key={header.id} header={header} />
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows.length > 0 ? (
                                table.getRowModel().rows.map((row) => (
                                    <TableRow key={row.id}>
                                        {row.getVisibleCells().map((cell) => (
                                            <ResizableTableCell key={cell.id} cell={cell} />
                                        ))}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                                        {loadStatus === 'running' ? 'Loading notifications...' : 'No VRChat notifications match the current view.'}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-muted-foreground">{rows.length} notifications in view</div>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
                        <ChevronLeftIcon className="size-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
                    </span>
                    <Button type="button" variant="outline" size="icon" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
                        <ChevronRightIcon className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
        <InviteResponseMessageDialog
            request={inviteResponseRequest}
            currentUserId={currentUserId}
            endpoint={endpoint}
            isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
            onOpenChange={(open) => {
                if (!open) {
                    setInviteResponseRequest(null);
                }
            }}
            onSend={sendInviteResponseSlot}
        />
        <BoopReplyDialog
            request={boopReplyRequest}
            endpoint={endpoint}
            isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
            onOpenChange={(open) => {
                if (!open) {
                    setBoopReplyRequest(null);
                }
            }}
            onSend={sendBoopReply}
        />
        </>
    );
}
