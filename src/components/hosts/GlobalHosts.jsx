import { AppToaster } from './AppToaster.jsx';
import { DialogHost } from './DialogHost.jsx';
import { ModalHost } from './ModalHost.jsx';
import { NotificationHost } from './NotificationHost.jsx';
import { VrcNotificationCenterHost } from './VrcNotificationCenterHost.jsx';
import { SystemDialogsHost } from './SystemDialogsHost.jsx';
import { FavoriteImportHost } from './FavoriteImportHost.jsx';
import { LaunchDialogHost } from './LaunchDialogHost.jsx';
import { ToolsDialogsHost } from './ToolsDialogsHost.jsx';

export function GlobalHosts() {
    return (
        <>
            <AppToaster />
            <ModalHost />
            <DialogHost />
            <FavoriteImportHost />
            <NotificationHost />
            <VrcNotificationCenterHost />
            <LaunchDialogHost />
            <SystemDialogsHost />
            <ToolsDialogsHost />
        </>
    );
}
