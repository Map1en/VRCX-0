import type { PrivacyLockSnapshot } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

export type PrivacyLockPhase = 'inactive' | 'pending' | 'locked' | 'unlocked';

export function resolvePrivacyLockPhase(
    currentUserId: string | null,
    snapshot: PrivacyLockSnapshot
): PrivacyLockPhase {
    if (!currentUserId) {
        return 'inactive';
    }
    if (snapshot.userId !== currentUserId) {
        return 'pending';
    }
    return snapshot.locked ? 'locked' : 'unlocked';
}

export function usePrivacyLockPhase(): PrivacyLockPhase {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const snapshot = useRuntimeStore((state) => state.privacyLock);
    return resolvePrivacyLockPhase(currentUserId, snapshot);
}

export function usePrivacyLockCovering(): boolean {
    const phase = usePrivacyLockPhase();
    return phase === 'pending' || phase === 'locked';
}
