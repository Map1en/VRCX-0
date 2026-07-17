import { describe, expect, it } from 'vitest';

import { buildCachedInstanceMap } from './locationMetadataCache';
import {
    normalizeMetadataEntry,
    resolveEntryMetadata
} from './locationMetadataResolution';
import type { MetadataContext } from './locationMetadataTypes';

const WORLD_ID = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const GROUP_ID = 'grp_11111111-2222-3333-4444-555555555555';
const INSTANCE_ID = '12345';
const LOCATION = `${WORLD_ID}:${INSTANCE_ID}~group(${GROUP_ID})~groupAccessType(members)`;

function createContext(): MetadataContext {
    return {
        cachedInstances: new Map(),
        currentEndpoint: 'https://api.vrchat.cloud/api/1',
        groupProfilesById: new Map(),
        locationHintsByKey: {},
        localWorldNamesById: new Map(),
        worldProfilesById: new Map()
    };
}

describe('locationMetadataResolution', () => {
    it('rejects raw world and group identifiers as display-name hints', () => {
        const entry = normalizeMetadataEntry(
            {
                currentLocation: LOCATION,
                hint: `${WORLD_ID}:${INSTANCE_ID}`,
                groupHint: GROUP_ID
            },
            0
        );

        expect(resolveEntryMetadata(entry, createContext())).toMatchObject({
            groupName: GROUP_ID,
            worldName: '',
            worldNameHint: ''
        });
    });

    it('resolves cached instance metadata and keeps closed state', () => {
        const context = createContext();
        context.cachedInstances = buildCachedInstanceMap([
            {
                $location: {
                    tag: LOCATION,
                    displayName: 'Cached Instance',
                    world: { name: 'Cached World' },
                    group: { name: 'Cached Group' }
                },
                closedAt: '2026-07-16T00:00:00Z'
            }
        ]);
        const entry = normalizeMetadataEntry({ currentLocation: LOCATION }, 0);

        expect(resolveEntryMetadata(entry, context)).toMatchObject({
            instanceName: 'Cached Instance',
            isClosed: true,
            groupName: 'Cached Group',
            worldName: 'Cached World'
        });
    });

    it('falls back to queried world and group profiles', () => {
        const context = createContext();
        context.worldProfilesById.set(WORLD_ID, { name: 'Profile World' });
        context.groupProfilesById.set(GROUP_ID, { name: 'Profile Group' });
        const entry = normalizeMetadataEntry({ currentLocation: LOCATION }, 0);

        expect(resolveEntryMetadata(entry, context)).toMatchObject({
            groupName: 'Profile Group',
            worldName: 'Profile World'
        });
    });
});
