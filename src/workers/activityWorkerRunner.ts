import ActivityWorker from './activityWorker.js?worker&inline';

let worker: Worker | null = null;
let workerSeq = 0;
const pendingWorkerCallbacks = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

function getWorker() {
    if (!worker) {
        worker = new ActivityWorker();
        worker.onmessage = (event: MessageEvent) => {
            const { type, seq, payload } = event.data;
            const callback = pendingWorkerCallbacks.get(seq);
            if (!callback) {
                return;
            }
            pendingWorkerCallbacks.delete(seq);
            if (type === 'error') {
                callback.reject(new Error(payload.message));
                return;
            }
            callback.resolve(payload);
        };
    }
    return worker;
}

export function runActivityWorkerTask(
    type: unknown,
    payload: unknown
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const seq = ++workerSeq;
        pendingWorkerCallbacks.set(seq, { resolve, reject });
        getWorker().postMessage({ type, seq, payload });
    });
}
