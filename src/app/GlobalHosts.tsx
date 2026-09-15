import { AppToaster } from '@/components/hosts/AppToaster';
import { BackgroundRouteResumeHost } from '@/components/hosts/BackgroundRouteResumeHost';
import { CommunityThemeSafetyHost } from '@/components/hosts/CommunityThemeSafetyHost';
import { DialogHost } from '@/components/hosts/DialogHost';
import { FriendProfileLoadHost } from '@/components/hosts/FriendProfileLoadHost';
import { LaunchDialogHost } from '@/components/hosts/LaunchDialogHost';
import { LinuxRenderingTrialHost } from '@/components/hosts/LinuxRenderingTrialHost';
import { ModalHost } from '@/components/hosts/ModalHost';
import { NotificationHost } from '@/components/hosts/NotificationHost';
import { PostUpdateChangelogToastHost } from '@/components/hosts/PostUpdateChangelogToastHost';
import { PreviousInstancesDialogHost } from '@/components/hosts/PreviousInstancesDialogHost';
import { SystemDialogsHost } from '@/components/hosts/SystemDialogsHost';
import { ToolsDialogsHost } from '@/components/hosts/ToolsDialogsHost';
import { AssistantDialogHost } from '@/features/assistant/AssistantDialogHost';
import { VrcNotificationCenterHost } from '@/features/notifications/VrcNotificationCenterHost';
import { PrivacyLockDialogHost } from '@/features/privacy-lock/PrivacyLockDialogHost';
import { PrivacyLockOverlay } from '@/features/privacy-lock/PrivacyLockOverlay';

export function GlobalHosts() {
    return (
        <>
            <AppToaster />
            <CommunityThemeSafetyHost />
            <BackgroundRouteResumeHost />
            <ModalHost />
            <DialogHost />
            <LinuxRenderingTrialHost />
            <FriendProfileLoadHost />
            <NotificationHost />
            <VrcNotificationCenterHost />
            <PostUpdateChangelogToastHost />
            <LaunchDialogHost />
            <PreviousInstancesDialogHost />
            <SystemDialogsHost />
            <ToolsDialogsHost />
            <AssistantDialogHost />
            <PrivacyLockDialogHost />
            <PrivacyLockOverlay />
        </>
    );
}
