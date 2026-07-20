// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    getFileAnalysis: vi.fn(),
    getInstance: vi.fn(),
    getWorldProfile: vi.fn(),
    openImagePreview: vi.fn(),
    readWorldCacheInfo: vi.fn()
}));

vi.mock('@/lib/fileAnalysis', () => ({
    getFileAnalysisForUnityPackages: mocks.getFileAnalysis
}));

vi.mock('@/lib/worldAssetBundle', async () => {
    const actual = await vi.importActual('@/lib/worldAssetBundle');
    return {
        ...actual,
        readWorldCacheInfo: mocks.readWorldCacheInfo
    };
});

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: {
        getConfig: mocks.getConfig
    }
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        getInstance: mocks.getInstance
    }
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: {
        getWorldProfile: mocks.getWorldProfile
    }
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: {
            openImagePreview: typeof mocks.openImagePreview;
        }) => T
    ) => selector({ openImagePreview: mocks.openImagePreview })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserEndpoint: string;
                currentUserSnapshot: null;
            };
        }) => T
    ) =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.example.test/api/1',
                currentUserSnapshot: null
            }
        })
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/components/LocationWorld', () => ({
    LocationWorld: () => <div />
}));

vi.mock('@/ui/shadcn/badge', () => ({
    Badge: ({
        children,
        variant: _variant,
        ...props
    }: PropsWithChildren<ComponentProps<'span'> & { variant?: unknown }>) => (
        <span {...props}>{children}</span>
    )
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        ...props
    }: PropsWithChildren<ComponentProps<'button'> & { variant?: unknown }>) => (
        <button {...props}>{children}</button>
    )
}));

import { PlayerListWorldHeader } from './PlayerListWorldHeader';

describe('PlayerListWorldHeader', () => {
    beforeEach(() => {
        mocks.getConfig.mockReset();
        mocks.getFileAnalysis.mockReset();
        mocks.getInstance.mockReset();
        mocks.getWorldProfile.mockReset();
        mocks.openImagePreview.mockReset();
        mocks.readWorldCacheInfo.mockReset();

        mocks.getConfig.mockResolvedValue({ json: {} });
        mocks.getFileAnalysis.mockResolvedValue({});
        mocks.getInstance.mockResolvedValue({
            json: { capacity: 100 }
        });
        mocks.getWorldProfile.mockResolvedValue({
            id: 'wrld_test',
            name: 'Test World',
            capacity: 80,
            unityPackages: []
        });
        mocks.readWorldCacheInfo.mockResolvedValue({
            cacheSize: '',
            inCache: false
        });
    });

    afterEach(cleanup);

    it('prefers the current instance capacity over the world capacity', async () => {
        render(
            <PlayerListWorldHeader
                clockNow={1_700_000_000_000}
                friendCount={0}
                instanceSnapshot={{
                    createdAt: '2023-11-14T22:00:00.000Z',
                    groupName: 'Test Group',
                    location:
                        'wrld_test:12345~group(grp_test)~groupAccessType(plus)',
                    playerCount: 99,
                    source: 'database',
                    time: 0,
                    worldId: 'wrld_test',
                    worldName: 'Test World'
                }}
                isGameRunning
                playerCount={99}
            />
        );

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledWith({
                worldId: 'wrld_test',
                instanceId: '12345~group(grp_test)~groupAccessType(plus)'
            });
        });
        expect(await screen.findByText('99/100')).toBeTruthy();
    });
});
