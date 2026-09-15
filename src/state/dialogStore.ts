import { create } from 'zustand';

type DialogKind = string;

interface DialogBreadcrumb {
    kind?: DialogKind;
    entityId?: string;
    title?: string;
    label?: string;
    description?: string;
    payload?: unknown;
    [key: string]: unknown;
}

interface WorldNewInstanceDefaults {
    accessType?: string | null;
    region?: string | null;
    groupId?: string | null;
    groupName?: string | null;
    groupAccessType?: string | null;
}

interface DialogPayload {
    seedData?: unknown;
    initialAction?: string;
    initialActionNonce?: number;
    initialNewInstanceDefaults?: WorldNewInstanceDefaults | null;
}

interface ActiveDialog {
    kind: DialogKind;
    entityId: string;
    title: string;
    description?: string;
    openNonce?: number;
    payload?: DialogPayload | null;
    body?: string;
    crumb?: DialogBreadcrumb;
    [key: string]: unknown;
}

interface DialogMetadataPatch {
    kind?: DialogKind;
    entityId?: string;
    title?: string;
    description?: string;
}

interface DialogStoreState {
    activeDialog: ActiveDialog | null;
    breadcrumbs: DialogBreadcrumb[];
    openDialog: (dialog: ActiveDialog | null) => void;
    setDialog: (dialog: ActiveDialog | null) => void;
    setDialogTrail: (
        dialog: ActiveDialog | null,
        breadcrumbs: DialogBreadcrumb[]
    ) => void;
    updateEntityDialogMetadata: (patch?: DialogMetadataPatch) => void;
    closeDialog: () => void;
    setBreadcrumbs: (breadcrumbs: DialogBreadcrumb[]) => void;
    pushBreadcrumb: (crumb: DialogBreadcrumb) => void;
    popToBreadcrumb: (index: number) => void;
    clearDialogState: () => void;
}

const initialState: Pick<DialogStoreState, 'activeDialog' | 'breadcrumbs'> = {
    activeDialog: null,
    breadcrumbs: []
};

function dialogFromBreadcrumb(crumb: DialogBreadcrumb): ActiveDialog | null {
    if (!crumb?.kind || !crumb?.entityId) {
        return null;
    }

    return {
        kind: crumb.kind,
        entityId: crumb.entityId,
        title: crumb.title ?? crumb.label ?? crumb.kind,
        description: crumb.description ?? '',
        payload: crumb.payload ?? null
    };
}

function isSameEntity(
    left: DialogBreadcrumb | ActiveDialog | null,
    rightKind: string,
    rightEntityId: string
): boolean {
    return (
        left?.kind === rightKind &&
        (left?.entityId?.trim() ?? '') === rightEntityId
    );
}

export const useDialogStore = create<DialogStoreState>((set) => ({
    ...initialState,
    openDialog(dialog) {
        set((state) => {
            return {
                activeDialog: dialog,
                breadcrumbs: dialog?.crumb
                    ? [...state.breadcrumbs, dialog.crumb]
                    : state.breadcrumbs
            };
        });
    },
    setDialog(dialog) {
        set({ activeDialog: dialog });
    },
    setDialogTrail(dialog, breadcrumbs) {
        set({
            activeDialog: dialog,
            breadcrumbs
        });
    },
    updateEntityDialogMetadata(patch = {}) {
        const { kind, entityId, title = '', description = '' } = patch;
        const normalizedKind = kind?.trim() ?? '';
        const normalizedEntityId = entityId?.trim() ?? '';
        const normalizedTitle = title.trim();
        const normalizedDescription = description.trim();
        if (
            !normalizedKind ||
            !normalizedEntityId ||
            (!normalizedTitle && !normalizedDescription)
        ) {
            return;
        }
        set((state) => {
            const activeDialog = state.activeDialog;
            const nextActiveDialog =
                activeDialog &&
                isSameEntity(activeDialog, normalizedKind, normalizedEntityId)
                    ? {
                          ...activeDialog,
                          ...(normalizedTitle
                              ? { title: normalizedTitle }
                              : {}),
                          ...(normalizedDescription
                              ? { description: normalizedDescription }
                              : {})
                      }
                    : activeDialog;
            const nextState = {
                activeDialog: nextActiveDialog,
                breadcrumbs: state.breadcrumbs.map((crumb) =>
                    isSameEntity(crumb, normalizedKind, normalizedEntityId)
                        ? {
                              ...crumb,
                              ...(normalizedTitle
                                  ? {
                                        label: normalizedTitle,
                                        title: normalizedTitle
                                    }
                                  : {}),
                              ...(normalizedDescription
                                  ? { description: normalizedDescription }
                                  : {})
                          }
                        : crumb
                )
            };
            return nextState;
        });
    },
    closeDialog() {
        set({ activeDialog: null, breadcrumbs: [] });
    },
    setBreadcrumbs(breadcrumbs) {
        set({ breadcrumbs });
    },
    pushBreadcrumb(crumb) {
        set((state) => ({
            breadcrumbs: [...state.breadcrumbs, crumb]
        }));
    },
    popToBreadcrumb(index) {
        set((state) => ({
            activeDialog:
                dialogFromBreadcrumb(state.breadcrumbs[index]) ??
                state.activeDialog,
            breadcrumbs: state.breadcrumbs.slice(0, index + 1)
        }));
    },
    clearDialogState() {
        set(initialState);
    }
}));
export type {
    ActiveDialog,
    DialogBreadcrumb,
    DialogStoreState,
    WorldNewInstanceDefaults
};
