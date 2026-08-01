import { useDialogStore } from '@/state/dialogStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useLaunchStore } from '@/state/launchStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useWorldDialogRuntimeState() {
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentHomeLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.homeLocation || ''
    );
    const isGameRunning = useRuntimeStore((state) =>
        Boolean(state.gameState.isGameRunning)
    );
    const setAuthBootstrap = useRuntimeStore((state) => state.setAuthBootstrap);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);

    return {
        closeDialog,
        confirm,
        currentEndpoint,
        currentHomeLocation,
        currentUserId,
        isGameRunning,
        prompt,
        setAuthBootstrap,
        showLaunchDialog,
        updateEntityDialogMetadata
    };
}

export function useWorldDialogTabbedRuntimeState() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const screenshotCacheStatus = useRuntimeStore(
        (state) => state.hostCapabilities.screenshotCache
    );
    const currentGameLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state) => state.gameState.currentLocationStartedAt
    );
    const currentLocationPlayers = useRuntimeStore(
        (state) => state.gameState.currentLocationPlayers
    );
    const currentWorldId = useRuntimeStore(
        (state) => state.gameState.currentWorldId
    );
    const currentWorldName = useRuntimeStore(
        (state) => state.gameState.currentWorldName
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const openImagePreview = useModalStore((state) => state.openImagePreview);

    return {
        currentEndpoint,
        currentGameLocation,
        currentLocationPlayers,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        currentWorldId,
        currentWorldName,
        friendsById,
        openImagePreview,
        screenshotCacheStatus
    };
}
