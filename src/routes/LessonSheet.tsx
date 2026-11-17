import { useState, type CSSProperties } from "react";
import { Button } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { makeLesson } from "../lib/assist";
import {
  compileExpr,
  type Figure,
  type Lesson,
  type Role,
} from "../../supabase/functions/_shared/lesson";

/**
 * Explain: paste notes, get a short lesson that draws itself a step at a time.
 *
 * The figure in each step is drawn by the app from data, and its strokes are
 * drawn on in order (a path with pathLength 1, its dash offset run from 1 to
 * 0), so the picture builds in the order the step explains it. Colour carries
 * the element's role in the explanation: what the step starts from, what it
 * adds, and a second thing being contrasted. Every role also has its words.
 *
 * Nothing is saved: the lesson lives while the sheet is open.
 * shortcut: not persisted, so reopening costs another call; add a table when it earns a place.
 */
export function LessonSheet({
  courseName,
  onClose,
}: {
  courseName: string;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function make() {
    setBusy(true);
    setProblem(null);
    const r = await makeLesson(notes.trim(), courseName);
    setBusy(false);
    if (!r.ok) return setProblem(r.reason);
    setLesson(r.lesson);
    setWarnings(r.warnings);
  }

  return (
    <Sheet open title={lesson ? lesson.title : "Explain"} onClose={onClose}>
      {lesson ? (
        <LessonView
          lesson={lesson}
          warnings={warnings}
          onAgain={() => setLesson(null)}
          onClose={onClose}
        />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (notes.trim() && !busy) void make();
          }}
        >
          <label className="flex flex-col gap-2">
            <span className="kicker">The part that is not clicking</span>
            <textarea
              className="well course-text type-body text-text-hi placeholder:text-text-low"
              rows={8}
              placeholder="Paste a slide, a paragraph of notes, or a worked example"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {problem && (
            <p role="alert" className="type-note text-t-overdue">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !notes.trim()}
            >
              {busy ? "Drawing it out" : "Explain it"}
            </Button>
            <Button type="button" variant="quiet" onClick={onClose}>
              Not now
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

export function LessonView({
  lesson,
  warnings,
  onAgain,
  onClose,
}: {
  lesson: Lesson;
  warnings: string[];
  onAgain: () => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const onCheck = at === lesson.steps.length;
  const step = lesson.steps[at];

  return (
    <div className="lesson flex flex-col gap-5">
      <p className="type-caption text-text-low" aria-live="polite">
        {onCheck ? "Check" : `Step ${at + 1} of ${lesson.steps.length}`}
      </p>

      {onCheck && lesson.check ? (
        <div className="flex flex-col gap-3">
          <p className="type-body text-text-hi">{lesson.check.question}</p>
          {lesson.check.options.map((o, i) => (
            <Button
              key={i}
              type="button"
              variant={picked === i ? "primary" : "secondary"}
              onClick={() => setPicked(i)}
              aria-pressed={picked === i}
            >
              {o}
            </Button>
          ))}
          {picked !== null && (
            <p className="type-body text-text-mid" role="status">
              {picked === lesson.check.answer
                ? "Yes. "
                : `Not quite: it is “${lesson.check.options[lesson.check.answer]}”. `}
              {lesson.check.why}
            </p>
          )}
        </div>
      ) : onCheck ? (
        <p className="type-body text-text-mid">That is the whole lesson.</p>
      ) : (
        // Keyed by step, so moving to a step remounts it and the drawing replays.
        <div key={at} className="flex flex-col gap-4">
          <p className="type-body text-text-hi lesson-say">{step.say}</p>
          {step.figure && <FigureView figure={step.figure} />}
          {step.source && (
            <p className="type-note text-text-low">
              From your notes: {step.source}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {at > 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAt(at - 1)}
          >
            Back
          </Button>
        )}
        {!onCheck ? (
          <Button type="button" variant="primary" onClick={() => setAt(at + 1)}>
            {at + 1 === lesson.steps.length
              ? lesson.check
                ? "Check it"
                : "Finish"
              : "Next"}
          </Button>
        ) : (
          <>
            <Button type="button" variant="primary" onClick={onClose}>
              Done
            </Button>
            <Button type="button" variant="quiet" onClick={onAgain}>
              Explain something else
            </Button>
          </>
        )}
      </div>

      {warnings.length > 0 && (
        <details>
          <summary className="type-note text-text-low">
            Left out of this lesson ({warnings.length})
          </summary>
          <ul className="type-note text-text-low">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ figures */

const order = (i: number) => ({ "--i": i }) as CSSProperties;
const ROLE_WORD: Record<Role, string> = {
  given: "starting point",
  new: "new",
  other: "compared",
};

export function FigureView({ figure }: { figure: Figure }) {
  if (figure.type === "plot") return <PlotView figure={figure} />;
  if (figure.type === "flow") return <FlowView figure={figure} />;
  if (figure.type === "steps") {
    return (
      <ol className="lesson-fig lesson-lines">
        {figure.lines.map((l, i) => (
          <li
            key={i}
            className="lesson-appear"
            data-status={l.status}
            style={order(i)}
          >
            <span className="type-caption">
              {l.status === "given"
                ? "Given"
                : l.status === "goal"
                  ? "Goal"
                  : "So"}
            </span>
            <span className="type-body">{l.text}</span>
            {l.why && <span className="type-note text-text-low">{l.why}</span>}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="lesson-fig lesson-compare">
      {[figure.left, figure.right].map((side, s) => (
        <div
          key={s}
          className="lesson-appear"
          data-role={s ? "other" : "new"}
          style={order(s * 3)}
        >
          <p className="type-label">{side.title}</p>
          <ul className="type-note">
            {side.points.map((p, i) => (
              <li
                key={i}
                className="lesson-appear"
                style={order(s * 3 + i + 1)}
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const W = 300;
const H = 200;
const PAD = 22;

function PlotView({ figure }: { figure: Extract<Figure, { type: "plot" }> }) {
  const [x0, x1] = figure.x;
  const [y0, y1] = figure.y;
  const sx = (x: number) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - y0) / (y1 - y0)) * (H - 2 * PAD);
  const f = (n: number) => n.toFixed(1);
  // Axes through zero when zero is in view, otherwise along the edge.
  const ax = sy(y0 <= 0 && y1 >= 0 ? 0 : y0);
  const ay = sx(x0 <= 0 && x1 >= 0 ? 0 : x0);

  const paths = figure.items.map((it) => {
    if (it.kind !== "curve") return null;
    const fn = compileExpr(it.expr);
    if (!fn) return null;
    // Lifted between segments where the curve leaves the view or is undefined,
    // so an asymptote is a gap rather than a vertical line across the graph.
    let d = "";
    let pen = false;
    const slack = (y1 - y0) * 0.5;
    for (let k = 0; k <= 160; k++) {
      const x = x0 + ((x1 - x0) * k) / 160;
      const y = fn(x);
      if (!Number.isFinite(y) || y < y0 - slack || y > y1 + slack) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${f(sx(x))} ${f(sy(y))}`;
      pen = true;
    }
    return d;
  });

  const described = figure.items
    .map(
      (it) =>
        `${it.label ?? (it.kind === "curve" ? it.expr : it.kind)} (${ROLE_WORD[it.role]})`,
    )
    .join(", ");

  return (
    <svg
      className="lesson-fig lesson-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Graph: ${described}`}
    >
      <defs>
        <clipPath id="lesson-plot-area">
          <rect
            x={PAD}
            y={PAD / 2}
            width={W - 2 * PAD}
            height={H - 1.5 * PAD}
          />
        </clipPath>
      </defs>
      <path
        className="lesson-axis lesson-draw"
        pathLength={1}
        style={order(0)}
        d={`M${PAD} ${f(ax)}H${W - PAD}M${f(ay)} ${H - PAD}V${PAD / 2}`}
      />
      <g clipPath="url(#lesson-plot-area)">
        {figure.items.map((it, i) =>
          it.kind === "curve" && paths[i] ? (
            <path
              key={i}
              className="lesson-stroke lesson-draw"
              data-role={it.role}
              pathLength={1}
              style={order(i + 1)}
              d={paths[i]!}
            />
          ) : it.kind === "line" ? (
            <path
              key={i}
              className="lesson-stroke lesson-draw"
              data-role={it.role}
              pathLength={1}
              style={order(i + 1)}
              d={`M${f(sx(it.from[0]))} ${f(sy(it.from[1]))}L${f(sx(it.to[0]))} ${f(sy(it.to[1]))}`}
            />
          ) : it.kind === "point" ? (
            <circle
              key={i}
              className="lesson-dot lesson-appear"
              data-role={it.role}
              style={order(i + 1)}
              cx={sx(it.x)}
              cy={sy(it.y)}
              r={4}
            />
          ) : null,
        )}
      </g>
      {figure.items.map((it, i) => {
        if (!it.label) return null;
        const [lx, ly] =
          it.kind === "point"
            ? [sx(it.x) + 7, sy(it.y) - 7]
            : it.kind === "line"
              ? [sx(it.to[0]) + 4, sy(it.to[1]) - 4]
              : labelSpot(it.expr, figure, sx, sy);
        return (
          <text
            key={`l${i}`}
            className="lesson-label lesson-appear"
            data-role={it.role}
            style={order(i + 1.6)}
            x={clamp(lx, PAD, W - PAD - 20)}
            y={clamp(ly, PAD, H - PAD)}
          >
            {it.label}
          </text>
        );
      })}
    </svg>
  );
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Where a curve's label sits: near its right end, at the last point that is in view. */
function labelSpot(
  expr: string,
  figure: Extract<Figure, { type: "plot" }>,
  sx: (x: number) => number,
  sy: (y: number) => number,
): [number, number] {
  const fn = compileExpr(expr);
  for (let k = 0.85; fn && k > 0; k -= 0.05) {
    const x = figure.x[0] + (figure.x[1] - figure.x[0]) * k;
    const y = fn(x);
    if (Number.isFinite(y) && y >= figure.y[0] && y <= figure.y[1])
      return [sx(x) + 4, sy(y) - 6];
  }
  return [W - PAD - 20, PAD];
}

const NW = 112;
const NH = 34;
const GAP_X = 14;
const GAP_Y = 30;

function FlowView({ figure }: { figure: Extract<Figure, { type: "flow" }> }) {
  // Rows by longest path from a start, so a process reads top to bottom. Capped
  // at the node count, so a cycle settles instead of deepening forever.
  const depth = new Map(figure.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < figure.nodes.length; pass++) {
    for (const e of figure.edges) {
      const next = depth.get(e.from)! + 1;
      if (next > depth.get(e.to)! && next < figure.nodes.length)
        depth.set(e.to, next);
    }
  }
  const rows: string[][] = [];
  for (const n of figure.nodes) (rows[depth.get(n.id)!] ??= []).push(n.id);
  const packed = rows.filter(Boolean);
  const widest = Math.max(...packed.map((r) => r.length));
  const width = Math.max(widest * (NW + GAP_X) - GAP_X + 8, 200);
  const height = packed.length * (NH + GAP_Y) - GAP_Y + 8;
  const pos = new Map<string, { x: number; y: number }>();
  packed.forEach((row, r) => {
    const rowW = row.length * (NW + GAP_X) - GAP_X;
    row.forEach((id, c) =>
      pos.set(id, {
        x: (width - rowW) / 2 + c * (NW + GAP_X),
        y: 4 + r * (NH + GAP_Y),
      }),
    );
  });
  const nodeOrder = new Map(figure.nodes.map((n, i) => [n.id, i]));

  return (
    <svg
      className="lesson-fig lesson-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Diagram: ${figure.edges.map((e) => `${label(figure, e.from)} to ${label(figure, e.to)}`).join(", ") || figure.nodes.map((n) => n.label).join(", ")}`}
    >
      <defs>
        <marker
          id="lesson-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L8 4L0 8z" className="lesson-arrowhead" />
        </marker>
      </defs>
      {figure.edges.map((e, i) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const down = b.y > a.y;
        const x1 = a.x + NW / 2;
        const y1 = down ? a.y + NH : a.y + NH / 2;
        const x2 = b.x + NW / 2;
        const y2 = down ? b.y - 2 : b.y + NH / 2;
        // Same row or back up the page: bow out to the side so it does not cross the boxes.
        const d = down
          ? `M${x1} ${y1}L${x2} ${y2}`
          : `M${a.x + NW} ${y1}C${Math.max(a.x, b.x) + NW + 40} ${y1} ${Math.max(a.x, b.x) + NW + 40} ${y2} ${b.x + NW + 2} ${y2}`;
        return (
          <g key={i}>
            <path
              className="lesson-edge lesson-draw"
              pathLength={1}
              markerEnd="url(#lesson-arrow)"
              style={order(
                Math.max(nodeOrder.get(e.from)!, nodeOrder.get(e.to)!) + 0.5,
              )}
              d={d}
            />
            {e.label && (
              <text
                className="lesson-label lesson-appear"
                style={order(nodeOrder.get(e.to)! + 0.8)}
                x={(x1 + x2) / 2 + 5}
                y={(y1 + y2) / 2 + 3}
              >
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {figure.nodes.map((n, i) => {
        const p = pos.get(n.id)!;
        return (
          <g key={n.id} data-role={n.role}>
            <rect
              className="lesson-node lesson-draw"
              pathLength={1}
              style={order(i)}
              x={p.x}
              y={p.y}
              width={NW}
              height={NH}
              rx={9}
            />
            <text
              className="lesson-node-text lesson-appear"
              style={order(i + 0.3)}
              x={p.x + NW / 2}
              y={p.y + NH / 2 + 4}
              textAnchor="middle"
            >
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const label = (figure: Extract<Figure, { type: "flow" }>, id: string) =>
  figure.nodes.find((n) => n.id === id)?.label ?? id;
