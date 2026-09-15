import type { LoadStatus } from '@/domain/shared/types';
import type {
    CurrentUserPresenceGameState,
    CurrentUserPresenceRecord
} from '@/shared/utils/currentUserPresence';

export type UserDialogProfileRecord = CurrentUserPresenceRecord & {
    id?: string;
    userId?: string;
    user_id?: string;
    targetUserId?: string;
    target_user_id?: string;
    displayName?: string;
    display_name?: string;
    username?: string;
    name?: string;
    currentAvatar?: string;
    currentAvatarName?: string;
    avatarName?: string;
    currentAvatarImageUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    profilePicOverride?: string;
    profilePicOverrideThumbnail?: string;
};

export type UserDialogProfileSnapshot = UserDialogProfileRecord | null;

export type UserDialogAvatarRecord = Record<string, unknown> & {
    id?: string | null;
    name?: string | null;
    imageUrl?: string | null;
    thumbnailImageUrl?: string | null;
    avatarName?: string | null;
};

export type UserDialogProfileLoadStatus = LoadStatus;

export type ActiveUserTarget = {
    userId: string;
    endpoint?: string;
};

type UserDialogGameStateInput = Omit<
    CurrentUserPresenceGameState,
    'isGameRunning'
> & {
    isGameRunning?: boolean | null;
};

export type UseUserDialogProfileResourceInput = {
    activitySnapshot?: unknown;
    currentEndpoint?: string;
    currentUserSnapshot?: UserDialogProfileRecord | null;
    gameState?: UserDialogGameStateInput | null;
    isFriend?: boolean;
    isTargetCurrentUser: boolean;
    localSnapshot?: unknown;
    normalizedUserId: string;
    updateEntityDialogMetadata: (metadata: {
        kind: 'user';
        entityId: string;
        title: string;
    }) => void;
};
