import { AppToaster } from './AppToaster.jsx';
import { DialogHost } from './DialogHost.jsx';
import { FavoriteImportHost } from './FavoriteImportHost.jsx';
import { LaunchDialogHost } from './LaunchDialogHost.jsx';
import { ModalHost } from './ModalHost.jsx';
import { NotificationHost } from './NotificationHost.jsx';
import { SystemDialogsHost } from './SystemDialogsHost.jsx';
import { ToolsDialogsHost } from './ToolsDialogsHost.jsx';
import { VrcNotificationCenterHost } from './VrcNotificationCenterHost.jsx';

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
