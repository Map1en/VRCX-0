import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    loadPostUpdateChangelogToastState,
    markPostUpdateChangelogVersionSeen
} from '@/services/changelogService';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
import { useRuntimeStore } from '@/state/runtimeStore';

export function PostUpdateChangelogToastHost() {
    const { t } = useTranslation();
    const hasCheckedRef = useRef(false);
    const backendRuntimeSnapshotHydrated = useRuntimeStore(
        (state: any) => state.shell.backendRuntimeSnapshotHydrated
    );
    const setSystemHostOpen = useRuntimeStore(
        (state: any) => state.setSystemHostOpen
    );

    useEffect(() => {
        if (!backendRuntimeSnapshotHydrated || hasCheckedRef.current) {
            return undefined;
        }

        hasCheckedRef.current = true;
        let cancelled = false;

        const run = async () => {
            try {
                const state = await loadPostUpdateChangelogToastState();
                if (cancelled || !state.shouldShow) {
                    return;
                }

                let seenRecorded = false;
                const recordSeen = () => {
                    if (seenRecorded) {
                        return;
                    }
                    seenRecorded = true;
                    markPostUpdateChangelogVersionSeen(
                        state.currentVersion
                    ).catch((error) => {
                        console.warn(
                            'Failed to record changelog toast state:',
                            error
                        );
                    });
                };
                const displayVersion =
                    formatReleaseDisplayVersion(state.currentVersion) ||
                    state.currentVersion;
                const toastId = toast.info(
                    t('dialog.change_log.toast_title', {
                        value: displayVersion
                    }),
                    {
                        description: t(
                            'dialog.change_log.toast_description'
                        ),
                        duration: Infinity,
                        position: 'bottom-right',
                        closeButton: true,
                        action: {
                            label: t(
                                'dialog.change_log.view_changes'
                            ),
                            onClick: () => {
                                recordSeen();
                                toast.dismiss(toastId);
                                setSystemHostOpen('changelogOpen', true);
                            }
                        },
                        onDismiss: recordSeen,
                        onAutoClose: recordSeen
                    }
                );
            } catch (error) {
                console.warn('Failed to show post-update changelog toast:', error);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [backendRuntimeSnapshotHydrated, setSystemHostOpen, t]);

    return null;
}
