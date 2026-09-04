import { RotateCcwIcon, Settings2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { UserPickerRow } from '@/components/search/UserPickerRow';
import { preserveAppTitleBarOnOpenChange } from '@/lib/overlayTitlebar';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Separator } from '@/ui/shadcn/separator';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger
} from '@/ui/shadcn/sheet';

import { MUTUAL_GRAPH_LAYOUT_LIMITS } from '../../mutual-friends/mutualFriendsSettings';
import type {
    MutualFriendPickerOption,
    MutualFriendsLayoutSettingKey,
    MutualFriendsLayoutSettings
} from '../../mutual-friends/mutualFriendsTypes';
import { CommitSlider } from './CommitSlider';

interface LayoutControl {
    key: MutualFriendsLayoutSettingKey;
    labelKey: string;
    helpKey: string;
    step: number;
    format: (value: number) => string;
}

const layoutControls: LayoutControl[] = [
    {
        key: 'layoutIterations',
        labelKey: 'view.charts.mutual_friend.settings.layout_iterations',
        helpKey: 'view.charts.mutual_friend.settings.layout_iterations_help',
        step: 100,
        format: (value) => String(value)
    },
    {
        key: 'layoutSpacing',
        labelKey: 'view.charts.mutual_friend.settings.layout_spacing',
        helpKey: 'view.charts.mutual_friend.settings.layout_spacing_help',
        step: 1,
        format: (value) => String(value)
    },
    {
        key: 'edgeCurvature',
        labelKey: 'view.charts.mutual_friend.settings.edge_curvature',
        helpKey: 'view.charts.mutual_friend.settings.edge_curvature_help',
        step: 0.01,
        format: (value) => value.toFixed(2)
    },
    {
        key: 'communitySeparation',
        labelKey: 'view.charts.mutual_friend.settings.community_separation',
        helpKey: 'view.charts.mutual_friend.settings.community_separation_help',
        step: 0.1,
        format: (value) => value.toFixed(1)
    }
];

function SettingsStat({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-muted/40 flex flex-col gap-1 rounded-md px-2.5 py-2">
            <span className="text-foreground text-base leading-none font-medium tabular-nums">
                {value}
            </span>
            <span className="text-muted-foreground text-xs">{label}</span>
        </div>
    );
}

function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <h3 className="text-muted-foreground text-xs font-medium tracking-wide">
            {children}
        </h3>
    );
}

