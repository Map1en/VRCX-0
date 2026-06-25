import { useDialogStore } from '@/state/dialogStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useLaunchStore } from '@/state/launchStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useWorldDialogRuntimeState() {
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentHomeLocation = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.homeLocation || ''
    );
    const isGameRunning = useRuntimeStore((state: any) =>
        Boolean(state.gameState.isGameRunning)
    );
    const setAuthBootstrap = useRuntimeStore(
        (state: any) => state.setAuthBootstrap
    );
    const confirm = useModalStore((state: any) => state.confirm);
    const prompt = useModalStore((state: any) => state.prompt);
    const closeDialog = useDialogStore((state: any) => state.closeDialog);
    const updateEntityDialogMetadata = useDialogStore(
        (state: any) => state.updateEntityDialogMetadata
    );
    const showLaunchDialog = useLaunchStore(
        (state: any) => state.showLaunchDialog
    );

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
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const screenshotCacheStatus = useRuntimeStore(
        (state: any) => state.hostCapabilities.screenshotCache
    );
    const currentGameLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state: any) => state.gameState.currentLocationStartedAt
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );

    return {
        currentEndpoint,
        currentGameLocation,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        friendsById,
        openImagePreview,
        screenshotCacheStatus
    };
}
