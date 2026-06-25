import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useGroupDialogTabbedRuntimeState() {
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const prompt = useModalStore((state: any) => state.prompt);
    const confirm = useModalStore((state: any) => state.confirm);

    return {
        confirm,
        currentEndpoint,
        currentUserId,
        openImagePreview,
        prompt
    };
}
