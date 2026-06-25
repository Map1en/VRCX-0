import { commands } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

type ExternalHeaders = Record<string, string>;

interface ExternalRequestInput {
    url: string;
    method?: string;
    headers?: ExternalHeaders;
    body?: unknown;
}

async function searchAvatarProvider({
    url,
    vrcxId
}: {
    url: string;
    vrcxId: string;
}) {
    return commands.appExternalApiAvatarSearchGet({ url, vrcxId });
}

async function executeTranslationRequest({
    url,
    method = 'GET',
    headers = {},
    body = null
}: ExternalRequestInput) {
    return commands.appExternalApiTranslationRequest({
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
    return commands.appExternalApiYoutubeVideoMetadataGet({
        videoId: normalizedVideoId,
        apiKey: normalizedApiKey
    });
}

async function fetchVrcStatusJson(path: string) {
    return commands.appExternalApiVrcStatusJsonGet({ path });
}

async function fetchGithubReleases({
    url,
    headers = {}
}: {
    url: string;
    headers?: ExternalHeaders;
}) {
    return commands.appExternalApiGithubReleasesGet({
        url,
        headers
    });
}

async function fetchImageDataUrl(url: string) {
    return commands.appExternalApiImageDataUrlGet({ url });
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
