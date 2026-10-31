import { RotateCcwIcon, Settings2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MutualFriendsLayoutControls } from '@/components/mutual-friends/MutualFriendsLayoutControls';
import { FriendMultiSelectList } from '@/components/search/FriendMultiSelectList';
import type {
    MutualFriendPickerOption,
    MutualFriendsLayoutSettingKey,
    MutualFriendsLayoutSettings
} from '@/lib/mutual-friends/mutualFriendsTypes';
import { preserveAppTitleBarOnOpenChange } from '@/lib/overlayTitlebar';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger
} from '@/ui/shadcn/sheet';

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
    excludePickerOptions,
    excludedFriendIds,
    layoutSettings,
    nodeCount,
    onExcludedFriendIdsChange,
    onResetLayoutSettings,
    setLayoutSetting
}: {
    edgeCount: number;
    excludePickerOptions: MutualFriendPickerOption[];
    excludedFriendIds: string[];
    layoutSettings: MutualFriendsLayoutSettings;
    nodeCount: number;
    onExcludedFriendIdsChange: (next: string[]) => void;
    onResetLayoutSettings: () => void;
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
                                value={excludedFriendIds.length}
                            />
                        </div>

                        <Separator />

                        <section className="flex flex-col gap-4">
                            <div className="flex items-center justify-between gap-2">
                                <SectionLabel>
                                    {t(
                                        'view.charts.mutual_friend.settings.layout_section'
                                    )}
                                </SectionLabel>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    onClick={onResetLayoutSettings}
                                >
                                    <RotateCcwIcon data-icon="inline-start" />
                                    {t(
                                        'view.charts.mutual_friend.settings.reset_defaults'
                                    )}
                                </Button>
                            </div>
                            <MutualFriendsLayoutControls
                                layoutSettings={layoutSettings}
                                setLayoutSetting={setLayoutSetting}
                            />
                        </section>

                        <Separator />

                        <section className="flex flex-col gap-2">
                            <SectionLabel>
                                {t(
                                    'view.charts.mutual_friend.settings.exclude_friends'
                                )}
                            </SectionLabel>
                            <p className="text-muted-foreground text-xs">
                                {t(
                                    'view.charts.mutual_friend.settings.exclude_friends_help'
                                )}
                            </p>
                            <FriendMultiSelectList
                                options={excludePickerOptions}
                                values={excludedFriendIds}
                                onChange={onExcludedFriendIdsChange}
                                placeholder={t(
                                    'view.charts.mutual_friend.settings.exclude_friends_placeholder'
                                )}
                                emptyContent={t(
                                    'view.charts.empty.no_friends_match_this_search'
                                )}
                                listClassName="bg-muted/30 h-64"
                            />
                        </section>
                    </div>
                </div>

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
