import { cloneElement, isValidElement, useEffect, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, MoreHorizontalIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldContent,
    FieldLabel
} from '@/ui/shadcn/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { configRepository } from '@/repositories/index.js';
import { refreshCurrentUserFriendsAndFavorites } from '@/services/backgroundMaintenanceService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { FriendsSidebar } from './FriendsSidebar.jsx';
import { GroupsSidebar } from './GroupsSidebar.jsx';

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

function SettingRow({ id, label, children }) {
    const control = id && isValidElement(children)
        ? cloneElement(children, { id })
        : children;

    return (
        <Field orientation="horizontal" className="gap-3 text-xs">
            <FieldContent>
                <FieldLabel htmlFor={id} className="text-xs">{label}</FieldLabel>
            </FieldContent>
            {control}
        </Field>
    );
}

function SortSelect({ value, disabled, onChange, placeholder = 'None', t }) {
    return (
        <Select value={value || '__none__'} disabled={disabled} onValueChange={(nextValue) => onChange(nextValue === '__none__' ? '' : nextValue)}>
            <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    <SelectItem value="__none__">{t('dialog.gallery_select.none')}</SelectItem>
                    {sortOptions.map(([option, labelKey]) => (
                        <SelectItem key={option} value={option}>
                            {t(labelKey)}
                        </SelectItem>
                    ))}
                </SelectGroup>
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
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const groupInstances = groupInstancesState.endpoint === currentEndpoint ? groupInstancesState.instances : [];
    const [activeTab, setActiveTab] = useState('friends');
    const [prefs, setPrefs] = useState(defaultPrefs);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
    const [favoriteGroupOrderDialogOpen, setFavoriteGroupOrderDialogOpen] = useState(false);
    const [favoriteGroupOrderDraft, setFavoriteGroupOrderDraft] = useState([]);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const totalFriendCount = Object.keys(friendsById || {}).length;

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
            await refreshCurrentUserFriendsAndFavorites();
            toast.success('Friend and favorite snapshots refreshed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to refresh friends.');
        } finally {
            setIsRefreshing(false);
        }
    }

    return (
        <aside className={cn('flex h-full min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l bg-background', className)} style={style}>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
                <div className="flex shrink-0 items-center gap-2">
                    <TabsList>
                        {tabItems.map((item) => (
                            <TabsTrigger key={item.value} value={item.value}>
                                {item.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <Popover open={settingsPopoverOpen} onOpenChange={setSettingsPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label={t('side_panel.settings.display')}>
                                {isRefreshing ? <Spinner data-icon="inline-start" /> : <MoreHorizontalIcon data-icon="inline-start" />}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent side="bottom" align="end" className="w-72 p-3">
                            <div className="flex flex-col gap-2.5">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full justify-start"
                                aria-label={t('side_panel.refresh_tooltip')}
                                disabled={isRefreshing}
                                onClick={() => {
                                    setSettingsPopoverOpen(false);
                                    void refreshFriends();
                                }}>
                                {isRefreshing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                                {t('side_panel.refresh_tooltip')}
                            </Button>
                            <Separator />
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t('side_panel.settings.display')}
                            </span>
                            <SettingRow id="side-panel-group-by-instance" label={t('side_panel.settings.group_by_instance')}>
                                <Switch
                                    checked={prefs.sidebarGroupByInstance}
                                    onCheckedChange={(value) => updateBoolPreference('sidebarGroupByInstance', value)}
                                />
                            </SettingRow>
                            {prefs.sidebarGroupByInstance ? (
                                <>
                                    <SettingRow id="side-panel-hide-friends-in-same-instance" label={t('side_panel.settings.hide_friends_in_same_instance')}>
                                        <Switch
                                            checked={prefs.isHideFriendsInSameInstance}
                                            onCheckedChange={(value) => updateBoolPreference('isHideFriendsInSameInstance', value)}
                                        />
                                    </SettingRow>
                                    <SettingRow id="side-panel-same-instance-above-favorites" label={t('side_panel.settings.same_instance_above_favorites')}>
                                        <Switch
                                            checked={prefs.isSameInstanceAboveFavorites}
                                            onCheckedChange={(value) => updateBoolPreference('isSameInstanceAboveFavorites', value)}
                                        />
                                    </SettingRow>
                                </>
                            ) : null}
                            <SettingRow id="side-panel-split-favorite-friends" label={t('side_panel.settings.split_favorite_friends')}>
                                <Switch
                                    checked={prefs.isSidebarDivideByFriendGroup}
                                    onCheckedChange={(value) => updateBoolPreference('isSidebarDivideByFriendGroup', value)}
                                />
                            </SettingRow>
                            <Separator />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-auto w-full justify-between px-0 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-transparent hover:text-foreground"
                                onClick={() => setIsAdvancedOpen((current) => !current)}>
                                {t('side_panel.settings.advanced')}
                                <ChevronDownIcon
                                    data-icon="inline-end"
                                    className={cn('transition-transform', isAdvancedOpen && 'rotate-180')}
                                />
                            </Button>
                            {isAdvancedOpen ? (
                                <div className="flex flex-col gap-2.5">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
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
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                                        {t('side_panel.settings.favorites_section')}
                                    </span>
                                    <div className="rounded-md border">
                                        <div className="border-b px-2 py-1.5 text-xs text-muted-foreground">
                                            {selectedFavoriteGroupLabel || t('side_panel.settings.favorite_groups_placeholder')}
                                        </div>
                                        <div className="max-h-[min(24rem,50vh)] overflow-auto p-1">
                                            {favoriteGroupItems.length ? (
                                                favoriteGroupItems.map((group) => (
                                                    <Field
                                                        key={group.key}
                                                        orientation="horizontal"
                                                        className="cursor-pointer gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                                                        <Checkbox
                                                            id={`sidebar-favorite-${group.key}`}
                                                            checked={resolvedSidebarFavoriteGroups.includes(group.key)}
                                                            onCheckedChange={(checked) => toggleFavoriteGroup(group.key, Boolean(checked))}
                                                        />
                                                        <FieldLabel htmlFor={`sidebar-favorite-${group.key}`} className="min-w-0 flex-1 truncate text-xs">
                                                            {group.label}
                                                        </FieldLabel>
                                                    </Field>
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
                    <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto py-2">
                        {favoriteGroupOrderDraft.map((group, index) => (
                            <div key={group.key} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Move ${group.label} up`}
                                    disabled={index === 0}
                                    onClick={() => setFavoriteGroupOrderDraft((current) => moveArrayItem(current, index, -1))}>
                                    <ArrowUpIcon data-icon="inline-start" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Move ${group.label} down`}
                                    disabled={index === favoriteGroupOrderDraft.length - 1}
                                    onClick={() => setFavoriteGroupOrderDraft((current) => moveArrayItem(current, index, 1))}>
                                    <ArrowDownIcon data-icon="inline-start" />
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
        </aside>
    );
}
