import {
    ChevronDownIcon,
    MoreHorizontalIcon,
    RefreshCwIcon,
    SlidersHorizontalIcon
} from 'lucide-react';
import { cloneElement, isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldContent, FieldLabel } from '@/ui/shadcn/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

const sortOptions = [
    [
        'Sort Alphabetically',
        'view.settings.appearance.side_panel.sorting.alphabetical'
    ],
    ['Sort by Status', 'view.settings.appearance.side_panel.sorting.status'],
    [
        'Sort Private to Bottom',
        'view.settings.appearance.side_panel.sorting.private_to_bottom'
    ],
    [
        'Sort by Last Active',
        'view.settings.appearance.side_panel.sorting.last_active'
    ],
    [
        'Sort by Last Seen',
        'view.settings.appearance.side_panel.sorting.last_seen'
    ],
    [
        'Sort by Time in Instance',
        'view.settings.appearance.side_panel.sorting.time_in_instance'
    ],
    ['Sort by Location', 'view.settings.appearance.side_panel.sorting.location']
];

type SettingRowControlProps = {
    id?: string;
};

function SettingRow({
    id,
    label,
    children
}: {
    id?: string;
    label: ReactNode;
    children: ReactNode;
}) {
    const control =
        id && isValidElement<SettingRowControlProps>(children)
            ? cloneElement(children, { id })
            : children;

    return (
        <Field orientation="horizontal" className="gap-3 text-xs">
            <FieldContent>
                <FieldLabel htmlFor={id} className="text-xs">
                    {label}
                </FieldLabel>
            </FieldContent>
            {control}
        </Field>
    );
}

