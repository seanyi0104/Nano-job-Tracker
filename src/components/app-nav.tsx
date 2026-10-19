import Link from "next/link";

// Order follows the actual dependency chain, not importance: the CV defines
// who the user is, that profile is what the JD analysis matches against AND
// what steers email triage, and tracking is what happens after you apply.
const LINKS = [
  { href: "/cv", label: "1 · My CV" },
  { href: "/analyze", label: "2 · Analyze JD" },
  { href: "/", label: "3 · Tracker" },
];

export function AppNav({ current }: { current: string }) {
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            link.href === current
              ? "bg-gray-900 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
