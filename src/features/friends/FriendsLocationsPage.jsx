import { FriendsLocationsPageView } from './components/FriendsLocationsPageView.jsx';
import { useFriendsLocationsPageController } from './useFriendsLocationsPageController.js';

export function FriendsLocationsPage({ embedded = false } = {}) {
    const viewProps = useFriendsLocationsPageController({ embedded });

    return <FriendsLocationsPageView {...viewProps} />;
}
