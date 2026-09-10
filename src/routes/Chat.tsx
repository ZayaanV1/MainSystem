import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { PromptInput } from '../components/kit/PromptInput';
import { ThinkingText } from '../components/kit/ThinkingText';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../lib/auth';
import { askChat } from '../lib/assist';
import { clearChat, loadChat, markActionTaken, saveMessage, type ChatMessage } from '../lib/chat';
import { addAssignment, assignmentDueAt, setCompletion, type Course } from '../lib/planner';
import { loadDay, logSavedMeal, setWeight } from '../lib/diet';
import { todayKey } from '../lib/time';

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
 * with a button, exactly like a parsed meal or an extracted syllabus date, and
 * declining leaves the proposal in the transcript rather than erasing it.
 */
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

  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadChat().then(setMessages);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function send() {
    const text = draft.trim();
    if (!text || thinking || spent) return;

    setDraft('');
    setProblem(null);
    setThinking(true);

    const mine = await saveMessage(userId, { role: 'user', content: text });
    if (mine) setMessages((m) => [...(m ?? []), mine]);

    const result = await askChat(text);
    setThinking(false);

    if (!result.ok) {
      setProblem(result.reason);
      if (result.failure === 'quota') setSpent(result.reason);

      // The failure is persisted as a reply rather than left as a transient
      // banner. Otherwise a reload shows the question sitting there with no
      // answer and no reason, which reads as the app having ignored it.
      const failed = await saveMessage(userId, { role: 'assistant', content: result.reason });
      if (failed) setMessages((m) => [...(m ?? []), failed]);
      return;
    }

    setRemaining(result.remaining);
    if (result.remaining <= 0) {
      setSpent(
        'That is enough questions for today — the rest of the daily model budget is kept for logging food. It resets tomorrow.',
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
      } else if (kind === 'log_saved_meal') {
        const day = await loadDay();
        const meal = day.savedMeals.find((m) => m.id === action.meal_id);
        if (!meal) throw new Error('That saved meal is gone.');
        await logSavedMeal(userId, todayKey(), meal, Number(action.portion ?? 1));
      } else if (kind === 'set_weight') {
        await setWeight(userId, todayKey(), Number(action.kg));
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
        <h1 className="type-h1 text-text-hi">Abood</h1>
        <div className="flex items-baseline gap-4">
          {messages.length > 0 && (
            <Button variant="quiet"
              onClick={() => void clearChat().then(() => setMessages([]))}>
              Clear
            </Button>
          )}
          <Button variant="quiet" onClick={onBack}>
            Today
          </Button>
        </div>
      </header>

      <div className="mb-6 flex flex-1 flex-col gap-4 px-4">
        {messages.length === 0 && (
          <EmptyState>
            <span>
              Ask about your own work, food or checklist. It only knows what is in this app, and
              says so when it does not know.
            </span>
          </EmptyState>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'self-end' : 'self-start'}>
            <div
              className={[
                'max-w-[85vw] rounded-card px-4 py-3',
                m.role === 'user' ? 'bg-ink-600' : 'bg-ink-800',
              ].join(' ')}
            >
              <p className="type-body whitespace-pre-wrap text-text-hi">{m.content}</p>
            </div>

            {m.proposed_action && (
              <div className="mt-2 flex flex-col gap-2 rounded-card border border-ink-600 p-3">
                <p className="type-note text-text-low">
                  {m.action_taken ? 'Done.' : 'Nothing is saved until you tap this.'}
                </p>
                <p className="type-body text-text-hi">{describe(m.proposed_action, courses)}</p>
                {!m.action_taken && (
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
      <div className="sticky bottom-0 mb-6 bg-ink-900 px-4 pt-2">
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
          {remaining} more questions today. The rest of the daily model budget is kept for logging
          food.
        </p>
      )}
    </main>
  );
}

/** A proposal in words, so the button is never the only description of it. */
function describe(action: Record<string, unknown>, courses: Course[]): string {
  const kind = action.kind as string;

  if (kind === 'add_assignment') {
    const when = action.due_date
      ? ` due ${action.due_date}${action.due_time ? ` at ${action.due_time}` : ''}`
      : ' with no date';
    return `Add "${action.title}"${when}.`;
  }
  if (kind === 'complete_checklist_item') return 'Tick that off for today.';
  if (kind === 'log_saved_meal') {
    const portion = Number(action.portion ?? 1);
    return `Log that meal${portion === 1 ? '' : `, ${portion} portions`}.`;
  }
  if (kind === 'set_weight') return `Record today's weight as ${action.kg} kg.`;

  void courses;
  return 'Do that.';
}
