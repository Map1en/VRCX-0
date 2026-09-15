import type { LucideIcon } from 'lucide-react';

import type {
    FriendProfileFields,
    FriendRecordInput
} from '@/domain/friends/types';
import type {
    CurrentInstanceRosterContext,
    CurrentInstanceRosterPlayer
} from '@/domain/instances/currentInstanceRoster';
import type { LocalModerationOutput } from '@/platform/tauri/bindings';

export type PlayerListRecord = Record<string, unknown>;
export type PlayerListRosterRow = Partial<CurrentInstanceRosterPlayer>;

export type PlayerListLanguageRow = {
    key: string;
    value?: string;
};

type PlayerListModerationRecord = PlayerListRecord & {
    block?: boolean;
    mute?: boolean;
    timeoutTime?: number | null;
    isAvatarInteractionDisabled?: boolean;
    isChatBoxMuted?: boolean;
    isBlocked?: boolean;
    isMuted?: boolean;
};

export type PlayerListLocalModerationRecord = Pick<
    LocalModerationOutput,
    'userId' | 'block' | 'mute'
>;

export type PlayerListProfileRecord = FriendRecordInput &
    Partial<FriendProfileFields> & {
        thumbnailUrl?: string | null;
        $languages?: string[];
        languages?: string[];
        note?: string | null;
        memo?: string | null;
        $moderations?: PlayerListModerationRecord | null;
        moderations?: PlayerListModerationRecord | null;
        stateBucket?: string;
        isFriend?: boolean;
        isChatBoxMuted?: boolean;
        timeoutTime?: number | null;
        worldId?: string;
    };

export type PlayerListCurrentUserSnapshot = PlayerListProfileRecord & {
    displayName?: string;
    username?: string;
};

export type PlayerListSourceRow = PlayerListRecord &
    PlayerListRosterRow & {
        rowId?: string;
        user_id?: string;
        username?: string;
        inVRMode?: boolean | null;
        isMaster?: boolean;
        isModerator?: boolean;
        isBlocked?: boolean;
        isMuted?: boolean;
        isChatBoxMuted?: boolean;
        ageVerified?: boolean;
        ageVerificationStatus?: string;
        timeoutTime?: number;
        ref?: PlayerListProfileRecord | null;
    };

export type PlayerListContext = Partial<CurrentInstanceRosterContext>;

export type PlayerListRow = PlayerListSourceRow & {
    displayName: string;
    userId: string;
    userRef: PlayerListProfileRecord | null;
    trustLevel: string;
    trustSortNum: number;
    trustClass: string;
    platformLabel: string;
    platformIcon: LucideIcon | null;
    platformClassName: string;
    inVRMode: boolean | null;
    status: string;
    statusDescription: string;
    languages: PlayerListLanguageRow[];
    bioLinks: string[];
    note: string;
    avatarUrl: string;
    isCurrentUser: boolean;
    isFriend: boolean;
    isFavorite: boolean;
    isBlocked: boolean;
    isMuted: boolean;
    isAvatarInteractionDisabled: boolean;
    isChatBoxMuted: boolean;
    timeoutTime: number;
    moderationSeverity: 'blocked' | 'muted' | '';
    ageVerified: boolean;
    timerMs: number;
    worldName: string;
    location: string;
};
