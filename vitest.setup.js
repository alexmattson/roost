// Browser APIs jsdom doesn't provide, stubbed so components can mount.
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
if (!global.ResizeObserver) {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
