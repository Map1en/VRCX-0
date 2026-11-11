// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createInstance: vi.fn(),
    resolveCreatedInstanceDetails: vi.fn(),
    selfInviteToInstance: vi.fn(),
    tryOpenLaunchLocation: vi.fn(),
    showLaunchDialog: vi.fn(),
    loadNewInstanceGroups: vi.fn().mockResolvedValue([]),
    instanceCreateOptionsGet: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        setString: vi.fn().mockResolvedValue(undefined),
        setBool: vi.fn().mockResolvedValue(undefined),
        setArray: vi.fn().mockResolvedValue(undefined),
        getString: vi.fn().mockResolvedValue(''),
        getBool: vi.fn().mockResolvedValue(false),
        getArray: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        createInstance: mocks.createInstance,
        getInstanceCreateOptions: mocks.instanceCreateOptionsGet
    }
}));

vi.mock('@/services/launchService', () => ({
    selfInviteToInstance: mocks.selfInviteToInstance
}));

vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: mocks.tryOpenLaunchLocation
}));

vi.mock('./worldInstanceResolver', () => ({
    resolveCreatedInstanceDetails: mocks.resolveCreatedInstanceDetails
}));

import type { InstanceCreateOptions } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';

import {
    resolveNewInstanceAfterCreateAction,
    useWorldInstanceActions
} from './useWorldInstanceActions';
import { normalizeMinimumAvatarPerformance } from './worldDialogHelpers';
import type {
    NewInstanceAfterCreateAction,
    WorldNewInstanceForm
} from './worldNewInstanceTypes';

describe('useWorldInstanceActions helpers', () => {
    it('maps the follow-up new-instance action to open in-game while VRChat is running', () => {
        expect(resolveNewInstanceAfterCreateAction(true, true)).toBe(
            'openInGame'
        );
    });

    it('keeps the follow-up new-instance action as self-invite when VRChat is not running', () => {
        expect(resolveNewInstanceAfterCreateAction(true, false)).toBe(
            'selfInvite'
        );
    });

    it('does not attach a follow-up action for a plain new instance', () => {
        expect(resolveNewInstanceAfterCreateAction(false, true)).toBe('');
    });

    it('accepts API avatar-performance values and treats legacy None as no limit', () => {
        expect(normalizeMinimumAvatarPerformance('Medium')).toBe('Medium');
        expect(normalizeMinimumAvatarPerformance('None')).toBe('');
    });
});

const created = {
    location: 'wrld_test:12345',
    shortName: 'shrt',
    secureOrShortName: 'shrt',
    url: 'https://vrchat.com/home/launch?worldId=wrld_test',
    accessType: 'public',
    ownerId: 'usr_self',
    groupId: '',
    group: null
};

const createOptions: InstanceCreateOptions = {
    categories: [{ id: 'icat_hangout', name: 'Hangout' }],
    vibes: [
        { id: 'ivib_chill', name: 'Chill' },
        { id: 'ivib_cozy', name: 'Cozy' }
    ]
};

function renderCreateFlow(
    afterCreateAction: NewInstanceAfterCreateAction,
    isGameRunning = false,
    options: InstanceCreateOptions | null = createOptions
) {
    const actionStatusRef = { current: 'idle' };
    const { result } = renderHook(() =>
        useWorldInstanceActions({
            world: worldProfileRepository.normalize({
                id: 'wrld_test',
                name: 'Test World'
            }),
            currentEndpoint: 'endpoint-a',
            currentUserId: 'usr_self',
            isGameRunning,
            profileWorldId: 'wrld_test',
            newInstanceGroups: [],
            loadNewInstanceGroups: mocks.loadNewInstanceGroups,
            actionStatusRef,
            setActionStatus: vi.fn(),
            isCurrentWorldTarget: () => true,
            showLaunchDialog: mocks.showLaunchDialog
        })
    );
    act(() => {
        result.current.setNewInstanceRequest({
            selfInvite: afterCreateAction === 'selfInvite',
            afterCreateAction,
            defaults: {},
            createOptions: options
        });
    });
    return result;
}

