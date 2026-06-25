import { InviteMessageTemplatesDialog } from '@/components/dialogs/InviteMessageDialog';
import { useRuntimeStore } from '@/state/runtimeStore';

import { AppLauncherDialog } from './tools-dialogs/AppLauncherDialog';
import {
    ExportAvatarsListDialog,
    ExportDiscordNamesDialog,
    ExportFriendsListDialog
} from './tools-dialogs/ExportListDialogs';
import { GroupCalendarDialog } from './tools-dialogs/GroupCalendarDialog';
import { NoteExportDialog } from './tools-dialogs/NoteExportDialog';
import {
    PresenceInviteRequestsDialog,
    PresenceRoomRulesDialog,
    PresenceScheduleDialog
} from './tools-dialogs/presence-automation/PresenceAutomationDialog';
import {
    getCurrentUserId,
    getEndpoint
} from './tools-dialogs/toolsDialogUtils';

export function ToolsDialogsHost() {
    const presenceScheduleOpen = useRuntimeStore(
        (state: any) => state.systemHosts.presenceScheduleOpen
    );
    const appLauncherOpen = useRuntimeStore(
        (state: any) => state.systemHosts.appLauncherOpen
    );
    const presenceRoomRulesOpen = useRuntimeStore(
        (state: any) => state.systemHosts.presenceRoomRulesOpen
    );
    const presenceInviteRequestsOpen = useRuntimeStore(
        (state: any) => state.systemHosts.presenceInviteRequestsOpen
    );
    const groupCalendarOpen = useRuntimeStore(
        (state: any) => state.systemHosts.groupCalendarOpen
    );
    const exportDiscordNamesOpen = useRuntimeStore(
        (state: any) => state.systemHosts.exportDiscordNamesOpen
    );
    const noteExportOpen = useRuntimeStore(
        (state: any) => state.systemHosts.noteExportOpen
    );
    const exportFriendsListOpen = useRuntimeStore(
        (state: any) => state.systemHosts.exportFriendsListOpen
    );
    const exportAvatarsListOpen = useRuntimeStore(
        (state: any) => state.systemHosts.exportAvatarsListOpen
    );
    const editInviteMessagesOpen = useRuntimeStore(
        (state: any) => state.systemHosts.editInviteMessagesOpen
    );
    const setSystemHostOpen = useRuntimeStore(
        (state: any) => state.setSystemHostOpen
    );

    return (
        <>
            <AppLauncherDialog
                open={Boolean(appLauncherOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('appLauncherOpen', open)
                }
            />
            <PresenceScheduleDialog
                open={Boolean(presenceScheduleOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('presenceScheduleOpen', open)
                }
            />
            <PresenceRoomRulesDialog
                open={Boolean(presenceRoomRulesOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('presenceRoomRulesOpen', open)
                }
            />
            <PresenceInviteRequestsDialog
                open={Boolean(presenceInviteRequestsOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('presenceInviteRequestsOpen', open)
                }
            />
            <GroupCalendarDialog
                open={Boolean(groupCalendarOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('groupCalendarOpen', open)
                }
            />
            <ExportDiscordNamesDialog
                open={Boolean(exportDiscordNamesOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('exportDiscordNamesOpen', open)
                }
            />
            <NoteExportDialog
                open={Boolean(noteExportOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('noteExportOpen', open)
                }
            />
            <ExportFriendsListDialog
                open={Boolean(exportFriendsListOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('exportFriendsListOpen', open)
                }
            />
            <ExportAvatarsListDialog
                open={Boolean(exportAvatarsListOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('exportAvatarsListOpen', open)
                }
            />
            <InviteMessageTemplatesDialog
                open={Boolean(editInviteMessagesOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('editInviteMessagesOpen', open)
                }
                currentUserId={getCurrentUserId()}
                endpoint={getEndpoint()}
            />
        </>
    );
}
