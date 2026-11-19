import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ScreenshotFacet } from '@/platform/tauri/bindings';
import { getFriendLogHistory } from '@/repositories/friendLogHistoryRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { TileGridSection } from './useVirtualTileGrid';

export function groupScreenshotPeople(
    facets: readonly ScreenshotFacet[],
    currentUserId: string,
    friendIds: ReadonlySet<string>,
    unfriendedIds: ReadonlySet<string>
) {
    const friends: ScreenshotFacet[] = [];
    const formerFriends: ScreenshotFacet[] = [];
    const others: ScreenshotFacet[] = [];
    for (const facet of facets) {
        if (facet.id === currentUserId) {
            continue;
        }
        if (friendIds.has(facet.id)) {
            friends.push(facet);
        } else if (unfriendedIds.has(facet.id)) {
            formerFriends.push(facet);
        } else {
            others.push(facet);
        }
    }
    return { friends, formerFriends, others };
}

export function useScreenshotPeopleSections(
    facets: readonly ScreenshotFacet[],
    enabled: boolean
): TileGridSection<ScreenshotFacet>[] {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state) => state.auth.currentUserId ?? ''
    );
    const friendIdSignature = useFriendRosterStore((state) =>
        Object.keys(state.friendsById || {}).join(',')
    );
    const [unfriended, setUnfriended] = useState<{
        ownerUserId: string;
        ids: ReadonlySet<string>;
    } | null>(null);

    useEffect(() => {
        if (!enabled || !currentUserId) {
            return;
        }
        let active = true;
        getFriendLogHistory(currentUserId, { types: ['Unfriend'] })
            .then((rows) => {
                if (active) {
                    setUnfriended({
                        ownerUserId: currentUserId,
                        ids: new Set(rows.map((row) => row.userId))
                    });
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId, enabled]);

    return useMemo(() => {
        const friendIds = new Set(
            friendIdSignature ? friendIdSignature.split(',') : []
        );
        const unfriendedIds =
            unfriended?.ownerUserId === currentUserId
                ? unfriended.ids
                : new Set<string>();
        const { friends, formerFriends, others } = groupScreenshotPeople(
            facets,
            currentUserId,
            friendIds,
            unfriendedIds
        );
        return [
            {
                key: 'friends',
                label: t('dialog.screenshot_metadata.people_section_friends'),
                items: friends
            },
            {
                key: 'former-friends',
                label: t(
                    'dialog.screenshot_metadata.people_section_former_friends'
                ),
                items: formerFriends
            },
            {
                key: 'others',
                label: t('dialog.screenshot_metadata.people_section_others'),
                items: others
            }
        ].filter((section) => section.items.length > 0);
    }, [currentUserId, facets, friendIdSignature, t, unfriended]);
}
