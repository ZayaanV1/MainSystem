import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { PdfViewer } from '../components/PdfViewer';
import { SectionHead } from '../components/SectionHead';
import { generateGuide } from '../lib/assist';
import { downloadFile, safeFilename } from '../lib/exportFile';
import {
  MAX_FILES_PER_WORK,
  attachFile,
  fetchBytes,
  loadFiles,
  removeFile,
  saveGuide,
  type WorkFile,
} from '../lib/workFiles';
import { courseVar, loadAssignment, type Assignment, type Course, type Subtask } from '../lib/planner';
import { durationLabel } from '../lib/blocks';
import { rowWhen } from '../lib/rowWhen';
import { formatDay, formatTime, localDayKey } from '../lib/time';
import { urgencyFor } from '../lib/urgency';
import { guideToMarkdown, type Guide } from '../../supabase/functions/_shared/guide';
import '../styles/work.css';

/**
 * One piece of work, on a page of its own.
 *
 * The sheet that edits a piece of work is for changing it. This is for
 * working on it: what it is and when it is due, the brief as a PDF read in
 * place, and a guide to the brief on request. Editing stays one tap away and
 * reuses that sheet, so there is still exactly one way to change a field.
 *
 * Nothing here is required. A piece of work with no file shows its details
 * and an invitation to attach one; the guide appears only for a file, and is
 * only ever saved after being read.
 */

type Loaded =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready'; work: Assignment };

