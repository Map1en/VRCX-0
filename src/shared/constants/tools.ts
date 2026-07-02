type ToolCategoryKey =
    | 'image'
    | 'shortcuts'
    | 'group'
    | 'social'
    | 'system'
    | 'user'
    | 'other';

type ToolAction =
    | {
          type: 'route';
          routeName:
              | 'screenshot-metadata'
              | 'gallery'
              | 'inventory'
              | 'vrchat-log';
      }
    | {
          type: 'app-api';
          method: string;
          successMessageKey: string;
          errorMessageKey: string;
      }
    | {
          type: 'store-action';
          target: 'advancedSettings' | 'launch' | 'vrcx';
          method:
              | 'showVRChatConfig'
              | 'showLaunchOptions'
              | 'showRegistryBackupDialog';
      }
    | {
          type: 'dialog';
          dialogKey: string;
      };

interface ToolCategory {
    key: ToolCategoryKey;
    labelKey: string;
}

interface ToolDefinition {
    key: string;
    category: ToolCategoryKey;
    iconKey: string;
    navIcon: string;
    titleKey: string;
    descriptionKey: string;
    navEligible: boolean;
    requiredCapability?: string;
    requiredCapabilities?: string[];
    requiredCapabilityMode?: 'supported';
    action: ToolAction;
}

interface ToolNavDefinition {
    key: string;
    icon: string;
    tooltip: string;
    labelKey: string;
    routeName: string | null;
    action: { type: 'tool'; toolKey: string } | null;
    defaultHidden: boolean;
}

const toolCategories: ToolCategory[] = [
    { key: 'image', labelKey: 'view.tools.pictures.header' },
    { key: 'shortcuts', labelKey: 'view.tools.shortcuts.header' },
    { key: 'group', labelKey: 'view.tools.group.header' },
    { key: 'social', labelKey: 'view.tools.social_automation.header' },
    { key: 'system', labelKey: 'view.tools.system_tools.header' },
    { key: 'user', labelKey: 'view.tools.export.header' },
    { key: 'other', labelKey: 'view.tools.other.header' }
];

