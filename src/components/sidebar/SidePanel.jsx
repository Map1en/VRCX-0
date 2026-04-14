import { useEffect, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, BellIcon, ChevronDownIcon, RefreshCwIcon, SearchIcon, SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu.jsx';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';
import { configRepository } from '@/repositories/index.js';
import { bootstrapFavorites } from '@/services/favoriteBootstrapService.js';
import { bootstrapFriendRoster } from '@/services/friendBootstrapService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';

import { FriendsSidebar } from './FriendsSidebar.jsx';
import { GroupsSidebar } from './GroupsSidebar.jsx';
import { QuickSearchDialog } from './QuickSearchDialog.jsx';

const sortOptions = [
    ['Sort Alphabetically', 'view.settings.appearance.side_panel.sorting.alphabetical'],
    ['Sort by Status', 'view.settings.appearance.side_panel.sorting.status'],
    ['Sort Private to Bottom', 'view.settings.appearance.side_panel.sorting.private_to_bottom'],
    ['Sort by Last Active', 'view.settings.appearance.side_panel.sorting.last_active'],
    ['Sort by Last Seen', 'view.settings.appearance.side_panel.sorting.last_seen'],
    ['Sort by Time in Instance', 'view.settings.appearance.side_panel.sorting.time_in_instance'],
    ['Sort by Location', 'view.settings.appearance.side_panel.sorting.location']
];

const defaultPrefs = {
    sidebarGroupByInstance: true,
    isHideFriendsInSameInstance: false,
    isSameInstanceAboveFavorites: false,
    isSidebarDivideByFriendGroup: false,
    sidebarSortMethod1: 'Sort by Status',
    sidebarSortMethod2: 'Sort Alphabetically',
    sidebarSortMethod3: '',
    sidebarFavoriteGroups: [],
    sidebarFavoriteGroupOrder: []
};

function parseConfigArray(value) {
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

function normalizeFavoriteGroupsChange(value, allKeys) {
    if (!Array.isArray(value) || !value.length) {
        return [];
    }
    if (value.length >= allKeys.length && allKeys.every((key) => value.includes(key))) {
        return [];
    }
    return value;
}

function moveArrayItem(values, index, delta) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= values.length) {
        return values;
    }
    const next = [...values];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    return next;
}

function SettingRow({ label, children }) {
    return (
        <label className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 flex-1">{label}</span>
            {children}
        </label>
    );
}

