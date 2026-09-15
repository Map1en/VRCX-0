import {
    commands,
    type ActivityPageBuildInput,
    type ActivityPageView
} from '@/platform/tauri/bindings';

export type {
    ActivityCompanionOrder,
    ActivityPageAccessSlice,
    ActivityPageBuildInput,
    ActivityPageCompanionRow,
    ActivityPageFadingRow,
    ActivityPagePeople,
    ActivityPageSeries,
    ActivityPageSummary,
    ActivityPageView,
    ActivityPageWorldRow,
    ActivityPageWorlds
} from '@/platform/tauri/bindings';

export const activityPageRepository = {
    view(input: ActivityPageBuildInput): Promise<ActivityPageView> {
        return commands.appActivityPageView(input);
    }
};
