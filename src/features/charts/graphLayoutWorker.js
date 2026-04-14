import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import Graph from 'graphology';

function clampNumber(value, min, max) {
    const normalized = Number.isFinite(value) ? value : min;
    return Math.min(max, Math.max(min, normalized));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function jitterPositions(graph, magnitude) {
    graph.forEachNode((node, attrs) => {
        if (!Number.isFinite(attrs.x) || !Number.isFinite(attrs.y)) {
            return;
        }
        graph.mergeNodeAttributes(node, {
            x: attrs.x + (Math.random() - 0.5) * magnitude,
            y: attrs.y + (Math.random() - 0.5) * magnitude
        });
    });
}

function initPositions(graph) {
    const radius = Math.max(50, Math.sqrt(graph.order) * 30);
    graph.forEachNode((node) => {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.sqrt(Math.random()) * radius;
        graph.mergeNodeAttributes(node, {
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance
        });
    });
}

const LAYOUT_SPACING_MIN = 8;
const LAYOUT_SPACING_MAX = 240;
const LAYOUT_ITERATIONS_MIN = 300;
const LAYOUT_ITERATIONS_MAX = 1500;

function runLayout(data) {
    const { nodes, edges, settings } = data;
    const graph = new Graph({
        type: 'undirected',
        multi: false,
        allowSelfLoops: false
    });

    for (const node of nodes) {
        graph.addNode(node.id, node.attributes);
    }
    for (const edge of edges) {
        graph.addEdgeWithKey(edge.key, edge.source, edge.target, edge.attributes);
    }

    if (settings.reinitialize ?? false) {
        initPositions(graph);
    }

    const iterations = clampNumber(settings.layoutIterations, LAYOUT_ITERATIONS_MIN, LAYOUT_ITERATIONS_MAX);
    const spacing = clampNumber(settings.layoutSpacing, LAYOUT_SPACING_MIN, LAYOUT_SPACING_MAX);
    const clampedT = clampNumber((spacing - LAYOUT_SPACING_MIN) / (LAYOUT_SPACING_MAX - LAYOUT_SPACING_MIN), 0, 1);
    const deltaSpacing = settings.deltaSpacing ?? 0;
    const inferred = forceAtlas2.inferSettings ? forceAtlas2.inferSettings(graph) : {};

    if (Math.abs(deltaSpacing) >= 8) {
        jitterPositions(graph, lerp(0.5, 2.0, clampedT));
    }

    forceAtlas2.assign(graph, {
        iterations,
        settings: {
            ...inferred,
            barnesHutOptimize: true,
            barnesHutTheta: 0.8,
            strongGravityMode: true,
            gravity: lerp(1.6, 0.6, clampedT),
            scalingRatio: spacing,
            slowDown: 2
        }
    });

    noverlap.assign(graph, {
        maxIterations: clampNumber(Math.round(Math.sqrt(graph.order) * 6), 200, 600),
        settings: {
            ratio: lerp(1.05, 1.35, clampedT),
            margin: lerp(1, 8, clampedT)
        }
    });

    const positions = {};
    graph.forEachNode((node, attrs) => {
        positions[node] = { x: attrs.x, y: attrs.y };
    });
    return positions;
}

self.addEventListener('message', (event) => {
    const { requestId } = event.data;
    try {
        self.postMessage({ requestId, positions: runLayout(event.data) });
    } catch (error) {
        self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
    }
});
