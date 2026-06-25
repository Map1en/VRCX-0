import { describe, expect, it } from 'vitest';

import { escapeHtml, formatDifferenceHtml } from './FeedDifferenceHtml';

const ADD = '<ins>{{text}}</ins>';
const DEL = '<del>{{text}}</del>';

describe('FeedDifferenceHtml', () => {
    it('escapes HTML-sensitive characters and preserves line breaks', () => {
        expect(escapeHtml(`<img src="x" onerror='alert(&)'>\nnext`)).toBe(
            '&lt;img src=&quot;x&quot; onerror=&#039;alert(&amp;)&#039;&gt;<br>next'
        );
        expect(escapeHtml(null)).toBe('');
    });

    it('renders inserted and deleted words around unchanged text', () => {
        expect(
            formatDifferenceHtml('hello old world', 'hello new world', ADD, DEL)
        ).toBe('hello <del>old</del> <ins>new</ins> world');
    });

    it('escapes changed bio content before wrapping diff markers', () => {
        expect(
            formatDifferenceHtml(
                'safe <script>alert(1)</script>',
                'safe <img src=x onerror=alert(1)>',
                ADD,
                DEL
            )
        ).toBe(
            'safe <del>&lt;script&gt;alert(1)&lt;/script&gt;</del> <ins>&lt;img src=x onerror=alert(1)&gt;</ins>'
        );
    });

    it('keeps line breaks outside inserted and deleted text chunks', () => {
        expect(formatDifferenceHtml('first\nold', 'first\nnew', ADD, DEL)).toBe(
            'first <br><del>old</del> <ins>new</ins>'
        );
    });
});
