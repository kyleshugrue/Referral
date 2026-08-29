let overlayCount = 0;
let originalOverflow = '';

export function lockBodyScroll() {
  if (overlayCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  overlayCount++;
}

export function unlockBodyScroll() {
  overlayCount--;
  if (overlayCount <= 0) {
    overlayCount = 0;
    document.body.style.overflow = originalOverflow || '';
    originalOverflow = '';
  }
}
