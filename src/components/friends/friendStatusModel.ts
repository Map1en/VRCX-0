import { presenceDotClassName, presenceOf } from '@/domain/friends/presence';
import type {
    FriendProfileFields,
    FriendRecordInput
} from '@/domain/friends/types';

export type SidebarFriendRecord = FriendRecordInput &
    Partial<FriendProfileFields> & {
        $friendNumber?: number;
        $userColour?: string;
        created_at?: string;
        developerType?: string;
        displayName?: string;
        id?: string;
        last_activity?: string | number;
        last_login?: string | number;
        memberCount?: number;
        name?: string;
        tags?: string[];
        updated_at?: string;
        username?: string;
        isFriend?: boolean;
    };

type SidebarStatusOptions = {
    hideNonFriend?: boolean;
};

export function resolveSidebarStatusDotClassName(
    friend: SidebarFriendRecord | null | undefined,
    { hideNonFriend = true }: SidebarStatusOptions = {}
) {
    if (!friend || (hideNonFriend && friend.isFriend === false)) {
        return '';
    }
    return presenceDotClassName(presenceOf(friend), friend.status);
}
