import type { LucideIcon } from 'lucide-react';

import type { CurrentInstanceRosterContext } from '@/domain/instances/currentInstanceRoster';

export type PlayerListRecord = Record<string, unknown>;

export type PlayerListLanguageRow = {
    key: string;
    value?: string;
    label?: unknown;
    name?: unknown;
};

export type PlayerListModerationRecord = PlayerListRecord & {
    block?: unknown;
    mute?: unknown;
    timeoutTime?: unknown;
    isAvatarInteractionDisabled?: unknown;
    isChatBoxMuted?: unknown;
    isBlocked?: unknown;
    isMuted?: unknown;
};

export type PlayerListProfileRecord = PlayerListRecord & {
    id?: unknown;
    userId?: unknown;
    user_id?: unknown;
    displayName?: unknown;
    username?: unknown;
    tags?: unknown[];
    developerType?: unknown;
    $trustLevel?: unknown;
    $trustClass?: unknown;
    $trustSortNum?: unknown;
    $isModerator?: unknown;
    $isTroll?: unknown;
    $isProbableTroll?: unknown;
    $platform?: unknown;
    platform?: unknown;
    last_platform?: unknown;
    status?: unknown;
    statusDescription?: unknown;
    profilePicOverrideThumbnail?: unknown;
    profilePicOverride?: unknown;
    thumbnailUrl?: unknown;
    currentAvatarThumbnailImageUrl?: unknown;
    currentAvatarImageUrl?: unknown;
    userIcon?: unknown;
    $languages?: unknown[];
    languages?: unknown[];
    bioLinks?: unknown[];
    note?: unknown;
    memo?: unknown;
    $moderations?: PlayerListModerationRecord | null;
    moderations?: PlayerListModerationRecord | null;
    ageVerified?: unknown;
    ageVerificationStatus?: unknown;
    isFriend?: unknown;
    isChatBoxMuted?: unknown;
    timeoutTime?: unknown;
    location?: unknown;
    worldId?: unknown;
};

export type PlayerListSourceRow = PlayerListRecord & {
    id?: unknown;
    rowId?: unknown;
    userId?: unknown;
    user_id?: unknown;
    displayName?: unknown;
    username?: unknown;
    joinedAt?: unknown;
    joinedAtMs?: unknown;
    lastDurationMs?: unknown;
    inVRMode?: unknown;
    isMaster?: unknown;
    isModerator?: unknown;
    isBlocked?: unknown;
    isMuted?: unknown;
    isChatBoxMuted?: unknown;
    ageVerified?: unknown;
    ageVerificationStatus?: unknown;
    timeoutTime?: unknown;
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
    inVRMode: unknown;
    status: unknown;
    statusDescription: string;
    languages: PlayerListLanguageRow[];
    bioLinks: unknown[];
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
    worldName: unknown;
    location: unknown;
};
