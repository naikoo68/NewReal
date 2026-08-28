import { api } from "../lib/api";

// ---- Auth ----
export const authService = {
  login: (email, password) => api.post("/auth/login", { email, password }, { auth: false }),
  register: (name, email, password, role, extra = {}) =>
    api.post("/auth/register", { name, email, password, ...(role ? { role } : {}), ...extra }, { auth: false }),
  // Client subscription plans + live price preview (coupon / referral).
  plans: () => api.get("/auth/plans", { auth: false }),
  // Student subscription plans (separate catalog from client plans).
  studentPlans: () => api.get("/auth/student-plans", { auth: false }),
  // Live price preview. Pass { audience: "student" } to price student plans.
  validateOffer: (data) => api.post("/auth/validate-offer", data, { auth: false }),
  verifyOtp: (email, otp) => api.post("/auth/verify-otp", { email, otp }, { auth: false }),
  resendOtp: (email) => api.post("/auth/resend-otp", { email }, { auth: false }),
  google: (profile) => api.post("/auth/google", profile, { auth: false }),
  me: () => api.get("/auth/me"),
  updateProfile: (data) => api.put("/auth/profile", data), // update own name / photo
  forgotPassword: (email) => api.post("/auth/forgot-password", { email }, { auth: false }),
  resetPassword: (token, password) => api.post(`/auth/reset-password/${token}`, { password }, { auth: false }),
};

// ---- Subjects / topics / sessions / questions ----
export const contentService = {
  // public reads
  streams: () => api.get("/streams"),
  subjectsByStream: (streamId) => api.get(`/streams/${streamId}/subjects`),
  subjects: () => api.get("/subjects"),
  topics: (subjectId) => api.get(`/subjects/${subjectId}/topics`),
  sessions: (topicId) => api.get(`/topics/${topicId}/sessions`),
  quizzes: (sessionId) => api.get(`/sessions/${sessionId}/quizzes`),
  quizQuestions: (quizId) => api.get(`/quizzes/${quizId}/questions`),
  questions: (sessionId) => api.get(`/sessions/${sessionId}/questions`),
  allQuestions: () => api.get("/questions"),
  moveQuiz: (id, data) => api.patch(`/quizzes/${id}/move`, data), // { session, copy }
  splitQuiz: (id, perQuiz) => api.post(`/quizzes/${id}/split`, { perQuiz }), // split one quiz into quizzes of N
  checkQuestions: (data) => api.post("/questions/check", data, { timeout: 120000 }), // "did this question come from my bank?" → { total, found, summary, results }
  splitTopic: (id, perQuiz) => api.post(`/topics/${id}/split`, { perQuiz }), // split all a topic's questions into quizzes of N
  mergeQuiz: (id, sourceIds) => api.post(`/quizzes/${id}/merge`, { sourceIds }), // merge other quizzes (same session) into this one
  // streams (admin)
  createStream: (data) => api.post("/streams", data),
  updateStream: (id, data) => api.put(`/streams/${id}`, data),
  deleteStream: (id) => api.del(`/streams/${id}`),
  // subjects (admin)
  createSubject: (data) => api.post("/subjects", data),
  updateSubject: (id, data) => api.put(`/subjects/${id}`, data),
  deleteSubject: (id) => api.del(`/subjects/${id}`),
  // topics (admin)
  createTopic: (data) => api.post("/topics", data),
  updateTopic: (id, data) => api.put(`/topics/${id}`, data),
  deleteTopic: (id) => api.del(`/topics/${id}`),
  // sessions (admin)
  createSession: (data) => api.post("/sessions", data),
  updateSession: (id, data) => api.put(`/sessions/${id}`, data),
  deleteSession: (id) => api.del(`/sessions/${id}`),
  // quizzes (admin)
  createQuiz: (data) => api.post("/quizzes", data),
  updateQuiz: (id, data) => api.put(`/quizzes/${id}`, data),
  deleteQuiz: (id) => api.del(`/quizzes/${id}`),
  // questions (admin)
  createQuestion: (data) => api.post("/questions", data),
  updateQuestion: (id, data) => api.put(`/questions/${id}`, data),
  deleteQuestion: (id) => api.del(`/questions/${id}`),
  // bulk upload: context merged into each question (subject/session/quiz/testSeries)
  bulkQuestions: (questions, context) => api.post("/questions/bulk", { questions, context }),
  // scan questions for full-question duplicates. Accepts a subjectId string
  // (quiz subject) OR a params object { subject | practiceSubject | testSeries }.
  duplicates: (params) => {
    const p = typeof params === "string" ? { subject: params } : params || {};
    const qs = new URLSearchParams();
    if (p.subject && p.subject !== "all") qs.set("subject", p.subject);
    if (p.practiceSubject) qs.set("practiceSubject", p.practiceSubject);
    if (p.pool) qs.set("pool", "1"); // pool duplicates across all of a subject's topics/items
    if (p.testSeries) qs.set("testSeries", p.testSeries);
    const s = qs.toString();
    return api.get(`/questions/duplicates${s ? `?${s}` : ""}`);
  },
};