export function WorkPage({
  id,
  courses,
  subtasks,
  userId,
  refresh,
  onBack,
  onEdit,
}: {
  id: string;
  courses: Course[];
  subtasks: Subtask[];
  userId: string;
  /** Bumped when the work was edited elsewhere, so this reads it again. */
  refresh: number;
  onBack: () => void;
  onEdit: (work: Assignment) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadAssignment(id).then((work) => {
      if (live) setLoaded(work ? { state: 'ready', work } : { state: 'missing' });
    });
    return () => {
      live = false;
    };
  }, [id, refresh, attempt]);

  const back = (
    <button type="button" className="settings-back" onClick={onBack}>
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 6-6 6 6 6" />
      </svg>
      Back
    </button>
  );

  if (loaded.state !== 'ready') {
    return (
      <main className="page-frame">
        {back}
        {loaded.state === 'loading' ? (
          <p className="px-4 type-note text-text-low">Opening the work.</p>
        ) : (
          <div className="px-4">
            <p className="type-body text-text-mid">
              This work isn’t here. It may have been deleted, or it couldn’t be loaded.
            </p>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <Ready
      work={loaded.work}
      course={courses.find((c) => c.id === loaded.work.course_id) ?? null}
      steps={subtasks.filter((s) => s.assignment_id === id).sort((a, b) => a.position - b.position)}
      userId={userId}
      back={back}
      onEdit={onEdit}
    />
  );
}

function Ready({
  work,
  course,
  steps,
  userId,
  back,
  onEdit,
}: {
  work: Assignment;
  course: Course | null;
  steps: Subtask[];
  userId: string;
  back: React.ReactNode;
  onEdit: (work: Assignment) => void;
}) {
  const due = work.due_at ? new Date(work.due_at) : null;
  const urgency = urgencyFor(due, { done: work.status === 'done' });
  const when = rowWhen(urgency, due, work.due_has_time, new Date());
  const cv = courseVar(course?.colour_index);

  return (
    <main className="page-frame work-page">
      {back}

      <header
        className="work-head mat"
        data-block={cv ? true : undefined}
        style={cv ? ({ '--b': `var(${cv}-rgb)` } as React.CSSProperties) : undefined}
      >
        <span className="kicker">{course ? (course.code ?? course.name) : 'No course'}</span>
        <h1 className="page-title">{work.title}</h1>
        <p className="type-label" style={{ color: `var(${urgency.colourVar})` }}>
          {urgency.label}
          {when ? ` · ${when}` : ''}
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => onEdit(work)}>
            Edit
          </Button>
        </div>
      </header>

      <section aria-label="Details">
        <dl className="work-facts px-4">
          <div>
            <dt className="kicker">Due</dt>
            <dd className="type-body">
              {due ? `${formatDay(localDayKey(due))}${work.due_has_time ? `, ${formatTime(due)}` : ''}` : 'No date'}
            </dd>
          </div>
          {work.effort_minutes ? (
            <div>
              <dt className="kicker">Estimate</dt>
              <dd className="type-body">{durationLabel(work.effort_minutes)}</dd>
            </div>
          ) : null}
          {work.weight_percent !== null && (
            <div>
              <dt className="kicker">Weight</dt>
              <dd className="type-body">{work.weight_percent}%</dd>
            </div>
          )}
          {work.link && (
            <div>
              <dt className="kicker">Where it lives</dt>
              <dd className="type-body">
                <a className="work-link" href={work.link} target="_blank" rel="noopener noreferrer">
                  Open the page
                </a>
              </dd>
            </div>
          )}
        </dl>
        {work.notes && <p className="mt-4 px-4 type-body whitespace-pre-wrap text-text-mid">{work.notes}</p>}
      </section>

      {steps.length > 0 && (
        <section>
          <SectionHead title="Steps" />
          <ul className="work-steps px-4">
            {steps.map((s) => (
              <li key={s.id} data-done={s.done || undefined}>
                <span className="type-note text-text-low">{s.done ? 'Done' : 'To do'}</span>
                <span className="type-body">{s.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Brief work={work} userId={userId} />
    </main>
  );
}

/* ------------------------------------------------------------------ brief */

function Brief({ work, userId }: { work: Assignment; userId: string }) {
  const [files, setFiles] = useState<WorkFile[]>([]);
  const [listed, setListed] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setListed('loading');
    void loadFiles(work.id).then((r) => {
      if (!live) return;
      setFiles(r.files);
      setChosen((c) => c ?? r.files[0]?.id ?? null);
      setListed(r.failed ? 'failed' : 'ready');
    });
    return () => {
      live = false;
    };
  }, [work.id]);

  const file = files.find((f) => f.id === chosen) ?? null;

  async function onPick(list: FileList | null) {
    const picked = list?.[0];
    if (picker.current) picker.current.value = '';
    if (!picked) return;
    setProblem(null);
    setBusy(true);
    const r = await attachFile(userId, work.id, picked);
    setBusy(false);
    if (r.error || !r.file) return setProblem(r.error);
    setFiles((all) => [...all, r.file as WorkFile]);
    setChosen(r.file.id);
  }

  async function remove(f: WorkFile) {
    setProblem(null);
    setBusy(true);
    const r = await removeFile(f);
    setBusy(false);
    setConfirmRemove(null);
    if (r.error) return setProblem(r.error);
    setFiles((all) => all.filter((x) => x.id !== f.id));
    setChosen((c) => (c === f.id ? (files.find((x) => x.id !== f.id)?.id ?? null) : c));
  }

  return (
    <section aria-label="Brief">
      <SectionHead title="Brief" />

      <div className="work-files px-4">
        {files.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={f.id === chosen ? 'primary' : 'secondary'}
            aria-pressed={f.id === chosen}
            onClick={() => setChosen(f.id)}
          >
            {f.name}
          </Button>
        ))}
        {files.length < MAX_FILES_PER_WORK && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => picker.current?.click()}>
            {busy ? 'Uploading' : files.length ? 'Add another PDF' : 'Add the brief as a PDF'}
          </Button>
        )}
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a PDF"
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>

      {problem && (
        <p role="alert" className="mt-3 px-4 type-note text-t-overdue">
          {problem}
        </p>
      )}
      {listed === 'failed' && (
        <p role="alert" className="mt-3 px-4 type-note text-t-overdue">
          The attached files couldn’t be loaded. Reopen this page to try again.
        </p>
      )}
      {listed === 'ready' && files.length === 0 && (
        <p className="mt-3 px-4 type-note text-text-low">
          Attach the PDF from your instructor to read it here and get a guide to it. PDFs up to 10 MB.
        </p>
      )}

      {file && (
        <div className="mt-4 flex flex-col gap-6">
          <Viewer key={`viewer-${file.id}`} file={file} />

          <div className="flex flex-wrap items-center gap-2 px-4">
            {confirmRemove === file.id ? (
              <>
                <span className="type-note text-text-mid">Remove this file{file.guide ? ' and its guide' : ''}?</span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove(file)}>
                  Remove
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(null)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(file.id)}>
                Remove this file
              </Button>
            )}
          </div>

          <GuideSection
            key={`guide-${file.id}`}
            work={work}
            file={file}
            onSaved={(guide) =>
              setFiles((all) => all.map((f) => (f.id === file.id ? { ...f, guide, guide_at: guide ? new Date().toISOString() : null } : f)))
            }
          />
        </div>
      )}
    </section>
  );
}