const toolDefinitions: ToolDefinition[] = [
    {
        key: 'screenshot-metadata',
        category: 'image',
        iconKey: 'camera',
        navIcon: 'lucide:Camera',
        titleKey: 'view.tools.pictures.screenshot',
        descriptionKey: 'view.tools.pictures.screenshot_description',
        navEligible: true,
        requiredCapability: 'screenshotCache',
        action: { type: 'route', routeName: 'screenshot-metadata' }
    },
    {
        key: 'gallery',
        category: 'image',
        iconKey: 'image',
        navIcon: 'lucide:Images',
        titleKey: 'view.tools.pictures.gallery',
        descriptionKey: 'view.tools.pictures.gallery_description',
        navEligible: true,
        requiredCapability: 'screenshotCache',
        action: { type: 'route', routeName: 'gallery' }
    },
    {
        key: 'inventory',
        category: 'image',
        iconKey: 'package',
        navIcon: 'lucide:Package',
        titleKey: 'view.tools.pictures.inventory',
        descriptionKey: 'view.tools.pictures.inventory_description',
        navEligible: true,
        action: { type: 'route', routeName: 'inventory' }
    },
    {
        key: 'vrc-photos',
        category: 'shortcuts',
        iconKey: 'folder-open',
        navIcon: 'lucide:Folder',
        titleKey: 'view.tools.pictures.pictures.vrc_photos',
        descriptionKey: 'view.tools.pictures.pictures.vrc_photos_description',
        navEligible: true,
        requiredCapability: 'vrchatPathDiscovery',
        action: {
            type: 'app-api',
            method: 'OpenVrcPhotosFolder',
            successMessageKey: 'message.file.folder_opened',
            errorMessageKey: 'message.file.folder_missing'
        }
    },
    {
        key: 'steam-screenshots',
        category: 'shortcuts',
        iconKey: 'folder-image',
        navIcon: 'lucide:Image',
        titleKey: 'view.tools.pictures.pictures.steam_screenshots',
        descriptionKey:
            'view.tools.pictures.pictures.steam_screenshots_description',
        navEligible: true,
        requiredCapability: 'screenshotCache',
        action: {
            type: 'app-api',
            method: 'OpenVrcScreenshotsFolder',
            successMessageKey: 'message.file.folder_opened',
            errorMessageKey: 'message.file.folder_missing'
        }
    },
    {
        key: 'vrcx-data',
        category: 'shortcuts',
        iconKey: 'folder-cog',
        navIcon: 'lucide:Database',
        titleKey: 'view.tools.shortcuts.vrcx_data',
        descriptionKey: 'view.tools.shortcuts.vrcx_data_description',
        navEligible: true,
        action: {
            type: 'app-api',
            method: 'OpenVrcxAppDataFolder',
            successMessageKey: 'message.file.folder_opened',
            errorMessageKey: 'message.file.folder_missing'
        }
    },
    {
        key: 'vrchat-data',
        category: 'shortcuts',
        iconKey: 'folder-cog',
        navIcon: 'lucide:ServerCog',
        titleKey: 'view.tools.shortcuts.vrchat_data',
        descriptionKey: 'view.tools.shortcuts.vrchat_data_description',
        navEligible: true,
        requiredCapability: 'vrchatPathDiscovery',
        action: {
            type: 'app-api',
            method: 'OpenVrcAppDataFolder',
            successMessageKey: 'message.file.folder_opened',
            errorMessageKey: 'message.file.folder_missing'
        }
    },
    {
        key: 'vrchat-log',
        category: 'system',
        iconKey: 'file-text',
        navIcon: 'lucide:FileText',
        titleKey: 'view.tools.system_tools.vrchat_log',
        descriptionKey: 'view.tools.system_tools.vrchat_log_description',
        navEligible: true,
        requiredCapability: 'vrchatPathDiscovery',
        action: { type: 'route', routeName: 'vrchat-log' }
    },
    {
        key: 'llm-endpoints',
        category: 'other',
        iconKey: 'plug',
        navIcon: 'lucide:Plug',
        titleKey: 'view.tools.system_tools.llm_endpoints',
        descriptionKey: 'view.tools.system_tools.llm_endpoints_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'llm-endpoints' }
    },
    {
        key: 'crash-dumps',
        category: 'shortcuts',
        iconKey: 'folder-x',
        navIcon: 'lucide:Archive',
        titleKey: 'view.tools.shortcuts.crash_dumps',
        descriptionKey: 'view.tools.shortcuts.crash_dumps_description',
        navEligible: true,
        requiredCapability: 'vrchatPathDiscovery',
        action: {
            type: 'app-api',
            method: 'OpenCrashVrcCrashDumps',
            successMessageKey: 'message.file.folder_opened',
            errorMessageKey: 'message.file.folder_missing'
        }
    },
    {
        key: 'vrchat-config',
        category: 'system',
        iconKey: 'sliders-horizontal',
        navIcon: 'lucide:SlidersHorizontal',
        titleKey: 'view.tools.system_tools.vrchat_config',
        descriptionKey: 'view.tools.system_tools.vrchat_config_description',
        navEligible: true,
        requiredCapability: 'vrchatPathDiscovery',
        action: {
            type: 'store-action',
            target: 'advancedSettings',
            method: 'showVRChatConfig'
        }
    },
    {
        key: 'launch-options',
        category: 'system',
        iconKey: 'terminal',
        navIcon: 'lucide:SquareTerminal',
        titleKey: 'view.settings.advanced.advanced.launch_options',
        descriptionKey: 'view.tools.system_tools.launch_options_description',
        navEligible: true,
        requiredCapability: 'gameLaunch',
        requiredCapabilityMode: 'supported',
        action: {
            type: 'store-action',
            target: 'launch',
            method: 'showLaunchOptions'
        }
    },
    {
        key: 'app-launcher',
        category: 'system',
        iconKey: 'rocket',
        navIcon: 'lucide:Rocket',
        titleKey: 'view.tools.system_tools.app_launcher',
        descriptionKey: 'view.tools.system_tools.app_launcher_description',
        navEligible: true,
        requiredCapabilities: ['gameProcessMonitor', 'gameLaunch'],
        action: {
            type: 'dialog',
            dialogKey: 'app-launcher'
        }
    },
    {
        key: 'registry-backup',
        category: 'system',
        iconKey: 'archive',
        navIcon: 'lucide:Archive',
        titleKey: 'view.settings.advanced.advanced.vrc_registry_backup',
        descriptionKey: 'view.tools.system_tools.registry_backup_description',
        navEligible: true,
        requiredCapability: 'registryPrefs',
        action: {
            type: 'store-action',
            target: 'vrcx',
            method: 'showRegistryBackupDialog'
        }
    },
    {
        key: 'presence-schedule',
        category: 'social',
        iconKey: 'calendar',
        navIcon: 'lucide:CalendarDays',
        titleKey: 'view.tools.social_automation.status_schedule',
        descriptionKey:
            'view.tools.social_automation.status_schedule_description',
        navEligible: true,
        action: {
            type: 'dialog',
            dialogKey: 'presence-schedule'
        }
    },
    {
        key: 'presence-room-rules',
        category: 'social',
        iconKey: 'users',
        navIcon: 'lucide:UsersRound',
        titleKey: 'view.tools.social_automation.room_status_rules',
        descriptionKey:
            'view.tools.social_automation.room_status_rules_description',
        navEligible: true,
        action: {
            type: 'dialog',
            dialogKey: 'presence-room-rules'
        }
    },
    {
        key: 'presence-invite-requests',
        category: 'social',
        iconKey: 'message',
        navIcon: 'lucide:MessageSquareText',
        titleKey: 'view.tools.social_automation.invite_request_auto_reply',
        descriptionKey:
            'view.tools.social_automation.invite_request_auto_reply_description',
        navEligible: true,
        action: {
            type: 'dialog',
            dialogKey: 'presence-invite-requests'
        }
    },
    {
        key: 'group-calendar',
        category: 'group',
        iconKey: 'calendar',
        navIcon: 'lucide:CalendarDays',
        titleKey: 'view.tools.group.calendar',
        descriptionKey: 'view.tools.group.calendar_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'group-calendar' }
    },
    {
        key: 'discord-names',
        category: 'user',
        iconKey: 'users',
        navIcon: 'lucide:Users',
        titleKey: 'view.tools.export.discord_names',
        descriptionKey: 'view.tools.user.discord_names_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'export-discord-names' }
    },
    {
        key: 'export-notes',
        category: 'user',
        iconKey: 'file-text',
        navIcon: 'lucide:FileText',
        titleKey: 'view.tools.export.export_notes',
        descriptionKey: 'view.tools.export.export_notes_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'note-export' }
    },
    {
        key: 'export-friend-list',
        category: 'user',
        iconKey: 'users',
        navIcon: 'lucide:Contact',
        titleKey: 'view.tools.export.export_friend_list',
        descriptionKey: 'view.tools.user.export_friend_list_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'export-friends-list' }
    },
    {
        key: 'export-own-avatars',
        category: 'user',
        iconKey: 'download',
        navIcon: 'lucide:Download',
        titleKey: 'view.tools.export.export_own_avatars',
        descriptionKey: 'view.tools.user.export_own_avatars_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'export-avatars-list' }
    },
    {
        key: 'edit-invite-message',
        category: 'other',
        iconKey: 'pencil',
        navIcon: 'lucide:MessageSquareText',
        titleKey: 'view.tools.other.edit_invite_message',
        descriptionKey: 'view.tools.other.edit_invite_message_description',
        navEligible: true,
        action: { type: 'dialog', dialogKey: 'edit-invite-messages' }
    }
];