// ---- Quiz ----
export const quizService = {
  submit: (quizId, answers, timeTaken) =>
    api.post(`/quiz/${quizId}/submit`, { answers, timeTaken }),
};

// ---- Test series ----
export const testService = {
  // list accepts { post, category, exam } filters
  list: (params = {}) => {
    const q = new URLSearchParams();
    if (params.post) q.set("post", params.post);
    if (params.exam) q.set("exam", params.exam);
    if (params.category && params.category !== "All") q.set("category", params.category);
    const s = q.toString();
    return api.get(`/tests${s ? `?${s}` : ""}`);
  },
  adminList: (postId) => api.get(`/tests/admin/all${postId ? `?post=${postId}` : ""}`),
  // Shared-link tracker (admin): all publicly shared quizzes/tests + completions.
  sharedLinks: () => api.get("/tests/admin/shared"),
  publicAttempts: (id) => api.get(`/tests/${id}/public-attempts`), // anonymous completions for one shared item
  get: (id) => api.get(`/tests/${id}`),
  submit: (id, answers, timeTaken) => api.post(`/tests/${id}/submit`, { answers, timeTaken }),
  // public share link — no account/login needed (auth header omitted)
  getPublic: (token) => api.get(`/tests/public/${token}`, { auth: false }),
  // FREE first-test-per-subject — playable without login (no auth header). The
  // backend only returns it when the id is the free preview test of its subject.
  getFree: (id) => api.get(`/tests/${id}/free`, { auth: false }),
  submitFree: (id, answers, timeTaken) => api.post(`/tests/${id}/free-submit`, { answers, timeTaken }, { auth: false }),
  registerPublicView: (token) => api.post(`/tests/public/${token}/view`, {}, { auth: false }), // count an open
  submitPublic: (token, answers, timeTaken) => api.post(`/tests/public/${token}/submit`, { answers, timeTaken }, { auth: false }),
  togglePublicLink: (id, enable, expiresAt) => api.patch(`/tests/${id}/public-link`, { enable, ...(expiresAt !== undefined ? { expiresAt } : {}) }),
  // admin
  create: (data) => api.post("/tests", data),
  update: (id, data) => api.put(`/tests/${id}`, data),
  togglePublish: (id) => api.patch(`/tests/${id}/publish`),
  remove: (id) => api.del(`/tests/${id}`),
  getAccess: (id) => api.get(`/tests/${id}/access`),
  updateAccess: (id, data) => api.put(`/tests/${id}/access`, data),
  // manual question management for a test series
  getQuestions: (id) => api.get(`/tests/${id}/questions`),
  addQuestion: (id, data) => api.post(`/tests/${id}/questions`, data),
  deleteQuestion: (id, qid) => api.del(`/tests/${id}/questions/${qid}`),
  // pull questions from the quiz/practice bank into a test
  populate: (id, plan) => api.post(`/tests/${id}/populate`, plan), // { quizPlan, practicePlan }
  autoBuild: (id, blueprint) => api.post(`/tests/${id}/auto-build`, { blueprint }, { timeout: 120000 }), // auto-pick by subject/topic/type/difficulty
  // migration (admin)
  toTestSeries: (id, data) => api.patch(`/tests/${id}/to-test-series`, data), // { exam, post }
  toMyTest: (id, data) => api.patch(`/tests/${id}/to-my-test`, data), // { practiceStream, practiceSubject }
  moveTestSeries: (id, data) => api.patch(`/tests/${id}/move-series`, data), // { exam, post }
  toQuiz: (id, data) => api.patch(`/tests/${id}/to-quiz`, data), // { session }
  quizToMyQuiz: (id, data) => api.patch(`/tests/from-quiz/${id}/to-my-quiz`, data), // { practiceStream, practiceSubject, practiceTopic }
};

