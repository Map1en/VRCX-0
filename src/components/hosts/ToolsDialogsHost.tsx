import { InviteMessageTemplatesDialog } from '@/components/dialogs/InviteMessageDialog';
import { useRuntimeStore } from '@/state/runtimeStore';

import { AppLauncherDialog } from './tools-dialogs/AppLauncherDialog';
import {
    ExportAvatarsListDialog,
    ExportDiscordNamesDialog,
    ExportFriendsListDialog
} from './tools-dialogs/ExportListDialogs';
import { GroupCalendarDialog } from './tools-dialogs/GroupCalendarDialog';
import { LlmEndpointsDialog } from './tools-dialogs/LlmEndpointsDialog';
import { NoteExportDialog } from './tools-dialogs/NoteExportDialog';
import {
    PresenceInviteRequestsDialog,
    PresenceRoomRulesDialog,
    PresenceScheduleDialog
} from './tools-dialogs/presence-automation/PresenceAutomationDialog';
import { ProfileBackupDialog } from './tools-dialogs/ProfileBackupDialog';
import {
    getCurrentUserId,
    getEndpoint
} from './tools-dialogs/toolsDialogUtils';

export function ToolsDialogsHost() {
    const presenceScheduleOpen = useRuntimeStore(
        (state) => state.systemHosts.presenceScheduleOpen
    );
    const appLauncherOpen = useRuntimeStore(
        (state) => state.systemHosts.appLauncherOpen
    );
    const presenceRoomRulesOpen = useRuntimeStore(
        (state) => state.systemHosts.presenceRoomRulesOpen
    );
    const presenceInviteRequestsOpen = useRuntimeStore(
        (state) => state.systemHosts.presenceInviteRequestsOpen
    );
    const groupCalendarOpen = useRuntimeStore(
        (state) => state.systemHosts.groupCalendarOpen
    );
    const exportDiscordNamesOpen = useRuntimeStore(
        (state) => state.systemHosts.exportDiscordNamesOpen
    );
    const noteExportOpen = useRuntimeStore(
        (state) => state.systemHosts.noteExportOpen
    );
    const exportFriendsListOpen = useRuntimeStore(
        (state) => state.systemHosts.exportFriendsListOpen
    );
    const exportAvatarsListOpen = useRuntimeStore(
        (state) => state.systemHosts.exportAvatarsListOpen
    );
    const editInviteMessagesOpen = useRuntimeStore(
        (state) => state.systemHosts.editInviteMessagesOpen
    );
    const llmEndpointsOpen = useRuntimeStore(
        (state) => state.systemHosts.llmEndpointsOpen
    );
    const profileBackupOpen = useRuntimeStore(
        (state) => state.systemHosts.profileBackupOpen
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    return (
        <>
            <AppLauncherDialog
                open={Boolean(appLauncherOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('appLauncherOpen', open)
                }
            />
            <PresenceScheduleDialog
                open={Boolean(presenceScheduleOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('presenceScheduleOpen', open)
                }
            />
            <PresenceRoomRulesDialog
                open={Boolean(presenceRoomRulesOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('presenceRoomRulesOpen', open)
                }
            />
            <PresenceInviteRequestsDialog
                open={Boolean(presenceInviteRequestsOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('presenceInviteRequestsOpen', open)
                }
            />
            <GroupCalendarDialog
                open={Boolean(groupCalendarOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('groupCalendarOpen', open)
                }
            />
            <ExportDiscordNamesDialog
                open={Boolean(exportDiscordNamesOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('exportDiscordNamesOpen', open)
                }
            />
            <NoteExportDialog
                open={Boolean(noteExportOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('noteExportOpen', open)
                }
            />
            <ExportFriendsListDialog
                open={Boolean(exportFriendsListOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('exportFriendsListOpen', open)
                }
            />
            <ExportAvatarsListDialog
                open={Boolean(exportAvatarsListOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('exportAvatarsListOpen', open)
                }
            />
            <InviteMessageTemplatesDialog
                open={Boolean(editInviteMessagesOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('editInviteMessagesOpen', open)
                }
                currentUserId={getCurrentUserId()}
                endpoint={getEndpoint()}
            />
            <LlmEndpointsDialog
                open={Boolean(llmEndpointsOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('llmEndpointsOpen', open)
                }
            />
            <ProfileBackupDialog
                open={Boolean(profileBackupOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('profileBackupOpen', open)
                }
            />
        </>
    );
}
