import type { ReactNode } from 'react';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { SectionHead } from '../components/SectionHead';
import { goTo } from '../lib/mentions';
import { moduleOn, usePreferences } from '../lib/preferences';

/**
 * How it works: the guide the first run ends on, and Settings > How it works
 * after that.
 *
 * Written as steps rather than a feature list, because a list of what exists
 * tells nobody where to tap. Each section ends in the one place it describes,
 * so reading about Schedule is one tap from being on it. Keep it in step with
 * the app: a guide that names a button that moved is worse than none.
 */

interface Step {
  title: string;
  body: ReactNode;
}

interface Section {
  id: string;
  title: string;
  lead: string;
  steps: Step[];
  go?: { label: string; href: string };
}

/** Follow a link from the guide. Settings pages move on popstate, as a Back does. */
function follow(href: string) {
  goTo(href);
  if (href.startsWith('/settings')) window.dispatchEvent(new PopStateEvent('popstate'));
}

const Key = ({ children }: { children: ReactNode }) => <kbd className="palette-kbd whitespace-nowrap">{children}</kbd>;

function sections(aboodOn: boolean): Section[] {
  return [
    {
      id: 'around',
      title: 'Getting around',
      lead: 'Seven places, always one tap away.',
      steps: [
        {
          title: 'On a phone, the bar at the bottom',
          body: 'Today, Schedule, Month and Search sit in the tab bar, with the + in the middle. Abood, Courses and Settings are under More. On an iPad every place gets its own tab.',
        },
        {
          title: 'On a laptop, the sidebar',
          body: (
            <>
              The sidebar runs down the left. In the Glass theme, the one every account starts on, it is glass too: closed it is a row of icons that name themselves on hover, and the toggle on its edge, or <Key>[</Key>, opens it into a labelled panel. It remembers which way you left it.
            </>
          ),
        },
        {
          title: 'Back always works',
          body: 'Every screen, course page and open item has its own address, so the back gesture and the browser’s Back button go where you expect.',
        },
      ],
    },
    {
      id: 'adding',
      title: 'Adding things',
      lead: 'Nothing needs a date, a course or a category to be worth writing down.',
      steps: [
        {
          title: 'The +',
          body: 'Tap + for Assignment, Course outline or Course. With an assignment, attach the brief as a PDF and the app fills the title, due date and weight from it, saying where each came from. You can change any of it before saving.',
        },
        {
          title: 'Capture anything',
          body: 'The box on Today takes plain language: “lab report thu 5pm phys” becomes Lab report, due Thursday at 5 p.m., in your physics course. What it read shows under the field before you press Enter, and anything without a date goes to the inbox.',
        },
        {
          title: 'Speak instead of typing',
          body: 'Where the browser can hear you, a microphone sits beside the capture box. Your words land in the field and nothing is saved until you press Enter.',
        },
        {
          title: 'Sort the inbox later',
          body: 'Captured thoughts wait in the inbox on Schedule, with a count on its tab. Open one to turn it into work, an event or nothing.',
        },
      ],
      go: { label: 'Open Schedule', href: '/week' },
    },
    {
      id: 'search',
      title: 'Search and shortcuts',
      lead: 'Faster than finding your way there.',
      steps: [
        {
          title: 'Search',
          body: 'One box covers work, events, the inbox and courses. Titles that start with what you typed come first, and open work before finished.',
        },
        {
          title: 'The command palette',
          body: (
            <>
              <Key>⌘K</Key> or <Key>Ctrl K</Key> opens it from anywhere, even mid-sentence. Jump to a screen, a course, a piece of work or a setting, or start capturing. In Glass, the search pill in the top bar opens it too.
            </>
          ),
        },
        {
          title: 'The island',
          body: (
            <>
              In Glass on a laptop, hover the search pill or press <Key>Alt N</Key> to drop down today’s work, the focus timer, the inbox and what is left of the day. <Key>Esc</Key> closes it.
            </>
          ),
        },
      ],
      go: { label: 'Open Search', href: '/search' },
    },
    {
      id: 'today',
      title: 'Today and your work',
      lead: 'What to do right now, without going anywhere.',
      steps: [
        {
          title: 'Widgets',
          body: 'Today is a board of widgets. Hold one still to lift it and move it; the ⋯ menu has Edit widgets and Add a widget, with every size each one comes in.',
        },
        {
          title: 'Finish and move work',
          body: 'Tap the circle on any piece of work to finish it, on Today or anywhere else. In Schedule’s lists, swipe a row right to finish it or left to push it to tomorrow; on a laptop the arrow beside it does the same. Both can be undone from the bar that appears.',
        },
        {
          title: 'Schedule and Month',
          body: 'Schedule holds everything dated, overdue and undated. Drag work to another day in Schedule or Month to reschedule it, or use Select to move several at once.',
        },
        {
          title: 'Courses',
          body: 'Each course has a page: what is coming up, office hours, contacts, links, notes, the syllabus as read, and a grade breakdown that can tell you what it would take to reach a mark.',
        },
      ],
      go: { label: 'Open Courses', href: '/plan' },
    },
    {
      id: 'ai',
      title: 'AI help',
      lead: 'It suggests; you decide. Nothing it reads or proposes is saved until you confirm it.',
      steps: [
        {
          title: 'Course outlines',
          body: 'Paste a syllabus, or upload it as a PDF or photo, from + > Course outline. Every deadline comes back as a ticket to keep or drop. Dates it cannot be sure of, like “week 6”, come back undated rather than guessed.',
        },
        {
          title: 'Break this into first moves',
          body: 'In a piece of work, this turns it into four or five concrete steps. They are added to your own steps, never in place of them.',
        },
        {
          title: 'Make a guide',
          body: 'On a work page with a PDF brief, Make a guide lays out how to approach it. It shows the route, not the answers, and is kept only if you tap Keep this guide.',
        },
        {
          title: 'What now',
          body: 'Tell it how long you have and it picks one task and says why. It is plain arithmetic on your own work, so it keeps working offline.',
        },
        ...(aboodOn
          ? [
              {
                title: 'Ask Abood',
                body: 'Ask about your own week: what is due, when the next exam is, what to start on. It answers only from your planner, and any change it suggests is a card you accept or decline. Abood can also be reached by Telegram or iMessage from Settings > Abood.',
              },
            ]
          : []),
        {
          title: 'Connect Claude',
          body: 'Settings > Connected apps gives the address to add the planner to Claude as a connector. Claude can read your day and add or move work; it cannot delete anything, and every change it makes is listed there with Undo.',
        },
        {
          title: 'Your own key',
          body: 'The AI features share a daily allowance. Add your own Groq or Gemini key in Settings > Abood and the allowance stops applying to you.',
        },
      ],
      go: aboodOn ? { label: 'Open Abood', href: '/ask' } : { label: 'Open AI keys', href: '/settings/abood' },
    },
    {
      id: 'yours',
      title: 'Make it yours',
      lead: 'All optional. The defaults work.',
      steps: [
        {
          title: 'Theme, colour scheme and wallpaper',
          body: 'Settings > Appearance has three separate choices. The theme is the material: Glass, Dot matrix or Plain. The colour scheme is one of seventeen palettes, each light and dark, and any theme takes any scheme. The wallpaper sits behind the glass and can be your own photo.',
        },
        {
          title: 'Today and modules',
          body: 'Reorder or hide Today’s sections, and switch off what you do not use: Abood, grades, repeating work, calendar feeds. Switching off hides, never deletes.',
        },
        {
          title: 'Notifications',
          body: 'Add the app to your home screen, then turn on push in Settings > Notifications for a morning digest and reminders. Exams get a nudge the night before.',
        },
        {
          title: 'Your calendar',
          body: 'The calendar feed puts your deadlines in Apple, Google or Outlook Calendar. Replace the link at any time to cut off the old one.',
        },
      ],
      go: { label: 'Open Appearance', href: '/settings/appearance' },
    },
  ];
}

const SHORTCUTS: [ReactNode, string][] = [
  [<Key>⌘K</Key>, 'Command palette'],
  [<Key>/</Key>, 'Search'],
  [<Key>[</Key>, 'Open or close the glass sidebar'],
  [<Key>Alt N</Key>, 'Open the island (Glass, on a laptop)'],
  [<Key>Esc</Key>, 'Close what is open, or go back to Today'],
];

export function Help() {
  const prefs = usePreferences();
  const list = sections(moduleOn('abood', prefs));
  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col gap-4 px-4">
        <p className="firstrun-p">Everything the planner does, and where to find it. Come back any time from Settings.</p>
        <div className="flex flex-wrap gap-2">
          {list.map((s) => (
            <Chip key={s.id} onClick={() => document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {s.title}
            </Chip>
          ))}
        </div>
        <Button variant="primary" className="self-start" onClick={() => goTo('/')}>
          Go to Today
        </Button>
      </div>

      {list.map((s) => (
        <section key={s.id} aria-labelledby={`help-${s.id}`} className="scroll-mt-6">
          <SectionHead id={`help-${s.id}`} title={s.title} />
          <p className="firstrun-p mb-3 px-4">{s.lead}</p>
          <ol className="firstrun-steps">
            {s.steps.map((step, i) => (
              <li key={step.title}>
                <span className="n">{i + 1}</span>
                <span>
                  <b>{step.title}</b>
                  <span>{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
          {s.go && (
            <Button variant="quiet" className="mt-2" onClick={() => follow(s.go!.href)}>
              {s.go.label}
            </Button>
          )}
        </section>
      ))}

      <section aria-labelledby="help-keys">
        <SectionHead id="help-keys" title="Keyboard" />
        <ul className="firstrun-steps">
          {SHORTCUTS.map(([keys, what], i) => (
            <li key={i}>
              <span>{keys}</span>
              <span>
                <b>{what}</b>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
