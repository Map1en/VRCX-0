import {
    ChevronDownIcon,
    ChevronsUpDownIcon,
    UserIcon,
    XIcon
} from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeEndpoint, normalizeUserId } from '@/domain/users/userFacts';
import type { UserFact } from '@/domain/users/userFacts';
import { UserPickerRow } from '@/features/charts/components/MutualFriendsViewParts';
import { userImage } from '@/services/entityMediaService';
import { MINUTES_PER_DAY } from '@/shared/constants/time';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';

import type { FavoriteFriendGroupOption } from '../../settingsFavoriteGroupOptions';
import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

type KnownUserOption = Partial<UserFact> & {
    id: string;
    endpoint: string;
    name?: string;
};

type UserOption = {
    value: string;
    label: string;
    user: KnownUserOption;
};

type SettingsSocialTabProps = {
    social: {
        prefs: {
            recentActionCooldownEnabled: boolean;
            recentActionCooldownMinutes: string | number;
        };
        selectedFavoriteFriendGroupLabel: string;
        favoriteFriendGroupOptions: FavoriteFriendGroupOption[];
        remoteFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
        localFavoriteFriendGroupOptions: FavoriteFriendGroupOption[];
        localFavoriteFriendsGroups: string[];
        feedHiddenUsers?: string[];
        onAddFeedHiddenUser(userId: string): unknown;
        onRemoveFeedHiddenUser(userId: string): unknown;
        onRecentActionCooldownEnabledChange(checked: boolean): unknown;
        onRecentActionCooldownMinutesChange(value: string): unknown;
        onRecentActionCooldownMinutesBlur(value: string): unknown;
        onToggleLocalFavoriteFriendsGroup(
            groupKey: string,
            checked: boolean
        ): unknown;
    };
};

function knownUserName(user: Partial<KnownUserOption> | null | undefined) {
    return user?.displayName || user?.username || user?.name || '';
}