// ---- Practice Quizzes (My Quiz / My Test Series) ----
// Items are practice TestSeries, so questions/visibility/attempt reuse testService.
export const practiceService = {
  // student browse (kind = "quiz" | "test") — token sent if logged in (optionalAuth),
  // so students see items granted to them; guests see only public ones.
  streams: (kind) => api.get(`/practice/browse/${kind}/streams`),
  subjects: (kind, streamId) => api.get(`/practice/browse/${kind}/streams/${streamId}/subjects`),
  topics: (kind, subjectId) => api.get(`/practice/browse/${kind}/subjects/${subjectId}/topics`), // My Quiz
  items: (kind, subjectId) => api.get(`/practice/browse/${kind}/subjects/${subjectId}/items`), // My Test Series
  topicItems: (kind, topicId) => api.get(`/practice/browse/${kind}/topics/${topicId}/items`), // My Quiz
  streamItems: (kind, streamId) => api.get(`/practice/browse/${kind}/streams/${streamId}/items`), // Previous Papers — items directly under a stream
  // My Quiz play — full questions WITH answers for instant reveal (quiz-style)
  quizPlay: (id) => api.get(`/practice/quiz/${id}/play`),
  // FREE first-quiz-per-topic — playable without login (no auth header). The
  // backend only returns it when the id is the free preview quiz of its topic.
  freeQuizPlay: (id) => api.get(`/practice/quiz/${id}/play`, { auth: false }),
  // The caller's own practice items (client dashboard) — flat quiz + test list
  myItems: () => api.get("/practice/my-items"),
  // Back up / restore ALL of my own My Practice content — background jobs with
  // a live % progress bar (poll the job, then download / read the file).
  startBackup: () => api.post("/practice/backup/start"),
  backupJob: (id) => api.get(`/practice/backup/job/${id}`),
  backupFile: (id) => api.get(`/practice/backup/job/${id}/file`, { timeout: 120000 }),
  startRestore: (data) => api.post("/practice/restore/start", data, { timeout: 180000 }),
  restoreJob: (id) => api.get(`/practice/restore/job/${id}`),
  share: (data) => api.post("/practice/share", data), // { level, id, email } → send a pending share to a registered user
  incomingShares: () => api.get("/practice/shares/incoming"), // pending shares awaiting my accept/decline
  sharePlacement: (id) => api.get(`/practice/shares/${id}/placement`), // which container levels to place (existing/new) + suggested names
  acceptShare: (id, placement) => api.post(`/practice/shares/${id}/accept`, placement ? { placement } : {}), // starts a background copy job → { jobId, itemsTotal, questionsTotal }
  acceptShareJob: (jobId) => api.get(`/practice/shares/job/${jobId}`), // poll accept progress → { status, itemsSaved, itemsTotal, questionsSaved, questionsTotal }
  declineShare: (id) => api.post(`/practice/shares/${id}/decline`),
  removeSharedWithMe: (data) => api.post("/practice/shared/remove", data), // { level, id } → remove content shared WITH me from my dashboard
  // flat list of all practice subjects (for composing a test from practice)
  allSubjects: () => api.get("/practice/all-subjects"),
  // admin — streams (kind-scoped so My Quiz & My Test Series stay separate)
  adminStreams: (kind) => api.get(`/practice/streams${kind ? `?kind=${kind}` : ""}`),
  createStream: (data) => api.post("/practice/streams", data),
  updateStream: (id, data) => api.put(`/practice/streams/${id}`, data),
  deleteStream: (id) => api.del(`/practice/streams/${id}`),
  // admin — subjects
  adminSubjects: (streamId) => api.get(`/practice/streams/${streamId}/subjects`),
  createSubject: (data) => api.post("/practice/subjects", data),
  updateSubject: (id, data) => api.put(`/practice/subjects/${id}`, data),
  deleteSubject: (id) => api.del(`/practice/subjects/${id}`),
  // admin — topics (My Quiz)
  adminTopics: (subjectId) => api.get(`/practice/subjects/${subjectId}/topics`),
  createTopic: (data) => api.post("/practice/topics", data),
  updateTopic: (id, data) => api.put(`/practice/topics/${id}`, data),
  moveTopic: (id, target) => api.patch(`/practice/topics/${id}/move`, target), // { subject } — move topic (+ its quizzes)
  deleteTopic: (id) => api.del(`/practice/topics/${id}`),
  // admin — items (practice test-series)
  adminItems: (subjectId, kind) => api.get(`/practice/subjects/${subjectId}/items${kind ? `?kind=${kind}` : ""}`),
  adminTopicItems: (topicId) => api.get(`/practice/topics/${topicId}/items`),
  createItem: (data) => api.post("/practice/items", data),
  updateItem: (id, data) => api.patch(`/practice/items/${id}`, data), // name / remembered AI topic
  moveItem: (id, target) => api.patch(`/practice/items/${id}/move`, target), // internal practice migration
  splitItem: (id, perQuiz) => api.post(`/practice/items/${id}/split`, { perQuiz }), // split one My-Quiz item into quizzes of N
  splitTopic: (id, perQuiz) => api.post(`/practice/topics/${id}/split`, { perQuiz }), // split all a topic's questions into quizzes of N
  mergeItem: (id, sourceIds) => api.post(`/practice/items/${id}/merge`, { sourceIds }), // merge other My-Quiz items (same topic) into this one
  moveQuestions: (id, questionIds, targetId) => api.post(`/practice/items/${id}/move-questions`, { questionIds, targetId }), // move selected questions to another quiz (same topic)
  copyQuestions: (id, questionIds, targetId) => api.post(`/practice/items/${id}/copy-questions`, { questionIds, targetId }), // copy selected questions into another quiz (originals kept)
  // Public share link for a WHOLE node (stream/subject/topic). Enabling cascades
  // a public link to every published item beneath it; disabling turns them off.
  // level = "stream" | "subject" | "topic".
  toggleNodePublicLink: (level, id, enable, expiresAt) =>
    api.patch(`/practice/${level}s/${id}/public-link`, { enable, ...(expiresAt !== undefined ? { expiresAt } : {}) }),
  // PUBLIC (no login): open a shared stream/subject/topic → its shareable items.
  getPublicNode: (token) => api.get(`/practice/public/node/${token}`, { auth: false }),
};

