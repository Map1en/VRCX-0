import { useFriendsLocationsPage } from '../FriendsLocationsPageContext.jsx';

export function FriendsLocationsPageLayout({ children }) {
    const { embedded } = useFriendsLocationsPage();

    return (
        <div
            className={
                embedded
                    ? 'friend-view flex h-full min-h-0 flex-col p-3'
                    : 'friend-view x-container flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4 pb-0'
            }
        >
            {children}
        </div>
    );
}