export function MutualFriendsSettingsSheet({
    edgeCount,
    excludeSearchQuery,
    excludedCount,
    excludedFriendIdSet,
    filteredExcludeOptions,
    layoutSettings,
    nodeCount,
    onExcludeSearchQueryChange,
    onResetLayoutAndHidden,
    onToggleExcludedFriendId,
    setLayoutSetting
}: {
    edgeCount: number;
    excludeSearchQuery: string;
    excludedCount: number;
    excludedFriendIdSet: Set<string>;
    filteredExcludeOptions: MutualFriendPickerOption[];
    layoutSettings: MutualFriendsLayoutSettings;
    nodeCount: number;
    onExcludeSearchQueryChange: (value: string) => void;
    onResetLayoutAndHidden: () => void;
    onToggleExcludedFriendId: (friendId: string) => void;
    setLayoutSetting: (
        key: MutualFriendsLayoutSettingKey,
        value: number
    ) => void;
}) {
    const { t } = useTranslation();

    return (
        <Sheet
            modal="trap-focus"
            onOpenChange={(open, eventDetails) => {
                preserveAppTitleBarOnOpenChange(open, eventDetails);
            }}
        >
            <SheetTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t(
                            'view.charts.mutual_friend.settings.title'
                        )}
                    >
                        <Settings2Icon />
                    </Button>
                }
            />
            <SheetContent
                side="right"
                variant="inset"
                showCloseButton={false}
                className="w-90 gap-0"
            >
                <SheetHeader className="border-border/60 shrink-0 border-b">
                    <SheetTitle>
                        {t('view.charts.mutual_friend.settings.title')}
                    </SheetTitle>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="flex flex-col gap-5 p-4">
                        <div className="grid grid-cols-3 gap-1.5">
                            <SettingsStat
                                label={t(
                                    'view.charts.mutual_friend.settings.stat_nodes'
                                )}
                                value={nodeCount}
                            />
                            <SettingsStat
                                label={t(
                                    'view.charts.mutual_friend.settings.stat_links'
                                )}
                                value={edgeCount}
                            />
                            <SettingsStat
                                label={t(
                                    'view.charts.mutual_friend.settings.stat_hidden'
                                )}
                                value={excludedCount}
                            />
                        </div>

                        <Separator />

                        <section className="flex flex-col gap-4">
                            <SectionLabel>
                                {t(
                                    'view.charts.mutual_friend.settings.layout_section'
                                )}
                            </SectionLabel>
                            {layoutControls.map((control) => (
                                <CommitSlider
                                    key={control.key}
                                    label={t(control.labelKey)}
                                    help={t(control.helpKey)}
                                    format={control.format}
                                    min={
                                        MUTUAL_GRAPH_LAYOUT_LIMITS[control.key]
                                            .min
                                    }
                                    max={
                                        MUTUAL_GRAPH_LAYOUT_LIMITS[control.key]
                                            .max
                                    }
                                    step={control.step}
                                    value={layoutSettings[control.key]}
                                    onCommit={(next) =>
                                        setLayoutSetting(control.key, next)
                                    }
                                />
                            ))}
                        </section>

                        <Separator />

                        <section className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <SectionLabel>
                                    {t(
                                        'view.charts.mutual_friend.settings.exclude_friends'
                                    )}
                                </SectionLabel>
                                {excludedCount ? (
                                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs font-medium tabular-nums">
                                        {excludedCount}
                                    </span>
                                ) : null}
                            </div>
                            <p className="text-muted-foreground text-xs">
                                {t(
                                    'view.charts.mutual_friend.settings.exclude_friends_help'
                                )}
                            </p>
                            <Input
                                value={excludeSearchQuery}
                                onChange={(event) =>
                                    onExcludeSearchQueryChange(
                                        event.target.value
                                    )
                                }
                                placeholder={t(
                                    'view.charts.mutual_friend.settings.exclude_friends_placeholder'
                                )}
                            />
                            <ScrollArea className="bg-muted/30 h-64 rounded-md border">
                                <div className="flex flex-col gap-0.5 p-1 pr-2">
                                    {filteredExcludeOptions.map((option) => {
                                        const selected =
                                            excludedFriendIdSet.has(
                                                option.value
                                            );
                                        return (
                                            <Field
                                                key={option.value}
                                                orientation="horizontal"
                                                className="hover:bg-muted gap-0 rounded-md p-0 transition-colors duration-150 ease-out"
                                            >
                                                <Checkbox
                                                    id={`mutual-excluded-friend-${option.value}`}
                                                    checked={selected}
                                                    onCheckedChange={() =>
                                                        onToggleExcludedFriendId(
                                                            option.value
                                                        )
                                                    }
                                                    className="ml-2"
                                                />
                                                <FieldLabel
                                                    htmlFor={`mutual-excluded-friend-${option.value}`}
                                                    className="min-w-0 flex-1 cursor-pointer font-normal"
                                                >
                                                    <UserPickerRow
                                                        option={option}
                                                        selected={selected}
                                                        multiple
                                                        showSelection={false}
                                                    />
                                                </FieldLabel>
                                            </Field>
                                        );
                                    })}
                                    {!filteredExcludeOptions.length ? (
                                        <div className="text-muted-foreground p-3 text-xs">
                                            {t(
                                                'view.charts.empty.no_friends_match_this_search'
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            </ScrollArea>
                        </section>
                    </div>
                </div>

                <SheetFooter className="border-border/60 shrink-0 border-t">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onResetLayoutAndHidden}
                    >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t('view.charts.mutual_friend.settings.reset_defaults')}
                    </Button>
                </SheetFooter>

                <SheetClose
                    render={
                        <Button
                            variant="ghost"
                            className="absolute top-3 right-3"
                            size="icon-sm"
                        />
                    }
                >
                    <XIcon />
                    <span className="sr-only">{t('common.actions.close')}</span>
                </SheetClose>
            </SheetContent>
        </Sheet>
    );
}
