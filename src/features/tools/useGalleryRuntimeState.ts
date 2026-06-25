import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useGalleryRuntimeState() {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const profilePicOverride = currentUserSnapshot?.profilePicOverride || '';
    const userIcon = currentUserSnapshot?.userIcon || '';
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis.$debug?.debugVrcPlus
    );

    return {
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        isVrcPlusSupporter,
        openImagePreview,
        profilePicOverride,
        userIcon
    };
}