function Viewer({ file }: { file: WorkFile }) {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setBytes(null);
    setFailed(false);
    void fetchBytes(file.path).then((b) => {
      if (!live) return;
      if (b) setBytes(b);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [file.path, attempt]);

  if (failed)
    return (
      <div className="px-4">
        <p className="type-body text-text-mid" role="alert">
          The file couldn’t be loaded. Check the connection and try again.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  if (!bytes) return <p className="px-4 type-note text-text-low">Loading the PDF.</p>;
  return <PdfViewer bytes={bytes} filename={safeFilename(file.name, 'pdf')} />;
}

/* ------------------------------------------------------------------ guide */

function GuideSection({
  work,
  file,
  onSaved,
}: {
  work: Assignment;
  file: WorkFile;
  onSaved: (guide: Guide | null) => void;
}) {
  const [draft, setDraft] = useState<{ guide: Guide; warnings: string[] } | null>(null);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const make = useCallback(async () => {
    setMaking(true);
    setProblem(null);
    const r = await generateGuide(file.id);
    setMaking(false);
    if (!r.ok) return setProblem(r.reason);
    setDraft({ guide: r.guide, warnings: r.warnings });
  }, [file.id]);

  async function keep() {
    if (!draft) return;
    setSaving(true);
    const r = await saveGuide(file.id, draft.guide);
    setSaving(false);
    if (r.error) return setProblem(r.error);
    onSaved(draft.guide);
    setDraft(null);
  }

  async function discard() {
    setSaving(true);
    const r = await saveGuide(file.id, null);
    setSaving(false);
    if (r.error) return setProblem(r.error);
    onSaved(null);
  }

  const shown = draft?.guide ?? file.guide;

  return (
    <section aria-label="Guide">
      <SectionHead title="Guide" />

      {!shown && (
        <div className="px-4">
          <p className="type-note text-text-low">
            Reads the PDF and sets out what it asks for and how to approach each part. It shows the route, not the
            answers. Nothing is saved until you keep it, and it uses some of today’s AI allowance.
          </p>
          <div className="mt-3">
            <Button variant="secondary" disabled={making} onClick={() => void make()}>
              {making ? 'Reading the brief' : 'Make a guide'}
            </Button>
          </div>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-3 px-4 type-note text-t-overdue">
          {problem}
        </p>
      )}

      {shown && (
        <div className="mat guide guide-print" aria-live="polite">
          <h3 className="type-h2 text-text-hi">{work.title}</h3>
          {draft && (
            <p className="kicker no-print">Not saved yet</p>
          )}
          {shown.overview && <p className="type-body text-text-mid">{shown.overview}</p>}

          {shown.requirements.length > 0 && (
            <div>
              <h4 className="kicker mb-2">What the brief requires</h4>
              <ul className="type-body">
                {shown.requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {shown.parts.length > 0 && (
            <div className="flex flex-col gap-3">
              <h4 className="kicker">How to approach each part</h4>
              {shown.parts.map((p) => (
                <div key={p.label} className="guide-part">
                  <p className="type-label text-text-hi">{p.label}</p>
                  <p className="type-body text-text-mid">{p.approach}</p>
                  {p.concepts.length > 0 && <p className="type-note text-text-low">Needs: {p.concepts.join('; ')}</p>}
                </div>
              ))}
            </div>
          )}

          {shown.pitfalls.length > 0 && (
            <div>
              <h4 className="kicker mb-2">Where marks are lost</h4>
              <ul className="type-body">
                {shown.pitfalls.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {shown.ask.length > 0 && (
            <div>
              <h4 className="kicker mb-2">Worth asking</h4>
              <ul className="type-body">
                {shown.ask.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {draft && draft.warnings.length > 0 && (
            <p className="type-note text-text-low no-print">{draft.warnings.join(' ')}</p>
          )}

          <div className="guide-actions no-print">
            {draft ? (
              <>
                <Button variant="primary" disabled={saving} onClick={() => void keep()}>
                  {saving ? 'Saving' : 'Keep this guide'}
                </Button>
                <Button variant="quiet" disabled={saving} onClick={() => setDraft(null)}>
                  Discard
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    downloadFile(
                      new Blob([guideToMarkdown(work.title, shown)], { type: 'text/markdown' }),
                      safeFilename(`${work.title} guide`, 'md'),
                    )
                  }
                >
                  Save as text
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    document.body.dataset.print = 'guide';
                    window.addEventListener('afterprint', () => delete document.body.dataset.print, { once: true });
                    window.print();
                  }}
                >
                  Print
                </Button>
                <Button variant="quiet" size="sm" disabled={making} onClick={() => void make()}>
                  {making ? 'Reading the brief' : 'Make it again'}
                </Button>
                <Button variant="quiet" size="sm" disabled={saving} onClick={() => void discard()}>
                  Remove the guide
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
