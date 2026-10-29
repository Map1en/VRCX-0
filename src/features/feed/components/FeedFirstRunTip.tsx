import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import configRepository from '@/repositories/configRepository';
import feedRepository from '@/repositories/feedRepository';
import { getSettingDeepLinkPath } from '@/shared/constants/settingsManifest';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    Alert,
    AlertAction,
    AlertDescription,
    AlertTitle
} from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';

const WELCOME_SEEN_CONFIG_KEY = 'onboarding_welcome_seen';

function useFirstRunTipVisibility() {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [newUserId, setNewUserId] = useState('');
    const dismissedRef = useRef(false);

    useEffect(() => {
        if (!currentUserId) {
            return;
        }
        let cancelled = false;
        const isStale = () => cancelled || dismissedRef.current;
        void configRepository
            .getBool(WELCOME_SEEN_CONFIG_KEY, false)
            .then(async (seen) => {
                if (seen || isStale()) {
                    return;
                }
                const rows = await feedRepository.queryFeed({
                    userId: currentUserId,
                    maxEntries: 1
                });
                if (rows.length === 0 && !isStale()) {
                    setNewUserId(currentUserId);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [currentUserId]);

    const dismiss = useCallback(() => {
        dismissedRef.current = true;
        setNewUserId('');
        void configRepository
            .setBool(WELCOME_SEEN_CONFIG_KEY, true)
            .catch(() => undefined);
    }, []);

    return {
        visible: Boolean(currentUserId) && newUserId === currentUserId,
        dismiss
    };
}

export function FeedFirstRunTip() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const gameLogImportSupported = useRuntimeStore(
        (state) => state.hostCapabilities.runtimeGameLogIngest.supported
    );
    const { visible, dismiss } = useFirstRunTipVisibility();

    if (!visible) {
        return null;
    }

    return (
        <Alert role="status" className="mb-3">
            <AlertTitle>{t('view.feed.first_run_tip.title')}</AlertTitle>
            <AlertDescription>
                {t(
                    gameLogImportSupported
                        ? 'view.feed.first_run_tip.description'
                        : 'view.feed.first_run_tip.description_without_logs'
                )}
            </AlertDescription>
            <div className="mt-2 flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        navigate(
                            getSettingDeepLinkPath(
                                'advanced.import-recovery.import-from-vrcx'
                            )
                        )
                    }
                >
                    {t(
                        'view.settings.advanced.advanced_ui.import_recovery.import_from_vrcx'
                    )}
                </Button>
                {gameLogImportSupported ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            navigate(
                                getSettingDeepLinkPath(
                                    'advanced.import-recovery.gamelog-import'
                                )
                            )
                        }
                    >
                        {t(
                            'view.settings.advanced.advanced_ui.import_recovery.game_log.label'
                        )}
                    </Button>
                ) : null}
            </div>
            <AlertAction>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={dismiss}
                >
                    {t('view.feed.first_run_tip.dismiss')}
                </Button>
            </AlertAction>
        </Alert>
    );
}
