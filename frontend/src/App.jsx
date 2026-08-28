import { lazy, Suspense } from "react";
// Hash-based routing: the route lives after the "#", so the web server only
// ever receives "/" and a full-page REFRESH on ANY deep route (a quiz, an admin
// page, the client workspace) always serves the app and restores that exact
// page — with no host-side SPA rewrite required. This is the reliable fix for
// "refresh drops me back to the home/streams page".
import { createHashRouter, RouterProvider } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { SettingsProvider } from "./context/SettingsContext";
import { AuthProvider } from "./context/AuthContext";
import { ZoomProvider } from "./context/ZoomContext";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import StudentGate from "./components/auth/StudentGate";
import ContentProtection from "./components/ui/ContentProtection";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import Layout from "./components/layout/Layout";
import { Loading } from "./components/ui/AsyncState";

// Pages are loaded on demand (code-splitting) so the first visit only downloads
// the code it actually needs, instead of the whole app in one large bundle.
const Home = lazy(() => import("./pages/Home"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Refund = lazy(() => import("./pages/Refund"));
const WriteReview = lazy(() => import("./pages/WriteReview"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Account = lazy(() => import("./pages/Account"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PublicNode = lazy(() => import("./pages/PublicNode"));

const QuizHome = lazy(() => import("./pages/quiz/QuizHome"));
const StreamSubjects = lazy(() => import("./pages/quiz/StreamSubjects"));
const PracticeHome = lazy(() => import("./pages/practice/PracticeHome"));
const PracticeBrowse = lazy(() => import("./pages/practice/PracticeBrowse"));
const PracticeQuizPlay = lazy(() => import("./pages/practice/PracticeQuizPlay"));
const SubjectTopics = lazy(() => import("./pages/quiz/SubjectTopics"));
const TopicSessions = lazy(() => import("./pages/quiz/TopicSessions"));
const SessionQuizzes = lazy(() => import("./pages/quiz/SessionQuizzes"));
const QuizPlay = lazy(() => import("./pages/quiz/QuizPlay"));
const QuizResult = lazy(() => import("./pages/quiz/QuizResult"));

const StudyHome = lazy(() => import("./pages/study/StudyHome"));
const StudySubjects = lazy(() => import("./pages/study/StudySubjects"));
const StudyClasses = lazy(() => import("./pages/study/StudyClasses"));
const StudyFiles = lazy(() => import("./pages/study/StudyFiles"));

const TestExams = lazy(() => import("./pages/testseries/TestExams"));
const ExamPosts = lazy(() => import("./pages/testseries/ExamPosts"));
const PostTests = lazy(() => import("./pages/testseries/PostTests"));
const TestAttempt = lazy(() => import("./pages/testseries/TestAttempt"));

const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const ClientRegister = lazy(() => import("./pages/auth/ClientRegister"));
const InstituteRegister = lazy(() => import("./pages/auth/InstituteRegister"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));

const StudentUpgrade = lazy(() => import("./pages/student/StudentUpgrade"));

const ClientWorkspace = lazy(() => import("./pages/client/ClientWorkspace"));
const ClientPerformanceDetails = lazy(() => import("./pages/client/ClientPerformanceDetails"));

const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminContent = lazy(() => import("./pages/admin/AdminContent"));
const AdminTests = lazy(() => import("./pages/admin/AdminTests"));
const AdminStudyMaterial = lazy(() => import("./pages/admin/AdminStudyMaterial"));
const AdminFeedback = lazy(() => import("./pages/admin/AdminFeedback"));
const AdminReviews = lazy(() => import("./pages/admin/AdminReviews"));
const AdminStorage = lazy(() => import("./pages/admin/AdminStorage"));
const AdminBackup = lazy(() => import("./pages/admin/AdminBackup"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminMessages = lazy(() => import("./pages/admin/AdminMessages"));
const AdminCustomization = lazy(() => import("./pages/admin/AdminCustomization"));
const AdminUserManual = lazy(() => import("./pages/admin/AdminUserManual"));
const AdminNotices = lazy(() => import("./pages/admin/AdminNotices"));
const AdminFacebook = lazy(() => import("./pages/admin/AdminFacebook"));
const AdminPerformance = lazy(() => import("./pages/admin/AdminPerformance"));
const AdminPractice = lazy(() => import("./pages/admin/AdminPractice"));
// Standalone "Previous Papers" = the practice manager locked to the paper kind.
const AdminPreviousPapers = () => <AdminPractice fixedKind="paper" />;
const AdminMigration = lazy(() => import("./pages/admin/AdminMigration"));
const AdminClients = lazy(() => import("./pages/admin/AdminClients"));
const AdminCoupons = lazy(() => import("./pages/admin/AdminCoupons"));
const AdminPlans = lazy(() => import("./pages/admin/AdminPlans"));
const AdminInstitutes = lazy(() => import("./pages/admin/AdminInstitutes"));
const AdminAiKeys = lazy(() => import("./pages/admin/AdminAiKeys"));
const AdminSharedLinks = lazy(() => import("./pages/admin/AdminSharedLinks"));
const AdminAiStudio = lazy(() => import("./pages/admin/AdminAiStudio"));
const AdminDocuments = lazy(() => import("./pages/admin/AdminDocuments"));
const AdminNotes = lazy(() => import("./pages/admin/AdminNotes"));
const AdminPdfBuilder = lazy(() => import("./pages/admin/AdminPdfBuilder"));
const AdminCbt = lazy(() => import("./pages/admin/AdminCbt"));
const AdminVisualize = lazy(() => import("./pages/admin/AdminVisualize"));
const AdminChecker = lazy(() => import("./pages/admin/AdminChecker"));
const CbtResult = lazy(() => import("./pages/cbt/CbtResult"));
const CbtPortal = lazy(() => import("./pages/cbt/CbtPortal"));

// Standalone Resume Builder (self-contained; no dependency on other features)
const ResumeBuilder = lazy(() => import("./pages/resume/ResumeBuilder"));

// Wraps a lazily-loaded page in a Suspense boundary with a loading fallback.
const S = (Comp) => (
  <Suspense fallback={<div className="container-page"><Loading label="Loading…" /></div>}>
    <Comp />
  </Suspense>
);

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: S(Home) },
      { path: "/about", element: S(About) },
      { path: "/contact", element: S(Contact) },
      { path: "/pricing", element: S(Pricing) },
      { path: "/privacy", element: S(Privacy) },
      { path: "/terms", element: S(Terms) },
      { path: "/refund", element: S(Refund) },
      { path: "/review", element: S(WriteReview) },

      { path: "/quiz", element: S(QuizHome) },
      { path: "/quiz/stream/:streamId", element: S(StreamSubjects) },
      { path: "/quiz/:subjectId", element: S(SubjectTopics) },
      { path: "/quiz/:subjectId/:topicId", element: S(TopicSessions) },
      { path: "/quiz/:subjectId/:topicId/:sessionId", element: S(SessionQuizzes) },
      // Playing a specific quiz is gated for logged-in students without an
      // active plan (they see the upgrade paywall). Anonymous visitors keep the
      // free preview; admins/clients are unaffected (StudentGate only gates
      // logged-in students).
      { path: "/quiz/:subjectId/:topicId/:sessionId/:quizId", element: <StudentGate>{S(QuizPlay)}</StudentGate> },
      { path: "/quiz/:subjectId/:topicId/:sessionId/:quizId/result", element: S(QuizResult) },

      { path: "/test-series", element: S(TestExams) },
      { path: "/test-series/:examId", element: S(ExamPosts) },
      { path: "/test-series/:examId/:postId", element: S(PostTests) },

      { path: "/practice", element: S(PracticeHome) },
      { path: "/practice/:kind", element: S(PracticeBrowse) },
      { path: "/practice/:kind/:streamId", element: S(PracticeBrowse) },
      { path: "/practice/:kind/:streamId/:subjectId", element: S(PracticeBrowse) },
      { path: "/practice/:kind/:streamId/:subjectId/:topicId", element: S(PracticeBrowse) },
      { path: "/practice/quiz/play/:itemId", element: <ProtectedRoute><StudentGate>{S(PracticeQuizPlay)}</StudentGate></ProtectedRoute> },

      { path: "/study", element: S(StudyHome) },
      { path: "/study/:institutionId", element: S(StudySubjects) },
      { path: "/study/:institutionId/:subjectId", element: S(StudyClasses) },
      { path: "/study/:institutionId/:subjectId/:classId", element: S(StudyFiles) },

      { path: "/login", element: S(Login) },
      { path: "/register", element: S(Register) },
      { path: "/client/register", element: S(ClientRegister) },
      { path: "/institute/register", element: S(InstituteRegister) },
      { path: "/forgot-password", element: S(ForgotPassword) },
      { path: "/reset-password/:token", element: S(ResetPassword) },

      {
        path: "/dashboard",
        element: <ProtectedRoute><StudentGate>{S(Dashboard)}</StudentGate></ProtectedRoute>,
      },
      {
        path: "/account",
        element: <ProtectedRoute>{S(Account)}</ProtectedRoute>,
      },
      {
        // Student self-serve subscribe / renew page (reachable any time; also
        // shown automatically by StudentGate when a gated feature is hit).
        path: "/subscribe",
        element: <ProtectedRoute>{S(StudentUpgrade)}</ProtectedRoute>,
      },
    ],
  },

  // Standalone Resume Builder — full-screen, public, self-contained
  {
    path: "/resume",
    element: S(ResumeBuilder),
  },

  // Full-screen test interface (outside main layout). Gated: attempting a
  // test-series requires an active student subscription (admins/clients pass).
  {
    path: "/test-series/attempt/:testId",
    element: <ProtectedRoute><StudentGate>{S(TestAttempt)}</StudentGate></ProtectedRoute>,
  },

  // Public shared test — NO login required (anyone with the link can take it)
  {
    path: "/public/test/:token",
    element: S(TestAttempt),
  },
  // Public shared QUIZ — quiz-style player (one at a time, tap to reveal)
  {
    path: "/public/quiz/:token",
    element: S(PracticeQuizPlay),
  },
  // FREE first-quiz-per-topic — attemptable without login (freemium preview)
  {
    path: "/practice/quiz/free/:freeId",
    element: S(PracticeQuizPlay),
  },
  // FREE first-test-per-subject — attemptable without login (freemium preview)
  {
    path: "/practice/test/free/:freeId",
    element: S(TestAttempt),
  },
  // Public shared NODE (stream/subject/topic) — lists every quiz/test under it
  {
    path: "/public/node/:token",
    element: S(PublicNode),
  },
  // Public exam PORTAL — the single shareable web page listing all live exams
  {
    path: "/online-exams",
    element: S(CbtPortal),
  },
  // CBT online exam — students sign in with name+email (no OTP) then take it
  {
    path: "/cbt/exam/:cbtToken",
    element: S(TestAttempt),
  },
  // CBT result — public, printable result page (reached from the emailed link)
  {
    path: "/cbt/result/:resultToken",
    element: S(CbtResult),
  },

  // Client "My Practice" workspace (separate shell, own content only)
  {
    path: "/client",
    element: (
      <ProtectedRoute role="client">
        {S(ClientWorkspace)}
      </ProtectedRoute>
    ),
  },
  // Full-page performance details (opened from the dashboard's Attempts card)
  {
    path: "/client/performance",
    element: (
      <ProtectedRoute role="client">
        {S(ClientPerformanceDetails)}
      </ProtectedRoute>
    ),
  },

  // Admin (separate shell)
  { path: "/admin/login", element: S(AdminLogin) },
  {
    path: "/admin",
    element: (
      <ProtectedRoute role={["admin", "institute_admin"]}>
        {S(AdminLayout)}
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: S(AdminDashboard) },
      { path: "institutes", element: S(AdminInstitutes) },
      { path: "content", element: S(AdminContent) },
      { path: "tests", element: S(AdminTests) },
      { path: "practice", element: S(AdminPractice) },
      { path: "previous-papers", element: S(AdminPreviousPapers) },
      { path: "checker", element: S(AdminChecker) },
      { path: "shared", element: S(AdminSharedLinks) },
      { path: "migration", element: S(AdminMigration) },
      { path: "clients", element: S(AdminClients) },
      { path: "coupons", element: S(AdminCoupons) },
      { path: "plans", element: S(AdminPlans) },
      { path: "study", element: S(AdminStudyMaterial) },
      { path: "feedback", element: S(AdminFeedback) },
      { path: "reviews", element: S(AdminReviews) },
      { path: "users", element: S(AdminUsers) },
      { path: "performance", element: S(AdminPerformance) },
      { path: "storage", element: S(AdminStorage) },
      { path: "backup", element: S(AdminBackup) },
      { path: "messages", element: S(AdminMessages) },
      { path: "notices", element: S(AdminNotices) },
      { path: "facebook", element: S(AdminFacebook) },
      { path: "ai-generator", element: S(AdminAiStudio) },
      { path: "visualize", element: S(AdminVisualize) },
      { path: "documents", element: S(AdminDocuments) },
      { path: "notes", element: S(AdminNotes) },
      { path: "pdf-builder", element: S(AdminPdfBuilder) },
      { path: "resume", element: S(ResumeBuilder) },
      { path: "cbt", element: S(AdminCbt) },
      { path: "ai-keys", element: S(AdminAiKeys) },
      { path: "customization", element: S(AdminCustomization) },
      { path: "manual", element: S(AdminUserManual) },
    ],
  },

  { path: "*", element: S(NotFound) },
]);

export default function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <AuthProvider>
          <ZoomProvider>
            <ContentProtection />
            <ErrorBoundary>
              <RouterProvider router={router} />
            </ErrorBoundary>
          </ZoomProvider>
        </AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