// ---- CBT online exams (single public portal; name+email sign-in; deferred results) ----
export const cbtService = {
  // public (no login) — registration is portal-wide (once per email)
  registerPortal: (data) => api.post("/cbt/register", data, { auth: false }), // { name, email, password } → OTP
  verifyPortal: (data) => api.post("/cbt/verify", data, { auth: false }), // { email, code } → { sessionToken }
  loginPortal: (data) => api.post("/cbt/login", data, { auth: false }), // { email, password } → { sessionToken }
  forgotPortal: (data) => api.post("/cbt/forgot", data, { auth: false }), // { email } → reset code
  resetPortal: (data) => api.post("/cbt/reset", data, { auth: false }), // { email, code, password } → { sessionToken }
  changePassword: (data) => api.post("/cbt/change-password", data, { auth: false }), // { email, sessionToken, currentPassword, newPassword }
  portal: (email) => api.get(`/cbt/portal${email ? `?email=${encodeURIComponent(email)}` : ""}`, { auth: false }), // list exams (+ completed flags)
  examMeta: (token) => api.get(`/cbt/exam/${token}`, { auth: false }), // exam meta
  start: (token, data) => api.post(`/cbt/exam/${token}/start`, data, { auth: false }), // { email, sessionToken } → questions
  registerView: (token) => api.post(`/cbt/exam/${token}/view`, {}, { auth: false }),
  submit: (token, payload) => api.post(`/cbt/exam/${token}/submit`, payload, { auth: false }), // { name, email, sessionToken, answers, timeTaken }
  getResult: (resultToken) => api.get(`/cbt/result/${resultToken}`, { auth: false }), // pending until released
  // student dashboard (session-gated)
  myResults: (email, session) => api.get(`/cbt/my?email=${encodeURIComponent(email)}&session=${encodeURIComponent(session)}`, { auth: false }),
  rankings: (email, session) => api.get(`/cbt/rankings?email=${encodeURIComponent(email)}&session=${encodeURIComponent(session)}`, { auth: false }),
  examRankings: (token, email, session) => api.get(`/cbt/rankings/${token}?email=${encodeURIComponent(email)}&session=${encodeURIComponent(session)}`, { auth: false }),
  // admin
  portalUrl: () => api.get("/cbt/admin/portal-url"),
  exams: () => api.get("/cbt/admin/exams"),
  candidates: () => api.get("/cbt/admin/candidates"), // My Tests available to add
  registrations: () => api.get("/cbt/admin/registrations"), // registered candidates
  deleteRegistration: (id) => api.del(`/cbt/admin/registrations/${id}`),
  leaderboard: (id) => api.get(`/cbt/admin/${id}/leaderboard`),
  students: (id) => api.get(`/cbt/admin/${id}/students`), // per-exam joined-student status
  grantLateEntry: (id, email, allow = true) => api.patch(`/cbt/admin/${id}/late-entry`, { email, allow }), // grant/revoke one student's late entry
  add: (id) => api.patch(`/cbt/admin/${id}/add`), // add a My Test to the portal
  update: (id, data) => api.patch(`/cbt/admin/${id}/update`, data), // { live?, endAt? }
  release: (id) => api.patch(`/cbt/admin/${id}/release`), // end now + email scorecards
  remove: (id) => api.patch(`/cbt/admin/${id}/remove`), // take off the portal
};

