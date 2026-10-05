import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { PromptInput } from '../components/kit/PromptInput';
import { ThinkingText } from '../components/kit/ThinkingText';
import { EmptyState } from '../components/EmptyState';
import { Chip } from '../components/Chip';
import { useAuth } from '../lib/auth';
import { askChat } from '../lib/assist';
import { clearChat, loadChat, markActionTaken, saveMessage, type ChatMessage } from '../lib/chat';
import { addAssignment, assignmentDueAt, setCompletion, type Course } from '../lib/planner';
import { formatDay, formatTime, todayKey } from '../lib/time';

/**
 * Ask the app about your own data.
 *
 * Two rules do most of the work here and both are inherited rather than new.
 *
 * It answers only from data it was given, and says so when it has none. The
 * enforcement is not in the prompt: the model is handed a bounded slice of the
 * user's rows, it must cite the ids it used, and ids it was never given are
 * dropped before this screen sees them.
 *
 * Nothing is written without confirmation. An action arrives as a proposal
 * with a button, exactly like an extracted syllabus date, and
 * declining leaves the proposal in the transcript rather than erasing it.
 */
/** The questions people ask first, offered on an empty conversation. */
const STARTERS = [
  'What is due this week?',
  'What should I start on now?',
  'When is my next exam?',
  'What did I leave without a date?',
];

