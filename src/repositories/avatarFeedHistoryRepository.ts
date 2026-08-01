import {
    commands,
    type AvatarFeedCleanupOutcome
} from '@/platform/tauri/bindings';

export function cleanupAvatarFeedHistory(
    cutoffDate: string | null
): Promise<AvatarFeedCleanupOutcome> {
    return commands.appAvatarFeedHistoryCleanup(cutoffDate);
}

export default { cleanupAvatarFeedHistory };
