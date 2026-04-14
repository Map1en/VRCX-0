import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from '@/lib/dayjs.js';
import { CalendarIcon, ChevronDownIcon, DownloadIcon, ImageIcon, RefreshCwIcon, Share2Icon, StarIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { convertFileUrlToImageUrl, userImage } from '@/lib/entityMedia.js';
import { timeToText } from '@/lib/dateTime.js';
import { backend } from '@/platform/index.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Label } from '@/ui/shadcn/label.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover.jsx';
import { ScrollArea } from '@/ui/shadcn/scroll-area.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';
import { configRepository, groupProfileRepository, myAvatarRepository, toolsRepository } from '@/repositories/index.js';
import { database } from '@/services/database/index.js';
import { openGroupDialog, openUserDialog } from '@/services/dialogService.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const statusOptions = ['join me', 'active', 'ask me', 'busy'];
const inviteMessageTypes = [
    ['message', 'dialog.edit_invite_messages.invite_message_tab'],
    ['request', 'dialog.edit_invite_messages.invite_request_tab'],
    ['requestResponse', 'dialog.edit_invite_messages.invite_request_response_tab'],
    ['response', 'dialog.edit_invite_messages.invite_response_tab']
];
const instanceTypes = ['invite', 'invite+', 'friends', 'friends+', 'public', 'groupPublic', 'groupPlus', 'groupOnly'];

function getAuthSnapshot() {
    return useRuntimeStore.getState().auth || {};
}

function getCurrentUserId() {
    const auth = getAuthSnapshot();
    return auth.currentUserId || auth.currentUserSnapshot?.id || '';
}

function getEndpoint() {
    return getAuthSnapshot().currentUserEndpoint || '';
}

function getFriendIds(orderedFriendIds) {
    const directFriends = getAuthSnapshot().currentUserSnapshot?.friends;
    if (Array.isArray(directFriends) && directFriends.length) {
        return directFriends;
    }
    return Array.isArray(orderedFriendIds) ? orderedFriendIds : [];
}

function csvEscape(value) {
    const text = String(value ?? '');
    const needsEscaping = text.includes(',') ||
        text.includes('"') ||
        Array.from(text).some((char) => char.charCodeAt(0) <= 31);
    if (needsEscaping) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function updateArrayValue(values, value, checked) {
    const next = new Set(Array.isArray(values) ? values : []);
    if (checked) {
        next.add(value);
    } else {
        next.delete(value);
    }
    return Array.from(next);
}

async function getUserMemoMap() {
    const rows = await database.getAllUserMemos().catch(() => []);
    return new Map(
        (Array.isArray(rows) ? rows : [])
            .filter((row) => typeof row?.userId === 'string' && row.userId)
            .map((row) => [row.userId, row.memo || ''])
    );
}

function delay(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function normalizeAutoAcceptValue(value) {
    if (value === 'Selected Favorites' || value === 'All Favorites') {
        return value;
    }
    return 'Off';
}

function normalizeAutoAcceptMode(value) {
    return value === 'Selected Favorites' ? 'Selected Favorites' : 'All Favorites';
}

function isInviteMessageOnCooldown(row) {
    return Boolean(row?.updatedAt && dayjs(row.updatedAt).add(1, 'hour').isAfter(dayjs()));
}

function getInviteCooldownLabel(updatedAt, now = Date.now()) {
    if (!updatedAt) {
        return '-';
    }
    const remaining = dayjs(updatedAt).add(1, 'hour').diff(dayjs(now));
    return remaining >= 0 ? timeToText(remaining) : '-';
}

function normalizeExportMemo(value) {
    return String(value ?? '').replace(/[\r\n]/g, ' ');
}

function truncateExportMemo(value) {
    return normalizeExportMemo(value).slice(0, 256);
}

function getEventGroupId(event) {
    return event?.ownerId || event?.groupId || event?.group?.id || '';
}

function getEventId(event) {
    return event?.id || event?.eventId || '';
}

function selectedDateKey(value) {
    return dayjs(value || new Date()).format('YYYY-MM-DD');
}

function ToolTextarea({ value, rows = 15 }) {
    return (
        <Textarea
            readOnly
            rows={rows}
            value={value}
            className="font-mono text-xs"
            onClick={(event) => event.currentTarget.select()}
        />
    );
}

function CheckRow({ id, label, description, checked, disabled, onCheckedChange }) {
    return (
        <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => onCheckedChange(Boolean(value))}
            />
            <div className="space-y-1">
                <Label htmlFor={id}>{label}</Label>
                {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            </div>
        </div>
    );
}

function MultiCheckList({ idPrefix, values, options, disabled, onChange }) {
    return (
        <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option) => (
                <CheckRow
                    key={option.value}
                    id={`${idPrefix}-${option.value}`}
                    label={option.label}
                    checked={values.includes(option.value)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(updateArrayValue(values, option.value, checked))}
                />
            ))}
        </div>
    );
}

