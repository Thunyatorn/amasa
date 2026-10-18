import type { Category, Rule } from "@amasa/schemas";

// The attribute keys demo-store really has per category (a test checks this against
// data/products.json), with how a must-have rule on each is written. Intake shows these to the
// model; contract confirmation rejects any rule whose key is not listed, because the verifier
// could never satisfy it.
export const STORE_ATTRIBUTES: Record<Category, Record<string, string>> = {
  "running-shoes": {
    width: 'Use op "eq" with wide, standard, or narrow.',
    sizes_available: 'Use op "includes" with the size as a string, e.g. "10.5".',
    use: 'Use op "eq" with road, trail, track, or walking.',
  },
  groceries: {
    diet: 'Use op "eq" with vegan or vegetarian.',
    size: 'Use op "eq" with the package size, e.g. "1 kg", "500 g", or "1 L".',
    type: 'Use op "eq" with oats, plant milk, fruit, eggs, yogurt, bread, rice, beans, spread, oil, coffee, tea, pasta, sauce, cheese, greens, honey, cereal, or water.',
    organic: 'Use op "eq" with "yes".',
  },
  household: {
    scent: 'Use op "eq" with lemon, fresh, unscented, or lavender.',
    size: 'Use op "eq" with the package size, e.g. "750 ml", "6 rolls", or "4 bulbs".',
    type: 'Use op "eq" with dish soap, detergent, paper towels, toilet paper, trash bags, cleaner, sponges, hand soap, light bulbs, or batteries.',
    watts: 'Use numeric watts with op "eq", "gte", or "lte"; current bulbs use 9 watts.',
  },
};

export const isStoreRule = (category: Category, rule: Rule): boolean =>
  Object.hasOwn(STORE_ATTRIBUTES[category], rule.key);
