import { ChevronDownIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField.jsx';
import { SettingsTabContent } from '../SettingsViewParts.jsx';

export function SettingsSocialTab({
    t,
    prefs,
    selectedFavoriteFriendGroupLabel,
    favoriteFriendGroupOptions,
    remoteFavoriteFriendGroupOptions,
    localFavoriteFriendGroupOptions,
    localFavoriteFriendsGroups,
    onRecentActionCooldownEnabledChange,
    onRecentActionCooldownMinutesChange,
    onRecentActionCooldownMinutesBlur,
    onToggleLocalFavoriteFriendsGroup
}) {
    return (
        <SettingsTabContent value="social">
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.social.interaction.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                                    max={1440}
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
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.social.favorites.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
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
                                        {selectedFavoriteFriendGroupLabel}
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
                </CardContent>
            </Card>
        </SettingsTabContent>
    );
}
