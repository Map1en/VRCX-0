import { FriendsLocationsPageLayout } from './components/FriendsLocationsPageView.jsx';
import { FriendsLocationsToolbar } from './components/FriendsLocationsToolbar.jsx';
import { FriendsLocationsVirtualList } from './components/FriendsLocationsVirtualList.jsx';
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