// ---- Dashboard / analytics ----
export const analyticsService = {
  dashboard: () => api.get("/me/dashboard"),
  myPerformance: () => api.get("/me/performance"), // the logged-in user's own attempts + weak areas
  attemptReview: (attemptId) => api.get(`/me/performance/attempt/${attemptId}`), // full question review of one attempt
  leaderboard: () => api.get("/leaderboard"),
  stats: () => api.get("/stats", { auth: false }),
  adminAnalytics: () => api.get("/admin/analytics"),
  contentOverview: () => api.get("/admin/content-overview"), // split practice vs content counts

  performance: () => api.get("/admin/performance"),
  userPerformance: (userId) => api.get(`/admin/performance/user/${userId}`),
  clearUserPerformance: (userId) => api.del(`/admin/performance/user/${userId}`),
  clearAllPerformance: () => api.del("/admin/performance"),
};

// ---- Storage / cleanup (admin) ----
export const storageService = {
  stats: (days) => api.get(`/admin/storage${days ? `?days=${days}` : ""}`), // DB usage + old-attempt counts
  cleanup: (data) => api.post("/admin/storage/cleanup", data), // { days, userAttempts, publicAttempts, cbtAttempts, stripCbtReview }
};

// ---- Site settings (branding & theme) ----
export const settingsService = {
  get: () => api.get("/settings", { auth: false }),
  update: (data) => api.put("/settings", data),
  testFacebook: (data) => api.post("/settings/facebook/test", data || {}), // verify/send a test Page post (admin)
  testInstagram: (data) => api.post("/settings/instagram/test", data || {}), // verify/send a test Instagram post (admin)
  uploadSelfieWatermark: (file) => {
    const fd = new FormData();
    fd.append("image", file);
    return api.post("/settings/selfie-watermark", fd);
  },
  deleteSelfieWatermark: () => api.del("/settings/selfie-watermark"),
};

// ---- Facebook scheduled auto-posting (admin) ----
export const facebookService = {
  schedules: () => api.get("/facebook/schedules"),
  create: (data) => api.post("/facebook/schedules", data),
  update: (id, data) => api.put(`/facebook/schedules/${id}`, data),
  remove: (id) => api.del(`/facebook/schedules/${id}`),
  postNow: (id) => api.post(`/facebook/schedules/${id}/post-now`),
  postQuestion: (data) => api.post("/facebook/post-question", data), // post ONE question now
  scheduleQuestion: (data) => api.post("/facebook/schedule-question", data), // schedule ONE question at a time
  previewImage: (data) => api.post("/facebook/preview-image", data), // render the question card → { url }
  suggestTags: (id) => api.get(`/facebook/suggest-tags/${id}`), // auto + default hashtags for a question → { hashtags }
};

// ---- Contact messages ----
export const messageService = {
  send: (data) => api.post("/messages", data), // requires login (sends JWT)
  list: () => api.get("/messages"),
  unreadCount: () => api.get("/messages/unread-count"),
  toggleRead: (id, read) => api.patch(`/messages/${id}/read`, { read }),
  remove: (id) => api.del(`/messages/${id}`),
};

