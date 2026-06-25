import mediaRepository from '@/repositories/mediaRepository';

const MAX_ACTIVE_THUMBNAIL_REQUESTS = 2;

interface ThumbnailTask {
    path: string;
    resolve: ((value: unknown) => void) | null;
    reject: ((reason?: unknown) => void) | null;
    promise: Promise<unknown> | null;
    subscribers: number;
    started: boolean;
    cancelled: boolean;
    sequence: number;
}

let activeRequests = 0;
let requestSequence = 0;
const queue: ThumbnailTask[] = [];
const inFlightByPath = new Map<string, ThumbnailTask>();

function runNextThumbnailRequest() {
    while (activeRequests < MAX_ACTIVE_THUMBNAIL_REQUESTS && queue.length) {
        const task = queue.shift();
        if (!task) {
            continue;
        }
        if (task.cancelled) {
            if (inFlightByPath.get(task.path) === task) {
                inFlightByPath.delete(task.path);
            }
            continue;
        }
        task.started = true;
        activeRequests += 1;
        mediaRepository
            .ensureScreenshotThumbnail(task.path)
            .then(task.resolve, task.reject)
            .finally(() => {
                activeRequests -= 1;
                if (inFlightByPath.get(task.path) === task) {
                    inFlightByPath.delete(task.path);
                }
                runNextThumbnailRequest();
            });
    }
}

export function requestScreenshotThumbnail(path: any) {
    const filePath = String(path || '');
    if (!filePath) {
        return {
            promise: Promise.reject(new Error('Screenshot path is empty.')),
            cancel: () => {}
        };
    }

    const existing = inFlightByPath.get(filePath);
    if (existing && existing.promise) {
        existing.subscribers += 1;
        return {
            promise: existing.promise,
            cancel: () => cancelThumbnailRequest(existing)
        };
    }

    const task: ThumbnailTask = {
        path: filePath,
        resolve: null,
        reject: null,
        promise: null,
        subscribers: 1,
        started: false,
        cancelled: false,
        sequence: (requestSequence += 1)
    };
    const promise = new Promise((resolve: any, reject: any) => {
        task.resolve = resolve;
        task.reject = reject;
        queue.push(task);
        queue.sort((left: any, right: any) => left.sequence - right.sequence);
        runNextThumbnailRequest();
    });
    task.promise = promise;
    inFlightByPath.set(filePath, task);
    return {
        promise,
        cancel: () => cancelThumbnailRequest(task)
    };
}

function cancelThumbnailRequest(task: any) {
    if (!task || task.cancelled) {
        return;
    }
    task.subscribers -= 1;
    if (task.subscribers > 0 || task.started) {
        return;
    }
    task.cancelled = true;
    inFlightByPath.delete(task.path);
    if (typeof task.reject === 'function') {
        task.reject(new Error('Thumbnail request cancelled.'));
    }
}
