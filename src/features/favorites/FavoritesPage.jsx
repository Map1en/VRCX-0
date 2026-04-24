import { FavoritesPageView } from './components/FavoritesPageView.jsx';
import { useFavoritesPageController } from './useFavoritesPageController.js';

function FavoritesPage({ kind, embedded = false }) {
    const viewProps = useFavoritesPageController({ kind, embedded });

    return <FavoritesPageView {...viewProps} />;
}

export function FavoriteFriendsPage(props) {
    return <FavoritesPage kind="friend" {...props} />;
}

export function FavoriteWorldsPage(props) {
    return <FavoritesPage kind="world" {...props} />;
}

export function FavoriteAvatarsPage(props) {
    return <FavoritesPage kind="avatar" {...props} />;
}
