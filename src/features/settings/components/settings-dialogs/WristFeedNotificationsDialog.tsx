import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildFeedFavoriteGroupOptions } from '@/features/feed/feedColumnScope';
import { tauriClient } from '@/platform/tauri/client';
import {
    DEFAULT_OVERLAY_ACTIVITY_FILTER_PROFILE,
    defaultOverlayActivityFilterProfileFromDefinitions,
    normalizeOverlayActivityFilterProfile,
    normalizeOverlayActivityFilterProfileWithDefinitions,
    normalizeOverlayActivityFilters,
    normalizeOverlayActivityFiltersWithDefinitions,
    overlayActivityCategoriesFromDefinitions,
    overlayActivityDefinitionByKeyFromDefinitions,
    overlayActivityRawTypesByCategoryFromDefinitions,
    overlayActivityTypeLabelKey,
    type OverlayActivityCategory,
    type OverlayActivityFilterProfilePreference,
    type OverlayActivityFavoriteGroupKeys,
    type OverlayActivityFiltersPreference,
    type OverlayActivityRule,
    type OverlayActivityScope,
    type OverlayActivityTypeDefinition
} from '@/shared/constants/overlayActivityFilters';
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

type WristFeedNotificationsDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    value: OverlayActivityFiltersPreference;
    onSave(
        value: OverlayActivityFiltersPreference,
        definitions: OverlayActivityTypeDefinition[]
    ): Promise<unknown>;
};

type VrNotificationsDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    value: OverlayActivityFilterProfilePreference;
    onSave(
        value: OverlayActivityFilterProfilePreference,
        definitions: OverlayActivityTypeDefinition[]
    ): Promise<unknown>;
};

type OverlayActivityFilterDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    titleKey: string;
    descriptionKey: string;
    value: OverlayActivityFilterProfilePreference;
    onSave(
        value: OverlayActivityFilterProfilePreference,
        definitions: OverlayActivityTypeDefinition[]
    ): Promise<unknown>;
};

function normalizeDraft(
    value: unknown,
    definitions: OverlayActivityTypeDefinition[]
) {
    return definitions.length
        ? normalizeOverlayActivityFilterProfileWithDefinitions(
              value,
              definitions
          )
        : normalizeOverlayActivityFilterProfile(value);
}

function scopeUsesFavoriteGroups(scope: OverlayActivityScope) {
    return scope === 'selectedFavorites';
}

function selectedGroupKeys(groupKeys: OverlayActivityFavoriteGroupKeys) {
    return Array.isArray(groupKeys) ? groupKeys : [];
}

export function WristFeedNotificationsDialog({
    open,
    onOpenChange,
    value,
    onSave
}: WristFeedNotificationsDialogProps) {
    const wristProfile = normalizeOverlayActivityFilters(value).wrist;
    return (
        <OverlayActivityFilterDialog
            open={open}
            onOpenChange={onOpenChange}
            titleKey="dialog.wrist_feed_notifications.title"
            descriptionKey="dialog.wrist_feed_notifications.description"
            value={{ version: 1, types: wristProfile.types }}
            onSave={async (profile, definitions) =>
                onSave(
                    normalizeOverlayActivityFiltersWithDefinitions(
                        {
                            version: 1,
                            wrist: {
                                types: profile.types
                            }
                        },
                        definitions
                    ),
                    definitions
                )
            }
        />
    );
}

export function VrNotificationsDialog({
    open,
    onOpenChange,
    value,
    onSave
}: VrNotificationsDialogProps) {
    return (
        <OverlayActivityFilterDialog
            open={open}
            onOpenChange={onOpenChange}
            titleKey="dialog.vr_notifications.title"
            descriptionKey="dialog.vr_notifications.description"
            value={value}
            onSave={onSave}
        />
    );
}

