import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
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
  const [doing, setDoing] = useState<string | null>(null);

  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadChat().then(setMessages);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;

    setDraft('');
    setProblem(null);
    setThinking(true);

    const mine = await saveMessage(userId, { role: 'user', content: text });
    if (mine) setMessages((m) => [...(m ?? []), mine]);

    const result = await askChat(text);
    setThinking(false);

    if (!result.ok) {
      setProblem(result.reason);

      // The failure is persisted as a reply rather than left as a transient
      // banner. Otherwise a reload shows the question sitting there with no
      // answer and no reason, which reads as the app having ignored it.
      const failed = await saveMessage(userId, { role: 'assistant', content: result.reason });
      if (failed) setMessages((m) => [...(m ?? []), failed]);
      return;
    }

    setRemaining(result.remaining);

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
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Ask</h1>
        <div className="flex items-baseline gap-4">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => void clearChat().then(() => setMessages([]))}
              className="type-label text-text-mid"
            >
              Clear
            </button>
          )}
          <button type="button" onClick={onBack} className="type-label text-text-mid">
            Today
          </button>
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

        {thinking && <p className="type-note self-start text-text-low">Looking…</p>}
        {problem && (
          <p className="type-body text-t-overdue" role="alert">
            {problem}
          </p>
        )}

        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="sticky bottom-0 mb-6 flex gap-2 bg-ink-900 px-4 pt-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What's due this week?"
          className="flex-1 rounded-card border border-ink-600 bg-ink-800 px-4 type-body text-text-hi placeholder:text-text-low"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim() || thinking}>
          Ask
        </Button>
      </form>

      {remaining !== null && remaining <= 10 && (
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
