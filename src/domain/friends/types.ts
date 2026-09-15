import type { ParsedLocation } from '@/shared/utils/location';

import type { LoadStatus } from '../shared/types';

export type FriendRosterBucket = 'online' | 'active' | 'offline';
export type FriendStateBucketAuthority = 'explicit' | 'preserve';
type FriendRosterLoadStatus = LoadStatus;

export type FriendLocationProjection = Record<string, unknown> &
    Partial<ParsedLocation> & {
        location?: string;
    };

export type FriendProfileFields = {
    $location?: FriendLocationProjection | null;
    $location_at?: number | string | null;
    $previousLocation?: string | null;
    $previousLocation_at?: number | string | null;
    $travelingToLocation?: FriendLocationProjection | null;
    $travelingToTime?: number | string | null;
    ageVerificationStatus?: string | null;
    ageVerified?: boolean;
    allowAvatarCopying?: boolean;
    badges?: unknown[];
    bannerColor?: string | null;
    bannerType?: string | null;
    bannerUrl?: string | null;
    bio?: string | null;
    bioLinks?: string[];
    currentAvatarAuthorId?: string | null;
    currentAvatarImageUrl?: string | null;
    currentAvatarName?: string | null;
    currentAvatarTags?: string[];
    currentAvatarThumbnailImageUrl?: string | null;
    discordId?: string | null;
    friendKey?: string | null;
    iconFrame?: string | null;
    iconUrl?: string | null;
    profilePicOverride?: string | null;
    profilePicOverrideThumbnail?: string | null;
    status?: string | null;
    statusDescription?: string | null;
    userIcon?: string | null;
};

export type FriendRecordInput = Record<string, unknown> & {
    id?: string;
    userId?: string;
    user_id?: string;
    displayName?: string;
    username?: string;
    tags?: string[];
    developerType?: string;
    platform?: string;
    last_platform?: string;
    lastPlatform?: string;
    location?: string;
    state?: string;
    $trustLevel?: string;
    $friendNumber?: number;
    $trustClass?: string;
    $trustSortNum?: number;
    $isModerator?: boolean;
    $isTroll?: boolean;
    $isProbableTroll?: boolean;
    $platform?: string;
    $profileSource?: string;
};

export type FriendRecord = FriendRecordInput &
    FriendProfileFields & {
        id: string;
        displayName: string;
        tags: string[];
        state: FriendRosterBucket;
        $trustLevel: string;
        $friendNumber: number;
        $trustClass: string;
        $trustSortNum: number;
        $isModerator: boolean;
        $isTroll: boolean;
        $isProbableTroll: boolean;
        $platform: string;
    };

export type FriendRosterById = Record<string, FriendRecord>;
export type FriendRosterInputById = Record<string, FriendRecordInput>;

export type FriendRosterOrdering = {
    onlineIds: string[];
    activeIds: string[];
    offlineIds: string[];
    orderedFriendIds: string[];
};

type FriendRosterSnapshot = FriendRosterOrdering & {
    currentUserId: string | null;
    friendsById: FriendRosterById;
    detail?: string;
};

export type FriendRosterSnapshotInput = Partial<FriendRosterOrdering> & {
    currentUserId?: string | null;
    friendsById?: FriendRosterInputById | null;
    detail?: string;
};

export type FriendRosterSeedSnapshot = {
    currentUserId?: string | null;
    friendsById?: FriendRosterInputById | null;
    detail?: string;
};

export type FriendPatchEntry = {
    userId?: string;
    patch?: FriendRecordInput | null;
    stateBucketAuthority?: FriendStateBucketAuthority;
};

export type FriendRosterState = FriendRosterSnapshot & {
    loadStatus: FriendRosterLoadStatus;
    detail: string;
    lastLoadedAt: string | null;
};

export type FriendRosterStore = FriendRosterState & {
    setRosterLoading(currentUserId: string, detail?: string): void;
    setRosterReady(detail?: string): void;
    setRosterSeedSnapshot(snapshot: FriendRosterSeedSnapshot): void;
    setRosterSnapshot(snapshot: FriendRosterSnapshotInput): void;
    setRosterError(detail: string): void;
    applyFriendPatch(entry: FriendPatchEntry & { detail?: string }): void;
    applyFriendPatches(patches?: FriendPatchEntry[], detail?: string): void;
    removeFriend(userId: string, detail?: string): void;
    resetRoster(): void;
};
