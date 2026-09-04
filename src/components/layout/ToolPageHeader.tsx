import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    toolDefinitionMap,
    type ToolRouteName
} from '@/shared/constants/tools';

import {
    PageBackButton,
    PageHeader,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from './PageScaffold';

export function ToolPageHeader({
    toolKey,
    status,
    actions
}: {
    toolKey: ToolRouteName;
    status?: ReactNode;
    actions?: ReactNode;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const tool = toolDefinitionMap.get(toolKey);

    if (
        !tool ||
        tool.action.type !== 'route' ||
        tool.action.routeName !== toolKey
    ) {
        throw new Error(`Unknown route tool: ${toolKey}`);
    }

    return (
        <PageToolbar>
            <PageToolbarRow className="items-center">
                <PageBackButton
                    label={t('nav_tooltip.tools')}
                    onClick={() => navigate('/tools')}
                />
                <PageHeader className="min-w-0 p-0">
                    <PageTitle>{t(tool.titleKey)}</PageTitle>
                </PageHeader>
                {status}
                {actions ? (
                    <div className="ml-auto flex flex-wrap items-center gap-1">
                        {actions}
                    </div>
                ) : null}
            </PageToolbarRow>
        </PageToolbar>
    );
}
