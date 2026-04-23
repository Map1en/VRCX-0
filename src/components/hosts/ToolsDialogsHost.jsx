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
    const systemHosts = useRuntimeStore((state) => state.systemHosts);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    return (
        <>
            <AutoChangeStatusDialog
                open={Boolean(systemHosts.autoChangeStatusOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('autoChangeStatusOpen', open)
                }
            />
            <GroupCalendarDialog
                open={Boolean(systemHosts.groupCalendarOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('groupCalendarOpen', open)
                }
            />
            <ExportDiscordNamesDialog
                open={Boolean(systemHosts.exportDiscordNamesOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('exportDiscordNamesOpen', open)
                }
            />
            <NoteExportDialog
                open={Boolean(systemHosts.noteExportOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('noteExportOpen', open)
                }
            />
            <ExportFriendsListDialog
                open={Boolean(systemHosts.exportFriendsListOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('exportFriendsListOpen', open)
                }
            />
            <ExportAvatarsListDialog
                open={Boolean(systemHosts.exportAvatarsListOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('exportAvatarsListOpen', open)
                }
            />
            <InviteMessageTemplatesDialog
                open={Boolean(systemHosts.editInviteMessagesOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('editInviteMessagesOpen', open)
                }
                currentUserId={getCurrentUserId()}
                endpoint={getEndpoint()}
            />
        </>
    );
}