// ---- Exams & Posts (test-series hierarchy) ----
export const examService = {
  exams: () => api.get("/exams"),
  posts: (examId) => api.get(`/exams/${examId}/posts`),
  createExam: (data) => api.post("/exams", data),
  updateExam: (id, data) => api.put(`/exams/${id}`, data),
  deleteExam: (id) => api.del(`/exams/${id}`),
  createPost: (data) => api.post("/posts", data),
  updatePost: (id, data) => api.put(`/posts/${id}`, data),
  deletePost: (id) => api.del(`/posts/${id}`),
};

// ---- Study Material (Institution → Subject → Class → Files) ----
export const studyService = {
  institutions: () => api.get("/institutions"),
  subjects: (institutionId) => api.get(`/institutions/${institutionId}/subjects`),
  classes: (subjectId) => api.get(`/sm-subjects/${subjectId}/classes`),
  files: (classId) => api.get(`/sm-classes/${classId}/files`),
  createInstitution: (d) => api.post("/institutions", d),
  updateInstitution: (id, d) => api.put(`/institutions/${id}`, d),
  deleteInstitution: (id) => api.del(`/institutions/${id}`),
  createSubject: (d) => api.post("/sm-subjects", d),
  updateSubject: (id, d) => api.put(`/sm-subjects/${id}`, d),
  deleteSubject: (id) => api.del(`/sm-subjects/${id}`),
  createClass: (d) => api.post("/sm-classes", d),
  updateClass: (id, d) => api.put(`/sm-classes/${id}`, d),
  deleteClass: (id) => api.del(`/sm-classes/${id}`),
  createFile: (d) => api.post("/sm-files", d),
  updateFile: (id, d) => api.put(`/sm-files/${id}`, d),
  deleteFile: (id) => api.del(`/sm-files/${id}`),
};

// ---- Feedback ----
export const feedbackService = {
  send: (data) => api.post("/feedback", data),
  list: () => api.get("/feedback"),
  toggleRead: (id, read) => api.patch(`/feedback/${id}/read`, { read }),
  remove: (id) => api.del(`/feedback/${id}`),
};

// ---- Reviews (public submit, admin moderation) ----
export const reviewService = {
  submit: (data) => api.post("/reviews", data), // public (works logged-in or guest)
  list: () => api.get("/reviews"), // admin
  approve: (id) => api.patch(`/reviews/${id}/approve`),
  reject: (id) => api.patch(`/reviews/${id}/reject`),
  remove: (id) => api.del(`/reviews/${id}`),
};

// ---- Notice board (scrolling ticker) ----
export const noticeService = {
  list: () => api.get("/notices", { auth: false }), // active notices (public)
  listAll: () => api.get("/notices/all"), // admin
  create: (data) => api.post("/notices", data),
  update: (id, data) => api.put(`/notices/${id}`, data),
  remove: (id) => api.del(`/notices/${id}`),
};

// ---- Documents (standalone text store; PDF text extraction) ----
export const documentService = {
  list: () => api.get("/documents"), // lightweight list (no full content)
  get: (id) => api.get(`/documents/${id}`), // full document incl. text
  create: (data) => api.post("/documents", data), // { title, content, sourceName, pages }
  update: (id, data) => api.put(`/documents/${id}`, data),
  remove: (id) => api.del(`/documents/${id}`),
};

// ---- AI question generator (admin) ----
// Retry a one-shot AI call after ~60s when the server reports a per-minute rate
// limit / quota (429, or a 5xx whose message mentions quota/rate-limit) — so a
// single "extend explanation" / "regenerate question" rides out the limit and
// finishes instead of failing immediately (mirrors the syllabus-parse wait). The
// bulk jobs already wait & retry server-side.
const isRateLimit = (e) =>
  e?.status === 429 || /\b(quota|rate[\s-]?limit|429|too many requests)\b/i.test(e?.message || "");
const withRateLimitRetry = async (fn, { waitMs = 60000, tries = 2 } = {}) => {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (e?.aborted) throw e; // user pressed Stop — never retry
      if (!isRateLimit(e) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, waitMs)); // wait for the per-minute limit to reset, then retry
    }
  }
};

