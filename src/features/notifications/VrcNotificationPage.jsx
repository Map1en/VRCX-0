import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    BanIcon,
    BellOffIcon,
    CheckIcon,
    ExternalLinkIcon,
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
import { cn } from '@/lib/utils.js';
import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    ResizableTableCell
} from '@/components/data-table/ResizableTableParts.jsx';
import {
    DataTableHeader,
    DataTablePagination
} from '@/components/data-table/DataTableView.jsx';
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
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedNotificationTableState as readPersistedState,
    resolveNotificationPageSize as resolvePageSize,
    safeJsonParse,
    sanitizeNotificationColumnOrder as sanitizeColumnOrder,
    sanitizeNotificationColumnSizing as sanitizeColumnSizing,
    sanitizeNotificationColumnVisibility as sanitizeColumnVisibility,
    sanitizeNotificationFilters,
    sanitizeNotificationSorting as sanitizeSorting,
    writePersistedNotificationTableState as writePersistedState
} from './notificationTableState.js';
import {
    buildCachedInstanceMap,
    canDeclineNotification,
    filterNotificationRows,
    getFileImageUrl,
    getInviteCooldownLabel,
    getNotificationCreatedAt,
    getNotificationGroupColumnLabel,
    getNotificationMessage,
    getResponseLabel,
    normalizeInviteMessageRows,
    normalizeWorldTarget,
    resolveCurrentInviteLocation
} from './notificationRows.js';

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

