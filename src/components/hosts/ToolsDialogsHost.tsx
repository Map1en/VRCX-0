// @ts-nocheck
import { InviteMessageTemplatesDialog } from '@/components/dialogs/InviteMessageDialog';
import { useRuntimeStore } from '@/state/runtimeStore.js';

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
} from './tools-dialogs/presence-automation/PresenceAutomationDialog.js';
import {
    getCurrentUserId,
    getEndpoint
} from './tools-dialogs/toolsDialogUtils.js';

export function ToolsDialogsHost() {
    const presenceScheduleOpen = useRuntimeStore(
        (state) => state.systemHosts.presenceScheduleOpen
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
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    return (
        <>
            <PresenceScheduleDialog
                open={Boolean(presenceScheduleOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('presenceScheduleOpen', open)
                }
            />
            <PresenceRoomRulesDialog
                open={Boolean(presenceRoomRulesOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('presenceRoomRulesOpen', open)
                }
            />
            <PresenceInviteRequestsDialog
                open={Boolean(presenceInviteRequestsOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('presenceInviteRequestsOpen', open)
                }
            />
            <GroupCalendarDialog
                open={Boolean(groupCalendarOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('groupCalendarOpen', open)
                }
            />
            <ExportDiscordNamesDialog
                open={Boolean(exportDiscordNamesOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('exportDiscordNamesOpen', open)
                }
            />
            <NoteExportDialog
                open={Boolean(noteExportOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('noteExportOpen', open)
                }
            />
            <ExportFriendsListDialog
                open={Boolean(exportFriendsListOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('exportFriendsListOpen', open)
                }
            />
            <ExportAvatarsListDialog
                open={Boolean(exportAvatarsListOpen)}
                onOpenChange={(open) =>
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
        </>
    );
}
