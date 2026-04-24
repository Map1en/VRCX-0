import { InviteMessageTemplatesDialog } from '@/components/dialogs/InviteMessageDialog.jsx';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { AutoChangeStatusDialog } from './tools-dialogs/AutoChangeStatusDialog.jsx';
import {
    ExportAvatarsListDialog,
    ExportDiscordNamesDialog,
    ExportFriendsListDialog
} from './tools-dialogs/ExportListDialogs.jsx';
import { GroupCalendarDialog } from './tools-dialogs/GroupCalendarDialog.jsx';
import { NoteExportDialog } from './tools-dialogs/NoteExportDialog.jsx';
import {
    getCurrentUserId,
    getEndpoint
} from './tools-dialogs/toolsDialogUtils.js';

export function ToolsDialogsHost() {
    const autoChangeStatusOpen = useRuntimeStore(
        (state) => state.systemHosts.autoChangeStatusOpen
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
            <AutoChangeStatusDialog
                open={Boolean(autoChangeStatusOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('autoChangeStatusOpen', open)
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
