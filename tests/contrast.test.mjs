import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, labelOn, liftAccent, parseCssColor } from '../src/theme/contrast.js';

// A user's tavern theme had a dark quote colour on a dark page: the 生成阶段总结 label (paper colour on the
// accent) could not be read. The label now picks white or near-black, and a too-dark accent is lifted.
test('a dark accent on a dark page is lifted and gets a readable label', () => {
    const paper = { r: 32, g: 34, b: 43 }, ink = { r: 200, g: 200, b: 205 }, accent = { r: 41, g: 44, b: 58 };
    const lifted = liftAccent(accent, paper, ink);
    assert.ok(lifted, 'the accent was too close to the page');
    assert.ok(contrastRatio(lifted, paper) >= 3);
    assert.ok(contrastRatio(labelOn(lifted), lifted) >= 4.5);
});

test('good accents are left alone and labels follow the fill', () => {
    assert.equal(liftAccent({ r: 138, g: 77, b: 10 }, { r: 242, g: 238, b: 229 }, { r: 35, g: 32, b: 27 }), null, '白板 · 日');
    assert.deepEqual(labelOn({ r: 138, g: 77, b: 10 }), { r: 255, g: 255, b: 255 });
    assert.notDeepEqual(labelOn({ r: 192, g: 203, b: 228 }), { r: 255, g: 255, b: 255 }, '场记板 · 夜 has a light accent');
});

test('computed colours parse in both formats browsers return', () => {
    assert.deepEqual(parseCssColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 });
    assert.deepEqual(parseCssColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30 });
    assert.deepEqual(parseCssColor('color(srgb 0.124902 0.132353 0.166863)'), { r: 32, g: 34, b: 43 });
    assert.equal(parseCssColor('transparent'), null);
});
