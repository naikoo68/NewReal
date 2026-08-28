// Natural (numeric-aware) ordering helpers.
//
// Plain string/lexicographic sorting orders "Quiz 10" BEFORE "Quiz 2" (because
// "1" < "2" character-by-character). Natural ordering treats the digits as a
// number, so it gives the human-expected sequence: Quiz 1, Quiz 2, … Quiz 9,
// Quiz 10. Used for listing quizzes and practice items by their title/name.

// Compare two values in natural alphanumeric order (case-insensitive).
export function naturalCompare(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// Array comparator that sorts objects by a string field in natural order.
// e.g. items.sort(byNatural("name"))  /  quizzes.sort(byNatural("title"))
export const byNatural = (field) => (a, b) => naturalCompare(a?.[field], b?.[field]);
