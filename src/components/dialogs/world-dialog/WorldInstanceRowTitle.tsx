import type { ComponentProps } from 'react';

import {
    instanceLanguageBadges,
    instanceLanguageRows
} from '@/components/instances/instanceLanguages';
import { LanguageCodeBadge } from '@/components/language/LanguageCodeBadge';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { LocationWorld } from '@/components/LocationWorld';
import { parseLocation } from '@/shared/utils/location';

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
    const { languageOptionsMap } = useSpokenLanguageSelection(NO_LANGUAGE_KEYS);
    const languageBadges = instanceLanguageBadges(
        instanceLanguageRows(
            languageSource,
            (key) => languageOptionsMap.get(key)?.value
        )
    );
    const visibleBadges = languageBadges.slice(0, VISIBLE_LANGUAGE_BADGES);
    const hiddenBadges = languageBadges.slice(VISIBLE_LANGUAGE_BADGES);

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
            <span className="flex h-6 shrink-0 items-center">
                <RegionCodeBadge region={parseLocation(location).region} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-h-6 min-w-0 items-center gap-2">
                    {displayName ? (
                        <span
                            className="truncate text-sm font-medium"
                            title={displayName}
                        >
                            {displayName}
                        </span>
                    ) : (
                        locationLabel('min-w-0 text-sm')
                    )}
                    {visibleBadges.length ? (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                            {visibleBadges.map((badge) => (
                                <LanguageCodeBadge
                                    key={badge.code}
                                    code={badge.code}
                                    tooltip={badge.tooltip}
                                />
                            ))}
                            {hiddenBadges.length ? (
                                <LanguageCodeBadge
                                    code={`+${hiddenBadges.length}`}
                                    tooltip={hiddenBadges
                                        .map((badge) => badge.tooltip)
                                        .join(' · ')}
                                />
                            ) : null}
                        </span>
                    ) : null}
                </div>
                {displayName || tagText ? (
                    <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                        {displayName
                            ? locationLabel('min-w-0 shrink text-xs')
                            : null}
                        {tagText ? (
                            <span className="min-w-0 truncate" title={tagText}>
                                {tagText}
                            </span>
                        ) : null}
                    </div>
                ) : null}
                {description ? (
                    <p
                        className="text-muted-foreground line-clamp-2 text-xs break-words whitespace-pre-line"
                        title={description}
                    >
                        {description}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