function OverlayActivityFilterDialog({
    open,
    onOpenChange,
    titleKey,
    descriptionKey,
    value,
    onSave
}: OverlayActivityFilterDialogProps) {
    const { t } = useTranslation();
    const [activityDefinitions, setActivityDefinitions] = useState<
        OverlayActivityTypeDefinition[]
    >([]);
    const [draft, setDraft] = useState(() => normalizeDraft(value, []));
    const [selectedCategory, setSelectedCategory] =
        useState<OverlayActivityCategory>('actionRequired');
    const favoriteFriendGroups = useFavoriteStore(
        (state: any) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state: any) => state.localFriendFavoriteGroups
    );
    const favoriteGroupOptions = useMemo(
        () =>
            buildFeedFavoriteGroupOptions({
                favoriteFriendGroups,
                localFriendFavoriteGroups
            }),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const activityCategories = useMemo(
        () => overlayActivityCategoriesFromDefinitions(activityDefinitions),
        [activityDefinitions]
    );
    const rawTypesByCategory = useMemo(
        () =>
            overlayActivityRawTypesByCategoryFromDefinitions(
                activityDefinitions
            ),
        [activityDefinitions]
    );
    const definitionByKey = useMemo(
        () => overlayActivityDefinitionByKeyFromDefinitions(activityDefinitions),
        [activityDefinitions]
    );

    useEffect(() => {
        if (open) {
            setDraft(normalizeDraft(value, activityDefinitions));
        }
    }, [activityDefinitions, open, value]);

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        tauriClient.app
            .OverlayActivityDefinitionsGet()
            .then((definitions) => {
                if (!cancelled) {
                    setActivityDefinitions(definitions);
                }
            })
            .catch((error) => {
                console.warn(
                    'Failed to load wrist activity definitions:',
                    error
                );
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

    function updateTypeRule(type: string, patch: Partial<OverlayActivityRule>) {
        setDraft((current) =>
            normalizeDraft(
                {
                    ...current,
                    types: {
                        ...current.types,
                        [type]: {
                            ...current.types[type],
                            ...patch
                        }
                    }
                },
                activityDefinitions
            )
        );
    }

    function toggleFavoriteGroup(type: string, groupKey: string) {
        const rule = draft.types[type];
        const currentGroupKeys = rule.favoriteGroupKeys;
        const currentSelectedGroups = selectedGroupKeys(currentGroupKeys);
        const nextSelectedGroups =
            currentGroupKeys === 'all'
                ? [groupKey]
                : currentSelectedGroups.includes(groupKey)
                  ? currentSelectedGroups.filter((entry) => entry !== groupKey)
                  : [...currentSelectedGroups, groupKey];
        updateTypeRule(type, {
            favoriteGroupKeys: nextSelectedGroups.length
                ? nextSelectedGroups
                : 'all'
        });
    }

    function toggleAllFavoriteGroups(type: string, checked: boolean) {
        updateTypeRule(type, {
            favoriteGroupKeys:
                checked || !favoriteGroupOptions.length
                    ? 'all'
                    : [favoriteGroupOptions[0].key]
        });
    }

    function favoriteGroupSummary(groupKeys: OverlayActivityFavoriteGroupKeys) {
        if (!favoriteGroupOptions.length) {
            return t('dialog.wrist_feed_notifications.favorite_groups.empty');
        }
        if (groupKeys === 'all') {
            return t(
                'dialog.wrist_feed_notifications.favorite_groups.all_groups'
            );
        }
        if (groupKeys.length === 1) {
            const group = favoriteGroupOptions.find(
                (entry) => entry.key === groupKeys[0]
            );
            return group?.label || groupKeys[0];
        }
        return t(
            'dialog.wrist_feed_notifications.favorite_groups.group_count',
            {
                count: groupKeys.length
            }
        );
    }

    async function saveDraft() {
        const saved = await onSave(
            normalizeDraft(draft, activityDefinitions),
            activityDefinitions
        );
        if (saved) {
            onOpenChange(false);
        }
    }

    function resetRecommended() {
        setDraft(
            normalizeDraft(
                activityDefinitions.length
                    ? defaultOverlayActivityFilterProfileFromDefinitions(
                          activityDefinitions
                      )
                    : DEFAULT_OVERLAY_ACTIVITY_FILTER_PROFILE,
                activityDefinitions
            )
        );
    }

    const selectedCategoryTypes = rawTypesByCategory[selectedCategory] || [];
    const definitionsLoaded = activityDefinitions.length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[85vh] w-[min(94vw,64rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t(titleKey)}</DialogTitle>
                    <DialogDescription>{t(descriptionKey)}</DialogDescription>
                </DialogHeader>

                <div className="grid h-[min(62vh,36rem)] min-h-0 grid-cols-[18rem_minmax(0,1fr)] gap-5 overflow-hidden">
                    <ScrollArea className="h-full border-r pr-3">
                        <FieldGroup className="gap-1">
                            {activityCategories.map((category) => (
                                <Button
                                    key={category}
                                    type="button"
                                    variant={
                                        selectedCategory === category
                                            ? 'secondary'
                                            : 'ghost'
                                    }
                                    className="h-auto w-full justify-between gap-3 px-3 py-2.5 text-left whitespace-normal"
                                    onClick={() =>
                                        setSelectedCategory(category)
                                    }
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
                                </Button>
                            ))}
                        </FieldGroup>
                    </ScrollArea>

                    <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
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
                                {selectedCategoryTypes.map((type) => {
                                    const definition =
                                        definitionByKey[type];
                                    if (!definition) {
                                        return null;
                                    }
                                    const rule = draft.types[type] || {
                                        scope: definition.defaultScope,
                                        favoriteGroupKeys: 'all'
                                    };
                                    const usesFavoriteGroups =
                                        scopeUsesFavoriteGroups(rule.scope);
                                    const selectedGroups = selectedGroupKeys(
                                        rule.favoriteGroupKeys
                                    );
                                    return (
                                        <Field
                                            key={type}
                                            orientation="horizontal"
                                            className="items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                                        >
                                            <FieldContent className="min-w-0">
                                                <FieldLabel className="truncate">
                                                    {t(
                                                        `dialog.wrist_feed_notifications.types.${overlayActivityTypeLabelKey(type)}`,
                                                        {
                                                            defaultValue: type
                                                        }
                                                    )}
                                                </FieldLabel>
                                            </FieldContent>

                                            <div className="grid w-full gap-2 sm:w-56">
                                                <Select
                                                    value={rule.scope}
                                                    onValueChange={(scope) =>
                                                        updateTypeRule(type, {
                                                            scope: scope as OverlayActivityScope
                                                        })
                                                    }
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
                                                                        {t(
                                                                            `dialog.wrist_feed_notifications.scopes.${scope}`
                                                                        )}
                                                                    </SelectItem>
                                                                )
                                                            )}
                                                        </SelectGroup>
                                                    </SelectContent>
                                                </Select>

                                                {usesFavoriteGroups ? (
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
                                                            rule.favoriteGroupKeys ===
                                                            'all'
                                                        }
                                                        summary={favoriteGroupSummary(
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
                                })}
                            </FieldGroup>
                        </ScrollArea>
                    </div>
                </div>

                <DialogFooter className="sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={resetRecommended}
                        disabled={!definitionsLoaded}
                    >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t('dialog.wrist_feed_notifications.reset_recommended')}
                    </Button>
                    <div className="flex gap-2">
                        <DialogClose asChild>
                            <Button type="button" variant="outline">
                                {t('common.actions.cancel')}
                            </Button>
                        </DialogClose>
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
    summary: string;
    onToggleAll(checked: boolean): void;
    onToggleGroup(groupKey: string): void;
};

function FavoriteGroupMenu({
    disabled,
    favoriteGroupOptions,
    selectedGroups,
    allFavoriteGroups,
    summary,
    onToggleAll,
    onToggleGroup
}: FavoriteGroupMenuProps) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="justify-between"
                    disabled={disabled}
                >
                    <span className="min-w-0 truncate">{summary}</span>
                    <ChevronDownIcon data-icon="inline-end" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>
                    {t(
                        'dialog.wrist_feed_notifications.favorite_groups.menu_label'
                    )}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                        checked={allFavoriteGroups}
                        onCheckedChange={(checked) =>
                            onToggleAll(Boolean(checked))
                        }
                        onSelect={(event) => event.preventDefault()}
                    >
                        {t(
                            'dialog.wrist_feed_notifications.favorite_groups.all_groups'
                        )}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuGroup>
                    {favoriteGroupOptions.map((group) => (
                        <DropdownMenuCheckboxItem
                            key={group.key}
                            checked={selectedGroups.includes(group.key)}
                            onCheckedChange={() => onToggleGroup(group.key)}
                            onSelect={(event) => event.preventDefault()}
                        >
                            {group.label}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
