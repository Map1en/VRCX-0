import { useEffect, useState } from 'react';

import { requestGroupInstancesRefresh } from '@/services/runtime-event-bridge/auxiliaryEventHandlers';

export function useSidePanelActiveTab() {
    const [activeTab, setActiveTab] = useState('friends');

    useEffect(() => {
        if (activeTab === 'groups') {
            void requestGroupInstancesRefresh('groups tab selected');
        }
    }, [activeTab]);

    return {
        activeTab,
        setActiveTab
    };
}