function SortSelect({ value, disabled, onChange, placeholder = 'None' }: any) {
    const { t } = useTranslation();

    return (
        <Select
            value={value || '__none__'}
            disabled={disabled}
            onValueChange={(nextValue: any) =>
                onChange(nextValue === '__none__' ? '' : nextValue)
            }
        >
            <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    <SelectItem value="__none__">
                        {t('dialog.gallery_select.none')}
                    </SelectItem>
                    {sortOptions.map(([option, labelKey]: any) => (
                        <SelectItem key={option} value={option}>
                            {t(labelKey)}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

export function SidePanelSettingsPopover({
    open,
    onOpenChange,
    isRefreshing,
    onRefreshFriends,
    prefs,
    onUpdateBoolPreference,
    onUpdateStringPreference,
    isAdvancedOpen,
    onAdvancedOpenChange,
    favoriteGroupItems,
    favoriteLoadStatus,
    selectedFavoriteGroupLabel,
    resolvedSidebarFavoriteGroups,
    onToggleFavoriteGroup,
    orderedFavoriteGroupItemsLength,
    onOpenFavoriteGroupOrderDialog,
    onOpenCustomTabsDialog
}: any) {
    const { t } = useTranslation();

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={t('side_panel.settings.display')}
                >
                    {isRefreshing ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <MoreHorizontalIcon data-icon="inline-start" />
                    )}
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
                            onOpenChange(false);
                            onRefreshFriends();
                        }}
                    >
                        {isRefreshing ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                        {t('side_panel.refresh_tooltip')}
                    </Button>
                    <Separator />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => {
                            onOpenChange(false);
                            onOpenCustomTabsDialog();
                        }}
                    >
                        <SlidersHorizontalIcon data-icon="inline-start" />
                        {t('side_panel.settings.custom_tabs.configure')}
                    </Button>
                    <Separator />
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('side_panel.settings.display')}
                    </span>
                    <SettingRow
                        id="side-panel-group-by-instance"
                        label={t('side_panel.settings.group_by_instance')}
                    >
                        <Switch
                            checked={prefs.sidebarGroupByInstance}
                            onCheckedChange={(value: any) =>
                                onUpdateBoolPreference(
                                    'sidebarGroupByInstance',
                                    value
                                )
                            }
                        />
                    </SettingRow>
                    {prefs.sidebarGroupByInstance ? (
                        <>
                            <SettingRow
                                id="side-panel-hide-friends-in-same-instance"
                                label={t(
                                    'side_panel.settings.hide_friends_in_same_instance'
                                )}
                            >
                                <Switch
                                    checked={prefs.isHideFriendsInSameInstance}
                                    onCheckedChange={(value: any) =>
                                        onUpdateBoolPreference(
                                            'isHideFriendsInSameInstance',
                                            value
                                        )
                                    }
                                />
                            </SettingRow>
                            <SettingRow
                                id="side-panel-same-instance-above-favorites"
                                label={t(
                                    'side_panel.settings.same_instance_above_favorites'
                                )}
                            >
                                <Switch
                                    checked={prefs.isSameInstanceAboveFavorites}
                                    onCheckedChange={(value: any) =>
                                        onUpdateBoolPreference(
                                            'isSameInstanceAboveFavorites',
                                            value
                                        )
                                    }
                                />
                            </SettingRow>
                        </>
                    ) : null}
                    <SettingRow
                        id="side-panel-split-favorite-friends"
                        label={t('side_panel.settings.split_favorite_friends')}
                    >
                        <Switch
                            checked={prefs.isSidebarDivideByFriendGroup}
                            onCheckedChange={(value: any) =>
                                onUpdateBoolPreference(
                                    'isSidebarDivideByFriendGroup',
                                    value
                                )
                            }
                        />
                    </SettingRow>
                    <Separator />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground h-auto w-full justify-between px-0 py-0.5 text-xs font-medium tracking-wide uppercase"
                        onClick={() => onAdvancedOpenChange(!isAdvancedOpen)}
                    >
                        {t('side_panel.settings.advanced')}
                        <ChevronDownIcon
                            data-icon="inline-end"
                            className={cn(
                                'transition-transform',
                                isAdvancedOpen && 'rotate-180'
                            )}
                        />
                    </Button>
                    {isAdvancedOpen ? (
                        <div className="flex flex-col gap-2.5">
                            <span className="text-muted-foreground/70 text-xs font-medium tracking-wide uppercase">
                                {t('side_panel.settings.sorting')}
                            </span>
                            <SortSelect
                                value={prefs.sidebarSortMethod1}
                                onChange={(value: any) =>
                                    onUpdateStringPreference(
                                        'sidebarSortMethod1',
                                        value
                                    )
                                }
                                placeholder={t(
                                    'view.settings.appearance.side_panel.sorting.placeholder'
                                )}
                            />
                            <SortSelect
                                value={prefs.sidebarSortMethod2}
                                disabled={!prefs.sidebarSortMethod1}
                                onChange={(value: any) =>
                                    onUpdateStringPreference(
                                        'sidebarSortMethod2',
                                        value
                                    )
                                }
                                placeholder={t(
                                    'side_panel.settings.sort_secondary'
                                )}
                            />
                            <SortSelect
                                value={prefs.sidebarSortMethod3}
                                disabled={!prefs.sidebarSortMethod2}
                                onChange={(value: any) =>
                                    onUpdateStringPreference(
                                        'sidebarSortMethod3',
                                        value
                                    )
                                }
                                placeholder={t(
                                    'side_panel.settings.sort_tertiary'
                                )}
                            />
                            <Separator />
                            <span className="text-muted-foreground/70 text-xs font-medium tracking-wide uppercase">
                                {t('side_panel.settings.favorites_section')}
                            </span>
                            <div className="rounded-md border">
                                <div className="text-muted-foreground border-b px-2 py-1.5 text-xs">
                                    {selectedFavoriteGroupLabel ||
                                        t(
                                            'side_panel.settings.favorite_groups_placeholder'
                                        )}
                                </div>
                                <div className="max-h-[min(24rem,50vh)] overflow-auto p-1">
                                    {favoriteGroupItems.length ? (
                                        favoriteGroupItems.map((group: any) => (
                                            <Field
                                                key={group.key}
                                                orientation="horizontal"
                                                className="hover:bg-muted/50 cursor-pointer gap-2 rounded px-1.5 py-1 text-xs"
                                            >
                                                <Checkbox
                                                    id={`sidebar-favorite-${group.key}`}
                                                    checked={resolvedSidebarFavoriteGroups.includes(
                                                        group.key
                                                    )}
                                                    onCheckedChange={(
                                                        checked: any
                                                    ) =>
                                                        onToggleFavoriteGroup(
                                                            group.key,
                                                            Boolean(checked)
                                                        )
                                                    }
                                                />
                                                <FieldLabel
                                                    htmlFor={`sidebar-favorite-${group.key}`}
                                                    className="min-w-0 flex-1 truncate text-xs"
                                                >
                                                    {group.label}
                                                </FieldLabel>
                                            </Field>
                                        ))
                                    ) : (
                                        <div className="text-muted-foreground px-1.5 py-1 text-xs">
                                            {favoriteLoadStatus === 'running'
                                                ? t('common.loading')
                                                : t(
                                                      'view.favorite.empty.no_favorite_groups_loaded'
                                                  )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {prefs.isSidebarDivideByFriendGroup ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!orderedFavoriteGroupItemsLength}
                                    onClick={onOpenFavoriteGroupOrderDialog}
                                >
                                    {t('side_panel.settings.edit_group_order')}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}
