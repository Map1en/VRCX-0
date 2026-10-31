import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import {
    getSettingsCard,
    getSettingsTabLabelKey,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';
import { usePreferencesStore } from '@/state/preferencesStore';

import { findDisabledAncestor } from '../settingsFieldState';

type SettingsSearchResultsProps = {
    results: readonly SettingsManifestEntry[];
    onSelect: (entry: SettingsManifestEntry) => void;
};

export function SettingsSearchResults({
    results,
    onSelect
}: SettingsSearchResultsProps) {
    const { t } = useTranslation();
    const blockingLabelKeys = usePreferencesStore(
        useShallow((state) =>
            results.map(
                (entry) => findDisabledAncestor(entry, state)?.labelKey ?? ''
            )
        )
    );

    if (!results.length) {
        return (
            <p className="text-muted-foreground px-3 py-6 text-sm">
                {t('view.settings.search.no_results')}
            </p>
        );
    }

    return (
        <ul
            aria-label={t('view.settings.search.results')}
            className="flex min-h-0 w-full max-w-[820px] flex-col gap-0.5 overflow-y-auto pb-4"
        >
            {results.map((entry, index) => {
                const tabLabelKey = getSettingsTabLabelKey(entry.tab);
                const cardTitleKey = getSettingsCard(entry.cardId)?.titleKey;
                const blockingLabelKey = blockingLabelKeys[index];
                return (
                    <li key={entry.id}>
                        <button
                            type="button"
                            data-setting-result={entry.id}
                            className="hover:bg-accent focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2"
                            onClick={() => onSelect(entry)}
                        >
                            <span className="text-sm">
                                <span className="text-muted-foreground">
                                    {tabLabelKey ? t(tabLabelKey) : entry.tab}
                                    {' · '}
                                    {cardTitleKey ? t(cardTitleKey) : null}
                                    {' · '}
                                </span>
                                <span className="font-medium">
                                    {t(entry.labelKey)}
                                </span>
                            </span>
                            {blockingLabelKey ? (
                                <span className="text-muted-foreground text-xs">
                                    {t('view.settings.field.requires_parent', {
                                        name: t(blockingLabelKey)
                                    })}
                                </span>
                            ) : null}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
