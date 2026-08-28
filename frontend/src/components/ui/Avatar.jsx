// Renders a user's uploaded photo when available, otherwise their initials in a
// coloured circle. `src` may be an image URL / data-URI (shows the picture) or
// empty / initials text (shows the fallback circle).
const isImage = (v) => typeof v === "string" && (v.startsWith("http") || v.startsWith("data:"));

const toInitials = (s = "") =>
  s.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export default function Avatar({
  src,
  name = "",
  size = 36,
  className = "",
  fallbackClassName = "bg-brand-600 text-white",
}) {
  const dim = { width: size, height: size };
  if (isImage(src)) {
    return (
      <img
        src={src}
        alt={name || "Profile"}
        style={dim}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      style={{ ...dim, fontSize: Math.round(size * 0.4) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${fallbackClassName} ${className}`}
    >
      {toInitials(name) || "U"}
    </span>
  );
}