const toolDefinitionMap = new Map<string, ToolDefinition>(
    toolDefinitions.map((tool) => [tool.key, tool])
);

const quickAccessConfigKey = 'VRCX_toolsQuickAccessList';
const TOOLS_QUICK_ACCESS_UPDATED_EVENT = 'vrcx:tools-quick-access-updated';
const knownToolKeys = new Set(toolDefinitions.map((tool) => tool.key));
const legacyToolKeyAliases: Record<string, string> = {
    'auto-change-status': 'presence-room-rules'
};

function normalizePinnedToolKey(toolKey: unknown): string {
    const normalizedToolKey = String(toolKey ?? '');
    return legacyToolKeyAliases[normalizedToolKey] ?? normalizedToolKey;
}

function normalizeQuickAccessToolKeys(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const nextKeys: string[] = [];
    for (const rawKey of value) {
        const toolKey = normalizePinnedToolKey(String(rawKey || ''));
        if (!knownToolKeys.has(toolKey) || seen.has(toolKey)) {
            continue;
        }
        seen.add(toolKey);
        nextKeys.push(toolKey);
    }
    return nextKeys;
}

function parseQuickAccessToolKeys(value: unknown): string[] {
    try {
        return normalizeQuickAccessToolKeys(JSON.parse(String(value || '[]')));
    } catch {
        return [];
    }
}

