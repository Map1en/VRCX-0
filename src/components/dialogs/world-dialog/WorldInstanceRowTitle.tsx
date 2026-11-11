import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import {
    instanceLanguageBadges,
    instanceLanguageRows
} from '@/components/instances/instanceLanguages';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { LocationWorld } from '@/components/LocationWorld';
import { parseLocation } from '@/shared/utils/location';
import { HintTooltip } from '@/ui/hint-tooltip';

import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';

const NO_LANGUAGE_KEYS: string[] = [];
const VISIBLE_LANGUAGE_BADGES = 3;

export function WorldInstanceRowTitle({
    location,
    displayName,
    description,
    tags,
    languageSource,
    locationWorldProps
}: {
    location: string;
    displayName: string;
    description: string;
    tags: string[];
    languageSource: unknown;
    locationWorldProps: ComponentProps<typeof LocationWorld>;
}) {
    const { t } = useTranslation();
    const { languageOptionsMap } = useSpokenLanguageSelection(NO_LANGUAGE_KEYS);
    const languageBadges = instanceLanguageBadges(
        instanceLanguageRows(
            languageSource,
            (key) => languageOptionsMap.get(key)?.value
        ),
        {
            declared: (languages) =>
                t('dialog.world.instances.languages_declared', { languages }),
            current: (languages) =>
                t('dialog.world.instances.languages_current', { languages })
        }
    );
    const languageText = [
        ...languageBadges
            .slice(0, VISIBLE_LANGUAGE_BADGES)
            .map((badge) => badge.code),
        ...(languageBadges.length > VISIBLE_LANGUAGE_BADGES
            ? [`+${languageBadges.length - VISIBLE_LANGUAGE_BADGES}`]
            : [])
    ].join(' / ');
    const languageTooltip = languageBadges
        .map((badge) => badge.tooltip)
        .join(' · ');

    const tagText = tags.join(' · ');

    const locationLabel = (className: string) => (
        <LocationWorld
            {...locationWorldProps}
            showRegion={false}
            className={className}
        />
    );

    return (
        <div className="flex min-w-0 flex-1 items-start">
            <span className="flex h-6 w-8 shrink-0 items-center">
                <RegionCodeBadge
                    region={parseLocation(location).region}
                    className="text-muted-foreground/80 border-transparent bg-transparent px-0 text-[11px]"
                />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-h-6 min-w-0 items-center">
                    {displayName ? (
                        <span className="truncate text-sm font-medium">
                            {displayName}
                        </span>
                    ) : (
                        locationLabel('min-w-0 text-sm')
                    )}
                </div>
                {displayName || tagText || languageText ? (
                    <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                        {displayName
                            ? locationLabel(
                                  'min-w-0 shrink text-xs [&_button]:text-xs'
                              )
                            : null}
                        {tagText ? (
                            <span className="min-w-0 truncate">{tagText}</span>
                        ) : null}
                        {languageText ? (
                            <HintTooltip label={languageTooltip}>
                                <span className="shrink-0 text-[11px]">
                                    {languageText}
                                </span>
                            </HintTooltip>
                        ) : null}
                    </div>
                ) : null}
                {description ? (
                    <HintTooltip label={description}>
                        <p className="text-muted-foreground truncate text-xs">
                            {description}
                        </p>
                    </HintTooltip>
                ) : null}
            </div>
        </div>
    );
}
