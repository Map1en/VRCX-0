import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildFeedFavoriteGroupOptions } from '@/domain/feed/feedFavoriteGroups';
import {
    commands,
    type ActivityCategory,
    type ActivityFilterProfile,
    type ActivityRule,
    type ActivityScope,
    type ActivityTypeDefinition,
    type SavedGroupCollection
} from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogClose,
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
    DropdownMenuLabel,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

type FavoriteGroupKeys = ActivityRule['favoriteGroupKeys'];
type DefaultScope = (definition: ActivityTypeDefinition) => ActivityScope;

function scopeUsesFavoriteGroups(scope: ActivityScope) {
    return scope === 'selectedFavorites';
}

function selectedGroupKeys(groupKeys: FavoriteGroupKeys) {
    return Array.isArray(groupKeys) ? groupKeys : [];
}

function activityTypeLabelKey(type: string) {
    return type.replace(/\./g, '_');
}

function recommendedProfile(
    definitions: ActivityTypeDefinition[],
    defaultScope: DefaultScope
): ActivityFilterProfile {
    return {
        version: 1,
        types: Object.fromEntries(
            definitions.map((definition) => [
                definition.key,
                { scope: defaultScope(definition), favoriteGroupKeys: 'all' }
            ])
        )
    };
}

type NotificationProfileDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    value: ActivityFilterProfile;
    onSave(
        value: ActivityFilterProfile
    ): Promise<ActivityFilterProfile | null | undefined>;
};

type ActivityFilterDialogProps = NotificationProfileDialogProps & {
    titleKey: string;
    descriptionKey: string;
    defaultScope: DefaultScope;
};

const wristDefaultScope: DefaultScope = (definition) =>
    definition.wristDefaultScope;
const alertDefaultScope: DefaultScope = (definition) =>
    definition.alertDefaultScope;

export function WristFeedNotificationsDialog(
    props: NotificationProfileDialogProps
) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.wrist_feed_notifications.title"
            descriptionKey="dialog.wrist_feed_notifications.description"
            defaultScope={wristDefaultScope}
        />
    );
}

export function VrNotificationsDialog(props: NotificationProfileDialogProps) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.vr_notifications.title"
            descriptionKey="dialog.vr_notifications.description"
            defaultScope={alertDefaultScope}
        />
    );
}

export function DesktopNotificationsDialog(
    props: NotificationProfileDialogProps
) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.desktop_notifications.title"
            descriptionKey="dialog.desktop_notifications.description"
            defaultScope={(definition) => definition.desktopDefaultScope}
        />
    );
}

export function DesktopWidgetActivityDialog(
    props: NotificationProfileDialogProps
) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.desktop_widget.title"
            descriptionKey="dialog.desktop_widget.description"
            defaultScope={(definition) => definition.widgetDefaultScope}
        />
    );
}

export function HmdNotificationsDialog(props: NotificationProfileDialogProps) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.hmd_notifications.title"
            descriptionKey="dialog.hmd_notifications.description"
            defaultScope={alertDefaultScope}
        />
    );
}

export function WebhookNotificationsDialog(
    props: NotificationProfileDialogProps
) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.webhook_notifications.title"
            descriptionKey="dialog.webhook_notifications.description"
            defaultScope={() => 'off'}
        />
    );
}

export function TtsNotificationsDialog(props: NotificationProfileDialogProps) {
    return (
        <ActivityFilterDialog
            {...props}
            titleKey="dialog.tts_notifications.title"
            descriptionKey="dialog.tts_notifications.description"
            defaultScope={(definition) => definition.ttsDefaultScope}
        />
    );
}

