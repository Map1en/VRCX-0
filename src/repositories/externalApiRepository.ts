import { backend } from '@/platform/index.js';

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

async function searchAvatarProvider({
    url,
    vrcxId
}: {
    url: string;
    vrcxId: string;
}) {
    return backend.app.BackendExternalAvatarSearchGet({ url, vrcxId });
}

async function executeTranslationRequest({
    url,
    method = 'GET',
    headers = {},
    body = null
}: ExternalRequestInput) {
    return backend.app.BackendExternalTranslationRequest({
        url,
        method,
        headers,
        body
    });
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
    return backend.app.BackendExternalYoutubeVideoMetadataGet({
        videoId: normalizedVideoId,
        apiKey: normalizedApiKey
    });
}

async function fetchVrcStatusJson(path: string) {
    return backend.app.BackendExternalVrcStatusJsonGet({ path });
}

async function fetchGithubReleases({
    url,
    headers = {}
}: {
    url: string;
    headers?: ExternalHeaders;
}) {
    return backend.app.BackendExternalGithubReleasesGet({
        url,
        headers
    });
}

async function fetchImageDataUrl(url: string) {
    return backend.app.BackendExternalImageDataUrlGet({ url });
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
