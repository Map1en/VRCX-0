import {
    executeBackendHttpRequest,
    type BackendHttpCommand
} from './vrchatRequest.js';

type ExternalHeaders = Record<string, string>;

interface ExternalRequestInput {
    url: string;
    method?: string;
    headers?: ExternalHeaders;
    body?: unknown;
}

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function executeExternal(
    commandName: BackendHttpCommand,
    { url, method = 'GET', headers = {}, body = null }: ExternalRequestInput
) {
    return executeBackendHttpRequest(commandName, {
        url,
        method,
        headers,
        body,
        jsonBody: false
    });
}

async function searchAvatarProvider({
    url,
    vrcxId
}: {
    url: string;
    vrcxId: string;
}) {
    return executeExternal('ExternalAvatarSearchExecute', {
        url,
        method: 'GET',
        headers: {
            Referer: 'https://vrcx.app',
            'VRCX-ID': vrcxId
        }
    });
}

async function executeTranslationRequest(input: ExternalRequestInput) {
    return executeExternal('ExternalTranslationExecute', input);
}

async function fetchYoutubeVideoMetadata({
    videoId,
    apiKey
}: {
    videoId: unknown;
    apiKey: unknown;
}) {
    const normalizedVideoId = normalizeString(videoId);
    const normalizedApiKey = normalizeString(apiKey);
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(normalizedVideoId)}&part=snippet,contentDetails&key=${encodeURIComponent(normalizedApiKey)}`;
    return executeExternal('ExternalYoutubeExecute', {
        url,
        method: 'GET'
    });
}

async function fetchVrcStatusJson(path: string) {
    return executeExternal('ExternalVrcStatusExecute', {
        url: `https://status.vrchat.com/api/v2/${path}`,
        method: 'GET',
        headers: {
            Referer: 'https://vrcx.app'
        }
    });
}

async function fetchGithubReleases({
    url,
    headers = {}
}: {
    url: string;
    headers?: ExternalHeaders;
}) {
    return executeExternal('ExternalUpdateReleaseExecute', {
        url,
        method: 'GET',
        headers
    });
}

async function fetchImageDataUrl(url: string) {
    return executeExternal('ExternalImageExecute', {
        url,
        method: 'GET'
    });
}

const externalApiRepository = Object.freeze({
    searchAvatarProvider,
    executeTranslationRequest,
    fetchYoutubeVideoMetadata,
    fetchVrcStatusJson,
    fetchGithubReleases,
    fetchImageDataUrl
});

export {
    executeTranslationRequest,
    fetchGithubReleases,
    fetchImageDataUrl,
    fetchVrcStatusJson,
    fetchYoutubeVideoMetadata,
    searchAvatarProvider
};
export default externalApiRepository;
