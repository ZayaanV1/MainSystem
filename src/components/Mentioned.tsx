import { Fragment, useMemo } from 'react';
import { goTo, splitMentions, type Mention } from '../lib/mentions';

/**
 * A sentence with the names of work and exams in it made into links.
 *
 * A real anchor, so it can be opened in a new tab and read out as a link; a
 * plain tap is caught and handed to the app, which moves without reloading.
 * What counts as a name comes from the caller (lib/mentions.ts): only titles
 * the app actually holds are ever linked.
 */
export function Mentioned({ text, mentions }: { text: string; mentions: Mention[] }) {
  const pieces = useMemo(() => splitMentions(text, mentions), [text, mentions]);
  return (
    <>
      {pieces.map((piece, i) =>
        piece.mention ? (
          <a
            key={i}
            className="mention"
            href={piece.mention.href}
            aria-label={`${piece.text}, ${piece.mention.kind === 'work' ? 'open its page' : 'open its day'}`}
            onClick={(e) => {
              // Leave modified clicks to the browser: new tab, new window.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              goTo(piece.mention!.href);
            }}
          >
            {piece.text}
          </a>
        ) : (
          <Fragment key={i}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}
