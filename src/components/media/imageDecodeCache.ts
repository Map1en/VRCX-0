const MAX_DECODED_IMAGES = 6;

type DecodeEntry = {
    image: HTMLImageElement;
    promise: Promise<void>;
    decoded: boolean;
};

const entries = new Map<string, DecodeEntry>();

function waitForImage(image: HTMLImageElement) {
    if (typeof image.decode === 'function') {
        return image.decode();
    }
    return new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('load')), {
            once: true
        });
    });
}

function touch(src: string, entry: DecodeEntry) {
    entries.delete(src);
    entries.set(src, entry);
    while (entries.size > MAX_DECODED_IMAGES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        entries.delete(oldest);
    }
}

export function decodeImage(src: string): Promise<void> {
    if (!src) {
        return Promise.reject(new Error('Image source is empty.'));
    }
    const existing = entries.get(src);
    if (existing) {
        touch(src, existing);
        return existing.promise;
    }
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    const entry: DecodeEntry = {
        image,
        decoded: false,
        promise: Promise.resolve()
    };
    entry.promise = waitForImage(image).then(
        () => {
            entry.decoded = true;
        },
        (error: unknown) => {
            if (entries.get(src) === entry) {
                entries.delete(src);
            }
            throw error;
        }
    );
    touch(src, entry);
    return entry.promise;
}

export function isImageDecoded(src: string) {
    return Boolean(src && entries.get(src)?.decoded);
}

export function preloadImages(sources: readonly string[]) {
    for (const src of sources) {
        if (src) {
            decodeImage(src).catch(() => {});
        }
    }
}

export function clearDecodedImagesForTest() {
    entries.clear();
}
