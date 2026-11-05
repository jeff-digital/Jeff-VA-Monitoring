const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/frontend/js/modules/pages/06-shell-events.js', 'utf8');
function node() {
  const classes = new Set();
  return { hidden: true, attributes: {}, focused: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; }
  };
}
for (const width of [390, 720, 768, 1024, 1100, 1280]) {
  const nodes = new Map();
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  const body = node();
  const context = vm.createContext({ $, document: { body }, requestAnimationFrame: callback => callback(),
    window: { matchMedia: query => ({ matches: width <= Number(query.match(/max-width:\s*(\d+)/)[1]) }) }
  });
  vm.runInContext(source.slice(source.indexOf('  function isMobileLayout()'), source.indexOf('  const quickSearchPages')), context);
  context.closeMobileSidebar();
  assert.equal($('#mainSidebar').attributes['aria-hidden'], String(width <= 720), `Closed navigation accessibility at ${width}`);
  context.openMobileSidebar();
  assert.equal($('#mainSidebar').classList.contains('open'), width <= 1100, `Full navigation can open at ${width}`);
  if (width <= 1100) {
    assert.equal($('#mainSidebar').attributes['aria-hidden'], 'false');
    assert.equal($('#mobileSidebarBackdrop').hidden, false);
    assert.equal($('#mobileMenu').attributes['aria-expanded'], 'true');
    assert.equal($('#mobileSidebarClose').focused, true);
  }
  context.closeMobileSidebar({ restoreFocus: true });
  assert.equal($('#mainSidebar').classList.contains('open'), false);
  assert.equal($('#mainSidebar').attributes['aria-hidden'], String(width <= 720));
  assert.equal($('#mobileSidebarBackdrop').hidden, true);
  assert.equal(body.classList.contains('mobile-sidebar-open'), false);
  assert.equal($('#mobileMenu').attributes['aria-expanded'], 'false');
  if (width <= 1100) assert.equal($('#mobileMenu').focused, true);
}
console.log('PASS responsive navigation: phone, tablet, split-window and desktop expansion, focus return, backdrop cleanup and visible-rail accessibility.');
