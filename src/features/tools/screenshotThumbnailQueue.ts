// @ts-nocheck
import { mediaRepository } from '@/repositories/index.js';

const MAX_ACTIVE_THUMBNAIL_REQUESTS = 2;

let activeRequests = 0;
let requestSequence = 0;
const queue = [];
const inFlightByPath = new Map();

function runNextThumbnailRequest() {
    while (activeRequests < MAX_ACTIVE_THUMBNAIL_REQUESTS && queue.length) {
        const task = queue.shift();
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

export function requestScreenshotThumbnail(path) {
    const filePath = String(path || '');
    if (!filePath) {
        return {
            promise: Promise.reject(new Error('Screenshot path is empty.')),
            cancel: () => {}
        };
    }

    const existing = inFlightByPath.get(filePath);
    if (existing) {
        existing.subscribers += 1;
        return {
            promise: existing.promise,
            cancel: () => cancelThumbnailRequest(existing)
        };
    }

    const task = {
        path: filePath,
        resolve: null,
        reject: null,
        promise: null,
        subscribers: 1,
        started: false,
        cancelled: false,
        sequence: requestSequence += 1
    };
    const promise = new Promise((resolve, reject) => {
        task.resolve = resolve;
        task.reject = reject;
        queue.push(task);
        queue.sort((left, right) => left.sequence - right.sequence);
        runNextThumbnailRequest();
    });
    task.promise = promise;
    inFlightByPath.set(filePath, task);
    return {
        promise,
        cancel: () => cancelThumbnailRequest(task)
    };
}

function cancelThumbnailRequest(task) {
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
