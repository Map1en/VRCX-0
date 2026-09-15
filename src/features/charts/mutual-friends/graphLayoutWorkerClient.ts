import type {
    GraphLayoutPositions,
    GraphLayoutRequest,
    GraphLayoutResponse
} from '../graphLayoutTypes';
import GraphLayoutWorker from '../graphLayoutWorker.js?worker&inline';

export type { GraphLayoutRequest };

export type GraphLayoutWorkerPort = {
    onMessage: (listener: (response: GraphLayoutResponse) => void) => void;
    onError: (listener: (error: unknown) => void) => void;
    postMessage: (request: GraphLayoutRequest) => void;
    terminate: () => void;
};

export type GraphLayoutRunner = (
    request: GraphLayoutRequest
) => Promise<GraphLayoutPositions>;

function runWorker(
    createWorker: () => GraphLayoutWorkerPort,
    request: GraphLayoutRequest
): Promise<GraphLayoutPositions> {
    return new Promise((resolve, reject) => {
        const worker = createWorker();
        worker.onMessage((response) => {
            if (response.requestId !== request.requestId) {
                return;
            }
            worker.terminate();
            if (response.error) {
                reject(new Error(response.error));
                return;
            }
            resolve(response.positions ?? {});
        });
        worker.onError((error) => {
            worker.terminate();
            reject(
                error instanceof Error
                    ? error
                    : new Error('Graph layout worker failed.')
            );
        });
        try {
            worker.postMessage(request);
        } catch (error) {
            worker.terminate();
            reject(error);
        }
    });
}

export function createGraphLayoutRunner(
    createWorker: () => GraphLayoutWorkerPort
): GraphLayoutRunner {
    let queue = Promise.resolve();
    return (request: GraphLayoutRequest): Promise<GraphLayoutPositions> => {
        const task = queue.then(() => runWorker(createWorker, request));
        queue = task.then(
            () => undefined,
            () => undefined
        );
        return task;
    };
}

export const runGraphLayoutWorker = createGraphLayoutRunner(() => {
    const worker = new GraphLayoutWorker();
    return {
        onMessage(listener) {
            worker.addEventListener('message', (event) => listener(event.data));
        },
        onError(listener) {
            worker.addEventListener('error', (event) =>
                listener(event.error || new Error(event.message))
            );
        },
        postMessage(request) {
            worker.postMessage(request);
        },
        terminate() {
            worker.terminate();
        }
    };
});
