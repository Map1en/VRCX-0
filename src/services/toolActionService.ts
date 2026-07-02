import { toast } from 'sonner';

import { invokeAppCommand } from '@/platform/tauri/dynamicCommand';
import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    isHostCapabilitySupported
} from '@/services/hostCapabilityService';
import i18n from '@/services/i18nService';
import {
    toolDefinitionMap,
    type ToolDefinition
} from '@/shared/constants/tools';
import { useRuntimeStore } from '@/state/runtimeStore';

type Navigate = (to: string) => unknown;
type Translate = (key: string) => string;
type TriggerToolOptions = {
    navigate: Navigate;
    t: Translate;
};
type ToolDialogHostKey =
    | 'appLauncherOpen'
    | 'presenceScheduleOpen'
    | 'presenceRoomRulesOpen'
    | 'presenceInviteRequestsOpen'
    | 'groupCalendarOpen'
    | 'exportDiscordNamesOpen'
    | 'noteExportOpen'
    | 'exportFriendsListOpen'
    | 'exportAvatarsListOpen'
    | 'editInviteMessagesOpen'
    | 'llmEndpointsOpen';

const toolRouteMap = {
    gallery: '/tools/gallery',
    inventory: '/tools/inventory',
    'screenshot-metadata': '/tools/screenshot-metadata',
    'vrchat-log': '/tools/vrchat-log'
} satisfies Record<string, string>;

const toolDialogHostMap: Record<string, ToolDialogHostKey> = {
    'app-launcher': 'appLauncherOpen',
    'presence-schedule': 'presenceScheduleOpen',
    'presence-room-rules': 'presenceRoomRulesOpen',
    'presence-invite-requests': 'presenceInviteRequestsOpen',
    'group-calendar': 'groupCalendarOpen',
    'export-discord-names': 'exportDiscordNamesOpen',
    'note-export': 'noteExportOpen',
    'export-friends-list': 'exportFriendsListOpen',
    'export-avatars-list': 'exportAvatarsListOpen',
    'edit-invite-messages': 'editInviteMessagesOpen',
    'llm-endpoints': 'llmEndpointsOpen'
};

const legacyToolAliases: Record<string, string> = {
    'auto-change-status': 'presence-room-rules'
};

export function isToolCapabilityAvailable(
    tool?: ToolDefinition | null
): boolean {
    const capabilities = [
        ...(tool?.requiredCapabilities ?? []),
        ...(tool?.requiredCapability ? [tool.requiredCapability] : [])
    ];
    if (capabilities.length === 0) {
        return true;
    }
    if (tool?.requiredCapabilityMode === 'supported') {
        return capabilities.every(isHostCapabilitySupported);
    }
    return capabilities.every(isHostCapabilityAvailable);
}

export function getToolCapabilityUnavailableReason(
    tool?: ToolDefinition | null
): string {
    const capabilities = [
        ...(tool?.requiredCapabilities ?? []),
        ...(tool?.requiredCapability ? [tool.requiredCapability] : [])
    ];
    if (capabilities.length === 0) {
        return '';
    }
    return getHostCapabilityUnavailableReason(capabilities[0]);
}

export async function triggerToolByKey(
    toolKey: string,
    { navigate, t }: TriggerToolOptions
): Promise<void> {
    const resolvedToolKey = legacyToolAliases[toolKey] ?? toolKey;
    const tool = toolDefinitionMap.get(resolvedToolKey);
    const action = tool?.action;
    if (!action) {
        toast.error(
            i18n.t(
                'service.tool_action_service.dynamic.unknown_tool_action_value',
                { value: toolKey }
            )
        );
        return;
    }

    if (!isToolCapabilityAvailable(tool)) {
        toast.error(getToolCapabilityUnavailableReason(tool));
        return;
    }

    if (action.type === 'route') {
        navigate(toolRouteMap[action.routeName] ?? '/tools');
        return;
    }

    if (action.type === 'app-api') {
        try {
            const result = await invokeAppCommand(action.method);
            toast[result ? 'success' : 'error'](
                t(result ? action.successMessageKey : action.errorMessageKey)
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(action.errorMessageKey)
            );
        }
        return;
    }

    if (action.type === 'store-action') {
        const setSystemHostOpen = useRuntimeStore.getState().setSystemHostOpen;
        if (
            action.target === 'vrcx' &&
            action.method === 'showRegistryBackupDialog'
        ) {
            setSystemHostOpen('registryBackupOpen', true);
            return;
        }
        if (
            action.target === 'launch' &&
            action.method === 'showLaunchOptions'
        ) {
            setSystemHostOpen('launchOptionsOpen', true);
            return;
        }
        if (
            action.target === 'advancedSettings' &&
            action.method === 'showVRChatConfig'
        ) {
            setSystemHostOpen('vrchatConfigOpen', true);
            return;
        }
    }

    if (action.type === 'dialog') {
        const dialogKey = String(action.dialogKey || '');
        const hostKey = toolDialogHostMap[dialogKey];
        if (hostKey) {
            useRuntimeStore.getState().setSystemHostOpen(hostKey, true);
            return;
        }
    }

    toast.error(
        i18n.t(
            'service.tool_action_service.dynamic.unsupported_tool_action_value',
            { value: toolKey }
        )
    );
}
