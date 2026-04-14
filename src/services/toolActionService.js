import { toast } from 'sonner';

import { backend } from '@/platform/index.js';
import { toolDefinitionMap } from '@/shared/constants/tools.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const toolRouteMap = {
    gallery: '/tools/gallery',
    'screenshot-metadata': '/tools/screenshot-metadata'
};

const toolDialogHostMap = {
    'auto-change-status': 'autoChangeStatusOpen',
    'group-calendar': 'groupCalendarOpen',
    'export-discord-names': 'exportDiscordNamesOpen',
    'note-export': 'noteExportOpen',
    'export-friends-list': 'exportFriendsListOpen',
    'export-avatars-list': 'exportAvatarsListOpen',
    'edit-invite-messages': 'editInviteMessagesOpen'
};

export async function triggerToolByKey(toolKey, { navigate, t }) {
    const tool = toolDefinitionMap.get(toolKey);
    const action = tool?.action;
    if (!action) {
        toast.error(`Unknown tool action: ${toolKey}`);
        return;
    }

    if (action.type === 'route') {
        navigate(toolRouteMap[action.routeName] ?? '/tools');
        return;
    }

    if (action.type === 'app-api') {
        try {
            const result = await backend.app[action.method]();
            toast[result ? 'success' : 'error'](t(result ? action.successMessageKey : action.errorMessageKey));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t(action.errorMessageKey));
        }
        return;
    }

    if (action.type === 'store-action') {
        const setSystemHostOpen = useRuntimeStore.getState().setSystemHostOpen;
        if (action.target === 'vrcx' && action.method === 'showRegistryBackupDialog') {
            setSystemHostOpen('registryBackupOpen', true);
            return;
        }
        if (action.target === 'launch' && action.method === 'showLaunchOptions') {
            setSystemHostOpen('launchOptionsOpen', true);
            return;
        }
        if (action.target === 'advancedSettings' && action.method === 'showVRChatConfig') {
            setSystemHostOpen('vrchatConfigOpen', true);
            return;
        }
    }

    if (action.type === 'dialog') {
        const hostKey = toolDialogHostMap[action.dialogKey];
        if (hostKey) {
            useRuntimeStore.getState().setSystemHostOpen(hostKey, true);
            return;
        }
    }

    toast.error(`Unsupported tool action: ${toolKey}`);
}
