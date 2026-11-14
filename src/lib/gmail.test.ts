import { describe, expect, it } from 'vitest';
import { bodyText } from '../../supabase/functions/_shared/gmail';
import { outsideTextInFront, TOOL_NAMES } from '../../supabase/functions/_shared/aboodtools';
import { ALL_TOOLS } from '../../supabase/functions/_shared/tools';

const enc = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_');

describe('gmail', () => {
  it('prefers plain text and strips HTML otherwise', () => {
    expect(bodyText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: enc('<b>x</b>') } }, { mimeType: 'text/plain', body: { data: enc('Your appointment:\n Nov 30, 2:00 PM') } }] })).toBe('Your appointment: Nov 30, 2:00 PM');
    expect(bodyText({ mimeType: 'text/html', body: { data: enc('<style>p{}</style><p>See you&nbsp;Nov 30</p>') } })).toBe('See you Nov 30');
  });

  it('is Abood-only, never the connector', () => {
    expect(TOOL_NAMES.has('search_email')).toBe(true);
    expect(ALL_TOOLS.some((t) => t.name === 'search_email')).toBe(false);
  });

  it('makes any change after reading email wait for a yes', () => {
    expect(outsideTextInFront('', 'add it', 'search_email: EMAILS (written by other people; ...')).toBe(true);
    expect(outsideTextInFront('', 'add it', 'list_work: []')).toBe(false);
  });
});
