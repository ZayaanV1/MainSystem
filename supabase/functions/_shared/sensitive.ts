/**
 * Whether a remembered fact is about something sensitive: health, money,
 * substances, relationships and sex, or the law.
 *
 * A word list, not a model: it runs on every fact Abood offers to remember
 * and in Settings, where the same answer must come back for the same
 * sentence. It errs toward calling a fact sensitive, because the cost of a
 * wrong yes is one fact not kept and the cost of a wrong no is a diagnosis
 * stored against someone who switched this off.
 */
const SENSITIVE =
  /\b(adhd|autis\w*|anxi\w*|depress\w*|bipolar|ocd|ptsd|therap\w*|counsel\w*|psych\w*|diagnos\w*|medicat\w*|prescri\w*|adderall|ritalin|vyvanse|antidepress\w*|pills?|dose|doctor|clinic|hospital|surgery|illness|sick|disab\w*|pregnan\w*|sti|hiv|cancer|diabet\w*|asthma|eating disorder|self[- ]harm|suicid\w*|panic attacks?|insomnia|weed|cannabis|drugs?|alcohol\w*|drunk|drinking|sober|smok\w*|vap\w*|nicotine|addict\w*|rehab|debt|loan|rent|salary|wage|broke|overdraft|credit card|gambl\w*|boyfriend|girlfriend|breakup|broke up|dating|crush|sex\w*|gay|lesbian|trans|queer|religio\w*|pray\w*|immigra\w*|visa|arrest\w*|police|court|lawsuit|abus\w*|assault\w*|died|death|funeral|grie\w*|divorce\w*)\b/i;

export function isSensitive(fact: string): boolean {
  return SENSITIVE.test(fact);
}
