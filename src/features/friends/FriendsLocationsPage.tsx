// @ts-nocheck
import { FriendsLocationsPageLayout } from './components/FriendsLocationsPageView';
import { FriendsLocationsToolbar } from './components/FriendsLocationsToolbar';
import { FriendsLocationsVirtualList } from './components/FriendsLocationsVirtualList';
import { useFriendsLocationsPageController } from './useFriendsLocationsPageController.js';

export function FriendsLocationsPage({ embedded = false } = {}) {
    const controller = useFriendsLocationsPageController({ embedded });

    return (
        <FriendsLocationsPageLayout embedded={controller.embedded}>
            <FriendsLocationsToolbar controller={controller} />
            <FriendsLocationsVirtualList controller={controller} />
        </FriendsLocationsPageLayout>
    );
}
