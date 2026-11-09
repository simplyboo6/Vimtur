/**
 * jsdom does not implement scrollIntoView, but SelectOptionComponent.scroll()
 * calls it whenever keyboard navigation moves the highlight.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}