export const aiService = {
  status: (mode) => api.get(`/ai/status${mode ? `?mode=${encodeURIComponent(mode)}` : ""}`),
  generate: (data) => api.post("/ai/generate", data), // returns { jobId, requested }
  job: (id) => api.get(`/ai/job/${id}`), // poll: { status, count, requested, questions? }
  cancelJob: (id) => api.post(`/ai/job/${id}/cancel`), // stop a running job → keeps partial results
  extract: (data) => api.post("/ai/extract", data), // import questions from a URL/text → { questions }
  notes: (data) => api.post("/ai/notes", data), // generate study notes (Markdown) on a topic
  visualize: (prompt, mode) => api.post("/ai/visualize", { prompt, ...(mode ? { mode } : {}) }), // prompt → visualization JSON spec
  inferTopic: (data) => api.post("/ai/infer-topic", data), // name the topic a quiz's existing questions belong to → { topic }
  coverageGaps: (data) => api.post("/ai/coverage-gaps", data), // list uncovered syllabus areas → { topic, coveredCount, missing } → { notes }
  outlineUnits: (data) => api.post("/ai/outline-units", data), // detect units/chapters/topics in a PDF/source → { units: [...] }
  parseSyllabus: (data) => api.post("/ai/parse-syllabus", data, { timeout: 180000 }), // full syllabus → { subject, topics:[{title,subtopics}] }
  classifyUnits: (data) => api.post("/ai/classify-units", data), // file question stems under units → { assign: [...] }
  extendExplanations: (data) => api.post("/ai/extend-explanations", data), // enrich all explanations in a quiz/test → { jobId, requested }
  extendOne: (data, opts) => withRateLimitRetry(() => api.post("/ai/extend-explanation", data, opts)), // enrich ONE question's explanation → { explanation, optionExplanations }; opts.signal supports Stop
  regenerate: (data, opts) => withRateLimitRetry(() => api.post("/ai/regenerate-question", data, opts)), // analyse ONE question → rebuild options/answer → { options, correct, explanation }; opts.signal supports Stop
  regenerateAll: (data) => api.post("/ai/regenerate-all", data), // regenerate EVERY question in a quiz/test → { jobId, requested }
  checkSemantic: (data) => api.post("/ai/check-semantic", data, { timeout: 120000 }), // AI "deep check": match pasted questions to the bank BY MEANING, across formats → same shape as contentService.checkQuestions
  // Client AI access + pool selection (built-in vs own keys)
  access: () => api.get("/ai/access"), // { access, mode, allowInbuilt, allowSelf, ownKeys, inbuiltAvailable }
  setMode: (mode) => api.put("/ai/mode", { mode }), // "inbuilt" | "self"
  // AI-key management (owner-scoped: admin → platform keys, client → own keys)
  keys: {
    list: () => api.get("/ai/keys"),
    create: (data) => api.post("/ai/keys", data),
    bulkCreate: (data) => api.post("/ai/keys/bulk", data), // add many keys at once (shared preset)
    update: (id, data) => api.put(`/ai/keys/${id}`, data),
    remove: (id) => api.del(`/ai/keys/${id}`),
    reveal: (id) => api.get(`/ai/keys/${id}/reveal`), // fetch the raw key to view/copy in the edit modal
    test: (id) => api.post(`/ai/keys/${id}/test`),
    models: (id) => api.post(`/ai/keys/${id}/models`), // which models this key can use
    autoModel: (id) => api.post(`/ai/keys/${id}/auto-model`), // auto-detect + set a working model
    importEnv: () => api.post("/ai/keys/import"),
    // These probe every key across the network, so allow a longer timeout.
    testAll: () => api.post("/ai/keys/test-all", undefined, { timeout: 300000 }),
    autoModelAll: () => api.post("/ai/keys/auto-model-all", undefined, { timeout: 300000 }), // auto-pick a working model for every key at once
    setAllEnabled: (enabled) => api.post("/ai/keys/set-enabled-all", { enabled }), // enable/disable every key at once
  },
};

// ---- File upload (Cloudinary) ----
export const uploadService = {
  file: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/upload", fd);
  },
};

// ---- User Manual (public read, admin write) ----
export const userManualService = {
  get: () => api.get("/manual", { auth: false }), // { sections: [...] }
  update: (sections) => api.put("/manual", { sections }), // admin only
};

