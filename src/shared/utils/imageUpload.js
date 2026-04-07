import { bytesToBase64 } from './binary';

const UPLOAD_TIMEOUT_MS = 30_000;

/**
 *
 * @param promise
 */
export function withUploadTimeout(promise) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error('Upload timed out')),
                UPLOAD_TIMEOUT_MS
            )
        )
    ]);
}

export async function readBlobAsBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * File -> base64
 * @param {Blob|File} blob
 * @returns {Promise<string>} base64 encoded string
 */
export async function readFileAsBase64(blob) {
    return bytesToBase64(await readBlobAsBytes(blob));
}
