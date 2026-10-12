// A one-shot "the opening animation has finished" signal.
//
// Deliberately a module rather than a DOM event or a React context:
//   - A DOM event would race. IntroAnimation and PromoPosters mount in the same
//     render pass today, but any future listener added later (or after a
//     Suspense boundary resolves) would miss an event that already fired.
//     `onIntroDone` fires immediately for late subscribers instead.
//   - A context would force IntroAnimation to live inside a provider, and it
//     specifically has to sit outside the app shell so its `position: fixed`
//     isn't captured by the shell's entrance transform.
//
// Module state is per-document, so this resets on every real page load — which
// is exactly the lifetime the intro itself has.

let introDone = false;
const waiting = new Set();

export function markIntroDone() {
  if (introDone) return;
  introDone = true;
  for (const notify of waiting) notify();
  waiting.clear();
}

export function isIntroDone() {
  return introDone;
}

// Returns an unsubscribe function, so a component that unmounts mid-intro
// doesn't leave a callback holding a reference to it.
export function onIntroDone(callback) {
  if (introDone) {
    callback();
    return () => {};
  }
  waiting.add(callback);
  return () => waiting.delete(callback);
}
