import { useAuth } from "../../context/AuthContext";
import StudentUpgrade from "../../pages/student/StudentUpgrade";

// True when a student account has an active subscription (studentPlanExpiresAt
// in the future). The backend also sends a convenience `studentSubscribed` flag.
function studentActive(user) {
  if (!user) return false;
  if (user.studentSubscribed === true) return true;
  return !!(user.studentPlanExpiresAt && new Date(user.studentPlanExpiresAt).getTime() > Date.now());
}

// Gates premium student features (attempting quizzes/test-series, the
// performance Dashboard) behind an active student subscription. Non-student
// roles (admin/client) and subscribed students see the feature; a student
// without an active plan sees the upgrade paywall instead.
//
// Meant to be used INSIDE a <ProtectedRoute> (which guarantees a logged-in
// user); if somehow rendered without a user it just passes through so the
// route guard can handle the redirect.
export default function StudentGate({ children }) {
  const { user } = useAuth();
  if (!user) return children;
  if (user.role !== "student") return children; // admins & clients are unaffected
  if (studentActive(user)) return children;

  return (
    <div className="container-page py-10">
      <StudentUpgrade />
    </div>
  );
}
