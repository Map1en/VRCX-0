import { PageScaffold } from '@/components/layout/PageScaffold';

import { FriendsLocationsToolbar } from './components/FriendsLocationsToolbar';
import { FriendsLocationsVirtualList } from './components/FriendsLocationsVirtualList';
import { useFriendsLocationsPageController } from './useFriendsLocationsPageController';

export function FriendsLocationsPage({
    embedded = false
}: {
    embedded?: boolean;
} = {}) {
    const { actions, derived, filters, load, preferences, runtime, scroll } =
        useFriendsLocationsPageController();

    return (
        <PageScaffold
            embedded={embedded}
            flushBottom={!embedded}
            className="friend-view flex-1"
        >
            <FriendsLocationsToolbar
                activeSegment={filters.activeSegment}
                segmentOptions={derived.segmentOptions}
                searchQuery={filters.searchQuery}
                showSameInstanceInOnline={preferences.showSameInstanceInOnline}
                density={preferences.density}
                onActiveSegmentChange={filters.setActiveSegment}
                onSearchQueryChange={filters.setSearchQuery}
                onShowSameInstanceInOnlineChange={
                    preferences.changeShowSameInstanceInOnline
                }
                onDensityChange={preferences.changeDensityPreference}
            />
            {preferences.preferencesReady ? (
                <FriendsLocationsVirtualList
                    derived={derived}
                    filters={filters}
                    load={load}
                    locationCommands={actions}
                    runtime={runtime}
                    scroll={scroll}
                />
            ) : null}
        </PageScaffold>
    );
}
