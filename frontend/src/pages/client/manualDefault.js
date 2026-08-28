/* =============================================================================
   USER MANUAL — DEFAULT CONTENT
   =============================================================================
   This is the built-in fallback shown when the admin hasn't saved any manual
   content yet (or if the manual API can't be reached). Once an admin saves the
   manual from the Admin Panel (Admin → User Manual), the saved content from the
   database is shown instead — so admins can edit everything without code.

   Entry shape (every field except `title` is optional):
     {
       title:   "Build",
       summary: "one-line description",
       details: ["step 1", "step 2"],   // shown as a numbered list
       image:   "build.png",            // a file in /public/manual, OR a full
                                        //   https:// URL (uploaded screenshots)
       tab:     "build",                // optional client workspace tab key
       children: [ { ...same shape... } ] // sub-functions, nested to any depth
     }
   ========================================================================== */
export const DEFAULT_MANUAL = [
  {
    id: "dashboard",
    title: "Dashboard",
    tab: "dashboard",
    image: "dashboard.png",
    summary: "Practice everything you've built and track your progress.",
    details: [
      "Open the Dashboard to see all your quizzes and tests, plus your live account validity.",
      "Switch between My Quiz and My Test, then drill Stream → Subject → Topic → Quiz (tests go Stream → Test).",
    ],
    children: [
      { title: "Practice / Take Test", details: ["Tap Practice on a quiz, or Take Test on a test, to start. A quiz/test needs at least one question before you can practise it."] },
      { title: "Search", details: ["Use the search box to find any quiz, test or question by its name or content."] },
      { title: "Download paper / answer key", details: ["Use the download icon on any card to export a printable question paper or an answer key (PDF)."] },
      { title: "Performance", details: ["Scroll to Performance for your accuracy, best score, attempt history and weak areas — it updates after every attempt."] },
    ],
  },
  {
    id: "build",
    title: "Build",
    tab: "build",
    image: "build.png",
    summary: "Create your own structure, then fill it with questions.",
    details: [
      "Open Build and pick My Quiz or My Test.",
      "Everything you add here appears on your Dashboard immediately.",
    ],
    children: [
      {
        title: "Create the structure",
        details: ["Build the hierarchy from the top down. Use the Add button at each level."],
        children: [
          { title: "Add Stream", details: ["The top level (e.g. an exam or class). Create this first."] },
          { title: "Add Subject", details: ["Sits under a Stream."] },
          { title: "Add Topic", details: ["Sits under a Subject (My Quiz only)."] },
          { title: "Add Quiz / Add Test", details: ["Inside a Topic (Quiz) or Subject (Test), set its name, duration, marks and difficulty."] },
        ],
      },
      {
        title: "Add questions to a quiz / test",
        details: ["Open a quiz/test and tap Questions to open its question tools."],
        children: [
          { title: "Add Manually", details: ["Write one question at a time — MCQ, matching, assertion–reason, statements, pairs, table, and more."] },
          { title: "Bulk Upload", details: ["Paste or upload many questions at once."] },
          { title: "Pick from Quizzes", details: ["Copy existing questions from your other quizzes into this one."] },
          { title: "View All", details: ["Review every question in Admin or Student view."] },
          { title: "Copy CSV / Export CSV", details: ["Copy the questions as CSV, or download them as a CSV file."] },
        ],
      },
      {
        title: "Generate questions with AI",
        image: "aigen.png",
        details: [
          "In a quiz/test's question tools, tap AI Generate.",
          "Type a topic (or paste a web/YouTube link), optionally list exact subtopics, then set how many of each type and difficulty.",
          "Generate, review the preview, and Insert. \"Generate more\" continues from the uncovered subtopics (no repeats).",
        ],
        children: [
          { title: "Import from Web", details: ["Reads a PDF, document, web page or YouTube transcript and turns it into questions."] },
          { title: "Choose your AI source", details: ["Pick built-in keys or your own in the AI tab."] },
        ],
      },
      {
        title: "Improve questions with AI",
        details: ["Polish questions you already have."],
        children: [
          { title: "Extend Explanations", details: ["Enrich the explanation of one question, or all at once."] },
          { title: "Regenerate All", details: ["Rebuild every question's options/answer (reshuffles pair/matching)."] },
          { title: "Scan Missing Areas", details: ["Find syllabus subtopics not yet covered, then generate for just those."] },
          { title: "Other question types", details: ["Turn your existing MCQs into assertion–reason, statements, matching or pairs."] },
        ],
      },
      {
        title: "Organise & clean up questions",
        details: ["Keep large banks tidy."],
        children: [
          { title: "Split", details: ["Break a large quiz (or a whole topic) into quizzes of N questions."] },
          { title: "Merge", details: ["Combine several sibling quizzes into one (use Select all to grab them quickly)."] },
          { title: "Find Duplicates", details: ["Scan a subject (or across all topics) for repeated questions and delete the extra copies."] },
        ],
      },
    ],
  },
  {
    id: "papers",
    title: "Previous Papers",
    tab: "papers",
    image: "papers.png",
    summary: "Organise real exam papers and let students practise them.",
    details: [
      "Open Previous Papers and build Stream → Exam → Year → Paper.",
      "Add the paper's questions like any quiz (they play with instant answers).",
    ],
    children: [
      { title: "Paper files", details: ["Upload the actual question-paper PDF and one or more answer keys (original, revised…), plus any additional information."] },
      { title: "Student view", details: ["Students open the paper, see the PDFs + info, and practise it like a quiz."] },
    ],
  },
  {
    id: "checker",
    title: "Question Checker",
    tab: "checker",
    image: "checker.png",
    summary: "Check whether questions already exist in your content.",
    details: [
      "Open Question Checker and paste questions, or upload a file/image of a paper.",
      "Nothing is saved — it only searches your own questions.",
    ],
    children: [
      { title: "Check my bank", details: ["Shows, per question, whether it already exists — exact copy, very similar, related, or original — and where."] },
      { title: "Deep check with AI", details: ["Tick this to match by meaning across formats (uses AI)."] },
    ],
  },
  {
    id: "aigen",
    title: "AI Generator (studio)",
    tab: "aigen",
    image: "aigen.png",
    summary: "A dedicated space to draft questions in bulk.",
    details: [
      "Open the AI Generator tab to draft questions in bulk.",
      "Generate, review, and save straight into your quizzes/tests.",
    ],
  },
  {
    id: "documents",
    title: "Documents",
    tab: "documents",
    image: "documents.png",
    summary: "Write notes and render math / chemistry equations.",
    details: [
      "Open Documents to write notes and render math/chemistry equations.",
      "Saved documents can be a source when importing questions with AI.",
    ],
    children: [
      { title: "Copy for Word", details: ["Pastes rendered equations straight into MS Word."] },
    ],
  },
  {
    id: "notes",
    title: "Notes",
    tab: "notes",
    image: "notes.png",
    summary: "Generate clean, structured study notes with AI.",
    details: ["Open Notes to generate clean, structured study notes on any topic with AI."],
  },
  {
    id: "migrate",
    title: "Migrate",
    tab: "migrate",
    image: "migrate.png",
    summary: "Move or copy content between locations.",
    details: ["Open Migrate to move or copy quizzes/tests (and their questions) between streams, subjects or topics."],
  },
  {
    id: "sharing",
    title: "Share & receive content",
    tab: "dashboard",
    image: "dashboard.png",
    summary: "Send your content to others and accept what they send you.",
    details: [
      "On any stream/subject/topic/quiz, use Send to user / Share to send it to another account by email.",
      "Content others send you appears at the top of your Dashboard — Accept to save your own copy (whole streams save directly; smaller shares ask where to save).",
    ],
  },
  {
    id: "account",
    title: "Account",
    tab: "account",
    image: "account.png",
    summary: "Your validity, plan and referral code.",
    details: [
      "Open Account (in the ☰ menu) for your name, email, plan and validity.",
      "Renew / change plan before your access expires.",
      "Share your referral code — for every friend who buys a plan you get 10 free days.",
    ],
  },
];

// Resolve an entry's `image` to a usable <img src>. Uploaded screenshots are
// stored as full https:// URLs (Cloudinary); built-in defaults are bare file
// names served from /public/manual. Data URIs (previews) pass through too.
export function manualImageSrc(image) {
  if (!image) return "";
  if (/^(https?:)?\/\//i.test(image) || image.startsWith("data:")) return image;
  return `/manual/${image}`;
}
