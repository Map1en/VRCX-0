import { create } from 'zustand';

export const usePrivacyLockDialogStore = create<{
    open: boolean;
    engageAfterSetup: boolean;
}>(() => ({ open: false, engageAfterSetup: false }));

export function openPrivacyLockDialog({
    engageAfterSetup = false
}: { engageAfterSetup?: boolean } = {}) {
    usePrivacyLockDialogStore.setState({ open: true, engageAfterSetup });
}

export function closePrivacyLockDialog() {
    usePrivacyLockDialogStore.setState({
        open: false,
        engageAfterSetup: false
    });
}
