import { AssistantDialog } from '@/features/assistant/AssistantDialog';

import { AppToaster } from './AppToaster';
import { BackgroundRouteResumeHost } from './BackgroundRouteResumeHost';
import { CommunityThemeSafetyHost } from './CommunityThemeSafetyHost';
import { DialogHost } from './DialogHost';
import { FavoriteImportHost } from './FavoriteImportHost';
import { FriendProfileLoadHost } from './FriendProfileLoadHost';
import { LaunchDialogHost } from './LaunchDialogHost';
import { ModalHost } from './ModalHost';
import { NotificationHost } from './NotificationHost';
import { PostUpdateChangelogToastHost } from './PostUpdateChangelogToastHost';
import { SystemDialogsHost } from './SystemDialogsHost';
import { ToolsDialogsHost } from './ToolsDialogsHost';
import { VrcNotificationCenterHost } from './VrcNotificationCenterHost';

export function GlobalHosts() {
    return (
        <>
            <AppToaster />
            <CommunityThemeSafetyHost />
            <BackgroundRouteResumeHost />
            <ModalHost />
            <DialogHost />
            <FavoriteImportHost />
            <FriendProfileLoadHost />
            <NotificationHost />
            <VrcNotificationCenterHost />
            <PostUpdateChangelogToastHost />
            <LaunchDialogHost />
            <SystemDialogsHost />
            <ToolsDialogsHost />
            <AssistantDialog />
        </>
    );
}
