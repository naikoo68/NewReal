---
inclusion: always
---

# AI question generation — complete syllabus coverage

Every AI **question-generation** path must produce COMPLETE topic coverage
before repeating concepts. This applies to all generation entry points, which
share the same prompts in `backend/src/controllers/aiController.js`:

- **AI Generator** (`generateQuestions` → `POST /api/ai/generate`)
- **Import from Web → "Generate new"** (same `generateQuestions`, with a `url`/`source`)
- **Client accounts** (same endpoint, scoped to their key pool)

"Extract existing" (`extractQuestions` → `POST /api/ai/extract`) is exempt from
*synthesising* coverage — it must faithfully copy the questions already present
in the source — but it must still de-duplicate and preserve factual accuracy.

## What the prompts must enforce

The directive is embedded in three shared places; keep them in sync when editing:

1. **`SYSTEM_PROMPT`** — the "COMPLETE SYLLABUS COVERAGE" + "BATCH CONTINUATION"
   block. Before writing, build a mental SYLLABUS MAP (NCERT + standard
   university books + competitive exams + current affairs where relevant) across
   every category — definitions, terminology, components, classification,
   principles, causes, processes/mechanisms, types, characteristics,
   distribution, factors, effects, importance, advantages/disadvantages,
   applications, examples, exceptions, comparisons, frequently-confused concepts,
   numericals/formulas, maps/diagrams — and every applicable dimension
   (historical, geographical, scientific, economic, environmental, political,
   technological, current) and scope (regional, national, international). Then
   distribute questions PROPORTIONALLY across all sections, cover static AND
   dynamic portions, test each concept at least once before repeating, and never
   test the same fact twice with different wording.

2. **`outlineSubtopics`** — decomposes the topic into a broad syllabus map that
   spans the categories/dimensions above, so parallel generation chunks each get
   different subtopics assigned.

3. **`buildUserPrompt`** — the "COVERAGE TRACKER" block treats the `avoid` list
   (existing questions) as already-covered concepts, tells the model to continue
   from uncovered parts first, and only move to advanced/analytical/
   interdisciplinary/current-affairs questions once breadth is covered.

## Batch continuation

Callers pass existing question stems in `avoid` (and the UI seeds it from prior
batches / "Generate more"). The generator also feeds back everything produced
within the current run. Treat this as the concept coverage tracker: continue
from uncovered concepts; do not revise covered concepts unless explicitly asked.

## User steering

An optional **"Subtopics to cover"** input (frontend `AiGenerate.jsx`, backend
`subtopics` body field) lets the user list exact subtopics; when provided they
are used directly (skipping auto-detection). Leave empty → auto-detect.


## Topic scope discipline

Every AI path must stay STRICTLY inside the named topic and out of sibling
topics that are studied as their own chapters. This is enforced by the
`TOPIC_SCOPE_RULE` constant in `aiController.js`, injected into `SYSTEM_PROMPT`,
`buildUserPrompt`, `outlineSubtopics` and `coverageGaps`.

Example: for **Physiography** (relief, landforms, mountains, plateaus, plains,
passes, glaciers, geology, tectonics) the AI must EXCLUDE Drainage/River
systems, Climate, Soils, Natural vegetation, Wildlife, Population and Economy —
each is its own topic. Likewise Climate excludes physiography and rivers;
Rivers/Drainage excludes climate and relief; etc. Overlapping concepts are
treated only from the named topic's angle, never as the sibling topic's content.

Keep `TOPIC_SCOPE_RULE` applied to any new AI generation/analysis path.
