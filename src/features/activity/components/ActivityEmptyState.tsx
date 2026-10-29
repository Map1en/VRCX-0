import { FileClockIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { EmptyState } from '@/components/layout/PageScaffold';
import { getSettingsManifestEntry } from '@/shared/constants/settingsManifest';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';

const GAME_LOG_IMPORT_SETTING_ID = 'advanced.import-recovery.gamelog-import';

export function ActivityNoHistoryState({
    icon,
    title,
    description
}: {
    icon: ComponentType;
    title: string;
    description: string;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const ingestSupported = useRuntimeStore(
        (state) => state.hostCapabilities.runtimeGameLogIngest.supported
    );
    const ingestAvailable = useRuntimeStore(
        (state) => state.hostCapabilities.runtimeGameLogIngest.available
    );
    const importEntry = getSettingsManifestEntry(GAME_LOG_IMPORT_SETTING_ID);

    function openImport() {
        if (!importEntry) {
            return;
        }
        const params = new URLSearchParams({
            tab: importEntry.tab,
            setting: importEntry.id
        });
        navigate(`/settings?${params.toString()}`);
    }

    return (
        <EmptyState
            icon={icon}
            title={title}
            description={
                !ingestSupported
                    ? t('view.activity.empty.unsupported')
                    : !ingestAvailable
                      ? t('view.activity.empty.unavailable')
                      : description
            }
        >
            {ingestSupported && importEntry ? (
                <Button
                    type="button"
                    variant={ingestAvailable ? 'outline' : 'secondary'}
                    onClick={openImport}
                >
                    <FileClockIcon data-icon="inline-start" />
                    {t(importEntry.labelKey)}
                </Button>
            ) : null}
        </EmptyState>
    );
}
