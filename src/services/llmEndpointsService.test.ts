import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    LlmEndpointDto,
    LlmEndpointUpsertInput
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    upsert: vi.fn(),
    deleteEndpoint: vi.fn(),
    detectModels: vi.fn(),
    publishToolsStatusUpdated: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appLlmEndpointList: mocks.list,
        appLlmEndpointUpsert: mocks.upsert,
        appLlmEndpointDelete: mocks.deleteEndpoint,
        appLlmEndpointDetectModels: mocks.detectModels
    }
}));

vi.mock('@/shared/constants/tools', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/shared/constants/tools')>()),
    publishToolsStatusUpdated: mocks.publishToolsStatusUpdated
}));

import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    deleteLlmEndpoint,
    detectLlmEndpointModels,
    loadLlmEndpoints,
    openLlmEndpointsManager,
    upsertLlmEndpoint
} from './llmEndpointsService';

function endpoint(models: string[], id = 'ep_1'): LlmEndpointDto {
    return {
        id,
        name: 'Provider',
        baseUrl: 'https://example.com/v1',
        apiKey: '',
        hasKey: false,
        models,
        modelReasoning: [],
        lastDetectedAt: null
    };
}

function upsertInput(saved: LlmEndpointDto): LlmEndpointUpsertInput {
    return {
        id: saved.id,
        name: saved.name,
        baseUrl: saved.baseUrl,
        apiKey: null,
        models: saved.models,
        modelReasoning: null
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('llm endpoint orchestration', () => {
    beforeEach(() => {
        mocks.list.mockReset();
        mocks.upsert.mockReset();
        mocks.deleteEndpoint.mockReset();
        mocks.detectModels.mockReset();
        mocks.publishToolsStatusUpdated.mockReset();
        useLlmEndpointsStore.setState({
            endpoints: [],
            loading: false,
            error: null
        });
    });

    it('loads endpoints into the store without publishing a tools update', async () => {
        const endpoints = [endpoint(['a'])];
        mocks.list.mockResolvedValue(endpoints);

        const pending = loadLlmEndpoints();
        expect(useLlmEndpointsStore.getState().loading).toBe(true);
        await expect(pending).resolves.toBe(endpoints);

        expect(useLlmEndpointsStore.getState()).toMatchObject({
            endpoints,
            loading: false,
            error: null
        });
        expect(mocks.publishToolsStatusUpdated).not.toHaveBeenCalled();
    });

    it('records the error message, rethrows and clears it on the next operation', async () => {
        const failure = new Error('list failed');
        mocks.list.mockRejectedValueOnce(failure);

        await expect(loadLlmEndpoints()).rejects.toBe(failure);
        expect(useLlmEndpointsStore.getState()).toMatchObject({
            loading: false,
            error: 'list failed'
        });

        const next = deferred<LlmEndpointDto[]>();
        mocks.list.mockReturnValueOnce(next.promise);
        const pending = loadLlmEndpoints();
        expect(useLlmEndpointsStore.getState().error).toBeNull();
        next.resolve([]);
        await pending;
    });

    it('stringifies non-Error failures', async () => {
        mocks.deleteEndpoint.mockRejectedValue('nope');

        await expect(deleteLlmEndpoint('ep_1')).rejects.toBe('nope');

        expect(useLlmEndpointsStore.getState().error).toBe('nope');
    });

    it('replaces a saved endpoint in place, appends new ones and publishes each save', async () => {
        const other = endpoint(['x'], 'ep_2');
        useLlmEndpointsStore.setState({
            endpoints: [endpoint(['old']), other]
        });
        const replaced = endpoint(['new']);
        const created = endpoint(['c'], 'ep_3');
        mocks.upsert
            .mockResolvedValueOnce(replaced)
            .mockResolvedValueOnce(created);

        await expect(upsertLlmEndpoint(upsertInput(replaced))).resolves.toBe(
            replaced
        );
        await upsertLlmEndpoint(upsertInput(created));

        expect(useLlmEndpointsStore.getState().endpoints).toEqual([
            replaced,
            other,
            created
        ]);
        expect(mocks.publishToolsStatusUpdated).toHaveBeenCalledTimes(2);
    });

    it('does not publish or change endpoints when a save fails', async () => {
        const existing = [endpoint(['old'])];
        useLlmEndpointsStore.setState({ endpoints: existing });
        mocks.upsert.mockRejectedValue(new Error('save failed'));

        await expect(
            upsertLlmEndpoint(upsertInput(endpoint([])))
        ).rejects.toThrow('save failed');

        expect(useLlmEndpointsStore.getState().endpoints).toBe(existing);
        expect(mocks.publishToolsStatusUpdated).not.toHaveBeenCalled();
    });

    it('removes a deleted endpoint and publishes the change', async () => {
        const kept = endpoint([], 'ep_2');
        useLlmEndpointsStore.setState({ endpoints: [endpoint([]), kept] });
        mocks.deleteEndpoint.mockResolvedValue(null);

        await deleteLlmEndpoint('ep_1');

        expect(mocks.deleteEndpoint).toHaveBeenCalledWith('ep_1');
        expect(useLlmEndpointsStore.getState().endpoints).toEqual([kept]);
        expect(mocks.publishToolsStatusUpdated).toHaveBeenCalledOnce();
    });

    it('reloads the authoritative endpoint after persisted detection', async () => {
        const authoritative = endpoint(['authoritative-model']);
        mocks.detectModels.mockResolvedValue({
            models: ['response-model'],
            modelReasoning: []
        });
        mocks.list.mockResolvedValue([authoritative]);

        await detectLlmEndpointModels({
            id: 'ep_1',
            baseUrl: null,
            apiKey: null,
            persist: true
        });

        expect(mocks.list).toHaveBeenCalledOnce();
        expect(useLlmEndpointsStore.getState().endpoints).toEqual([
            authoritative
        ]);
        expect(mocks.publishToolsStatusUpdated).toHaveBeenCalledOnce();
    });

    it('returns detected models without reloading when detection is not persisted', async () => {
        const result = { models: ['m'], modelReasoning: [] };
        mocks.detectModels.mockResolvedValue(result);

        await expect(
            detectLlmEndpointModels({
                id: 'ep_1',
                baseUrl: null,
                apiKey: null,
                persist: false
            })
        ).resolves.toBe(result);
        await detectLlmEndpointModels({
            id: null,
            baseUrl: 'https://example.com/v1',
            apiKey: null,
            persist: true
        });

        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.publishToolsStatusUpdated).not.toHaveBeenCalled();
    });

    it('drops a persisted detection reload that finishes after a newer save', async () => {
        const detection = deferred<{ models: string[]; modelReasoning: [] }>();
        mocks.detectModels.mockReturnValue(detection.promise);
        mocks.list.mockResolvedValue([endpoint(['stale'])]);
        const saved = endpoint(['saved']);
        mocks.upsert.mockResolvedValue(saved);

        const detect = detectLlmEndpointModels({
            id: 'ep_1',
            baseUrl: null,
            apiKey: null,
            persist: true
        });
        await upsertLlmEndpoint(upsertInput(saved));
        detection.resolve({ models: ['stale'], modelReasoning: [] });
        await detect;

        expect(mocks.list).toHaveBeenCalledOnce();
        expect(useLlmEndpointsStore.getState().endpoints).toEqual([saved]);
        expect(mocks.publishToolsStatusUpdated).toHaveBeenCalledOnce();
    });

    it('does not let an older load overwrite a completed upsert', async () => {
        const load = deferred<LlmEndpointDto[]>();
        mocks.list.mockReturnValue(load.promise);
        const saved = endpoint(['new-model']);
        mocks.upsert.mockResolvedValue(saved);

        const loading = loadLlmEndpoints();
        await upsertLlmEndpoint(upsertInput(saved));
        expect(useLlmEndpointsStore.getState().loading).toBe(true);

        load.resolve([endpoint(['old-model'])]);
        await expect(loading).resolves.toEqual([endpoint(['old-model'])]);

        expect(useLlmEndpointsStore.getState().endpoints).toEqual([saved]);
        expect(useLlmEndpointsStore.getState().loading).toBe(false);
    });

    it('stays loading until every overlapping operation settles', async () => {
        const first = deferred<LlmEndpointDto[]>();
        const second = deferred<LlmEndpointDto[]>();
        mocks.list
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const a = loadLlmEndpoints();
        const b = loadLlmEndpoints();
        second.resolve([]);
        await b;
        expect(useLlmEndpointsStore.getState().loading).toBe(true);

        first.reject(new Error('late failure'));
        await expect(a).rejects.toThrow('late failure');
        expect(useLlmEndpointsStore.getState()).toMatchObject({
            loading: false,
            error: 'late failure'
        });
    });

    it('opens the endpoints manager host', () => {
        useRuntimeStore.getState().setSystemHostOpen('llmEndpointsOpen', false);

        openLlmEndpointsManager();

        expect(useRuntimeStore.getState().systemHosts.llmEndpointsOpen).toBe(
            true
        );
    });
});
