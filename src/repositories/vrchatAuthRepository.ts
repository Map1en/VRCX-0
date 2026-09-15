import {
    commands,
    type AutoLoginStartInput,
    type AutoLoginOutcome,
    type HttpApiExecuteResponse,
    type LoginSessionRespondInput,
    type LoginSessionStartInput as StartLoginSessionInput,
    type LoginSessionState,
    type VrchatAuthFileAnalysisInput
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import {
    type VrchatRequestResponse,
    unwrapVrchatResponse
} from './vrchatRequest';

export const DEFAULT_ENDPOINT_DOMAIN = DEFAULT_VRCHAT_API_ENDPOINT;
type VrchatApiResult = HttpApiExecuteResponse;
type AuthRecord = Record<string, unknown>;

function unwrapVrchatAuthResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string
): VrchatRequestResponse<TJson> {
    return {
        ...unwrapVrchatResponse<TJson>(response, path),
        endpointDomain: DEFAULT_VRCHAT_API_ENDPOINT
    };
}

async function getConfig() {
    const response = await commands.appVrchatAuthConfigGet();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'config');
}

async function refreshConfig() {
    const response = await commands.appVrchatAuthConfigRefresh();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'config');
}

async function getCurrentUser() {
    const response = await commands.appVrchatAuthCurrentUserGet();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'auth/user');
}

async function startLoginSession(
    input: StartLoginSessionInput
): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionStart(input);
}

async function respondLoginSession(
    input: LoginSessionRespondInput
): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionRespond(input);
}

async function cancelLoginSession(
    attemptId: string
): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionCancel({ attemptId });
}

async function autoLoginStart({
    userId
}: AutoLoginStartInput): Promise<AutoLoginOutcome> {
    return commands.appVrchatAuthAutoLoginStart({ userId });
}

async function getOnlineVisits() {
    const response = await commands.appVrchatAuthVisitsGet();
    return unwrapVrchatAuthResponse<unknown[]>(response, 'visits');
}

async function getFileAnalysis({
    fileId,
    version,
    variant
}: VrchatAuthFileAnalysisInput) {
    const response = await commands.appVrchatAuthFileAnalysisGet({
        fileId,
        version,
        variant
    });
    return unwrapVrchatAuthResponse(
        response,
        `analysis/${encodeURIComponent(fileId ?? '')}/${version ?? 0}/${encodeURIComponent(variant ?? '')}`
    );
}

const vrchatAuthRepository = Object.freeze({
    getConfig,
    refreshConfig,
    getCurrentUser,
    startLoginSession,
    respondLoginSession,
    cancelLoginSession,
    autoLoginStart,
    getOnlineVisits,
    getFileAnalysis
});

export {
    getConfig,
    refreshConfig,
    getCurrentUser,
    startLoginSession,
    respondLoginSession,
    cancelLoginSession,
    getFileAnalysis
};
export default vrchatAuthRepository;
