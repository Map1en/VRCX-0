import { FriendListPageView } from './components/FriendListPageView.jsx';
import { useFriendListPageController } from './useFriendListPageController.js';

export function FriendListPage({ embedded = false } = {}) {
    const viewProps = useFriendListPageController({ embedded });

    return <FriendListPageView {...viewProps} />;
}
