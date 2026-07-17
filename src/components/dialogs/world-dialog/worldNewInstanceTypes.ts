import type { buildCreatedInstanceDetails } from './worldInstances';

export interface WorldNewInstanceForm {
    selectedTab: string;
    accessType: string;
    region: string;
    groupId: string;
    groupName?: string;
    groupAccessType: string;
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
    created?: CreatedWorldInstance;
}

export interface WorldInstanceInviteRequest {
    location: string;
    launchToken: string;
    worldName: string;
}

export interface InstanceGroupOption {
    displayName?: unknown;
    groupId?: unknown;
    id?: unknown;
    name?: unknown;
}
