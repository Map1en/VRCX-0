import { BarChart, HeatmapChart } from 'echarts/charts';
import {
    AriaComponent,
    GridComponent,
    TooltipComponent,
    VisualMapComponent
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
    BarChart,
    HeatmapChart,
    AriaComponent,
    GridComponent,
    TooltipComponent,
    VisualMapComponent,
    CanvasRenderer
]);

export { echarts };
