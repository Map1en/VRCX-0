import type {
    InstanceCreateGroupAccessType,
    InstanceCreateMinimumAvatarPerformance
} from '@/platform/tauri/bindings';

import type { buildCreatedInstanceDetails } from './worldInstances';

export type WorldInstanceAccessType =
    | 'public'
    | 'friends'
    | 'friends+'
    | 'invite'
    | 'invite+'
    | 'group';
export type WorldInstanceRegion = 'US West' | 'US East' | 'Europe' | 'Japan';
const WORLD_NEW_INSTANCE_TABS = ['Normal', 'Legacy'] as const;
export type WorldNewInstanceTab = (typeof WORLD_NEW_INSTANCE_TABS)[number];

export function isWorldNewInstanceTab(
    value: string
): value is WorldNewInstanceTab {
    return WORLD_NEW_INSTANCE_TABS.some((tab) => tab === value);
}

export interface WorldNewInstanceForm {
    selectedTab: WorldNewInstanceTab;
    accessType: WorldInstanceAccessType;
    region: WorldInstanceRegion;
    groupId: string;
    groupName?: string;
    groupAccessType: InstanceCreateGroupAccessType;
    minimumAvatarPerformance: InstanceCreateMinimumAvatarPerformance | '';
    queueEnabled: boolean;
    ageGate: boolean;
    displayName: string;
    displayNamePresets: string[];
    roleIds: string;
    instanceName: string;
    legacyUserId: string;
    strict: boolean;
}

export type CreatedWorldInstance = ReturnType<
    typeof buildCreatedInstanceDetails
>;

export type NewInstanceAfterCreateAction = '' | 'selfInvite' | 'openInGame';

export interface WorldNewInstanceRequest {
    selfInvite: boolean;
    afterCreateAction: NewInstanceAfterCreateAction;
    defaults: Partial<WorldNewInstanceForm>;
}

export interface WorldInstanceInviteRequest {
    location: string;
    launchToken: string;
    worldName: string;
}

export type InstanceGroupOption = Record<string, unknown> & {
    displayName?: string;
    groupId?: string;
    id?: string;
    name?: string;
};
