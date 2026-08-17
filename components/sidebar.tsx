import Link from "next/link";
import {
  CheckCircle2,
  Home,
  Library,
  PenLine,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  shortcut?: string;
  active?: boolean;
};

const primaryNav: NavItem[] = [
  { label: "Panel", icon: Home, href: "/", active: true },
  { label: "Buscar", icon: Search, href: "/", shortcut: "⌘K" },
];

const projectNav: NavItem[] = [
  { label: "Todos los libros", icon: Library, href: "/" },
  { label: "En escritura", icon: PenLine, href: "/" },
  { label: "Listos", icon: CheckCircle2, href: "/" },
  { label: "Míos", icon: User, href: "/" },
];

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        item.active
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.shortcut ? (
        <kbd className="text-[11px] text-muted-foreground/70">
          {item.shortcut}
        </kbd>
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-background lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-primary to-accent">
          <Sparkles className="size-4 text-primary-foreground" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Nébula</span>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4 scrollbar-thin">
        <div className="flex flex-col gap-0.5">
          {primaryNav.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Biblioteca
          </p>
          {projectNav.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </div>
      </nav>

      <div className="border-t border-border p-3">
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="text-sm font-medium">Herramienta interna</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Solo para el equipo. Los libros son compartidos.
          </p>
        </div>
      </div>
    </aside>
  );
}
