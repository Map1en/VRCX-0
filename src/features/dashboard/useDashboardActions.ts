import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useDashboardStore } from '@/state/dashboardStore';
import { useModalStore } from '@/state/modalStore';

import { cloneDashboardRows } from './dashboardConfig';

export function useDashboardActions({ dashboard, dashboards }: any) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const confirm = useModalStore((state: any) => state.confirm);
    const createDashboard = useDashboardStore(
        (state: any) => state.createDashboard
    );
    const updateDashboard = useDashboardStore(
        (state: any) => state.updateDashboard
    );
    const deleteDashboard = useDashboardStore(
        (state: any) => state.deleteDashboard
    );
    const setEditingDashboardId = useDashboardStore(
        (state: any) => state.setEditingDashboardId
    );

    async function saveDashboard(dashboardId: any, nextDashboard: any) {
        await updateDashboard(dashboardId, nextDashboard);
    }

    async function updateLivePanel(
        rowIndex: any,
        panelIndex: any,
        nextPanel: any
    ) {
        if (!dashboard?.rows?.[rowIndex]?.panels) {
            return;
        }

        const rows = cloneDashboardRows(dashboard.rows);
        rows[rowIndex].panels[panelIndex] = nextPanel;

        try {
            await updateDashboard(dashboard.id, { rows });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.dashboard.toast.failed_to_update_dashboard_panel')
            );
        }
    }

    async function deleteCurrentDashboard() {
        if (!dashboard) {
            return;
        }

        const result = await confirm({
            title: t('view.dashboard.modal.delete_dashboard'),
            description: t(
                'view.dashboard.modal.this_removes_the_dashboard_definition_from_the_s'
            ),
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            await deleteDashboard(dashboard.id);
            const fallback =
                dashboards.find((entry: any) => entry.id !== dashboard.id) ||
                null;
            if (fallback) {
                navigate(`/dashboard/${fallback.id}`, { replace: true });
            } else {
                navigate('/feed', { replace: true });
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.dashboard.toast.failed_to_delete_dashboard')
            );
        }
    }

    async function createNewDashboard() {
        try {
            const nextDashboard = await createDashboard(
                t('dashboard.default_name')
            );
            setEditingDashboardId(nextDashboard.id);
            navigate(`/dashboard/${nextDashboard.id}`);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.dashboard.toast.failed_to_create_dashboard')
            );
        }
    }

    function openFirstDashboard() {
        if (dashboards[0]?.id) {
            navigate(`/dashboard/${dashboards[0].id}`, { replace: true });
        }
    }

    function goToFeed() {
        navigate('/feed', { replace: true });
    }

    return {
        createNewDashboard,
        deleteCurrentDashboard,
        goToFeed,
        openFirstDashboard,
        saveDashboard,
        updateLivePanel
    };
}
