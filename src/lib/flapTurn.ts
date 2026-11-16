/**
 * Split-flap: a figure that changes turns over.
 *
 * The theme draws the app's own figures as flaps in CSS alone (flap.css), so
 * nothing in a component knows it is on a board. This is the one piece of
 * behaviour that needs: when the text inside a flap changes, the flap replays
 * its turn. One observer for the whole app, running only while the theme is on.
 * Motion: None and reduced motion are honoured by the stylesheet, not here.
 */
const FLAPS =
  '.bw-num, .bw-urg, .numeral, .stub-n, .ws-n, .section-count, .tab-badge, .today-date, .lrow-when, .rb-time b, .ev-time b, .course-when b';

export function watchFlaps(): () => void {
  const observer = new MutationObserver((changes) => {
    const turned = new Set<Element>();
    for (const change of changes) {
      const at = change.target instanceof Element ? change.target : change.target.parentElement;
      const flap = at?.closest(FLAPS);
      if (flap) turned.add(flap);
    }
    for (const flap of turned) {
      // Off and on again across a reflow, or a second change mid-turn would not replay.
      flap.removeAttribute('data-turn');
      void (flap as HTMLElement).offsetWidth;
      flap.setAttribute('data-turn', '');
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
