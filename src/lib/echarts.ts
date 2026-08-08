import { BarChart, HeatmapChart, PieChart } from 'echarts/charts';
import {
    GridComponent,
    TooltipComponent,
    VisualMapComponent
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
    BarChart,
    HeatmapChart,
    PieChart,
    GridComponent,
    TooltipComponent,
    VisualMapComponent,
    CanvasRenderer
]);

export { echarts };