export function Chat({ courses, onBack, onChanged }: {
  courses: Course[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [learned, setLearned] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  /*
   * Set when the daily question budget is gone.
   *
   * Two ways to learn it, and both were being discarded. The server classifies
   * the refusal as `failure: 'quota'`, which the client wrapper dropped; and a
   * successful answer reports how many questions are left, which reaching zero
   * makes certain. Either way the composer should stop accepting a question it
   * already knows cannot be sent — leaving it enabled invites typing a
   * paragraph and being refused after.
   */
  const [spent, setSpent] = useState<string | null>(null);
  const [doing, setDoing] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadChat().then(setMessages);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function send(asked?: string) {
    const text = (asked ?? draft).trim();
    if (!text || thinking || spent) return;

    setDraft('');
    setProblem(null);
    setLearned([]);
    setThinking(true);

    const mine = await saveMessage(userId, { role: 'user', content: text });
    if (!mine) {
      // The question never reached the server, so nothing can answer it.
      // Hand the words back rather than losing them: the draft was cleared
      // above for the common case, and offline that meant the question was
      // simply gone.
      setThinking(false);
      setDraft(text);
      setProblem('Couldn’t send that. Check your connection and send it again.');
      return;
    }
    setMessages((m) => [...(m ?? []), mine]);

    const result = await askChat(text);
    setThinking(false);

    if (!result.ok) {
      if (result.failure === 'quota') setSpent(result.reason);

      // The failure is persisted, marked, rather than left as a transient
      // banner. Otherwise a reload shows the question sitting there with no
      // answer and no reason, which reads as the app having ignored it. The
      // banner is only for when even that save fails — showing both put the
      // same sentence on screen twice, once in red.
      const failed = await saveMessage(userId, { role: 'assistant', content: result.reason, failed: true });
      if (failed) setMessages((m) => [...(m ?? []), failed]);
      else setProblem(result.reason);
      return;
    }

    setRemaining(result.remaining);
    setLearned(result.learned);
    if (result.remaining <= 0) {
      setSpent(
        'That is enough questions for today. It resets tomorrow, and everything else works as usual.',
      );
    }

    const theirs = await saveMessage(userId, {
      role: 'assistant',
      content: result.warnings.length
        ? `${result.reply}\n\n${result.warnings.join(' ')}`
        : result.reply,
      proposed_action: result.action,
      referenced_ids: result.referenced,
    });
    if (theirs) setMessages((m) => [...(m ?? []), theirs]);
  }

  /**
   * Carries out a proposal, after the person has said so.
   *
   * Each branch goes through the same function the rest of the app uses, so a
   * chatbot-created assignment is identical to a hand-typed one and inherits
   * every rule about due times and offline queueing.
   */
  async function carryOut(message: ChatMessage) {
    const action = message.proposed_action;
    if (!action || doing) return;

    setDoing(message.id);
    setProblem(null);

    try {
      const kind = action.kind as string;

      if (kind === 'add_assignment') {
        await addAssignment(userId, {
          title: String(action.title ?? ''),
          due_at: assignmentDueAt(
            (action.due_date as string) ?? null,
            (action.due_time as string) ?? null,
          ),
          due_has_time: Boolean(action.due_time),
        });
      } else if (kind === 'complete_checklist_item') {
        await setCompletion(userId, String(action.item_id), todayKey(), true);
      } else {
        throw new Error('That kind of change is no longer part of the app.');
      }

      await markActionTaken(message.id);
      setMessages((m) => (m ?? []).map((x) => (x.id === message.id ? { ...x, action_taken: true } : x)));
      onChanged();
    } catch (err) {
      setProblem(`Not done. ${(err as Error).message}`);
    } finally {
      setDoing(null);
    }
  }

  if (!messages) return null;

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="page-title">Abood</h1>
        <div className="flex items-baseline gap-4">
          {messages.length > 0 && !confirmClear && (
            <Button variant="quiet" onClick={() => setConfirmClear(true)}>
              Clear
            </Button>
          )}
          <Button variant="quiet" onClick={onBack}>
            Today
          </Button>
        </div>
      </header>

      {/*
        Confirmed in place, because it cannot be undone and it reaches further
        than this screen: Telegram and iMessage share this one conversation.
        It used to delete everything on a single tap of a button that sits
        beside "Today".
      */}
      {confirmClear && (
        <div role="alert" className="mx-4 mb-6 flex flex-col gap-3 rounded-card border border-ink-600 p-4">
          <p className="type-body text-text-hi">Clear the whole conversation?</p>
          <p className="type-note text-text-mid">
            This removes every message, including the ones sent by Telegram and iMessage. What
            Abood remembers about you stays; that is in Settings.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() =>
                void clearChat().then(() => {
                  setMessages([]);
                  setConfirmClear(false);
                })
              }
            >
              Clear it
            </Button>
            <Button variant="quiet" onClick={() => setConfirmClear(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-1 flex-col gap-4 px-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-4">
            <EmptyState>
              <span>
                Ask about your own work, classes or checklist. It only knows what is in this app, and
                says so when it does not know.
              </span>
            </EmptyState>
            {/*
              Somewhere to start (the UI overview). An empty conversation asks
              you to think of a question before you can ask one; these are the
              ones people ask first, and a tap asks it.
            */}
            {!spent && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Questions to start with">
                {STARTERS.map((q) => (
                  <Chip key={q} onClick={() => void send(q)}>
                    {q}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'self-end' : 'self-start'}>
            {/*
              Yours in phthalo glass, Abood's on the app's own lit panel — the
              two voices told apart by material as well as by side, so a long
              exchange reads as a conversation rather than a column of boxes.
              The corner nearest the speaker is tightened, the way a speech
              bubble points at who said it.
            */}
            {m.failed ? (
              /*
                Not a reply. A question that went unanswered keeps its reason
                beside it — without one it reads as ignored — but in the
                app's voice, as a note on the conversation, not in Abood's
                as if it had said "could not reach the model".
              */
              <div className="chat-note max-w-[min(85vw,40rem)]" role="note">
                <span className="kicker">Couldn&rsquo;t answer</span>
                <p className="type-note text-text-mid">{m.content}</p>
              </div>
            ) : (
              /*
                Abood texts in short messages, a blank line between each, the
                way people do; each is its own bubble here as on the phone.
              */
              (m.role === 'assistant' ? m.content.split(/\n\s*\n/).filter((t) => t.trim()) : [m.content]).map((part, i, all) => (
              <div
                key={i}
                className={[
                  'max-w-[min(85vw,40rem)] px-4 py-3',
                  i < all.length - 1 ? 'mb-1.5' : '',
                  m.role === 'user' ? 'chat-mine' : 'mat chat-theirs',
                ].join(' ')}
              >
                <p
                  className={`type-body whitespace-pre-wrap ${m.role === 'user' ? 'text-on-accent-2' : 'text-text-hi'}`}
                >
                  {part}
                </p>
                {m.via !== 'app' && m.role === 'user' && (
                  <span className="mt-1 block text-right type-caption text-on-accent-2 opacity-70">
                    via {m.via === 'telegram' ? 'Telegram' : 'iMessage'}
                  </span>
                )}
              </div>
              ))
            )}

            {m.proposed_action && (
              <div className="mat mat-raised mt-2 flex flex-col gap-2 p-4">
                <p className="kicker">{m.action_taken ? 'Done' : 'Proposed'}</p>
                {(m.action_taken || ACTIONABLE.has(m.proposed_action.kind as string)) && (
                  <p className="type-note text-text-low">
                    {m.action_taken ? 'Done.' : 'Nothing is saved until you tap this.'}
                  </p>
                )}
                <p className="type-body text-text-hi">{describe(m.proposed_action, courses)}</p>
                {!m.action_taken && ACTIONABLE.has(m.proposed_action.kind as string) && (
                  <div>
                    <Button
                      variant="primary"
                      disabled={doing === m.id}
                      onClick={() => void carryOut(m)}
                    >
                      {doing === m.id ? 'Doing it' : 'Do it'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/*
          A line that describes the work, rather than a spinner. The three
          lines are literal — the model really is reading the week, then
          deciding what matters, then writing — and they rotate slowly enough
          to be read. Under reduced motion the sweep stops and the sentence
          simply sits there, which is a complete pending state on its own.
        */}
        {/* Said when it happens: memory that grew in silence could not be
            corrected. Everything remembered is listed, and can be taken
            back, in Settings. */}
        {learned.length > 0 && (
          <div className="chat-note max-w-[min(85vw,40rem)] self-start" role="status">
            <span className="kicker">Remembered</span>
            <p className="type-note text-text-mid">{learned.join(' ')}</p>
          </div>
        )}

        {thinking && (
          <ThinkingText
            className="self-start"
            lines={['Reading your week', 'Working out what matters', 'Writing it up']}
          />
        )}
        {problem && (
          <p className="type-body text-t-overdue" role="alert">
            {problem}
          </p>
        )}

        <div ref={bottom} />
      </div>

      {/*
        The composer.

        It was a single-line <input>, which is the wrong control for this: a
        question long enough to be worth asking scrolled sideways out of view
        while it was being typed, and there was no way to put a line break in
        one. PromptInput grows with the text, sends on Enter and breaks the
        line on Shift+Enter, and refuses to send mid-IME-composition.
      */}
      {/*
        Pinned above the floating tab bar on a phone and to the bottom edge on
        a desktop, over a fade rather than a slab. It sat at bottom-0 on a
        solid ink rectangle: on a phone that put it UNDER the tab bar, and
        everywhere it drew a hard-edged dark box across the conversation.
      */}
      <div className="composer-dock sticky z-10 px-4 pt-6 pb-3">
        <PromptInput
          value={draft}
          onChange={setDraft}
          onSubmit={() => void send()}
          busy={thinking}
          disabledReason={spent ?? undefined}
          label="Ask Abood"
        />
      </div>

      {remaining !== null && remaining > 0 && remaining <= 10 && (
        <p className="mb-6 px-4 type-note text-text-low">
          {remaining} more questions today.
        </p>
      )}
    </main>
  );
}

/**
 * The proposals this screen can still carry out. Older transcripts can hold
 * food and weight proposals from before the diet tracker was removed; they stay
 * readable, but without a button that would do nothing.
 */
const ACTIONABLE = new Set(['add_assignment', 'complete_checklist_item']);

/**
 * A proposed due date the way a person checks one: with its weekday.
 *
 * "Due 2026-10-09 at 23:59" is what was being confirmed against, and a date
 * you are asked to approve is the worst place for a format you have to decode.
 */
function dueWords(date: unknown, time: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return ' with no date';
  const day = formatDay(date);
  if (typeof time !== 'string' || !/^\d{1,2}:\d{2}$/.test(time)) return ` due ${day}`;
  const at = assignmentDueAt(date, time);
  return at ? ` due ${day} at ${formatTime(new Date(at))}` : ` due ${day}`;
}

/** A proposal in words, so the button is never the only description of it. */
function describe(action: Record<string, unknown>, courses: Course[]): string {
  const kind = action.kind as string;

  if (kind === 'add_assignment') {
    return `Add "${action.title}"${dueWords(action.due_date, action.due_time)}.`;
  }
  if (kind === 'complete_checklist_item') return 'Tick that off for today.';
  if (!ACTIONABLE.has(kind)) return 'An older suggestion. That kind of change is no longer part of the app.';

  void courses;
  return 'Do that.';
}