function getEquivalentToolNavKeys(toolKey: unknown): string[] {
    const normalizedToolKey = normalizePinnedToolKey(toolKey);
    const equivalentToolKeys = new Set([normalizedToolKey]);

    for (const [legacyToolKey, targetToolKey] of Object.entries(
        legacyToolKeyAliases
    )) {
        if (targetToolKey === normalizedToolKey) {
            equivalentToolKeys.add(legacyToolKey);
        }
    }

    return Array.from(equivalentToolKeys).map((key) => `tool-${key}`);
}

function publishToolsQuickAccessUpdated(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(TOOLS_QUICK_ACCESS_UPDATED_EVENT));
    }
}

const generatedToolNavDefinitions: ToolNavDefinition[] = toolDefinitions
    .filter((tool) => tool.navEligible)
    .map((tool) => ({
        key: `tool-${tool.key}`,
        icon: tool.navIcon,
        tooltip: tool.titleKey,
        labelKey: tool.titleKey,
        routeName: tool.action.type === 'route' ? tool.action.routeName : null,
        action:
            tool.action.type === 'route'
                ? null
                : {
                      type: 'tool',
                      toolKey: tool.key
                  },
        defaultHidden: true
    }));

const legacyToolNavDefinitions: ToolNavDefinition[] = [
    {
        key: 'tool-auto-change-status',
        icon: 'lucide:Bot',
        tooltip: 'view.tools.social_automation.room_status_rules',
        labelKey: 'view.tools.social_automation.room_status_rules',
        routeName: null,
        action: { type: 'tool', toolKey: 'auto-change-status' },
        defaultHidden: true
    }
];

const toolNavDefinitions: ToolNavDefinition[] = [
    ...generatedToolNavDefinitions,
    ...legacyToolNavDefinitions
];

const defaultHiddenToolNavKeys = toolNavDefinitions.map((tool) => tool.key);
const isToolNavKey = (key: unknown): key is string =>
    typeof key === 'string' && key.startsWith('tool-');

function getToolsByCategory(categoryKey: ToolCategoryKey): ToolDefinition[] {
    return toolDefinitions.filter((tool) => tool.category === categoryKey);
}

export {
    TOOLS_QUICK_ACCESS_UPDATED_EVENT,
    defaultHiddenToolNavKeys,
    getEquivalentToolNavKeys,
    isToolNavKey,
    knownToolKeys,
    normalizePinnedToolKey,
    normalizeQuickAccessToolKeys,
    parseQuickAccessToolKeys,
    publishToolsQuickAccessUpdated,
    quickAccessConfigKey,
    toolCategories,
    toolDefinitions,
    toolDefinitionMap,
    toolNavDefinitions,
    getToolsByCategory
};
export type {
    ToolAction,
    ToolCategory,
    ToolCategoryKey,
    ToolDefinition,
    ToolNavDefinition
};
