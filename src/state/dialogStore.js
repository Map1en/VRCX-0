import { create } from 'zustand';

const initialState = {
    activeDialog: null,
    breadcrumbs: []
};

function dialogFromBreadcrumb(crumb) {
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

function isSameEntity(left, rightKind, rightEntityId) {
    return (
        left?.kind === rightKind &&
        String(left?.entityId ?? '').trim() === rightEntityId
    );
}

export const useDialogStore = create((set) => ({
    ...initialState,
    openDialog(dialog) {
        set((state) => ({
            activeDialog: dialog,
            breadcrumbs: dialog?.crumb
                ? [...state.breadcrumbs, dialog.crumb]
                : state.breadcrumbs
        }));
    },
    setDialog(dialog) {
        set({ activeDialog: dialog });
    },
    setDialogTrail(dialog, breadcrumbs) {
        set({
            activeDialog: dialog,
            breadcrumbs: Array.isArray(breadcrumbs) ? breadcrumbs : []
        });
    },
    updateEntityDialogMetadata({ kind, entityId, title = '', description = '' } = {}) {
        const normalizedKind = String(kind || '').trim();
        const normalizedEntityId = String(entityId ?? '').trim();
        const normalizedTitle = String(title || '').trim();
        const normalizedDescription = String(description || '').trim();
        if (!normalizedKind || !normalizedEntityId || (!normalizedTitle && !normalizedDescription)) {
            return;
        }
        set((state) => ({
            activeDialog: isSameEntity(state.activeDialog, normalizedKind, normalizedEntityId)
                ? {
                    ...state.activeDialog,
                    ...(normalizedTitle ? { title: normalizedTitle } : {}),
                    ...(normalizedDescription ? { description: normalizedDescription } : {})
                }
                : state.activeDialog,
            breadcrumbs: state.breadcrumbs.map((crumb) =>
                isSameEntity(crumb, normalizedKind, normalizedEntityId)
                    ? {
                        ...crumb,
                        ...(normalizedTitle ? { label: normalizedTitle, title: normalizedTitle } : {}),
                        ...(normalizedDescription ? { description: normalizedDescription } : {})
                    }
                    : crumb
            )
        }));
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
                dialogFromBreadcrumb(state.breadcrumbs[index]) ?? state.activeDialog,
            breadcrumbs: state.breadcrumbs.slice(0, index + 1)
        }));
    },
    clearDialogState() {
        set(initialState);
    }
}));
