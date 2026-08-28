import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

// Gates routes that require an authenticated user.
// `role` optionally restricts to a specific role (e.g. "admin").
export default function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  // `role` may be a single role or an array of allowed roles.
  const roles = role ? (Array.isArray(role) ? role : [role]) : null;
  const isAdminArea = !!roles && (roles.includes("admin") || roles.includes("institute_admin"));
  const loginPath = isAdminArea ? "/admin/login" : "/login";

  // While revalidating the session, avoid a premature redirect.
  if (loading && !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!user || (roles && !roles.includes(user.role))) {
    return <Navigate to={loginPath} state={{ from: location.pathname }} replace />;
  }
  return children;
}
