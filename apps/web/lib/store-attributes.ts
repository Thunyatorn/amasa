import type { Category, Rule } from "@amasa/schemas";

// The attribute keys demo-store really has per category (a test checks this against
// data/celebrities/demo-set.json), with how a must-have rule on each is written. Intake shows these to
// the model; contract confirmation rejects any rule whose key is not listed, because the verifier
// could never satisfy it.
export const STORE_ATTRIBUTES: Record<Category, Record<string, string>> = {
  actors: {
    oscar: 'Use op "eq" with "yes" (has won an Academy Award) or "no".',
  },
  musicians: {
    genre: 'Use op "includes" with one of pop, rock, r&b, soul, hip-hop, country, latin, or electronic.',
  },
  athletes: {
    sport: 'Use op "eq" with tennis, soccer, basketball, track and field, gymnastics, swimming, american football, or motor racing.',
  },
};

export const isStoreRule = (category: Category, rule: Rule): boolean =>
  Object.hasOwn(STORE_ATTRIBUTES[category], rule.key);