export function SettingsSocialTab({ social }: SettingsSocialTabProps) {
    const {
        prefs,
        selectedFavoriteFriendGroupLabel,
        favoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        localFavoriteFriendsGroups,
        feedHiddenUsers = [],
        onAddFeedHiddenUser,
        onRemoveFeedHiddenUser,
        onRecentActionCooldownEnabledChange,
        onRecentActionCooldownMinutesChange,
        onRecentActionCooldownMinutesBlur,
        onToggleLocalFavoriteFriendsGroup
    } = social;
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const usersByKey = useUserFactsStore((state) => state.usersByKey);
    const [hiddenUserPickerOpen, setHiddenUserPickerOpen] = useState(false);
    const [hiddenUserSearch, setHiddenUserSearch] = useState('');
    const endpoint = normalizeEndpoint(currentEndpoint);
    const favoriteGroupLabel =
        selectedFavoriteFriendGroupLabel ||
        t('view.settings.general.favorites.group_placeholder');
    const hiddenUserIds = useMemo(
        () => new Set(feedHiddenUsers),
        [feedHiddenUsers]
    );
    const knownUsers = useMemo(() => {
        const usersById = new Map<string, KnownUserOption>();
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        for (const user of Object.values(usersByKey).filter((user) => {
            const userId = normalizeUserId(user?.id);
            return (
                userId &&
                userId !== normalizedCurrentUserId &&
                normalizeEndpoint(user?.endpoint || endpoint) === endpoint
            );
        })) {
            const userId = normalizeUserId(user?.id);
            if (!usersById.has(userId)) {
                usersById.set(userId, user);
            }
        }
        return Array.from(usersById.values())
            .sort((left, right) =>
                (knownUserName(left) || left.id).localeCompare(
                    knownUserName(right) || right.id
                )
            )
            .slice(0, 500);
    }, [currentUserId, endpoint, usersByKey]);
    const knownUsersById = useMemo(
        () =>
            new Map(knownUsers.map((user) => [normalizeUserId(user.id), user])),
        [knownUsers]
    );
    const hiddenUserOptions = useMemo(() => {
        const query = hiddenUserSearch.trim().toLowerCase();
        return knownUsers
            .map(
                (user): UserOption => ({
                    value: normalizeUserId(user.id),
                    label:
                        knownUserName(user) ||
                        t('view.settings.social.hidden_feed.unknown_user'),
                    user
                })
            )
            .filter((option) => {
                if (!option.value || hiddenUserIds.has(option.value)) {
                    return false;
                }
                if (!query) {
                    return true;
                }
                return (
                    option.label.toLowerCase().includes(query) ||
                    option.value.toLowerCase().includes(query)
                );
            });
    }, [hiddenUserIds, hiddenUserSearch, knownUsers, t]);
    const hiddenFeedUserOptions = useMemo(
        () =>
            feedHiddenUsers.map((userId): UserOption => {
                const knownUser = knownUsersById.get(userId);
                const label = knownUserName(knownUser) || userId;
                return {
                    value: userId,
                    label,
                    user:
                        knownUser ||
                        ({
                            id: userId,
                            displayName: label,
                            endpoint
                        } satisfies KnownUserOption)
                };
            }),
        [endpoint, feedHiddenUsers, knownUsersById]
    );

    return (
        <SettingsTabContent value="social">
            <SettingsGroup title={t('view.settings.social.interaction.header')}>
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.recent_action_cooldown'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.recent_action_cooldown_description'
                    )}
                >
                    <div className="flex items-center gap-3">
                        <Switch
                            checked={prefs.recentActionCooldownEnabled}
                            onCheckedChange={
                                onRecentActionCooldownEnabledChange
                            }
                        />
                        {prefs.recentActionCooldownEnabled ? (
                            <Input
                                type="number"
                                min={1}
                                max={MINUTES_PER_DAY}
                                className="w-28"
                                value={prefs.recentActionCooldownMinutes}
                                onChange={(event) =>
                                    onRecentActionCooldownMinutesChange(
                                        event.target.value
                                    )
                                }
                                onBlur={(event) =>
                                    onRecentActionCooldownMinutesBlur(
                                        event.target.value
                                    )
                                }
                            />
                        ) : null}
                    </div>
                </Field>
            </SettingsGroup>
            <SettingsGroup title={t('view.settings.social.hidden_feed.header')}>
                <Field
                    label={t('view.settings.social.hidden_feed.add')}
                    description={t(
                        'view.settings.social.hidden_feed.description'
                    )}
                >
                    <div className="flex max-w-xl flex-col gap-2">
                        <Popover
                            open={hiddenUserPickerOpen}
                            onOpenChange={setHiddenUserPickerOpen}
                        >
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-64 justify-between"
                                >
                                    <span className="truncate">
                                        {t(
                                            'view.settings.social.hidden_feed.add'
                                        )}
                                    </span>
                                    <ChevronsUpDownIcon className="text-muted-foreground size-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-96 p-2">
                                <div className="flex flex-col gap-2">
                                    <Input
                                        value={hiddenUserSearch}
                                        onChange={(
                                            event: ChangeEvent<HTMLInputElement>
                                        ) =>
                                            setHiddenUserSearch(
                                                event.target.value
                                            )
                                        }
                                        placeholder={t(
                                            'view.settings.social.hidden_feed.search_placeholder'
                                        )}
                                    />
                                    <ScrollArea className="h-72 rounded-md border">
                                        <div className="flex flex-col gap-1 p-1 pr-2">
                                            {hiddenUserOptions.map((option) => (
                                                <Button
                                                    key={option.value}
                                                    type="button"
                                                    variant="ghost"
                                                    className="h-auto justify-start p-0"
                                                    onClick={() => {
                                                        void onAddFeedHiddenUser(
                                                            option.value
                                                        );
                                                        setHiddenUserPickerOpen(
                                                            false
                                                        );
                                                        setHiddenUserSearch('');
                                                    }}
                                                >
                                                    <UserPickerRow
                                                        option={option}
                                                        showSelection={false}
                                                    />
                                                </Button>
                                            ))}
                                            {!hiddenUserOptions.length ? (
                                                <div className="text-muted-foreground p-3 text-xs">
                                                    {t(
                                                        'common.search_no_results'
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </PopoverContent>
                        </Popover>
                        {hiddenFeedUserOptions.length ? (
                            <div className="flex flex-col rounded-md border">
                                {hiddenFeedUserOptions.map((option) => {
                                    const imageUrl = option.user
                                        ? userImage(option.user, true, '64')
                                        : '';
                                    return (
                                        <div
                                            key={option.value}
                                            className="flex items-center gap-2 px-2 py-1"
                                        >
                                            <span className="bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
                                                {imageUrl ? (
                                                    <img
                                                        src={imageUrl}
                                                        alt=""
                                                        loading="lazy"
                                                        className="size-full object-cover"
                                                    />
                                                ) : (
                                                    <UserIcon className="text-muted-foreground size-3" />
                                                )}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-sm">
                                                {option.label}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7 shrink-0"
                                                aria-label={t(
                                                    'view.settings.social.hidden_feed.remove'
                                                )}
                                                onClick={() =>
                                                    void onRemoveFeedHiddenUser(
                                                        option.value
                                                    )
                                                }
                                            >
                                                <XIcon data-icon="icon" />
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                                {t('view.settings.social.hidden_feed.empty')}
                            </div>
                        )}
                    </div>
                </Field>
            </SettingsGroup>
            <SettingsGroup title={t('view.settings.social.favorites.header')}>
                <Field
                    label={t('view.settings.general.favorites.header')}
                    description={t(
                        'view.settings.general.favorites.header_tooltip'
                    )}
                >
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-56 justify-between"
                            >
                                <span className="truncate">
                                    {favoriteGroupLabel}
                                </span>
                                <ChevronDownIcon
                                    data-icon="inline-end"
                                    className="opacity-50"
                                />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            {favoriteFriendGroupOptions.length ? (
                                <>
                                    <DropdownMenuGroup>
                                        {remoteFavoriteFriendGroupOptions.map(
                                            (group) => (
                                                <DropdownMenuCheckboxItem
                                                    key={group.value}
                                                    checked={localFavoriteFriendsGroups.includes(
                                                        group.value
                                                    )}
                                                    onSelect={(event) =>
                                                        event.preventDefault()
                                                    }
                                                    onCheckedChange={(
                                                        checked
                                                    ) =>
                                                        onToggleLocalFavoriteFriendsGroup(
                                                            group.value,
                                                            checked
                                                        )
                                                    }
                                                >
                                                    {group.label}
                                                </DropdownMenuCheckboxItem>
                                            )
                                        )}
                                    </DropdownMenuGroup>
                                    {remoteFavoriteFriendGroupOptions.length &&
                                    localFavoriteFriendGroupOptions.length ? (
                                        <DropdownMenuSeparator />
                                    ) : null}
                                    <DropdownMenuGroup>
                                        {localFavoriteFriendGroupOptions.map(
                                            (group) => (
                                                <DropdownMenuCheckboxItem
                                                    key={group.value}
                                                    checked={localFavoriteFriendsGroups.includes(
                                                        group.value
                                                    )}
                                                    onSelect={(event) =>
                                                        event.preventDefault()
                                                    }
                                                    onCheckedChange={(
                                                        checked
                                                    ) =>
                                                        onToggleLocalFavoriteFriendsGroup(
                                                            group.value,
                                                            checked
                                                        )
                                                    }
                                                >
                                                    {group.label}
                                                </DropdownMenuCheckboxItem>
                                            )
                                        )}
                                    </DropdownMenuGroup>
                                </>
                            ) : (
                                <div className="text-muted-foreground px-2 py-1.5 text-sm">
                                    {t(
                                        'view.settings.general.favorites.group_placeholder'
                                    )}
                                </div>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </Field>
            </SettingsGroup>
        </SettingsTabContent>
    );
}
