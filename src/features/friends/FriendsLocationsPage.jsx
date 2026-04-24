import { FriendsLocationsPageLayout } from './components/FriendsLocationsPageView.jsx';
import { FriendsLocationsToolbar } from './components/FriendsLocationsToolbar.jsx';
import { FriendsLocationsVirtualList } from './components/FriendsLocationsVirtualList.jsx';
import { FriendsLocationsPageProvider } from './FriendsLocationsPageContext.jsx';

export function FriendsLocationsPage({ embedded = false } = {}) {
    return (
        <FriendsLocationsPageProvider embedded={embedded}>
            <FriendsLocationsPageLayout>
                <FriendsLocationsToolbar />
                <FriendsLocationsVirtualList />
            </FriendsLocationsPageLayout>
        </FriendsLocationsPageProvider>
    );
}
