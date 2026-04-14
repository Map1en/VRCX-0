import { create } from 'zustand';

const initialState = {
    open: false,
    type: 'avatar',
    input: '',
    rows: [],
    loading: false,
    progress: 0,
    progressTotal: 0,
    importProgress: 0,
    importProgressTotal: 0,
    errors: '',
    remoteGroupName: '',
    localGroupName: '',
    sessionId: 0
};

function normalizeType(value) {
    return ['avatar', 'world', 'friend'].includes(value) ? value : 'avatar';
}

export const useFavoriteImportStore = create((set) => ({
    ...initialState,
    openDialog({ type, input = '' } = {}) {
        set((state) => ({
            ...initialState,
            open: true,
            type: normalizeType(type),
            input: typeof input === 'string' ? input : String(input ?? ''),
            sessionId: state.sessionId + 1
        }));
    },
    closeDialog() {
        set((state) => ({
            ...state,
            open: false,
            loading: false
        }));
    },
    cancelActiveWork() {
        set((state) => ({
            ...state,
            loading: false,
            progress: 0,
            progressTotal: 0,
            importProgress: 0,
            importProgressTotal: 0,
            sessionId: state.sessionId + 1
        }));
    },
    setInput(input) {
        set({ input: typeof input === 'string' ? input : String(input ?? '') });
    },
    setLoading(loading) {
        set({ loading: Boolean(loading) });
    },
    setProgress(progress, progressTotal) {
        set({ progress, progressTotal });
    },
    setImportProgress(importProgress, importProgressTotal) {
        set({ importProgress, importProgressTotal });
    },
    setErrors(errors) {
        set({ errors: typeof errors === 'string' ? errors : String(errors ?? '') });
    },
    appendError(error) {
        const text = typeof error === 'string' ? error : String(error ?? '');
        if (!text) {
            return;
        }
        set((state) => ({
            errors: `${state.errors || ''}${text}${text.endsWith('\n') ? '' : '\n'}`
        }));
    },
    setRows(rows) {
        set({ rows: Array.isArray(rows) ? rows : [] });
    },
    addRow(row) {
        if (!row?.id) {
            return;
        }
        set((state) => {
            if (state.rows.some((entry) => entry.id === row.id)) {
                return state;
            }
            return { rows: [...state.rows, row] };
        });
    },
    removeRow(id) {
        set((state) => ({
            rows: state.rows.filter((row) => row.id !== id)
        }));
    },
    clearRows() {
        set({ rows: [] });
    },
    setRemoteGroupName(remoteGroupName) {
        set({
            remoteGroupName,
            localGroupName: remoteGroupName ? '' : ''
        });
    },
    setLocalGroupName(localGroupName) {
        set({
            localGroupName,
            remoteGroupName: localGroupName ? '' : ''
        });
    },
    resetImportState() {
        set((state) => ({
            ...initialState,
            open: state.open,
            type: state.type
        }));
    }
}));
