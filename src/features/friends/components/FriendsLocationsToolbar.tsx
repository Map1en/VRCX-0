import { SearchIcon, Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { FRIENDS_LOCATIONS_DENSITY_OPTIONS } from '../friendsLocationsDensity';

type FriendsLocationsSegmentOption = {
    value: string;
    labelKey: string;
    count: number;
};

type FriendsLocationsToolbarProps = {
    activeSegment: string;
    segmentOptions: FriendsLocationsSegmentOption[];
    searchQuery: string;
    showSameInstanceInOnline: boolean;
    density: string;
    onActiveSegmentChange: (value: string) => void;
    onSearchQueryChange: (value: string) => void;
    onShowSameInstanceInOnlineChange: (value: boolean) => void;
    onDensityChange: (value: string) => void;
};

export function FriendsLocationsToolbar({
    activeSegment,
    segmentOptions,
    searchQuery,
    showSameInstanceInOnline,
    density,
    onActiveSegmentChange,
    onSearchQueryChange,
    onShowSameInstanceInOnlineChange,
    onDensityChange
}: FriendsLocationsToolbarProps) {
    const { t } = useTranslation();

    return (
        <PageToolbar className="friend-view__toolbar mb-3">
            <PageToolbarRow className="flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex w-full min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
                    <Tabs
                        value={activeSegment}
                        onValueChange={onActiveSegmentChange}
                        className="h-9 gap-0"
                    >
                        <TabsList className="h-full! w-full">
                            {segmentOptions.map((segment) => (
                                <TabsTrigger
                                    key={segment.value}
                                    value={segment.value}
                                >
                                    <span>{t(segment.labelKey)}</span>
                                    <span className="text-muted-foreground tabular-nums">
                                        {segment.count}
                                    </span>
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>

                    <InputGroup className="h-9 w-full min-w-0 lg:flex-1">
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            value={searchQuery}
                            onChange={(event) =>
                                onSearchQueryChange(event.target.value)
                            }
                            placeholder={t(
                                'view.friends_locations.search_placeholder'
                            )}
                        />
                    </InputGroup>
                </div>

                <Popover>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <PopoverTrigger
                                    render={
                                        <Button
                                            type="button"
                                            size="icon-lg"
                                            variant="ghost"
                                            aria-label={t('common.settings')}
                                        >
                                            <Settings2Icon data-icon="inline-start" />
                                        </Button>
                                    }
                                />
                            }
                        />
                        <TooltipContent>{t('common.settings')}</TooltipContent>
                    </Tooltip>
                    <PopoverContent className="w-72" align="end">
                        <FieldGroup>
                            <Field orientation="horizontal">
                                <FieldContent>
                                    <FieldLabel htmlFor="friends-locations-same-instance">
                                        {t(
                                            'view.friends_locations.show_same_instance_in_online'
                                        )}
                                    </FieldLabel>
                                </FieldContent>
                                <Switch
                                    id="friends-locations-same-instance"
                                    checked={showSameInstanceInOnline}
                                    onCheckedChange={
                                        onShowSameInstanceInOnlineChange
                                    }
                                />
                            </Field>
                            <Field>
                                <FieldContent>
                                    <FieldLabel>
                                        {t('view.friends_locations.density')}
                                    </FieldLabel>
                                </FieldContent>
                                <ToggleGroup
                                    variant="outline"
                                    size="sm"
                                    spacing={1}
                                    value={density ? [density] : []}
                                    onValueChange={(nextValue) => {
                                        if (nextValue[0]) {
                                            onDensityChange(nextValue[0]);
                                        }
                                    }}
                                    className="grid w-full grid-cols-3"
                                >
                                    {FRIENDS_LOCATIONS_DENSITY_OPTIONS.map(
                                        (option) => (
                                            <ToggleGroupItem
                                                key={option.value}
                                                value={option.value}
                                                aria-label={t(option.labelKey)}
                                                className="w-full min-w-0 justify-center px-2"
                                            >
                                                <span className="truncate">
                                                    {t(option.labelKey)}
                                                </span>
                                            </ToggleGroupItem>
                                        )
                                    )}
                                </ToggleGroup>
                            </Field>
                        </FieldGroup>
                    </PopoverContent>
                </Popover>
            </PageToolbarRow>
        </PageToolbar>
    );
}