function SortSelect({ value, disabled, onChange, placeholder = 'None', t }) {
    return (
        <Select value={value || '__none__'} disabled={disabled} onValueChange={(nextValue) => onChange(nextValue === '__none__' ? '' : nextValue)}>
            <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="__none__">{t('dialog.gallery_select.none')}</SelectItem>
                {sortOptions.map(([option, labelKey]) => (
                    <SelectItem key={option} value={option}>
                        {t(labelKey)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function SidePanel({ className = '', style = undefined }) {
    const { t } = useI18n();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const favoriteLoadStatus = useFavoriteStore((state) => state.loadStatus);
    const favoriteFriendGroups = useFavoriteStore((state) => state.favoriteFriendGroups);
    const localFriendFavoriteGroups = useFavoriteStore((state) => state.localFriendFavoriteGroups);
    const groupInstancesState = useRuntimeStore((state) => state.groupInstances);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const groupInstances = groupInstancesState.endpoint === currentEndpoint ? groupInstancesState.instances : [];
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const vrcUnseenNotificationCount = useVrcNotificationStore((state) => state.unseenCount);
    const openVrcNotificationCenter = useVrcNotificationStore((state) => state.openCenter);
    const markAllVrcNotificationsSeen = useVrcNotificationStore((state) => state.markAllSeen);
    const loadVrcNotifications = useVrcNotificationStore((state) => state.loadForCurrentUser);
    const removeNavNotification = useShellStore((state) => state.removeNotify);
    const notificationLayout = usePreferencesStore((state) => state.notificationLayout);
    const [activeTab, setActiveTab] = useState('friends');
    const [prefs, setPrefs] = useState(defaultPrefs);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [favoriteGroupOrderDialogOpen, setFavoriteGroupOrderDialogOpen] = useState(false);
    const [favoriteGroupOrderDraft, setFavoriteGroupOrderDraft] = useState([]);
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const totalFriendCount = Object.keys(friendsById || {}).length;

    useEffect(() => {
        if (sessionPhase !== 'ready' || !currentUserId) {
            return;
        }
        void loadVrcNotifications().catch(() => {});
    }, [currentUserId, loadVrcNotifications, sessionPhase]);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getBool('sidebarGroupByInstance', true),
            configRepository.getBool('isHideFriendsInSameInstance', false),
            configRepository.getBool('isSameInstanceAboveFavorites', false),
            configRepository.getBool('isSidebarDivideByFriendGroup', false),
            configRepository.getString('sidebarSortMethod1', 'Sort by Status'),
            configRepository.getString('sidebarSortMethod2', 'Sort Alphabetically'),
            configRepository.getString('sidebarSortMethod3', ''),
            configRepository.getString('sidebarFavoriteGroups', '[]'),
            configRepository.getString('sidebarFavoriteGroupOrder', '[]')
        ])
            .then(
                ([
                    sidebarGroupByInstance,
                    isHideFriendsInSameInstance,
                    isSameInstanceAboveFavorites,
                    isSidebarDivideByFriendGroup,
                    sidebarSortMethod1,
                    sidebarSortMethod2,
                    sidebarSortMethod3,
                    sidebarFavoriteGroups,
                    sidebarFavoriteGroupOrder
                ]) => {
                    if (!active) {
                        return;
                    }
                    setPrefs({
                        sidebarGroupByInstance: Boolean(sidebarGroupByInstance),
                        isHideFriendsInSameInstance: Boolean(isHideFriendsInSameInstance),
                        isSameInstanceAboveFavorites: Boolean(isSameInstanceAboveFavorites),
                        isSidebarDivideByFriendGroup: Boolean(isSidebarDivideByFriendGroup),
                        sidebarSortMethod1: sidebarSortMethod1 || '',
                        sidebarSortMethod2: sidebarSortMethod2 || '',
                        sidebarSortMethod3: sidebarSortMethod3 || '',
                        sidebarFavoriteGroups: parseConfigArray(sidebarFavoriteGroups),
                        sidebarFavoriteGroupOrder: parseConfigArray(sidebarFavoriteGroupOrder)
                    });
                }
            )
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
                return;
            }
            event.preventDefault();
            setQuickSearchOpen(true);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const tabItems = useMemo(
        () => [
            {
                value: 'friends',
                label: `${t('side_panel.friends')} (${onlineIds.length}/${totalFriendCount})`
            },
            {
                value: 'groups',
                label: `${t('side_panel.groups')} (${groupInstances.length})`
            }
        ],
        [groupInstances.length, onlineIds.length, t, totalFriendCount]
    );

    const favoriteGroupItems = useMemo(
        () => [
            ...(favoriteFriendGroups || []).map((group) => ({
                key: group.key,
                label: group.displayName || group.name || group.key
            })),
            ...(localFriendFavoriteGroups || []).map((groupName) => ({
                key: `local:${groupName}`,
                label: groupName
            }))
        ].filter((group) => group.key),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const allFavoriteGroupKeys = useMemo(
        () => favoriteGroupItems.map((group) => group.key),
        [favoriteGroupItems]
    );
    const resolvedSidebarFavoriteGroups = useMemo(() => {
        const configured = Array.isArray(prefs.sidebarFavoriteGroups) ? prefs.sidebarFavoriteGroups.filter(Boolean) : [];
        if (!configured.length) {
            return allFavoriteGroupKeys;
        }
        return configured.filter((key) => allFavoriteGroupKeys.includes(key));
    }, [allFavoriteGroupKeys, prefs.sidebarFavoriteGroups]);
    const selectedFavoriteGroupLabel = useMemo(() => {
        const firstKey = resolvedSidebarFavoriteGroups[0];
        const firstGroup = favoriteGroupItems.find((group) => group.key === firstKey);
        if (!firstGroup) {
            return '';
        }
        return resolvedSidebarFavoriteGroups.length > 1
            ? `${firstGroup.label} +${resolvedSidebarFavoriteGroups.length - 1}`
            : firstGroup.label;
    }, [favoriteGroupItems, resolvedSidebarFavoriteGroups]);
    const orderedFavoriteGroupItems = useMemo(() => {
        const selected = new Set(resolvedSidebarFavoriteGroups);
        const itemMap = new Map(favoriteGroupItems.map((group) => [group.key, group]));
        const ordered = [];
        for (const key of prefs.sidebarFavoriteGroupOrder || []) {
            if (selected.has(key) && itemMap.has(key)) {
                ordered.push(itemMap.get(key));
                selected.delete(key);
            }
        }
        for (const key of resolvedSidebarFavoriteGroups) {
            if (selected.has(key) && itemMap.has(key)) {
                ordered.push(itemMap.get(key));
            }
        }
        return ordered;
    }, [favoriteGroupItems, prefs.sidebarFavoriteGroupOrder, resolvedSidebarFavoriteGroups]);

    useEffect(() => {
        if (favoriteGroupOrderDialogOpen) {
            setFavoriteGroupOrderDraft(orderedFavoriteGroupItems);
        }
    }, [favoriteGroupOrderDialogOpen, orderedFavoriteGroupItems]);

    function updateBoolPreference(key, value) {
        setPrefs((current) => ({
            ...current,
            [key]: Boolean(value)
        }));
        void configRepository.setBool(key, Boolean(value));
    }

    function updateStringPreference(key, value) {
        setPrefs((current) => ({
            ...current,
            [key]: value || ''
        }));
        void configRepository.setString(key, value || '');
    }

    function updateArrayPreference(key, value) {
        const nextValue = Array.isArray(value) ? value : [];
        setPrefs((current) => ({
            ...current,
            [key]: nextValue
        }));
        void configRepository.setString(key, JSON.stringify(nextValue));
    }

    function updateFavoriteGroupSelection(nextKeys) {
        updateArrayPreference('sidebarFavoriteGroups', normalizeFavoriteGroupsChange(nextKeys, allFavoriteGroupKeys));
    }

    function toggleFavoriteGroup(key, checked) {
        const selected = new Set(resolvedSidebarFavoriteGroups);
        if (checked) {
            selected.add(key);
        } else {
            selected.delete(key);
        }
        updateFavoriteGroupSelection([...selected].filter((value) => allFavoriteGroupKeys.includes(value)));
    }

    function confirmFavoriteGroupOrder() {
        const nextOrder = favoriteGroupOrderDraft.map((group) => group.key);
        for (const key of prefs.sidebarFavoriteGroupOrder || []) {
            if (!nextOrder.includes(key)) {
                nextOrder.push(key);
            }
        }
        updateArrayPreference('sidebarFavoriteGroupOrder', nextOrder);
        setFavoriteGroupOrderDialogOpen(false);
    }

    function resetFavoriteGroupOrder() {
        updateArrayPreference('sidebarFavoriteGroupOrder', []);
        setFavoriteGroupOrderDraft(orderedFavoriteGroupItems);
    }

    async function refreshFriends() {
        if (isRefreshing) {
            return;
        }
        const auth = useRuntimeStore.getState().auth;
        if (!auth.currentUserId || !auth.currentUserSnapshot) {
            toast.error('No authenticated user snapshot is available.');
            return;
        }
        setIsRefreshing(true);
        try {
            await Promise.all([
                bootstrapFriendRoster({
                    userId: auth.currentUserId,
                    endpoint: auth.currentUserEndpoint,
                    currentUserSnapshot: auth.currentUserSnapshot
                }),
                bootstrapFavorites({
                    userId: auth.currentUserId,
                    endpoint: auth.currentUserEndpoint,
                    currentUserSnapshot: auth.currentUserSnapshot
                })
            ]);
            toast.success('Friend and favorite snapshots refreshed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to refresh friends.');
        } finally {
            setIsRefreshing(false);
        }
    }

    return (
        <aside className={cn('flex h-full min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l bg-background', className)} style={style}>
            <div className="flex shrink-0 items-center gap-1 px-2 py-2">
                <button
                    type="button"
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-xs hover:border-ring"
                    onClick={() => setQuickSearchOpen(true)}>
                    <SearchIcon className="size-4 shrink-0 opacity-50" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {t('side_panel.search_placeholder')}
                    </span>
                    <span className="rounded border px-1 text-[10px] text-muted-foreground">Ctrl</span>
                    <span className="rounded border px-1 text-[10px] text-muted-foreground">K</span>
                </button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                    disabled={isRefreshing}
                    onClick={() => {
                        void refreshFriends();
                    }}
                    title={t('side_panel.refresh_tooltip')}>
                    <RefreshCwIcon className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
                {notificationLayout !== 'table' ? (
                    vrcUnseenNotificationCount ? (
                        <ContextMenu>
                            <ContextMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="relative size-8 rounded-full"
                                    onClick={() => openVrcNotificationCenter()}
                                    title={t('side_panel.notification_center.title')}>
                                    <BellIcon className="size-4" />
                                    <span className="absolute right-2 top-2 size-1.5 rounded-full bg-red-500" />
                                </Button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-48">
                                <ContextMenuItem
                                    onSelect={() => {
                                        void markAllVrcNotificationsSeen()
                                            .then(() => {
                                                removeNavNotification('notification');
                                            })
                                            .catch((error) => {
                                                toast.error(error instanceof Error ? error.message : 'Failed to mark notifications as seen.');
                                            });
                                    }}>
                                    {t('nav_menu.mark_all_read')}
                                </ContextMenuItem>
                            </ContextMenuContent>
                        </ContextMenu>
                    ) : (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="relative size-8 rounded-full"
                            onClick={() => openVrcNotificationCenter()}
                            onContextMenu={(event) => {
                                event.preventDefault();
                                toast.info(t('side_panel.notification_center.no_unseen_notifications'));
                            }}
                            title={t('side_panel.notification_center.title')}>
                            <BellIcon className="size-4" />
                        </Button>
                    )
                ) : null}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full">
                            <SettingsIcon className="size-4" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="w-72 p-3">
                        <div className="flex flex-col gap-2.5">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t('side_panel.settings.display')}
                            </span>
                            <SettingRow label={t('side_panel.settings.group_by_instance')}>
                                <Switch
                                    checked={prefs.sidebarGroupByInstance}
                                    onCheckedChange={(value) => updateBoolPreference('sidebarGroupByInstance', value)}
                                />
                            </SettingRow>
                            {prefs.sidebarGroupByInstance ? (
                                <>
                                    <SettingRow label={t('side_panel.settings.hide_friends_in_same_instance')}>
                                        <Switch
                                            checked={prefs.isHideFriendsInSameInstance}
                                            onCheckedChange={(value) => updateBoolPreference('isHideFriendsInSameInstance', value)}
                                        />
                                    </SettingRow>
                                    <SettingRow label={t('side_panel.settings.same_instance_above_favorites')}>
                                        <Switch
                                            checked={prefs.isSameInstanceAboveFavorites}
                                            onCheckedChange={(value) => updateBoolPreference('isSameInstanceAboveFavorites', value)}
                                        />
                                    </SettingRow>
                                </>
                            ) : null}
                            <SettingRow label={t('side_panel.settings.split_favorite_friends')}>
                                <Switch
                                    checked={prefs.isSidebarDivideByFriendGroup}
                                    onCheckedChange={(value) => updateBoolPreference('isSidebarDivideByFriendGroup', value)}
                                />
                            </SettingRow>
                            <Separator />
                            <button
                                type="button"
                                className="flex w-full items-center justify-between py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                                onClick={() => setIsAdvancedOpen((current) => !current)}>
                                {t('side_panel.settings.advanced')}
                                <ChevronDownIcon className={`size-3.5 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isAdvancedOpen ? (
                                <div className="flex flex-col gap-2.5">
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                                        {t('side_panel.settings.sorting')}
                                    </span>
                                    <SortSelect
                                        value={prefs.sidebarSortMethod1}
                                        onChange={(value) => updateStringPreference('sidebarSortMethod1', value)}
                                        placeholder={t('view.settings.appearance.side_panel.sorting.placeholder')}
                                        t={t}
                                    />
                                    <SortSelect
                                        value={prefs.sidebarSortMethod2}
                                        disabled={!prefs.sidebarSortMethod1}
                                        onChange={(value) => updateStringPreference('sidebarSortMethod2', value)}
                                        placeholder={t('side_panel.settings.sort_secondary')}
                                        t={t}
                                    />
                                    <SortSelect
                                        value={prefs.sidebarSortMethod3}
                                        disabled={!prefs.sidebarSortMethod2}
                                        onChange={(value) => updateStringPreference('sidebarSortMethod3', value)}
                                        placeholder={t('side_panel.settings.sort_tertiary')}
                                        t={t}
                                    />
                                    <Separator />
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                                        {t('side_panel.settings.favorites_section')}
                                    </span>
                                    <div className="rounded-md border">
                                        <div className="border-b px-2 py-1.5 text-[11px] text-muted-foreground">
                                            {selectedFavoriteGroupLabel || t('side_panel.settings.favorite_groups_placeholder')}
                                        </div>
                                        <div className="max-h-[min(24rem,50vh)] overflow-auto p-1">
                                            {favoriteGroupItems.length ? (
                                                favoriteGroupItems.map((group) => (
                                                    <label
                                                        key={group.key}
                                                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                                                        <Checkbox
                                                            checked={resolvedSidebarFavoriteGroups.includes(group.key)}
                                                            onCheckedChange={(checked) => toggleFavoriteGroup(group.key, Boolean(checked))}
                                                        />
                                                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                                                    </label>
                                                ))
                                            ) : (
                                                <div className="px-1.5 py-1 text-xs text-muted-foreground">
                                                    {favoriteLoadStatus === 'running' ? 'Loading favorite groups.' : 'No favorite groups.'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {prefs.isSidebarDivideByFriendGroup ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={!orderedFavoriteGroupItems.length}
                                            onClick={() => setFavoriteGroupOrderDialogOpen(true)}>
                                            {t('side_panel.settings.edit_group_order')}
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
                <TabsList variant="line" className="grid w-full shrink-0 grid-cols-2">
                    {tabItems.map((item) => (
                        <TabsTrigger key={item.value} value={item.value} className="flex-none">
                            {item.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <TabsContent value="friends" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
                    <FriendsSidebar prefs={prefs} />
                </TabsContent>
                <TabsContent value="groups" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
                    <GroupsSidebar />
                </TabsContent>
            </Tabs>
            <Dialog open={favoriteGroupOrderDialogOpen} onOpenChange={setFavoriteGroupOrderDialogOpen}>
                <DialogContent className="max-h-[80vh] sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('side_panel.settings.edit_group_order')}</DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[50vh] space-y-1 overflow-auto py-2">
                        {favoriteGroupOrderDraft.map((group, index) => (
                            <div key={group.key} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={index === 0}
                                    onClick={() => setFavoriteGroupOrderDraft((current) => moveArrayItem(current, index, -1))}>
                                    <ArrowUpIcon className="size-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={index === favoriteGroupOrderDraft.length - 1}
                                    onClick={() => setFavoriteGroupOrderDraft((current) => moveArrayItem(current, index, 1))}>
                                    <ArrowDownIcon className="size-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="secondary" size="sm" onClick={resetFavoriteGroupOrder}>
                            {t('common.actions.reset')}
                        </Button>
                        <Button type="button" size="sm" onClick={confirmFavoriteGroupOrder}>
                            {t('common.actions.confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <QuickSearchDialog open={quickSearchOpen} onOpenChange={setQuickSearchOpen} />
        </aside>
    );
}