// ---- Users (admin) ----
export const userService = {
  list: (search = "") => api.get(`/users${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  clients: (search = "") => api.get(`/users/clients${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  deletedClients: () => api.get("/users/clients/deleted"), // Recycle bin (soft-deleted clients)
  restore: (id) => api.post(`/users/${id}/restore`), // restore a soft-deleted client
  deletePermanent: (id) => api.del(`/users/${id}/permanent`), // permanent delete (cannot be undone)
  create: (data) => api.post("/users", data),
  update: (id, data) => api.put(`/users/${id}`, data),
  remove: (id) => api.del(`/users/${id}`),
  toggleStatus: (id) => api.patch(`/users/${id}/status`),
  updatePlan: (id, plan) => api.patch(`/users/${id}/plan`, { plan }),
  resetPassword: (id) => api.post(`/users/${id}/reset-password`),
  getAccess: (id) => api.get(`/users/${id}/access`),
  updateAccess: (id, data) => api.put(`/users/${id}/access`, data),
  applyClientFeatures: (features) => api.patch(`/users/clients/feature-access`, { features }), // apply feature flags to ALL clients
};

// ---- Discount coupons (admin) ----
export const couponService = {
  list: () => api.get("/coupons"),
  create: (data) => api.post("/coupons", data),
  update: (id, data) => api.put(`/coupons/${id}`, data),
  remove: (id) => api.del(`/coupons/${id}`),
};

// ---- Payments (Razorpay) ----
export const paymentService = {
  config: () => api.get("/payments/config", { auth: false }), // { enabled, keyId }
  createOrder: (data) => api.post("/payments/create-order", data, { auth: false }),
};

// ---- Subscription upgrade / renew (logged-in client, works when expired) ----
export const subscriptionService = {
  order: (data) => api.post("/subscriptions/order", data),
  activate: (data) => api.post("/subscriptions/activate", data),
};

// ---- Student subscription subscribe / renew (logged-in student, works when
// the plan has lapsed). Mirrors subscriptionService but for student plans. ----
export const studentSubscriptionService = {
  order: (data) => api.post("/student-subscriptions/order", data),
  activate: (data) => api.post("/student-subscriptions/activate", data),
};

// ---- Tenants / institutes (super-admin only) ----
export const tenantService = {
  list: (search) => api.get(`/tenants${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  get: (id) => api.get(`/tenants/${id}`),
  create: (data) => api.post("/tenants", data),
  setStatus: (id, status) => api.patch(`/tenants/${id}/status`, { status }),
  createAdmin: (id, data) => api.post(`/tenants/${id}/admin`, data), // create an institute admin
  setDomain: (id, customDomain) => api.patch(`/tenants/${id}/domain`, { customDomain }), // set/clear custom domain
};

// ---- Public institute self-signup (Phase 5) ----
export const instituteSignupService = {
  config: () => api.get("/institute-signup/config", { auth: false }), // { enabled, payEnabled, keyId, plans }
  availability: ({ slug, email }) => {
    const q = new URLSearchParams();
    if (slug) q.set("slug", slug);
    if (email) q.set("email", email);
    return api.get(`/institute-signup/availability?${q.toString()}`, { auth: false });
  },
  order: (data) => api.post("/institute-signup/order", data, { auth: false }),
  provision: (data) => api.post("/institute-signup", data, { auth: false }),
};

// ---- Global metadata search (streams/subjects/topics/quizzes/tests) ----
// optionalAuth on the backend: an admin's token unlocks all metadata; guests
// and students see only public, published content.
export const searchService = {
  query: (q) => api.get(`/search?q=${encodeURIComponent(q)}`),
};


// Full ADMIN content-library backup & restore (background jobs + live progress).
export const adminBackupService = {
  start: () => api.post("/admin/backup/start"),
  job: (id) => api.get(`/admin/backup/job/${id}`),
  file: (id) => api.get(`/admin/backup/job/${id}/file`, { timeout: 180000 }),
  startRestore: (data) => api.post("/admin/restore/start", data, { timeout: 180000 }),
  restoreJob: (id) => api.get(`/admin/restore/job/${id}`),
};

// Content-library Recycle Bin — soft-deleted Streams/Subjects/Topics/Sessions/
// Quizzes/Questions that can be restored or permanently removed.
export const recycleService = {
  list: () => api.get("/recycle-bin"), // { items, counts, total }
  restore: (type, id) => api.post("/recycle-bin/restore", { type, id }),
  remove: (type, id) => api.del(`/recycle-bin/${type}/${id}`), // permanent delete (cascades)
  empty: () => api.del("/recycle-bin"), // permanently empty the whole bin
};
