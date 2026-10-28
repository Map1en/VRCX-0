import {
    ChevronDownIcon,
    ChevronsUpDownIcon,
    UserIcon,
    XIcon
} from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { FadeInImage } from '@/components/media/FadeInImage';
import { UserPickerRow } from '@/components/search/UserPickerRow';
import { normalizeEndpoint, normalizeUserId } from '@/domain/users/userFacts';
import { useKnownUserFacts } from '@/lib/useKnownUser';
import {
    knownUserName,
    useKnownUserOptions,
    type KnownUserOption
} from '@/lib/useKnownUserOptions';
import { userImage } from '@/services/entityMediaService';
import { MINUTES_PER_DAY } from '@/shared/constants/time';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
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
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

type UserOption = {
    value: string;
    label: string;
    user: KnownUserOption;
};

export function SettingsSocialTab() {
    const social = useSettingsPageSection('social');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            recentActionCooldownEnabled: state.recentActionCooldownEnabled,
            recentActionCooldownMinutes: state.recentActionCooldownMinutes,
            autoDeclineFriendRequests: state.autoDeclineFriendRequests,
            hideUnfriends: state.hideUnfriends,
            profileBioScanEnabled: state.profileBioScanEnabled,
            feedHiddenUsersHideNotifications:
                state.feedHiddenUsersHideNotifications,
            feedHiddenUsersHideAll: state.feedHiddenUsersHideAll,
            hidePrivateFromFeed: state.hidePrivateFromFeed
        }))
    );
    const {
        selectedFavoriteFriendGroupLabel,
        favoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        localFavoriteFriendsGroups,
        feedHiddenUsers = [],
        onAddFeedHiddenUser,
        onAutoDeclineFriendRequestsChange,
        onFeedHiddenUsersHideAllChange,
        onFeedHiddenUsersHideNotificationsChange,
        onHidePrivateFromFeedChange,
        onHideUnfriendsChange,
        onProfileBioScanEnabledChange,
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
    const knownUsers = useKnownUserOptions({
        enabled: hiddenUserPickerOpen,
        endpoint,
        excludeUserId: currentUserId,
        query: hiddenUserSearch
    });
    const hiddenUserFacts = useKnownUserFacts(feedHiddenUsers, { endpoint });
    const hiddenUserOptions = useMemo(
        () =>
            knownUsers
                .map((user): UserOption => ({
                    value: normalizeUserId(user.id),
                    label:
                        knownUserName(user) ||
                        t('view.settings.social.hidden_feed.unknown_friend'),
                    user
                }))
                .filter(
                    (option) => option.value && !hiddenUserIds.has(option.value)
                ),
        [hiddenUserIds, knownUsers, t]
    );
    const hiddenFeedUserOptions = useMemo(
        () =>
            feedHiddenUsers.map((userId): UserOption => {
                const knownUser = hiddenUserFacts[userId];
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
        [endpoint, feedHiddenUsers, hiddenUserFacts]
    );

    return (
        <SettingsTabContent value="social">
            <SettingsCard
                cardId="social.interaction"
                title={t('view.settings.social.interaction.header')}
            >
                <Field
                    settingId="social.interaction.recent-action-cooldown"
                    onReset={() =>
                        onRecentActionCooldownEnabledChange(
                            SETTINGS_DEFAULT_VALUES.recentActionCooldownEnabled
                        )
                    }
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
                            <NumberField
                                min={1}
                                max={MINUTES_PER_DAY}
                                allowOutOfRange
                                className="w-36"
                                value={prefs.recentActionCooldownMinutes}
                                onValueChange={(value) =>
                                    onRecentActionCooldownMinutesChange(
                                        value === null ? '' : String(value)
                                    )
                                }
                                onValueCommitted={(value) =>
                                    onRecentActionCooldownMinutesBlur(
                                        value === null ? '' : String(value)
                                    )
                                }
                            >
                                <NumberFieldGroup>
                                    <NumberFieldDecrement />
                                    <NumberFieldInput />
                                    <NumberFieldIncrement />
                                </NumberFieldGroup>
                            </NumberField>
                        ) : null}
                    </div>
                </Field>
                <Field
                    settingId="social.interaction.auto-decline-friend-requests"
                    onReset={() =>
                        onAutoDeclineFriendRequestsChange(
                            SETTINGS_DEFAULT_VALUES.autoDeclineFriendRequests
                        )
                    }
                    label={t(
                        'view.settings.social.interaction.auto_decline_friend_requests'
                    )}
                    description={t(
                        'view.settings.social.interaction.auto_decline_friend_requests_description'
                    )}
                >
                    <Switch
                        checked={prefs.autoDeclineFriendRequests}
                        onCheckedChange={onAutoDeclineFriendRequestsChange}
                    />
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="social.friend-log"
                title={t('view.settings.appearance.friend_log.header')}
            >
                <Field
                    settingId="social.friend-log.hide-unfriends"
                    onReset={() =>
                        onHideUnfriendsChange(
                            SETTINGS_DEFAULT_VALUES.hideUnfriends
                        )
                    }
                    label={t(
                        'view.settings.appearance.friend_log.hide_unfriends'
                    )}
                >
                    <Switch
                        checked={prefs.hideUnfriends}
                        onCheckedChange={onHideUnfriendsChange}
                    />
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="social.friend-bios"
                title={t('view.settings.social.friend_bios.header')}
            >
                <Field
                    settingId="social.friend-bios.keep-up-to-date"
                    onReset={() =>
                        onProfileBioScanEnabledChange(
                            SETTINGS_DEFAULT_VALUES.profileBioScanEnabled
                        )
                    }
                    label={t(
                        'view.settings.social.friend_bios.keep_up_to_date'
                    )}
                    description={t(
                        'view.settings.social.friend_bios.description'
                    )}
                >
                    <Switch
                        checked={prefs.profileBioScanEnabled}
                        onCheckedChange={onProfileBioScanEnabledChange}
                    />
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="social.hidden-feed"
                title={t('view.settings.social.hidden_feed.header')}
            >
                <Field
                    settingId="social.hidden-feed.users"
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
                            <PopoverTrigger
                                render={
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
                                }
                            />
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
                                                        'empty_state.search_no_results'
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
                                        ? userImage(option.user, 64)
                                        : '';
                                    return (
                                        <div
                                            key={option.value}
                                            className="flex items-center gap-2 px-2 py-1"
                                        >
                                            <span className="bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
                                                {imageUrl ? (
                                                    <FadeInImage
                                                        src={imageUrl}
                                                        alt=""
                                                        loading="lazy"
                                                        className="size-full object-cover"
                                                        fallback={
                                                            <UserIcon className="text-muted-foreground size-3" />
                                                        }
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
                <Field
                    settingId="social.hidden-feed.hide-all"
                    onReset={() =>
                        onFeedHiddenUsersHideAllChange(
                            SETTINGS_DEFAULT_VALUES.feedHiddenUsersHideAll
                        )
                    }
                    label={t('view.settings.social.hidden_feed.hide_all')}
                    description={t(
                        'view.settings.social.hidden_feed.hide_all_description'
                    )}
                >
                    <Switch
                        checked={prefs.feedHiddenUsersHideAll}
                        onCheckedChange={onFeedHiddenUsersHideAllChange}
                    />
                </Field>
                <Field
                    settingId="social.hidden-feed.hide-notifications"
                    onReset={() =>
                        onFeedHiddenUsersHideNotificationsChange(
                            SETTINGS_DEFAULT_VALUES.feedHiddenUsersHideNotifications
                        )
                    }
                    label={t(
                        'view.settings.social.hidden_feed.hide_notifications'
                    )}
                    description={t(
                        'view.settings.social.hidden_feed.hide_notifications_description'
                    )}
                >
                    <Switch
                        checked={prefs.feedHiddenUsersHideNotifications}
                        onCheckedChange={
                            onFeedHiddenUsersHideNotificationsChange
                        }
                    />
                </Field>
                <Field
                    settingId="social.hidden-feed.hide-private-location-changes"
                    onReset={() =>
                        onHidePrivateFromFeedChange(
                            SETTINGS_DEFAULT_VALUES.hidePrivateFromFeed
                        )
                    }
                    label={t(
                        'view.settings.social.hidden_feed.hide_private_location_changes'
                    )}
                    description={t(
                        'view.settings.social.hidden_feed.hide_private_location_changes_description'
                    )}
                >
                    <Switch
                        checked={prefs.hidePrivateFromFeed}
                        onCheckedChange={onHidePrivateFromFeedChange}
                    />
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="social.favorites"
                title={t('view.settings.social.favorites.header')}
            >
                <Field
                    settingId="social.favorites.local-friend-groups"
                    label={t('view.settings.general.favorites.header')}
                    description={t(
                        'view.settings.general.favorites.header_tooltip'
                    )}
                >
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
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
                            }
                        />
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
                                                    onClick={(event) =>
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
                                                    onClick={(event) =>
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
            </SettingsCard>
        </SettingsTabContent>
    );
}