function StatusEditor({ label, disabled, status, descEnabled, desc, onStatusChange, onDescEnabledChange, onDescChange }) {
    const { t } = useI18n();
    return (
        <div className="space-y-3 rounded-md border p-3">
            <Label>{label}</Label>
            <Select value={status} disabled={disabled} onValueChange={onStatusChange}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {statusOptions.map((statusOption) => (
                        <SelectItem key={statusOption} value={statusOption}>
                            {t(`dialog.user.status.${statusOption.replace(' ', '_')}`)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
                <Switch checked={descEnabled} disabled={disabled} onCheckedChange={onDescEnabledChange} />
                <Label>{t('view.settings.general.automation.change_status_description')}</Label>
            </div>
            {descEnabled ? (
                <Input
                    value={desc}
                    maxLength={32}
                    disabled={disabled}
                    placeholder={t('view.settings.general.automation.status_description_placeholder')}
                    onChange={(event) => onDescChange(event.target.value)}
                />
            ) : null}
        </div>
    );
}

function AutoChangeStatusDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const favoriteFriendGroups = useFavoriteStore((state) => state.favoriteFriendGroups);
    const localFriendFavoriteGroups = useFavoriteStore((state) => state.localFriendFavoriteGroups);
    const [values, setValues] = useState({
        autoStateChangeEnabled: false,
        autoStateChangeNoFriends: false,
        autoStateChangeGroups: [],
        autoStateChangeInstanceTypes: [],
        autoStateChangeAloneStatus: 'join me',
        autoStateChangeCompanyStatus: 'busy',
        autoStateChangeAloneDescEnabled: false,
        autoStateChangeAloneDesc: '',
        autoStateChangeCompanyDescEnabled: false,
        autoStateChangeCompanyDesc: '',
        autoAcceptInviteRequests: 'Off',
        autoAcceptInviteGroups: []
    });
    const [loading, setLoading] = useState(false);

    const groupOptions = useMemo(() => {
        const remote = (favoriteFriendGroups || []).map((group) => ({
            value: group.key,
            label: group.displayName || group.name || group.key
        }));
        const local = (localFriendFavoriteGroups || []).map((group) => ({
            value: `local:${group}`,
            label: group
        }));
        return [...remote, ...local].filter((group) => group.value);
    }, [favoriteFriendGroups, localFriendFavoriteGroups]);

    const instanceOptions = useMemo(
        () =>
            instanceTypes.map((type) => {
                const mapKey = type === 'groupOnly' ? 'groupMembers' : type;
                const localeKey = accessTypeLocaleKeyMap[mapKey];
                const groupKey = accessTypeLocaleKeyMap.group;
                return {
                    value: type,
                    label:
                        mapKey === 'groupPublic' || mapKey === 'groupPlus' || mapKey === 'groupMembers'
                            ? `${t(groupKey)} ${t(localeKey)}`
                            : localeKey
                                ? t(localeKey)
                                : type
                };
            }),
        [t]
    );

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        Promise.all([
            configRepository.getBool('autoStateChangeEnabled', false),
            configRepository.getBool('autoStateChangeNoFriends', false),
            configRepository.getString('autoStateChangeGroups', '[]'),
            configRepository.getString('autoStateChangeInstanceTypes', '[]'),
            configRepository.getString('autoStateChangeAloneStatus', 'join me'),
            configRepository.getString('autoStateChangeCompanyStatus', 'busy'),
            configRepository.getBool('autoStateChangeAloneDescEnabled', false),
            configRepository.getString('autoStateChangeAloneDesc', ''),
            configRepository.getBool('autoStateChangeCompanyDescEnabled', false),
            configRepository.getString('autoStateChangeCompanyDesc', ''),
            configRepository.getString('autoAcceptInviteRequests', 'Off'),
            configRepository.getString('autoAcceptInviteGroups', '[]')
        ])
            .then((result) => {
                if (!active) {
                    return;
                }
                setValues({
                    autoStateChangeEnabled: result[0],
                    autoStateChangeNoFriends: result[1],
                    autoStateChangeGroups: parseJsonArray(result[2]),
                    autoStateChangeInstanceTypes: parseJsonArray(result[3]),
                    autoStateChangeAloneStatus: result[4] || 'join me',
                    autoStateChangeCompanyStatus: result[5] || 'busy',
                    autoStateChangeAloneDescEnabled: result[6],
                    autoStateChangeAloneDesc: result[7] || '',
                    autoStateChangeCompanyDescEnabled: result[8],
                    autoStateChangeCompanyDesc: result[9] || '',
                    autoAcceptInviteRequests: normalizeAutoAcceptValue(result[10]),
                    autoAcceptInviteGroups: parseJsonArray(result[11])
                });
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [open]);

    function setLocalValue(key, value) {
        setValues((current) => ({ ...current, [key]: value }));
    }

    async function saveValue(key, value, type = 'string') {
        setLocalValue(key, value);
        try {
            if (type === 'bool') {
                await configRepository.setBool(key, value);
            } else if (type === 'array') {
                await configRepository.setString(key, JSON.stringify(value));
            } else {
                await configRepository.setString(key, value);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }

    const autoAcceptEnabled = values.autoAcceptInviteRequests !== 'Off';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t('view.settings.general.automation.auto_change_status')}</DialogTitle>
                    <DialogDescription>{t('view.settings.general.automation.auto_state_change_tooltip')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                    <CheckRow
                        id="autoStateChangeEnabled"
                        label={t('view.settings.general.automation.auto_change_status_switch')}
                        description={t('view.settings.general.automation.auto_state_change_switch_tooltip')}
                        checked={values.autoStateChangeEnabled}
                        disabled={loading}
                        onCheckedChange={(checked) => void saveValue('autoStateChangeEnabled', checked, 'bool')}
                    />
                    <div className="space-y-2">
                        <Label>{t('view.settings.general.automation.alone_condition')}</Label>
                        <Select
                            value={values.autoStateChangeNoFriends ? 'noFriends' : 'alone'}
                            disabled={loading || !values.autoStateChangeEnabled}
                            onValueChange={(value) => void saveValue('autoStateChangeNoFriends', value === 'noFriends', 'bool')}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="alone">{t('view.settings.general.automation.alone')}</SelectItem>
                                <SelectItem value="noFriends">{t('view.settings.general.automation.no_friends')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>{t('view.settings.general.automation.auto_change_status_groups')}</Label>
                        <MultiCheckList
                            idPrefix="autoStateChangeGroups"
                            values={values.autoStateChangeGroups}
                            options={groupOptions}
                            disabled={loading || !values.autoStateChangeEnabled || !values.autoStateChangeNoFriends}
                            onChange={(next) => void saveValue('autoStateChangeGroups', next, 'array')}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('view.settings.general.automation.allowed_instance_types')}</Label>
                        <MultiCheckList
                            idPrefix="autoStateChangeInstanceTypes"
                            values={values.autoStateChangeInstanceTypes}
                            options={instanceOptions}
                            disabled={loading || !values.autoStateChangeEnabled}
                            onChange={(next) => void saveValue('autoStateChangeInstanceTypes', next, 'array')}
                        />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <StatusEditor
                            label={t('view.settings.general.automation.alone_status')}
                            disabled={loading || !values.autoStateChangeEnabled}
                            status={values.autoStateChangeAloneStatus}
                            descEnabled={values.autoStateChangeAloneDescEnabled}
                            desc={values.autoStateChangeAloneDesc}
                            onStatusChange={(value) => void saveValue('autoStateChangeAloneStatus', value)}
                            onDescEnabledChange={(value) => void saveValue('autoStateChangeAloneDescEnabled', value, 'bool')}
                            onDescChange={(value) => void saveValue('autoStateChangeAloneDesc', value)}
                        />
                        <StatusEditor
                            label={t('view.settings.general.automation.company_status')}
                            disabled={loading || !values.autoStateChangeEnabled}
                            status={values.autoStateChangeCompanyStatus}
                            descEnabled={values.autoStateChangeCompanyDescEnabled}
                            desc={values.autoStateChangeCompanyDesc}
                            onStatusChange={(value) => void saveValue('autoStateChangeCompanyStatus', value)}
                            onDescEnabledChange={(value) => void saveValue('autoStateChangeCompanyDescEnabled', value, 'bool')}
                            onDescChange={(value) => void saveValue('autoStateChangeCompanyDesc', value)}
                        />
                    </div>
                    <Separator />
                    <CheckRow
                        id="autoAcceptInviteRequests"
                        label={t('view.settings.general.automation.auto_invite_request_accept')}
                        description={t('view.settings.general.automation.auto_invite_request_accept_tooltip')}
                        checked={autoAcceptEnabled}
                        disabled={loading}
                        onCheckedChange={(checked) =>
                            void saveValue(
                                'autoAcceptInviteRequests',
                                checked ? normalizeAutoAcceptMode(values.autoAcceptInviteRequests) : 'Off'
                            )
                        }
                    />
                    <div className="space-y-2">
                        <Label>{t('view.settings.general.automation.auto_invite_request_accept')}</Label>
                        <Select
                            value={normalizeAutoAcceptMode(values.autoAcceptInviteRequests)}
                            disabled={loading || !autoAcceptEnabled}
                            onValueChange={(value) => void saveValue('autoAcceptInviteRequests', value)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All Favorites">{t('view.settings.general.automation.auto_invite_request_accept_favs')}</SelectItem>
                                <SelectItem value="Selected Favorites">{t('view.settings.general.automation.auto_invite_request_accept_selected_favs')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>{t('view.settings.general.automation.auto_accept_invite_groups')}</Label>
                        <MultiCheckList
                            idPrefix="autoAcceptInviteGroups"
                            values={values.autoAcceptInviteGroups}
                            options={groupOptions}
                            disabled={loading || values.autoAcceptInviteRequests !== 'Selected Favorites'}
                            onChange={(next) => void saveValue('autoAcceptInviteGroups', next, 'array')}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ExportDiscordNamesDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore((state) => state.orderedFriendIds);
    const [content, setContent] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        const lines = ['DisplayName,DiscordName'];
        const discordRegex = /(?:discord|dc|dis)(?: |=|:|˸|;)(.*)/i;
        for (const userId of getFriendIds(orderedFriendIds)) {
            const friend = friendsById[userId];
            const match = discordRegex.exec(friend?.statusDescription || '') || discordRegex.exec(friend?.bio || '');
            if (match?.[1]) {
                lines.push(`${csvEscape(friend?.displayName || userId)},${csvEscape(match[1].trim())}`);
            }
        }
        setContent(lines.join('\n'));
    }, [friendsById, open, orderedFriendIds]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialog.discord_names.header')}</DialogTitle>
                    <DialogDescription>{t('dialog.discord_names.description')}</DialogDescription>
                </DialogHeader>
                <ToolTextarea value={content} />
            </DialogContent>
        </Dialog>
    );
}

function ExportFriendsListDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore((state) => state.orderedFriendIds);
    const [csv, setCsv] = useState('');
    const [json, setJson] = useState('');
    const [tab, setTab] = useState('csv');

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        getUserMemoMap()
            .then((memosById) => {
                if (!active) {
                    return;
                }
                const lines = ['UserID,DisplayName,Memo'];
                const friendsList = [];
                for (const userId of getFriendIds(orderedFriendIds)) {
                    const friend = friendsById[userId];
                    const memo = String(memosById.get(userId) || friend?.memo || '').replace(/\n/g, ' ');
                    lines.push(`${csvEscape(userId)},${csvEscape(friend?.displayName || friend?.name || '')},${csvEscape(memo)}`);
                    friendsList.push(userId);
                }
                setCsv(lines.join('\n'));
                setJson(JSON.stringify({ friends: friendsList }, null, 4));
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
        return () => {
            active = false;
        };
    }, [friendsById, open, orderedFriendIds]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialog.export_friends_list.header')}</DialogTitle>
                </DialogHeader>
                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList>
                        <TabsTrigger value="csv">{t('dialog.export_friends_list.csv')}</TabsTrigger>
                        <TabsTrigger value="json">{t('dialog.export_friends_list.json')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="csv">
                        <ToolTextarea value={csv} />
                    </TabsContent>
                    <TabsContent value="json">
                        <ToolTextarea value={json} />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function ExportAvatarsListDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        myAvatarRepository
            .getMyAvatars({ endpoint: getEndpoint() })
            .then((avatars) => {
                if (!active) {
                    return;
                }
                const lines = ['AvatarID,AvatarName'];
                for (const avatar of Array.isArray(avatars) ? avatars : []) {
                    lines.push(`${csvEscape(avatar.id)},${csvEscape(avatar.name)}`);
                }
                setContent(lines.join('\n'));
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialog.export_own_avatars.header')}</DialogTitle>
                    {loading ? <DialogDescription>Loading avatars.</DialogDescription> : null}
                </DialogHeader>
                <ToolTextarea value={content} />
            </DialogContent>
        </Dialog>
    );
}

function NoteExportDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore((state) => state.orderedFriendIds);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const cancelRef = useRef(false);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [errors, setErrors] = useState('');

    async function refreshRows() {
        setLoading(true);
        setErrors('');
        try {
            const memosById = await getUserMemoMap();
            const nextRows = [];
            for (const userId of getFriendIds(orderedFriendIds)) {
                const friend = friendsById[userId];
                const memo = normalizeExportMemo(memosById.get(userId) || friend?.memo || '');
                const vrchatNote = friend?.ref?.note ?? friend?.note ?? '';
                if (memo && friend && vrchatNote !== truncateExportMemo(memo)) {
                    nextRows.push({
                        id: userId,
                        name: friend.displayName || friend.name || userId,
                        memo,
                        ref: friend.ref || friend
                    });
                }
            }
            setRows(nextRows);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (open) {
            cancelRef.current = false;
            setRows([]);
            setProgress({ done: 0, total: 0 });
            setErrors('');
            void refreshRows();
        } else {
            cancelRef.current = true;
        }
    }, [open]);

    async function exportNotes() {
        const snapshot = [...rows].reverse();
        cancelRef.current = false;
        setLoading(true);
        setProgress({ done: 0, total: snapshot.length });
        setErrors('');
        try {
            for (let index = 0; index < snapshot.length; index += 1) {
                if (cancelRef.current) {
                    break;
                }
                const row = snapshot[index];
                try {
                    await toolsRepository.saveUserNote(
                        {
                            targetUserId: row.id,
                            note: truncateExportMemo(row.memo)
                        },
                        { endpoint: getEndpoint() }
                    );
                    setRows((current) => current.filter((item) => item.id !== row.id));
                    setProgress({ done: index + 1, total: snapshot.length });
                    if (index < snapshot.length - 1) {
                        await delay(5000);
                    }
                } catch (error) {
                    setErrors((current) => `${current}Name: ${row.name}\n${error instanceof Error ? error.message : String(error)}\n\n`);
                    break;
                }
            }
        } finally {
            setLoading(false);
            setProgress({ done: 0, total: 0 });
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.note_export.header')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-1 text-xs text-muted-foreground">
                    {Array.from({ length: 8 }, (_, index) => (
                        <div key={`note-export-description-${index + 1}`}>
                            {t(`dialog.note_export.description${index + 1}`)}
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" disabled={loading} onClick={() => void refreshRows()}>
                        {t('dialog.note_export.refresh')}
                    </Button>
                    <Button type="button" variant="outline" disabled={loading || rows.length === 0} onClick={() => void exportNotes()}>
                        {t('dialog.note_export.export')}
                    </Button>
                    {loading ? (
                        <Button type="button" variant="outline" onClick={() => { cancelRef.current = true; }}>
                            {t('dialog.note_export.cancel')}
                        </Button>
                    ) : null}
                    {loading ? (
                        <span className="text-sm text-muted-foreground">
                            {t('dialog.note_export.progress')} {progress.done}/{progress.total}
                        </span>
                    ) : null}
                </div>
                {errors ? (
                    <div className="space-y-2 rounded-md border p-3">
                        <Button type="button" size="sm" variant="outline" onClick={() => setErrors('')}>
                            {t('dialog.note_export.clear_errors')}
                        </Button>
                        <pre className="whitespace-pre-wrap text-xs">{errors}</pre>
                    </div>
                ) : null}
                <div className="overflow-hidden rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[70px]">{t('table.import.image')}</TableHead>
                                <TableHead>{t('table.import.name')}</TableHead>
                                <TableHead>{t('table.import.note')}</TableHead>
                                <TableHead className="w-20 text-right">{t('table.import.skip_export')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length ? rows.map((row) => (
                                <TableRow key={row.id}>
                                    <TableCell>
                                        {userImage(row.ref, true, '64') ? (
                                            <button
                                                type="button"
                                                className="block size-10 overflow-hidden rounded-full border bg-muted"
                                                onClick={() => {
                                                    const fullImageUrl = userImage(row.ref, false, '512');
                                                    if (fullImageUrl) {
                                                        openImagePreview({ url: fullImageUrl, title: row.name });
                                                    }
                                                }}>
                                                <img src={userImage(row.ref, true, '64')} alt="" className="size-full object-cover" loading="lazy" />
                                            </button>
                                        ) : (
                                            <span className="block size-10 rounded-full border bg-muted" />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Button type="button" variant="link" className="px-0" onClick={() => openUserDialog({ userId: row.id, title: row.name })}>
                                            {row.name}
                                        </Button>
                                    </TableCell>
                                    <TableCell>
                                        <Textarea
                                            value={row.memo}
                                            maxLength={256}
                                            rows={2}
                                            disabled={loading}
                                            onChange={(event) =>
                                                setRows((current) =>
                                                    current.map((item) =>
                                                        item.id === row.id ? { ...item, memo: normalizeExportMemo(event.target.value) } : item
                                                    )
                                                )
                                            }
                                        />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            disabled={loading}
                                            onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>
                                            <Trash2Icon className="size-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                        {loading ? 'Loading.' : 'No memo differences found.'}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function GroupCalendarDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const [selectedDate, setSelectedDate] = useState(() => selectedDateKey(new Date()));
    const [showFeaturedEvents, setShowFeaturedEvents] = useState(false);
    const [viewMode, setViewMode] = useState('timeline');
    const [search, setSearch] = useState('');
    const [events, setEvents] = useState([]);
    const [followingIds, setFollowingIds] = useState([]);
    const [groupNames, setGroupNames] = useState({});
    const [groupProfiles, setGroupProfiles] = useState({});
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const [loading, setLoading] = useState(false);

    const selectedDayEvents = useMemo(
        () =>
            events
                .filter((event) => selectedDateKey(event.startsAt) === selectedDate)
                .sort((left, right) => dayjs(left.startsAt).diff(dayjs(right.startsAt))),
        [events, selectedDate]
    );
    const eventsByGroup = useMemo(() => {
        const query = search.trim().toLowerCase();
        const groups = new Map();
        for (const event of events) {
            const groupId = getEventGroupId(event);
            if (!groupId) {
                continue;
            }
            const groupName = groupNames[groupId] || groupId;
            if (
                query &&
                !groupName.toLowerCase().includes(query) &&
                !String(event.title || '').toLowerCase().includes(query) &&
                !String(event.description || '').toLowerCase().includes(query)
            ) {
                continue;
            }
            if (!groups.has(groupId)) {
                groups.set(groupId, []);
            }
            groups.get(groupId).push(event);
        }
        return Array.from(groups.entries())
            .map(([groupId, groupEvents]) => ({
                groupId,
                groupName: groupNames[groupId] || groupId,
                events: groupEvents.sort((left, right) => dayjs(left.startsAt).diff(dayjs(right.startsAt)))
            }))
            .sort((left, right) => left.groupName.localeCompare(right.groupName));
    }, [events, groupNames, search]);

    async function resolveGroupNames(rows) {
        const ids = Array.from(new Set(rows.map(getEventGroupId).filter(Boolean)));
        const nextNames = {};
        const nextProfiles = {};
        await Promise.all(
            ids.map(async (groupId) => {
                if (groupNames[groupId]) {
                    nextNames[groupId] = groupNames[groupId];
                    if (groupProfiles[groupId]) {
                        nextProfiles[groupId] = groupProfiles[groupId];
                    }
                    return;
                }
                try {
                    const group = await groupProfileRepository.getGroupProfile({
                        groupId,
                        endpoint: getEndpoint(),
                        includeRoles: false
                    });
                    nextNames[groupId] = group.name || groupId;
                    nextProfiles[groupId] = group;
                } catch {
                    nextNames[groupId] = groupId;
                }
            })
        );
        setGroupNames((current) => ({ ...current, ...nextNames }));
        if (Object.keys(nextProfiles).length) {
            setGroupProfiles((current) => ({ ...current, ...nextProfiles }));
        }
    }

    async function loadCalendar({ force = false } = {}) {
        setLoading(true);
        try {
            const params = {
                n: 100,
                offset: 0,
                date: dayjs(selectedDate).format('YYYY-MM-DDTHH:mm:ss[Z]')
            };
            const [calendarRows, followingRows, featuredRows] = await Promise.all([
                toolsRepository.getAllGroupCalendars(params, { endpoint: getEndpoint(), force }),
                toolsRepository.getAllFollowingGroupCalendars(params, { endpoint: getEndpoint(), force }),
                showFeaturedEvents
                    ? toolsRepository.getAllFeaturedGroupCalendars(params, { endpoint: getEndpoint(), force })
                    : Promise.resolve([])
            ]);
            const normalizedRows = [...calendarRows, ...featuredRows].map((event) => ({
                ...event,
                title: replaceBioSymbols(event.title || ''),
                description: replaceBioSymbols(event.description || '')
            }));
            setEvents(normalizedRows);
            setFollowingIds(followingRows.map(getEventId).filter(Boolean));
            await resolveGroupNames([...normalizedRows, ...followingRows]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!open) {
            return;
        }
        configRepository
            .getBool('groupCalendarShowFeaturedEvents', false)
            .then(setShowFeaturedEvents)
            .catch(() => {});
    }, [open]);

    useEffect(() => {
        if (open) {
            void loadCalendar();
        }
    }, [open, selectedDate, showFeaturedEvents]);

    async function toggleFeatured(nextValue) {
        setShowFeaturedEvents(nextValue);
        await configRepository.setBool('groupCalendarShowFeaturedEvents', nextValue).catch(() => {});
    }

    async function toggleFollow(event) {
        const groupId = getEventGroupId(event);
        const eventId = getEventId(event);
        if (!groupId || !eventId) {
            return;
        }
        const nextFollowing = !followingIds.includes(eventId);
        try {
            await toolsRepository.followGroupEvent(
                { groupId, eventId, isFollowing: nextFollowing },
                { endpoint: getEndpoint() }
            );
            setFollowingIds((current) => updateArrayValue(current, eventId, nextFollowing));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.group_calendar.header')}</DialogTitle>
                    <DialogDescription>{loading ? 'Loading group events.' : 'Group calendar events for the selected date and month.'}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-3">
                    <Input
                        type="date"
                        value={selectedDate}
                        className="w-auto"
                        onChange={(event) => setSelectedDate(event.target.value || selectedDateKey(new Date()))}
                    />
                    <div className="flex items-center gap-2">
                        <Switch checked={showFeaturedEvents} onCheckedChange={(checked) => void toggleFeatured(checked)} />
                        <Label>{t('dialog.group_calendar.featured_events')}</Label>
                    </div>
                    <Button type="button" variant="outline" disabled={loading} onClick={() => void loadCalendar({ force: true })}>
                        <RefreshCwIcon className="size-4" />
                        {t('common.actions.refresh')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setViewMode((current) => (current === 'timeline' ? 'grid' : 'timeline'))}>
                        {viewMode === 'timeline' ? t('dialog.group_calendar.list_view') : t('dialog.group_calendar.calendar_view')}
                    </Button>
                </div>
                {viewMode === 'timeline' ? (
                    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
                        <ScrollArea className="h-[52vh] rounded-md border p-4">
                            {selectedDayEvents.length ? selectedDayEvents.map((event) => (
                                <GroupEventCard
                                    key={getEventId(event)}
                                    event={event}
                                    mode="timeline"
                                    groupName={groupNames[getEventGroupId(event)] || getEventGroupId(event)}
                                    groupProfile={groupProfiles[getEventGroupId(event)]}
                                    isFollowing={followingIds.includes(getEventId(event))}
                                    onToggleFollow={() => void toggleFollow(event)}
                                />
                            )) : (
                                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                    {t('dialog.group_calendar.no_events')}
                                </div>
                            )}
                        </ScrollArea>
                        <div className="rounded-md border p-4">
                            <div className="text-sm font-medium">{dayjs(selectedDate).format('MMMM YYYY')}</div>
                            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
                                {Array.from({ length: dayjs(selectedDate).daysInMonth() }, (_, index) => {
                                    const dateKey = dayjs(selectedDate).date(index + 1).format('YYYY-MM-DD');
                                    const dayEvents = events.filter((event) => selectedDateKey(event.startsAt) === dateKey);
                                    const count = dayEvents.length;
                                    const hasFollowing = dayEvents.some((event) => followingIds.includes(getEventId(event)));
                                    return (
                                        <Button
                                            key={dateKey}
                                            type="button"
                                            variant={dateKey === selectedDate ? 'default' : 'outline'}
                                            size="sm"
                                            className={`relative h-12 flex-col gap-0 ${hasFollowing ? 'ring-1 ring-primary' : ''}`}
                                            onClick={() => setSelectedDate(dateKey)}>
                                            <span>{index + 1}</span>
                                            {count ? <span className="text-[10px]">{count}</span> : null}
                                            {hasFollowing ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" /> : null}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <Input
                            value={search}
                            placeholder={t('dialog.group_calendar.search_placeholder')}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                        <ScrollArea className="h-[55vh] rounded-md border p-4">
                            {eventsByGroup.length ? eventsByGroup.map((group) => (
                                <div key={group.groupId} className="mb-4 space-y-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="justify-start px-0"
                                        onClick={() =>
                                            setCollapsedGroups((current) => ({
                                                ...current,
                                                [group.groupId]: !current[group.groupId]
                                            }))
                                        }>
                                        <ChevronDownIcon className={`size-4 transition-transform ${collapsedGroups[group.groupId] ? '-rotate-90' : ''}`} />
                                        {group.groupName}
                                    </Button>
                                    {!collapsedGroups[group.groupId] ? (
                                        <div className="grid gap-3 md:grid-cols-2">
                                            {group.events.map((event) => (
                                                <GroupEventCard
                                                    key={getEventId(event)}
                                                    event={event}
                                                    mode="grid"
                                                    groupName={group.groupName}
                                                    groupProfile={groupProfiles[getEventGroupId(event)]}
                                                    isFollowing={followingIds.includes(getEventId(event))}
                                                    onToggleFollow={() => void toggleFollow(event)}
                                                />
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            )) : (
                                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                    {search ? t('dialog.group_calendar.search_no_matching') : t('dialog.group_calendar.search_no_this_month')}
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

async function getCalendarIcs(event) {
    const groupId = getEventGroupId(event);
    const eventId = getEventId(event);
    if (!groupId || !eventId) {
        return '';
    }
    try {
        return await toolsRepository.getGroupCalendarIcs(
            { groupId, eventId },
            { endpoint: getEndpoint() }
        );
    } catch (error) {
        toast.error(`Failed to download .ics file, ${error instanceof Error ? error.message : String(error)}`);
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
    const blob = new Blob([content], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${eventId || 'group-event'}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function copyEventLink(event, t) {
    const groupId = getEventGroupId(event);
    const eventId = getEventId(event);
    if (!groupId || !eventId) {
        return;
    }
    try {
        await navigator.clipboard.writeText(`https://vrchat.com/home/group/${groupId}/calendar/${eventId}`);
        toast.success(t('dialog.group_calendar.event_card.copied_event_link'));
    } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
    }
}

function getEventBannerUrl(event, groupProfile) {
    return convertFileUrlToImageUrl(
        event?.imageUrl || event?.thumbnailImageUrl || groupProfile?.bannerUrl || groupProfile?.iconUrl || '',
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
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
}

function GroupEventCard({ event, mode = 'timeline', groupName, groupProfile, isFollowing, onToggleFollow }) {
    const { t } = useI18n();
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const groupId = getEventGroupId(event);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [bannerError, setBannerError] = useState(false);
    const closeTimerRef = useRef(null);
    const bannerUrl = bannerError ? '' : getEventBannerUrl(event, groupProfile);
    const title = event.title || 'Untitled event';
    const showGroupName = mode === 'timeline';
    const closeAfterMinutes = event.closeInstanceAfterEndMinutes ?? event.closeAfterEndMinutes ?? '';

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
        closeTimerRef.current = window.setTimeout(() => setPopoverOpen(false), 100);
    }

    useEffect(() => () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
        }
    }, []);

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
                    className="mb-3 overflow-hidden rounded-md border bg-card"
                    onMouseEnter={openPopover}
                    onMouseLeave={scheduleClosePopover}>
                    {bannerUrl ? (
                        <button
                            type="button"
                            className="block h-28 w-full overflow-hidden bg-muted text-left"
                            onClick={stopAndRun(() => openImagePreview({ url: convertFileUrlToImageUrl(event.imageUrl || bannerUrl, 1024), title }))}>
                            <img
                                src={bannerUrl}
                                alt=""
                                loading="lazy"
                                className="size-full object-cover"
                                onError={() => setBannerError(true)}
                            />
                        </button>
                    ) : (
                        <div className="flex h-28 items-center justify-center bg-muted text-muted-foreground">
                            <ImageIcon className="size-6" />
                        </div>
                    )}
                    <div className="p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                                {showGroupName ? (
                                    <button
                                        type="button"
                                        className="block truncate text-left text-xs text-muted-foreground hover:underline"
                                        onClick={stopAndRun(() => openGroupDialog({ groupId }))}>
                                        {groupName || groupId}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="block min-w-0 text-left text-sm font-medium hover:underline"
                                    onClick={stopAndRun(() => openGroupDialog({ groupId }))}>
                                    {title}
                                </button>
                                <div className="text-xs text-muted-foreground">
                                    {formatEventTimeRange(event, mode)} · {capitalizeFirst(event.accessType)}
                                </div>
                                {event.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{event.description}</p> : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <Button type="button" size="icon-sm" variant="outline" onClick={stopAndRun(() => void copyEventLink(event, t))}>
                                    <Share2Icon className="size-4" />
                                </Button>
                                <Button type="button" size="icon-sm" variant={isFollowing ? 'default' : 'outline'} onClick={stopAndRun(onToggleFollow)}>
                                    <StarIcon className="size-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={stopAndRun(() => void openCalendarEvent(event))}>
                                <CalendarIcon className="size-4" />
                                {t('dialog.group_calendar.event_card.export_to_calendar')}
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={stopAndRun(() => void downloadEventIcs(event))}>
                                <DownloadIcon className="size-4" />
                                {t('dialog.group_calendar.event_card.download_ics')}
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
                onMouseLeave={scheduleClosePopover}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                    <div className="min-w-0 text-[13px] font-semibold">{title}</div>
                    <div className="shrink-0 whitespace-nowrap">{formatEventTimeRange(event)}</div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Button variant="outline" size="sm" onClick={() => void openCalendarEvent(event)}>
                        <CalendarIcon className="size-4" />
                        {t('dialog.group_calendar.event_card.export_to_calendar')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void downloadEventIcs(event)}>
                        <DownloadIcon className="size-4" />
                        {t('dialog.group_calendar.event_card.download_ics')}
                    </Button>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>{t('dialog.group_calendar.event_card.category')}</div>
                        <div className="font-medium">{capitalizeFirst(event.category)}</div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>{t('dialog.group_calendar.event_card.interested_user')}</div>
                        <div className="font-medium">{event.interestedUserCount ?? 0}</div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>{t('dialog.group_calendar.event_card.close_time')}</div>
                        <div className="font-medium">{closeAfterMinutes !== '' ? `${closeAfterMinutes} min` : '—'}</div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div>{t('dialog.group_calendar.event_card.created')}</div>
                        <div className="font-medium">{event.createdAt ? dayjs(event.createdAt).format('YYYY-MM-DD HH:mm') : '—'}</div>
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-col gap-1">
                        <div>{t('dialog.group_calendar.event_card.description')}</div>
                        <div className="whitespace-pre-wrap break-words font-normal leading-snug">
                            {event.description || '—'}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function EditInviteMessagesDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState('message');
    const [rowsByType, setRowsByType] = useState({});
    const [editingRow, setEditingRow] = useState(null);
    const [loading, setLoading] = useState(false);

    async function loadRows(types = inviteMessageTypes.map(([type]) => type)) {
        const currentUserId = getCurrentUserId();
        if (!currentUserId) {
            return;
        }
        setLoading(true);
        try {
            const entries = await Promise.all(
                types.map(async (type) => [
                    type,
                    await toolsRepository.getInviteMessages(
                        { currentUserId, messageType: type },
                        { endpoint: getEndpoint() }
                    )
                ])
            );
            setRowsByType((current) => ({
                ...current,
                ...Object.fromEntries(entries.map(([type, rows]) => [type, Array.isArray(rows) ? rows : []]))
            }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (open) {
            void loadRows();
        } else {
            setEditingRow(null);
        }
    }, [open]);

    function beginEdit(row, messageType) {
        if (isInviteMessageOnCooldown(row)) {
            toast.warning('This invite message is on cooldown and cannot be edited yet.');
            return;
        }
        setEditingRow({ ...row, messageType });
    }

    async function saveEdit(message) {
        const currentUserId = getCurrentUserId();
        if (!editingRow || !currentUserId) {
            return;
        }
        if (message === editingRow.message) {
            setEditingRow(null);
            return;
        }
        try {
            const json = await toolsRepository.editInviteMessage(
                {
                    currentUserId,
                    messageType: editingRow.messageType,
                    slot: editingRow.slot,
                    message
                },
                { endpoint: getEndpoint() }
            );
            if (json?.[editingRow.slot]?.message === editingRow.message) {
                toast.error(t('message.invite.message_update_failed'));
                return;
            }
            toast.success(t('message.invite.message_updated'));
            const messageType = editingRow.messageType;
            setEditingRow(null);
            await loadRows([messageType]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>{t('dialog.edit_invite_messages.header')}</DialogTitle>
                        <DialogDescription>{loading ? 'Loading invite messages.' : 'Click a row to edit an invite message.'}</DialogDescription>
                    </DialogHeader>
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="flex-wrap">
                            {inviteMessageTypes.map(([type, labelKey]) => (
                                <TabsTrigger key={type} value={type}>
                                    {t(labelKey)}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        {inviteMessageTypes.map(([type]) => (
                            <TabsContent key={type} value={type}>
                                <InviteMessageTable
                                    rows={rowsByType[type] || []}
                                    loading={loading}
                                    onEdit={(row) => beginEdit(row, type)}
                                />
                            </TabsContent>
                        ))}
                    </Tabs>
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={loading} onClick={() => void loadRows()}>
                            {t('common.actions.refresh')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <EditInviteMessageDialog
                row={editingRow}
                open={Boolean(editingRow)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setEditingRow(null);
                    }
                }}
                onSave={saveEdit}
            />
        </>
    );
}

function InviteCooldownText({ updatedAt }) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const intervalId = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(intervalId);
    }, []);

    return getInviteCooldownLabel(updatedAt, now);
}

function InviteMessageTable({ rows, loading, onEdit }) {
    const { t } = useI18n();
    return (
        <div className="overflow-hidden rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-20">{t('table.profile.invite_messages.slot')}</TableHead>
                        <TableHead>{t('table.profile.invite_messages.message')}</TableHead>
                        <TableHead className="w-32 text-right">{t('table.profile.invite_messages.cool_down')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length ? rows.map((row) => (
                        <TableRow key={row.slot} className="cursor-pointer" onClick={() => onEdit(row)}>
                            <TableCell>{row.slot}</TableCell>
                            <TableCell>{row.message}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                                <InviteCooldownText updatedAt={row.updatedAt} />
                            </TableCell>
                        </TableRow>
                    )) : (
                        <TableRow>
                            <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                                {loading ? 'Loading.' : 'No invite messages.'}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );
}

function EditInviteMessageDialog({ row, open, onOpenChange, onSave }) {
    const { t } = useI18n();
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (row) {
            setMessage(row.message || '');
        }
    }, [row]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.edit_invite_message.header')}</DialogTitle>
                    <DialogDescription>{t('dialog.edit_invite_message.description')}</DialogDescription>
                </DialogHeader>
                <Textarea
                    value={message}
                    rows={2}
                    maxLength={64}
                    onChange={(event) => setMessage(event.target.value)}
                />
                <div className="text-right text-xs text-muted-foreground">{message.length}/64</div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('dialog.edit_invite_message.cancel')}
                    </Button>
                    <Button type="button" onClick={() => void onSave(message)}>
                        {t('dialog.edit_invite_message.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function ToolsDialogsHost() {
    const systemHosts = useRuntimeStore((state) => state.systemHosts);
    const setSystemHostOpen = useRuntimeStore((state) => state.setSystemHostOpen);

    return (
        <>
            <AutoChangeStatusDialog
                open={Boolean(systemHosts.autoChangeStatusOpen)}
                onOpenChange={(open) => setSystemHostOpen('autoChangeStatusOpen', open)}
            />
            <GroupCalendarDialog
                open={Boolean(systemHosts.groupCalendarOpen)}
                onOpenChange={(open) => setSystemHostOpen('groupCalendarOpen', open)}
            />
            <ExportDiscordNamesDialog
                open={Boolean(systemHosts.exportDiscordNamesOpen)}
                onOpenChange={(open) => setSystemHostOpen('exportDiscordNamesOpen', open)}
            />
            <NoteExportDialog
                open={Boolean(systemHosts.noteExportOpen)}
                onOpenChange={(open) => setSystemHostOpen('noteExportOpen', open)}
            />
            <ExportFriendsListDialog
                open={Boolean(systemHosts.exportFriendsListOpen)}
                onOpenChange={(open) => setSystemHostOpen('exportFriendsListOpen', open)}
            />
            <ExportAvatarsListDialog
                open={Boolean(systemHosts.exportAvatarsListOpen)}
                onOpenChange={(open) => setSystemHostOpen('exportAvatarsListOpen', open)}
            />
            <EditInviteMessagesDialog
                open={Boolean(systemHosts.editInviteMessagesOpen)}
                onOpenChange={(open) => setSystemHostOpen('editInviteMessagesOpen', open)}
            />
        </>
    );
}