function newInstanceForm(
    overrides: Partial<WorldNewInstanceForm> = {}
): WorldNewInstanceForm {
    return {
        selectedTab: 'Normal',
        accessType: 'public',
        region: 'US West',
        groupId: '',
        groupAccessType: 'plus',
        minimumAvatarPerformance: '',
        queueEnabled: true,
        ageGate: false,
        displayName: '',
        displayNamePresets: [],
        description: '',
        categoryId: '',
        vibeIds: [],
        languages: [],
        roleIds: '',
        instanceName: '',
        legacyUserId: '',
        strict: false,
        ...overrides
    };
}

async function submit(
    result: { current: ReturnType<typeof useWorldInstanceActions> },
    overrides: Partial<WorldNewInstanceForm> = {}
) {
    await act(async () => {
        await result.current.createWorldInstance(newInstanceForm(overrides));
    });
}

describe('useWorldInstanceActions createWorldInstance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(configRepository.getString).mockResolvedValue('');
        vi.mocked(configRepository.getArray).mockResolvedValue([]);
        mocks.instanceCreateOptionsGet.mockResolvedValue(createOptions);
        mocks.createInstance.mockResolvedValue({
            json: { location: created.location }
        });
        mocks.resolveCreatedInstanceDetails.mockResolvedValue(created);
        mocks.selfInviteToInstance.mockResolvedValue(undefined);
        mocks.tryOpenLaunchLocation.mockResolvedValue(true);
    });

    it('loads current-user groups when opening the new-instance dialog', async () => {
        const result = renderCreateFlow('');
        act(() => {
            result.current.setNewInstanceRequest(null);
        });

        await act(async () => {
            await result.current.openNewInstanceDialog();
        });

        expect(mocks.loadNewInstanceGroups).toHaveBeenCalledOnce();
        expect(result.current.newInstanceRequest).not.toBeNull();
    });

    it('restores remembered discovery details, drops options VRChat no longer offers and defaults to the first category', async () => {
        const strings = new Map([
            ['instanceDialogDescription', 'Bring snacks'],
            ['instanceDialogCategoryId', 'icat_deleted']
        ]);
        const arrays = new Map([
            ['instanceDialogVibeIds', ['ivib_cozy', 'ivib_gone']],
            ['instanceDialogLanguages', ['jpn']]
        ]);
        vi.mocked(configRepository.getString).mockImplementation(
            async (key: string) => strings.get(key) ?? ''
        );
        vi.mocked(configRepository.getArray).mockImplementation(
            async (key: string) => arrays.get(key) ?? []
        );
        const result = renderCreateFlow('');

        await act(async () => {
            await result.current.openNewInstanceDialog();
        });

        expect(result.current.newInstanceRequest?.createOptions).toEqual(
            createOptions
        );
        expect(result.current.newInstanceRequest?.defaults).toMatchObject({
            description: 'Bring snacks',
            categoryId: 'icat_hangout',
            vibeIds: ['ivib_cozy'],
            languages: ['jpn']
        });
    });

    it('still opens the dialog with remembered vibes when the options fail to load', async () => {
        mocks.instanceCreateOptionsGet.mockRejectedValue(new Error('offline'));
        vi.mocked(configRepository.getArray).mockImplementation(
            async (key: string) =>
                key === 'instanceDialogVibeIds' ? ['ivib_cozy'] : []
        );
        const result = renderCreateFlow('');

        await act(async () => {
            await result.current.openNewInstanceDialog();
        });

        expect(result.current.newInstanceRequest?.createOptions).toBeNull();
        expect(result.current.newInstanceRequest?.defaults).toMatchObject({
            vibeIds: ['ivib_cozy']
        });
    });

    it('remembers discovery details as they are edited', () => {
        const result = renderCreateFlow('');

        act(() => {
            result.current.saveNewInstanceDraft(
                newInstanceForm({
                    description: 'Bring snacks',
                    categoryId: 'icat_hangout',
                    vibeIds: ['ivib_chill'],
                    languages: ['jpn']
                })
            );
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'instanceDialogDescription',
            'Bring snacks'
        );
        expect(configRepository.setString).toHaveBeenCalledWith(
            'instanceDialogCategoryId',
            'icat_hangout'
        );
        expect(configRepository.setArray).toHaveBeenCalledWith(
            'instanceDialogVibeIds',
            ['ivib_chill']
        );
        expect(configRepository.setArray).toHaveBeenCalledWith(
            'instanceDialogLanguages',
            ['jpn']
        );
    });

    it('sends discovery details limited to the options VRChat offers', async () => {
        const result = renderCreateFlow('');
        await submit(result, {
            description: '  Bring snacks  ',
            categoryId: 'icat_hangout',
            vibeIds: ['ivib_chill', 'ivib_gone'],
            languages: ['jpn', 'eng']
        });

        expect(configRepository.setArray).toHaveBeenCalledWith(
            'instanceDialogVibeIds',
            ['ivib_chill', 'ivib_gone']
        );
        expect(mocks.createInstance).toHaveBeenCalledWith(
            expect.objectContaining({
                description: 'Bring snacks',
                categoryId: 'icat_hangout',
                vibeIds: ['ivib_chill'],
                languages: ['jpn', 'eng']
            })
        );
    });

    it('omits category and vibes when their options could not be loaded', async () => {
        const result = renderCreateFlow('', false, null);
        await submit(result, {
            categoryId: 'icat_hangout',
            vibeIds: ['ivib_chill'],
            languages: ['jpn']
        });

        expect(mocks.createInstance).toHaveBeenCalledWith(
            expect.objectContaining({
                categoryId: '',
                vibeIds: [],
                languages: ['jpn']
            })
        );
    });

    it('closes the dialog and hands a plain new instance to the launch dialog', async () => {
        const result = renderCreateFlow('');
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.showLaunchDialog).toHaveBeenCalledWith(
            created.location,
            created.shortName,
            created.secureOrShortName,
            expect.objectContaining({ createdInstance: created })
        );
    });

    it('persists and forwards the group avatar-performance limit', async () => {
        const result = renderCreateFlow('');
        await submit(result, {
            accessType: 'group',
            groupId: 'grp_test',
            minimumAvatarPerformance: 'Good'
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'instanceDialogMinimumAvatarPerformance',
            'Good'
        );
        expect(mocks.createInstance).toHaveBeenCalledWith(
            expect.objectContaining({ minimumAvatarPerformance: 'Good' })
        );
    });

    it('closes the dialog without the launch dialog when the follow-up self-invite succeeds', async () => {
        const result = renderCreateFlow('selfInvite');
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.selfInviteToInstance).toHaveBeenCalledOnce();
        expect(mocks.showLaunchDialog).not.toHaveBeenCalled();
    });

    it('falls back to the launch dialog when the follow-up self-invite fails', async () => {
        mocks.selfInviteToInstance.mockRejectedValue(new Error('nope'));
        const result = renderCreateFlow('selfInvite');
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.showLaunchDialog).toHaveBeenCalledOnce();
    });

    it('closes the dialog without the launch dialog when the follow-up open in-game succeeds', async () => {
        const result = renderCreateFlow('openInGame', true);
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.tryOpenLaunchLocation).toHaveBeenCalledOnce();
        expect(mocks.showLaunchDialog).not.toHaveBeenCalled();
    });

    it('falls back to the launch dialog when the follow-up open in-game fails', async () => {
        mocks.tryOpenLaunchLocation.mockRejectedValue(new Error('nope'));
        const result = renderCreateFlow('openInGame', true);
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.showLaunchDialog).toHaveBeenCalledOnce();
    });
});
