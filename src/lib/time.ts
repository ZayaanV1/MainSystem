/**
 * The time layer, for the browser.
 *
 * The implementation lives under supabase/functions/_shared so the Deno edge
 * runtime bundles it. This re-export is not indirection for its own sake: the
 * client deciding what "today" means and the digest deciding when 07:00 is are
 * the same question, and two copies of that answer would eventually disagree.
 *
 * Import from here in app code. Never from the _shared path directly.
 */
export * from '../../supabase/functions/_shared/time';
