import { mediaRepository } from '@/repositories/index.js';

function isHttpUrl(url) {
    try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error(`Unexpected image type: ${blob.type}`);
    }
    return blob;
}

async function fetchImageBlobDirect(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error(`Unexpected image type: ${blob.type}`);
    }

    return blob;
}

async function fetchImageBlobViaBackend(url) {
    const response = await mediaRepository.executeGet(url);
    const dataUrl = typeof response.json === 'string' ? response.json : '';

    if (!dataUrl.startsWith('data:image/')) {
        throw new Error('Image response is not a data URL');
    }

    return dataUrlToBlob(dataUrl);
}

export async function fetchImageBlob(url) {
    if (!url) {
        throw new Error('Missing image URL');
    }

    const normalizedUrl = String(url);
    if (normalizedUrl.startsWith('data:')) {
        return dataUrlToBlob(normalizedUrl);
    }

    if (isHttpUrl(normalizedUrl)) {
        try {
            return await fetchImageBlobViaBackend(normalizedUrl);
        } catch (backendError) {
            try {
                return await fetchImageBlobDirect(normalizedUrl);
            } catch {
                throw backendError;
            }
        }
    }

    return fetchImageBlobDirect(normalizedUrl);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const separatorIndex = dataUrl.indexOf(',');
            resolve(
                separatorIndex >= 0
                    ? dataUrl.slice(separatorIndex + 1)
                    : dataUrl
            );
        };
        reader.onerror = () => {
            reject(reader.error || new Error('Failed to read image data'));
        };
        reader.readAsDataURL(blob);
    });
}

export async function getDownloadImageBase64({ sourcePath, url }) {
    if (sourcePath) {
        return mediaRepository.getFileBase64(sourcePath);
    }

    const blob = await fetchImageBlob(url);
    return blobToBase64(blob);
}
