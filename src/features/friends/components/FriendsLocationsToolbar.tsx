// @ts-nocheck
import { SearchIcon, Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

import { FRIENDS_LOCATIONS_DENSITY_OPTIONS } from '../friendsLocationsDensity.js';

export function FriendsLocationsToolbar({ controller }) {
    const { t } = useTranslation();
    const {
        activeSegment,
        segmentOptions,
        searchQuery,
        showSameInstance,
        density,
        setActiveSegment,
        setSearchQuery,
        changeShowSameInstance,
        changeDensityPreference
    } = controller;

    return (
        <div className="friend-view__toolbar mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
                <Tabs
                    value={activeSegment}
                    onValueChange={setActiveSegment}
                    className="gap-0"
                >
                    <TabsList>
                        {segmentOptions.map((segment) => (
                            <TabsTrigger
                                key={segment.value}
                                value={segment.value}
                            >
                                {t(segment.labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                <InputGroup className="w-full max-w-md lg:ml-auto">
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t(
                            'view.friends_locations.search_placeholder'
                        )}
                    />
                </InputGroup>
            </div>

            <Popover>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t('common.settings')}
                            >
                                <Settings2Icon data-icon="inline-start" />
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{t('common.settings')}</TooltipContent>
                </Tooltip>
                <PopoverContent className="w-72" align="end">
                    <FieldGroup>
                        <Field orientation="horizontal">
                            <FieldContent>
                                <FieldLabel htmlFor="friends-locations-same-instance">
                                    {t(
                                        'view.friends_locations.separate_same_instance_friends'
                                    )}
                                </FieldLabel>
                            </FieldContent>
                            <Switch
                                id="friends-locations-same-instance"
                                checked={showSameInstance}
                                onCheckedChange={changeShowSameInstance}
                            />
                        </Field>
                        <Field>
                            <FieldContent>
                                <FieldLabel>
                                    {t('view.friends_locations.density')}
                                </FieldLabel>
                            </FieldContent>
                            <ToggleGroup
                                type="single"
                                variant="outline"
                                size="sm"
                                spacing={1}
                                value={density}
                                onValueChange={(nextValue) => {
                                    if (nextValue) {
                                        changeDensityPreference(nextValue);
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
        </div>
    );
}
