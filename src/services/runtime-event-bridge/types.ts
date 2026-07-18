import type {
    BackendRuntimeEventPayloadMap,
    BackendRuntimeSnapshot
} from '@/platform/tauri/bindings';

export type RuntimeEventPayloadMap = BackendRuntimeEventPayloadMap & {
    browserFocus: unknown;
};

export type RuntimeEventName = keyof RuntimeEventPayloadMap;

export type RuntimeEvent<Name extends RuntimeEventName = RuntimeEventName> = {
    [EventName in Name]: {
        name: EventName;
        payload: RuntimeEventPayloadMap[EventName];
    };
}[Name];

export type FavoritesChangedEventPayload =
    RuntimeEventPayloadMap['favoritesChanged'];

export type RuntimeGroupInstancesProjection =
    RuntimeEventPayloadMap['runtimeGroupInstancesProjection'];

export type RuntimeSnapshotPayload =
    | BackendRuntimeSnapshot
    | Record<string, unknown>
    | null;
