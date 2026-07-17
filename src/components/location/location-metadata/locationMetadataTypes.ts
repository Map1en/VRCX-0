import type { ParsedLocation } from '@/shared/utils/location';

export type LocationMetadata = {
    currentEndpoint: string;
    region: string;
    instanceName: string;
    isClosed: boolean;
    groupName: string;
    worldName: string;
    worldNameHint: string;
};

export type LocationMetadataEntry = {
    key?: unknown;
    locationInfo?: unknown;
    currentLocation?: unknown;
    hint?: unknown;
    worldNameHint?: unknown;
    groupHint?: unknown;
    instanceName?: unknown;
};

export type NormalizedLocationMetadataEntry = {
    key: unknown;
    locationInfo: ParsedLocation;
    currentLocation: string;
    locationTag: string;
    locationValue: string;
    worldId: string;
    groupId: string;
    hint: string;
    worldNameHint: string;
    groupHint: string;
    instanceName: string;
};

export type LocationCacheRecord = Record<string, unknown> & {
    $location?: unknown;
    closedAt?: unknown;
    closed_at?: unknown;
    displayName?: unknown;
    group?: unknown;
    groupName?: unknown;
    group_name?: unknown;
    isClosed?: unknown;
    instanceDisplayName?: unknown;
    location?: unknown;
    name?: unknown;
    ref?: unknown;
    tag?: unknown;
    world?: unknown;
    worldName?: unknown;
    world_name?: unknown;
};

export type GroupProfileRecord = Record<string, unknown> & {
    displayName?: unknown;
    name?: unknown;
    shortCode?: unknown;
};

export type WorldProfileRecord = Record<string, unknown> & {
    name?: unknown;
};

export type LocationHintRecord = {
    groupName?: unknown;
    instanceName?: unknown;
    isClosed?: unknown;
    region?: unknown;
    worldName?: unknown;
};

export type MetadataContext = {
    cachedInstances: Map<string, LocationCacheRecord>;
    currentEndpoint: string;
    groupProfilesById: Map<string, GroupProfileRecord>;
    locationHintsByKey: Record<string, LocationHintRecord | undefined>;
    localWorldNamesById: Map<string, string>;
    worldProfilesById: Map<string, WorldProfileRecord>;
};