function ActivityFilterDialog({
    open,
    onOpenChange,
    titleKey,
    descriptionKey,
    value,
    defaultScope,
    onSave
}: ActivityFilterDialogProps) {
    const { t } = useTranslation();
    const [activityDefinitions, setActivityDefinitions] = useState<
        ActivityTypeDefinition[]
    >([]);
    const [draft, setDraft] = useState(value);
    const [selectedCategory, setSelectedCategory] =
        useState<ActivityCategory>('actionRequired');
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const friendFavoriteGroupOptions = useMemo(
        () =>
            buildFeedFavoriteGroupOptions({
                favoriteFriendGroups,
                localFriendFavoriteGroups
            }),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const [savedGroupCollections, setSavedGroupCollections] = useState<
        SavedGroupCollection[]
    >([]);
    const groupFavoriteGroupOptions = useMemo(
        () =>
            savedGroupCollections.map((collection) => ({
                key: `group:${collection.id}`,
                label: collection.name
            })),
        [savedGroupCollections]
    );

    function favoriteGroupOptionsForType(type: string) {
        return type === 'group.instanceOpened'
            ? groupFavoriteGroupOptions
            : friendFavoriteGroupOptions;
    }
    const definitionsByCategory = useMemo(() => {
        const grouped = new Map<ActivityCategory, ActivityTypeDefinition[]>();
        for (const definition of activityDefinitions) {
            grouped.set(definition.category, [
                ...(grouped.get(definition.category) ?? []),
                definition
            ]);
        }
        return grouped;
    }, [activityDefinitions]);
    const activityCategories = useMemo(
        () => [...definitionsByCategory.keys()],
        [definitionsByCategory]
    );

    useEffect(() => {
        if (open) {
            setDraft(value);
        }
    }, [open, value]);

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        commands
            .appOverlayActivityDefinitionsGet()
            .then((definitions) => {
                if (!cancelled) {
                    setActivityDefinitions(definitions);
                }
            })
            .catch((error) => {
                console.warn(
                    'Failed to load notification activity definitions:',
                    error
                );
            });
        commands
            .appSavedGroupFavoritesGet()
            .then((snapshot) => {
                if (!cancelled) {
                    setSavedGroupCollections(snapshot.collections);
                }
            })
            .catch((error) => {
                console.warn('Failed to load saved group collections:', error);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    useEffect(() => {
        if (
            activityCategories.length &&
            !activityCategories.includes(selectedCategory)
        ) {
            setSelectedCategory(activityCategories[0]);
        }
    }, [activityCategories, selectedCategory]);

    function updateTypeRule(type: string, patch: Partial<ActivityRule>) {
        setDraft((current) => {
            const currentRule: ActivityRule = current.types[type] ?? {
                scope: 'off',
                favoriteGroupKeys: 'all'
            };
            return {
                ...current,
                types: {
                    ...current.types,
                    [type]: { ...currentRule, ...patch }
                }
            };
        });
    }

    function toggleFavoriteGroup(type: string, groupKey: string) {
        const currentGroupKeys = draft.types[type]?.favoriteGroupKeys ?? 'all';
        const currentSelectedGroups = selectedGroupKeys(currentGroupKeys);
        const nextSelectedGroups =
            currentGroupKeys === 'all'
                ? [groupKey]
                : currentSelectedGroups.includes(groupKey)
                  ? currentSelectedGroups.filter((entry) => entry !== groupKey)
                  : [...currentSelectedGroups, groupKey];
        if (
            type === 'group.instanceOpened' &&
            nextSelectedGroups.length === 0
        ) {
            updateTypeRule(type, {
                scope: 'off',
                favoriteGroupKeys: 'all'
            });
            return;
        }
        updateTypeRule(type, {
            favoriteGroupKeys: nextSelectedGroups.length
                ? nextSelectedGroups
                : 'all'
        });
    }

    function toggleAllFavoriteGroups(type: string, checked: boolean) {
        const favoriteGroupOptions = favoriteGroupOptionsForType(type);
        updateTypeRule(type, {
            favoriteGroupKeys:
                checked || !favoriteGroupOptions.length
                    ? 'all'
                    : [favoriteGroupOptions[0].key]
        });
    }

    function favoriteGroupSummary(type: string, groupKeys: FavoriteGroupKeys) {
        const favoriteGroupOptions = favoriteGroupOptionsForType(type);
        if (!favoriteGroupOptions.length) {
            return type === 'group.instanceOpened'
                ? t('saved_group_favorites.notification_empty')
                : t('dialog.wrist_feed_notifications.favorite_groups.empty');
        }
        const selectedGroups = selectedGroupKeys(groupKeys);
        if (!selectedGroups.length) {
            return t(
                'dialog.wrist_feed_notifications.favorite_groups.all_groups'
            );
        }
        if (selectedGroups.length === 1) {
            const group = favoriteGroupOptions.find(
                (entry) => entry.key === selectedGroups[0]
            );
            return group?.label || selectedGroups[0];
        }
        return t(
            'dialog.wrist_feed_notifications.favorite_groups.group_count',
            {
                count: selectedGroups.length
            }
        );
    }

    async function saveDraft() {
        const saved = await onSave(draft);
        if (saved) {
            onOpenChange(false);
        }
    }

    function resetRecommended() {
        setDraft(recommendedProfile(activityDefinitions, defaultScope));
    }

    const selectedCategoryDefinitions =
        definitionsByCategory.get(selectedCategory) ?? [];
    const definitionsLoaded = activityDefinitions.length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[85vh] w-[min(94vw,64rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t(titleKey)}</DialogTitle>
                    <DialogDescription>{t(descriptionKey)}</DialogDescription>
                </DialogHeader>

                <Tabs
                    orientation="vertical"
                    value={selectedCategory}
                    onValueChange={(value) => {
                        const category = activityCategories.find(
                            (entry) => entry === value
                        );
                        if (category) setSelectedCategory(category);
                    }}
                    className="grid h-[min(62vh,36rem)] min-h-0 grid-cols-[18rem_minmax(0,1fr)] gap-5 overflow-hidden"
                >
                    <ScrollArea className="h-full border-r pr-3">
                        <TabsList className="h-fit w-full gap-1">
                            {activityCategories.map((category) => (
                                <TabsTrigger
                                    key={category}
                                    value={category}
                                    className="h-auto w-full justify-between gap-3 px-3 py-2.5 text-left whitespace-normal sm:h-auto"
                                >
                                    <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                                        <span className="font-medium">
                                            {t(
                                                `dialog.wrist_feed_notifications.categories.${category}.label`
                                            )}
                                        </span>
                                        <span className="text-muted-foreground line-clamp-2 text-xs font-normal">
                                            {t(
                                                `dialog.wrist_feed_notifications.categories.${category}.description`
                                            )}
                                        </span>
                                    </span>
                                    <ChevronRightIcon data-icon="inline-end" />
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </ScrollArea>

                    <TabsContent
                        value={selectedCategory}
                        className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3"
                    >
                        <div className="flex items-start justify-between gap-4 border-b pb-3">
                            <div className="flex min-w-0 flex-col gap-1">
                                <div className="font-semibold">
                                    {t(
                                        `dialog.wrist_feed_notifications.categories.${selectedCategory}.label`
                                    )}
                                </div>
                                <div className="text-muted-foreground text-sm">
                                    {t(
                                        `dialog.wrist_feed_notifications.categories.${selectedCategory}.description`
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1 pt-1">
                                    <Badge variant="secondary">
                                        {t(
                                            `dialog.wrist_feed_notifications.categories.${selectedCategory}.example`
                                        )}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        <ScrollArea className="min-h-0 pr-2">
                            <FieldGroup className="gap-0 rounded-lg border">
                                {selectedCategoryDefinitions.map(
                                    (definition) => {
                                        const type = definition.key;
                                        const rule = draft.types[type] ?? {
                                            scope: defaultScope(definition),
                                            favoriteGroupKeys: 'all'
                                        };
                                        const usesFavoriteGroups =
                                            scopeUsesFavoriteGroups(rule.scope);
                                        const selectedGroups =
                                            selectedGroupKeys(
                                                rule.favoriteGroupKeys
                                            );
                                        const groupInstanceType =
                                            type === 'group.instanceOpened';
                                        const favoriteGroupOptions =
                                            favoriteGroupOptionsForType(type);
                                        const scopeLabel = (
                                            scope: ActivityScope
                                        ) =>
                                            groupInstanceType &&
                                            scope === 'allFavorites'
                                                ? t(
                                                      'saved_group_favorites.scope_all',
                                                      {
                                                          defaultValue:
                                                              '全部收藏群组'
                                                      }
                                                  )
                                                : groupInstanceType &&
                                                    scope ===
                                                        'selectedFavorites'
                                                  ? t(
                                                        'saved_group_favorites.scope_selected',
                                                        {
                                                            defaultValue:
                                                                '指定收藏分组'
                                                        }
                                                    )
                                                  : t(
                                                        `dialog.wrist_feed_notifications.scopes.${scope}`
                                                    );
                                        return (
                                            <Field
                                                key={type}
                                                orientation="horizontal"
                                                className="items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                                            >
                                                <FieldContent className="min-w-0">
                                                    <FieldLabel className="truncate">
                                                        {groupInstanceType
                                                            ? t(
                                                                  'saved_group_favorites.notification_type'
                                                              )
                                                            : t(
                                                                  `dialog.wrist_feed_notifications.types.${activityTypeLabelKey(type)}`,
                                                                  {
                                                                      defaultValue:
                                                                          type
                                                                  }
                                                              )}
                                                    </FieldLabel>
                                                </FieldContent>

                                                <div className="grid w-full gap-2 sm:w-56">
                                                    <Select<ActivityScope>
                                                        value={rule.scope}
                                                        items={definition.allowedScopes.map(
                                                            (scope) => ({
                                                                value: scope,
                                                                label: scopeLabel(
                                                                    scope
                                                                )
                                                            })
                                                        )}
                                                        onValueChange={(
                                                            scope
                                                        ) => {
                                                            if (scope) {
                                                                if (
                                                                    groupInstanceType &&
                                                                    scope ===
                                                                        'selectedFavorites'
                                                                ) {
                                                                    const firstKey =
                                                                        favoriteGroupOptions[0]
                                                                            ?.key;
                                                                    updateTypeRule(
                                                                        type,
                                                                        firstKey
                                                                            ? {
                                                                                  scope,
                                                                                  favoriteGroupKeys:
                                                                                      [
                                                                                          firstKey
                                                                                      ]
                                                                              }
                                                                            : {
                                                                                  scope: 'off',
                                                                                  favoriteGroupKeys:
                                                                                      'all'
                                                                              }
                                                                    );
                                                                    return;
                                                                }
                                                                updateTypeRule(
                                                                    type,
                                                                    { scope }
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectGroup>
                                                                {definition.allowedScopes.map(
                                                                    (scope) => (
                                                                        <SelectItem
                                                                            key={
                                                                                scope
                                                                            }
                                                                            value={
                                                                                scope
                                                                            }
                                                                        >
                                                                            {scopeLabel(
                                                                                scope
                                                                            )}
                                                                        </SelectItem>
                                                                    )
                                                                )}
                                                            </SelectGroup>
                                                        </SelectContent>
                                                    </Select>
                                                    {usesFavoriteGroups &&
                                                    (!groupInstanceType ||
                                                        rule.scope ===
                                                            'selectedFavorites') ? (
                                                        <FavoriteGroupMenu
                                                            disabled={
                                                                !favoriteGroupOptions.length
                                                            }
                                                            favoriteGroupOptions={
                                                                favoriteGroupOptions
                                                            }
                                                            selectedGroups={
                                                                selectedGroups
                                                            }
                                                            allFavoriteGroups={
                                                                !groupInstanceType &&
                                                                rule.favoriteGroupKeys ===
                                                                    'all'
                                                            }
                                                            allowAllFavoriteGroups={
                                                                !groupInstanceType
                                                            }
                                                            summary={favoriteGroupSummary(
                                                                type,
                                                                rule.favoriteGroupKeys
                                                            )}
                                                            onToggleAll={(
                                                                checked
                                                            ) =>
                                                                toggleAllFavoriteGroups(
                                                                    type,
                                                                    checked
                                                                )
                                                            }
                                                            onToggleGroup={(
                                                                groupKey
                                                            ) =>
                                                                toggleFavoriteGroup(
                                                                    type,
                                                                    groupKey
                                                                )
                                                            }
                                                        />
                                                    ) : null}
                                                </div>
                                            </Field>
                                        );
                                    }
                                )}
                            </FieldGroup>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>

                <DialogFooter className="sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={resetRecommended}
                        disabled={!definitionsLoaded}
                    >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t('common.actions.reset')}
                    </Button>
                    <div className="flex gap-2">
                        <DialogClose
                            render={
                                <Button type="button" variant="outline">
                                    {t('common.actions.cancel')}
                                </Button>
                            }
                        />
                        <Button
                            type="button"
                            onClick={saveDraft}
                            disabled={!definitionsLoaded}
                        >
                            {t('common.actions.save')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

type FavoriteGroupMenuProps = {
    disabled: boolean;
    favoriteGroupOptions: Array<{ key: string; label: string }>;
    selectedGroups: string[];
    allFavoriteGroups: boolean;
    allowAllFavoriteGroups: boolean;
    summary: string;
    onToggleAll(checked: boolean): void;
    onToggleGroup(groupKey: string): void;
};

function FavoriteGroupMenu({
    disabled,
    favoriteGroupOptions,
    selectedGroups,
    allFavoriteGroups,
    allowAllFavoriteGroups,
    summary,
    onToggleAll,
    onToggleGroup
}: FavoriteGroupMenuProps) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="outline"
                        className="justify-between"
                        disabled={disabled}
                    >
                        <span className="min-w-0 truncate">{summary}</span>
                        <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>
                        {t(
                            'dialog.wrist_feed_notifications.favorite_groups.menu_label'
                        )}
                    </DropdownMenuLabel>
                    {allowAllFavoriteGroups ? (
                        <DropdownMenuCheckboxItem
                            checked={allFavoriteGroups}
                            onCheckedChange={(checked) =>
                                onToggleAll(Boolean(checked))
                            }
                            onClick={(event) => event.preventDefault()}
                        >
                            {t(
                                'dialog.wrist_feed_notifications.favorite_groups.all_groups'
                            )}
                        </DropdownMenuCheckboxItem>
                    ) : null}
                    {favoriteGroupOptions.map((group) => (
                        <DropdownMenuCheckboxItem
                            key={group.key}
                            checked={selectedGroups.includes(group.key)}
                            onCheckedChange={() => onToggleGroup(group.key)}
                            onClick={(event) => event.preventDefault()}
                        >
                            {group.label}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
