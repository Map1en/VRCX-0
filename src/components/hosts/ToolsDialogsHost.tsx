import { lazy } from 'react';

import { InviteMessageTemplatesDialog } from '@/components/dialogs/InviteMessageDialog';
import { useRuntimeStore } from '@/state/runtimeStore';

import { MountOnFirstOpen } from './MountOnFirstOpen';
import {
    getCurrentUserId,
    getEndpoint
} from './tools-dialogs/toolsDialogUtils';

const AppLauncherDialog = lazy(() =>
    import('./tools-dialogs/AppLauncherDialog').then((module) => ({
        default: module.AppLauncherDialog
    }))
);
const PresenceScheduleDialog = lazy(() =>
    import('./tools-dialogs/presence-automation/PresenceAutomationDialog').then(
        (module) => ({
            default: module.PresenceScheduleDialog
        })
    )
);
const PresenceRoomRulesDialog = lazy(() =>
    import('./tools-dialogs/presence-automation/PresenceAutomationDialog').then(
        (module) => ({
            default: module.PresenceRoomRulesDialog
        })
    )
);
const PresenceInviteRequestsDialog = lazy(() =>
    import('./tools-dialogs/presence-automation/PresenceAutomationDialog').then(
        (module) => ({
            default: module.PresenceInviteRequestsDialog
        })
    )
);
const GroupCalendarDialog = lazy(() =>
    import('./tools-dialogs/GroupCalendarDialog').then((module) => ({
        default: module.GroupCalendarDialog
    }))
);
const ExportDiscordNamesDialog = lazy(() =>
    import('./tools-dialogs/ExportListDialogs').then((module) => ({
        default: module.ExportDiscordNamesDialog
    }))
);
const NoteExportDialog = lazy(() =>
    import('./tools-dialogs/NoteExportDialog').then((module) => ({
        default: module.NoteExportDialog
    }))
);
const ExportFriendsListDialog = lazy(() =>
    import('./tools-dialogs/ExportListDialogs').then((module) => ({
        default: module.ExportFriendsListDialog
    }))
);
const ExportAvatarsListDialog = lazy(() =>
    import('./tools-dialogs/ExportListDialogs').then((module) => ({
        default: module.ExportAvatarsListDialog
    }))
);
const LlmEndpointsDialog = lazy(() =>
    import('./tools-dialogs/LlmEndpointsDialog').then((module) => ({
        default: module.LlmEndpointsDialog
    }))
);
const ProfileBackupDialog = lazy(() =>
    import('./tools-dialogs/ProfileBackupDialog').then((module) => ({
        default: module.ProfileBackupDialog
    }))
);

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
            <MountOnFirstOpen open={appLauncherOpen}>
                <AppLauncherDialog
                    open={appLauncherOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('appLauncherOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={presenceScheduleOpen}>
                <PresenceScheduleDialog
                    open={presenceScheduleOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('presenceScheduleOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={presenceRoomRulesOpen}>
                <PresenceRoomRulesDialog
                    open={presenceRoomRulesOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('presenceRoomRulesOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={presenceInviteRequestsOpen}>
                <PresenceInviteRequestsDialog
                    open={presenceInviteRequestsOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('presenceInviteRequestsOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={groupCalendarOpen}>
                <GroupCalendarDialog
                    open={groupCalendarOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('groupCalendarOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={exportDiscordNamesOpen}>
                <ExportDiscordNamesDialog
                    open={exportDiscordNamesOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('exportDiscordNamesOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={noteExportOpen}>
                <NoteExportDialog
                    open={noteExportOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('noteExportOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={exportFriendsListOpen}>
                <ExportFriendsListDialog
                    open={exportFriendsListOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('exportFriendsListOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={exportAvatarsListOpen}>
                <ExportAvatarsListDialog
                    open={exportAvatarsListOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('exportAvatarsListOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={editInviteMessagesOpen}>
                <InviteMessageTemplatesDialog
                    open={editInviteMessagesOpen}
                    onOpenChange={(open) =>
                        setSystemHostOpen('editInviteMessagesOpen', open)
                    }
                    currentUserId={getCurrentUserId()}
                    endpoint={getEndpoint()}
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={llmEndpointsOpen}>
                <LlmEndpointsDialog
                    open={llmEndpointsOpen}
                    onOpenChange={(open) =>
                        setSystemHostOpen('llmEndpointsOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={profileBackupOpen}>
                <ProfileBackupDialog
                    open={profileBackupOpen}
                    onOpenChange={(open) =>
                        setSystemHostOpen('profileBackupOpen', open)
                    }
                />
            </MountOnFirstOpen>
        </>
    );
}
