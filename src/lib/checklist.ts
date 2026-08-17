/**
 * Checklist logic, for the browser.
 *
 * The implementation lives under supabase/functions/_shared so the digest can
 * use it too. Which items are due today must mean the same thing to the app
 * and to the 07:00 notification — two copies of that rule would eventually
 * disagree, and the symptom would be a digest listing something the app says
 * is not due.
 */
export * from '../../supabase/functions/_shared/checklist';
