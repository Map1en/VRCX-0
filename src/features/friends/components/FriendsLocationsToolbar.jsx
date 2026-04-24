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
import { Slider } from '@/ui/shadcn/slider';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

export function FriendsLocationsToolbar({ controller }) {
    const { t } = useTranslation();
    const {
        activeSegment,
        segmentOptions,
        searchQuery,
        showSameInstance,
        cardScale,
        spacingScale,
        setActiveSegment,
        setSearchQuery,
        changeShowSameInstance,
        changeCardScalePreference,
        changeSpacingScalePreference
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
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.settings')}
                        title={t('common.settings')}
                    >
                        <Settings2Icon data-icon="inline-start" />
                    </Button>
                </PopoverTrigger>
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
                                <FieldLabel htmlFor="friends-locations-card-scale">
                                    {t('view.friends_locations.scale')}
                                </FieldLabel>
                            </FieldContent>
                            <Slider
                                id="friends-locations-card-scale"
                                min={0.5}
                                max={1}
                                step={0.01}
                                value={[cardScale]}
                                onValueChange={([value]) =>
                                    changeCardScalePreference(value)
                                }
                            />
                            <div className="text-muted-foreground text-sm">
                                {Math.round(cardScale * 100)}%
                            </div>
                        </Field>

                        <Field>
                            <FieldContent>
                                <FieldLabel htmlFor="friends-locations-card-spacing">
                                    {t('view.friends_locations.spacing')}
                                </FieldLabel>
                            </FieldContent>
                            <Slider
                                id="friends-locations-card-spacing"
                                min={0.25}
                                max={1}
                                step={0.05}
                                value={[spacingScale]}
                                onValueChange={([value]) =>
                                    changeSpacingScalePreference(value)
                                }
                            />
                            <div className="text-muted-foreground text-sm">
                                {Math.round(spacingScale * 100)}%
                            </div>
                        </Field>
                    </FieldGroup>
                </PopoverContent>
            </Popover>
        </div>
    );
}