function SortButton({ column, label }) {
    const direction = column.getIsSorted();
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto justify-start px-1 py-0 text-left"
            onClick={() => column.toggleSorting(direction === 'asc')}>
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
                <Button type="button" variant="outline" className="h-9 min-w-0 flex-1 basis-64 justify-start truncate">
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
                <DropdownMenuGroup>
                    {NOTIFICATION_TYPES.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={activeTypes.includes(type)}
                            onCheckedChange={(checked) => {
                                const nextTypes = checked
                                    ? [...activeTypes, type]
                                    : activeTypes.filter((entry) => entry !== type);
                                onChange(sanitizeNotificationFilters(nextTypes, NOTIFICATION_TYPES));
                            }}
                            onSelect={(event) => event.preventDefault()}>
                            {getTypeLabel(type)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
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
    const inviteCooldownNowMs = Date.now();

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
                                        <div className="inline-flex items-center gap-2">
                                            <Spinner className="size-4" />
                                            Loading invite messages.
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : rows.length ? rows.map((row) => (
                                <TableRow
                                    key={`${messageType}:${row.slot}`}
                                    className={cn('cursor-pointer', confirmRow?.slot === row.slot && 'bg-muted/70')}
                                    tabIndex={0}
                                    aria-label={`Select invite message slot ${row.slot}`}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') {
                                            return;
                                        }
                                        event.preventDefault();
                                        setEditingRow(null);
                                        setConfirmRow(row);
                                    }}
                                    onClick={() => {
                                        setEditingRow(null);
                                        setConfirmRow(row);
                                    }}>
                                    <TableCell className="font-mono text-xs">{row.slot}</TableCell>
                                    <TableCell className="whitespace-normal">{row.message || '—'}</TableCell>
                                    <TableCell className="text-right text-xs text-muted-foreground">
                                        {getInviteCooldownLabel(row.updatedAt, inviteCooldownNowMs)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={`Edit slot ${row.slot}`}
                                            disabled={sending}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                beginEdit(row);
                                            }}>
                                            <PencilIcon data-icon="inline-start" />
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
                    <div className="flex flex-col gap-2 rounded-md border p-3">
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
                                    {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
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
                                {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
                                Confirm
                            </Button>
                        </div>
                    </div>
                ) : null}
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={loading || sending} onClick={() => void loadRows()}>
                        <RefreshCcwIcon data-icon="inline-start" />
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
                <div className="flex flex-col gap-3">
                    {!emojiId ? (
                        <div className="rounded-md border p-3 text-sm text-muted-foreground">
                            No custom emoji selected. The default boop will be sent.
                        </div>
                    ) : null}
                    {isLocalUserVrcPlusSupporter ? (
                        <div className="flex flex-col gap-2">
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
                                <div className="flex h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
                                    <Spinner className="size-4" />
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
                                            <Button
                                                key={emoji.id}
                                                type="button"
                                                variant={selected ? 'secondary' : 'outline'}
                                                className="h-auto w-full flex-col p-2"
                                                aria-pressed={selected}
                                                disabled={sending}
                                                onClick={() => setEmojiId(selected ? '' : emoji.id)}>
                                                <img
                                                    src={imageUrl}
                                                    alt={emoji.name || emoji.id}
                                                    className="mx-auto size-20 object-contain"
                                                />
                                            </Button>
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
                        <RefreshCcwIcon data-icon="inline-start" />
                        Refresh
                    </Button>
                    <Button type="button" variant="secondary" disabled={sending} onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={sending || !notification?.senderUserId} onClick={() => void handleSend()}>
                        {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
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
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
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

                setActiveTypes(sanitizeNotificationFilters(safeJsonParse(savedFilters), NOTIFICATION_TYPES));
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
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing]);

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
                        <Button type="button" variant="ghost" size="sm" className="h-auto p-0" onClick={() => openNotificationTypeTarget(notification)}>
                            {badge}
                        </Button>
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
                            <Button type="button" variant="link" className="h-auto max-w-48 justify-start p-0 text-left font-normal" onClick={() => openUserDialog({ userId: notification.senderUserId, title: notification.senderUsername || undefined })}>
                                <span className="truncate">{notification.senderUsername || 'User'}</span>
                            </Button>
                        );
                    }
                    if (notification.link?.startsWith('user:')) {
                        const userId = notification.link.slice('user:'.length);
                        return (
                            <Button type="button" variant="link" className="h-auto max-w-48 justify-start p-0 text-left font-normal" onClick={() => openUserDialog({ userId, title: notification.linkText || notification.senderUsername || undefined })}>
                                <span className="truncate">{notification.linkText || notification.senderUsername || 'User'}</span>
                            </Button>
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
                        <Button type="button" variant="link" className="h-auto max-w-48 justify-start p-0 text-left font-normal" onClick={() => openGroupDialog({ groupId, title: label })}>
                            <span className="truncate">{label}</span>
                        </Button>
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
                    const previewLabel = getNotificationMessage(row.original) || t('table.notification.photo');
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto p-1"
                            aria-label={`Preview notification image: ${previewLabel}`}
                            onClick={() => openNotificationImagePreview(row.original)}>
                            <img
                                src={convertFileUrlToImageUrl(imageUrl, 64)}
                                alt={previewLabel}
                                width={40}
                                height={40}
                                className="size-10 rounded-md object-cover"
                            />
                        </Button>
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
                        <div className="flex min-w-0 flex-col gap-1">
                            {message ? <div className="max-w-xl truncate text-sm">{message}</div> : null}
                            {worldId ? (
                                <NotificationLocationLink
                                    location={worldId}
                                    worldName={notification.details?.worldName || notification.worldName || ''}
                                    groupName={notification.details?.groupName || notification.groupName || notification.data?.groupName || ''}
                                />
                            ) : null}
                            {notification.link ? (
                                <Button type="button" variant="link" size="sm" className="h-auto max-w-xl justify-start p-0 text-left font-normal" onClick={() => openNotificationLink(notification.link)}>
                                    <ExternalLinkIcon data-icon="inline-start" />
                                    <span className="truncate">{notification.linkText || notification.link}</span>
                                </Button>
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
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Accept friend request" title="Accept" onClick={() => void acceptFriendRequest(notification)}>
                                    <CheckIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible && notification.type === 'requestInvite' && canInviteFromCurrentLocation ? (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Send invite" title="Invite" onClick={() => void acceptRequestInvite(notification)}>
                                    <SendIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible && notification.type === 'invite' ? (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Decline with message" title="Decline with message" onClick={() => void sendInviteResponseWithMessage(notification, 'response')}>
                                    <SendIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible && notification.type === 'requestInvite' ? (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Decline with message" title="Decline with message" onClick={() => void sendInviteResponseWithMessage(notification, 'requestResponse')}>
                                    <SendIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible
                                ? responses.map((response) => {
                                    const label = getResponseLabel(response);
                                    const ResponseIcon = getResponseIcon(response, notification.type);
                                    return (
                                        <Button
                                            key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={label}
                                            title={label}
                                            onClick={() => void sendNotificationResponse(notification, response)}>
                                            <ResponseIcon data-icon="inline-start" />
                                        </Button>
                                    );
                                })
                                : null}
                            {remoteActionsVisible && canDeclineNotification(notification) ? (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Decline notification" title="Decline" onClick={(event) => void hideNotification(notification, { skipConfirm: shiftHeld || event.shiftKey })}>
                                    <XIcon data-icon="inline-start" className={cn(shiftHeld && 'text-destructive')} />
                                </Button>
                            ) : null}
                            {notification.version === 2 && !notification.seen ? (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Mark notification seen" title="Seen" onClick={() => void markSeen(notification)}>
                                    <CheckIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {localDeleteVisible ? (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label="Delete notification log" title="Delete log" onClick={(event) => void deleteNotification(notification, { skipConfirm: shiftHeld || event.shiftKey })}>
                                    {shiftHeld ? <XIcon data-icon="inline-start" className="text-destructive" /> : <Trash2Icon data-icon="inline-start" />}
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
        getPaginationRowModel: getPaginationRowModel(),
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    return (
        <>
        <div
            className={cn(
                'flex h-full min-h-0 flex-col gap-3',
                embedded ? 'p-3' : 'x-container x-container--auto-height p-4 pb-0'
            )}>
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
                    className="h-9 min-w-36 flex-1 sm:max-w-52"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh notifications"
                    className="rounded-full"
                    disabled={loadStatus === 'running'}
                    onClick={() => setReloadToken((value) => value + 1)}>
                    {loadStatus === 'running' ? <Spinner data-icon="inline-start" /> : <RefreshCcwIcon data-icon="inline-start" />}
                </Button>
                <TableColumnVisibilityMenu table={table} />
                {activeTypes.length ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setActiveTypes([])}>
                        Clear
                    </Button>
                ) : null}
            </div>

            {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}

            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                <div className="h-full overflow-auto">
                    <Table className="app-data-table table-fixed">
                        <DataTableHeader table={table} />
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
                <DataTablePagination
                    table={table}
                    pageIndex={pagination.pageIndex}
                    pageCount={table.getPageCount() || 1}
                    pageSize={pagination.pageSize}
                    pageSizes={DEFAULT_PAGE_SIZES}
                    pageSizeLabel={t('table.pagination.rows_per_page')}
                    previousLabel={t('table.pagination.previous')}
                    nextLabel={t('table.pagination.next')}
                    onPageSizeChange={(value) => setPagination({ pageIndex: 0, pageSize: resolvePageSize(value) })}
                />
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
