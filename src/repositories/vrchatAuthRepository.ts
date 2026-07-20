import {
    commands,
    type AutoLoginOutcome,
    type LoginSessionState
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import {
    type VrchatRequestResponse,
    unwrapVrchatResponse
} from './vrchatRequest';

export const DEFAULT_ENDPOINT_DOMAIN = DEFAULT_VRCHAT_API_ENDPOINT;
export const DEFAULT_WEBSOCKET_DOMAIN = 'wss://pipeline.vrchat.cloud';

type VrchatApiResult = {
    status: number;
    data: unknown;
};
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

interface FileAnalysisInput {
    fileId?: unknown;
    version?: unknown;
    variant?: unknown;
}

async function getConfig() {
    const response = await commands.appVrchatAuthConfigGet();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'config');
}

async function getCurrentUser() {
    const response = await commands.appVrchatAuthCurrentUserGet();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'auth/user');
}

interface StartBasicLoginSessionInput {
    mode: 'basic';
    username?: unknown;
    password?: unknown;
    saveCredentials?: boolean;
}

interface StartSavedCredentialLoginSessionInput {
    mode: 'savedCredential';
    userId?: unknown;
}

type StartLoginSessionInput =
    | StartBasicLoginSessionInput
    | StartSavedCredentialLoginSessionInput;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '');
}

async function startLoginSession(
    input: StartLoginSessionInput
): Promise<LoginSessionState> {
    switch (input.mode) {
        case 'basic':
            return commands.appVrchatAuthSessionStart({
                mode: 'basic',
                username: normalizeString(input.username),
                password: normalizeString(input.password),
                saveCredentials: input.saveCredentials === true
            });
        case 'savedCredential':
            return commands.appVrchatAuthSessionStart({
                mode: 'savedCredential',
                userId: normalizeString(input.userId)
            });
    }
}

async function respondLoginSession({
    attemptId,
    method,
    code
}: {
    attemptId: string;
    method?: unknown;
    code?: unknown;
}): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionRespond({
        attemptId: normalizeString(attemptId),
        method: normalizeString(method),
        code: normalizeString(code)
    });
}

async function cancelLoginSession(
    attemptId: string
): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionCancel({
        attemptId: normalizeString(attemptId)
    });
}

interface AutoLoginStartInput {
    userId?: unknown;
}

async function autoLoginStart({
    userId
}: AutoLoginStartInput): Promise<AutoLoginOutcome> {
    return commands.appVrchatAuthAutoLoginStart({
        userId: normalizeString(userId)
    });
}

async function getOnlineVisits() {
    const response = await commands.appVrchatAuthVisitsGet();
    return unwrapVrchatAuthResponse<unknown[]>(response, 'visits');
}

async function getFileAnalysis({
    fileId,
    version,
    variant
}: FileAnalysisInput) {
    const response = await commands.appVrchatAuthFileAnalysisGet({
        fileId: typeof fileId === 'string' ? fileId : String(fileId ?? ''),
        version: Number(version) || 0,
        variant: typeof variant === 'string' ? variant : String(variant ?? '')
    });
    return unwrapVrchatAuthResponse(
        response,
        `analysis/${encodeURIComponent(String(fileId ?? ''))}/${Number(version) || 0}/${encodeURIComponent(String(variant ?? ''))}`
    );
}

const vrchatAuthRepository = Object.freeze({
    getConfig,
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
    getCurrentUser,
    startLoginSession,
    respondLoginSession,
    cancelLoginSession,
    autoLoginStart,
    getOnlineVisits,
    getFileAnalysis
};
export type { StartLoginSessionInput };
export default vrchatAuthRepository;
