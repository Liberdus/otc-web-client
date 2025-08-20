export function setVisibility(element, isVisible) {
    if (!element) return;
    element.classList.toggle('is-hidden', !isVisible);
    element.setAttribute('aria-hidden', String(!isVisible));
}


