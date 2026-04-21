import { afterEach, describe, expect, it, vi } from 'vitest';

function createFakeElement(tagName = 'div') {
    const children = [];
    const element = {
        tagName: tagName.toUpperCase(),
        id: '',
        dataset: {},
        style: {},
        parentNode: null,
        children,
        appendChild(child) {
            if (child.parentNode && child.parentNode !== this) {
                child.remove();
            }
            const existingIndex = children.indexOf(child);
            if (existingIndex !== -1) {
                children.splice(existingIndex, 1);
            }
            child.parentNode = this;
            children.push(child);
            return child;
        },
        remove() {
            if (!this.parentNode) {
                return;
            }
            const siblings = this.parentNode.children;
            const index = siblings.indexOf(this);
            if (index !== -1) {
                siblings.splice(index, 1);
            }
            this.parentNode = null;
        }
    };
    return element;
}

function createFakeDocument() {
    const body = createFakeElement('body');
    const elements = [];
    return {
        body,
        createElement(tagName) {
            const element = createFakeElement(tagName);
            elements.push(element);
            return element;
        },
        getElementById(id) {
            return [body, ...elements, ...body.children].find(
                (element) => element.id === id
            );
        }
    };
}

async function loadModalPortalLayers() {
    vi.resetModules();
    return import('./modalPortalLayers.js');
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('modalPortalLayers', () => {
    it('returns no-op layer controls when document is unavailable', async () => {
        vi.stubGlobal('document', undefined);
        const { acquireModalPortalLayer } = await loadModalPortalLayers();

        const layer = acquireModalPortalLayer();

        expect(layer.element).toBeUndefined();
        expect(() => layer.bringToFront()).not.toThrow();
        expect(() => layer.release()).not.toThrow();
    });

    it('creates a modal portal root and movable layer', async () => {
        const document = createFakeDocument();
        vi.stubGlobal('document', document);
        const { acquireModalPortalLayer } = await loadModalPortalLayers();

        const first = acquireModalPortalLayer();
        const second = acquireModalPortalLayer();

        const root = document.getElementById('vrcx-modal-portal-root');
        expect(root).toBeTruthy();
        expect(root.style).toMatchObject({
            position: 'relative',
            isolation: 'isolate',
            zIndex: '10000'
        });
        expect(root.children).toEqual([first.element, second.element]);

        first.bringToFront();

        expect(first.element.dataset.vrcxPortalLayer).toBe('modal');
        expect(first.element.style.zIndex).toBe('10010');
        expect(root.children).toEqual([second.element, first.element]);

        first.release();

        expect(root.children).toEqual([second.element]);
    });

    it('reuses the app portal root when present', async () => {
        const document = createFakeDocument();
        const appRoot = document.createElement('div');
        appRoot.id = 'x-dialog-portal';
        document.body.appendChild(appRoot);
        vi.stubGlobal('document', document);
        const { acquireModalPortalLayer } = await loadModalPortalLayers();

        const layer = acquireModalPortalLayer();

        expect(document.getElementById('vrcx-modal-portal-root')).toBeFalsy();
        expect(appRoot.children).toEqual([layer.element]);
        expect(appRoot.style.zIndex).toBe('10000');
    });
});
