"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, 
  FileText, 
  Calendar as CalendarIcon, 
  BarChart3, 
  Users, 
  User, 
  LogOut, 
  ShieldCheck,
  Sun,
  Moon,
  Menu,
  X
} from "lucide-react";
import { useAppStore } from "@/lib/store";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAppStore();
  const [theme, setTheme] = useState("dark");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const activeTheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(activeTheme);
  }, []);

  const toggleTheme = () => {
    if (document.documentElement.classList.contains("dark")) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setTheme("light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setTheme("dark");
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const menuItems = [
    { name: "DASHBOARD", href: "/dashboard", icon: LayoutDashboard },
    { name: "RESUME", href: "/resume", icon: FileText },
    { name: "CALENDAR", href: "/calendar", icon: CalendarIcon },
    { name: "ANALYTICS", href: "/analytics", icon: BarChart3 },
    { name: "COMMUNITY", href: "/community", icon: Users },
    { name: "PROFILE", href: "/profile", icon: User },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="flex h-16 w-full items-center justify-between border-b-2 border-border bg-background px-4 md:hidden">
        <Link href="/dashboard" className="text-xl font-bold tracking-tighter text-foreground uppercase">
          NEXTUP<span className="text-accent">.AI</span>
        </Link>
        <button 
          onClick={() => setMobileOpen(!mobileOpen)} 
          className="border-2 border-border p-1 bg-muted hover:bg-accent hover:text-black transition-colors"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar Container */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r-2 border-border bg-background transition-transform md:translate-x-0
        ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        {/* Brand header */}
        <div className="flex h-24 items-center justify-between border-b-2 border-border px-8">
          <Link href="/dashboard" className="text-2xl font-bold tracking-tighter text-foreground uppercase leading-none">
            NEXTUP<span className="text-accent">.AI</span>
          </Link>
          <button 
            onClick={() => setMobileOpen(false)} 
            className="border-2 border-border p-1 bg-muted hover:bg-accent hover:text-black transition-colors md:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {/* Security badge */}
        <div className="flex flex-col gap-2 border-b-2 border-border bg-muted/30 p-6">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-accent uppercase">
            <ShieldCheck size={16} className="text-accent" />
            <span>🔒 ZERO-KNOWLEDGE</span>
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-tight leading-snug">
            All profile and job application details are encrypted locally in your browser.
          </p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 py-8">
          {menuItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`
                  flex items-center gap-4 px-8 py-4 text-sm font-bold tracking-tighter transition-all uppercase
                  ${isActive 
                    ? "bg-accent text-black border-y-2 border-black" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                `}
              >
                <Icon size={18} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer actions */}
        <div className="border-t-2 border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase">THEME</span>
            <button 
              onClick={toggleTheme} 
              className="flex items-center justify-center border-2 border-border bg-muted hover:bg-accent hover:text-black p-2 transition-all active:scale-95"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          {user && (
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <div className="flex h-10 w-10 items-center justify-center bg-muted border-2 border-border text-sm font-bold uppercase">
                {user.full_name ? user.full_name[0] : user.email[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground truncate uppercase tracking-tighter">
                  {user.full_name || "STUDENT"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-3 border-2 border-border py-3 text-xs font-bold tracking-wider hover:bg-red-600 hover:text-white hover:border-red-600 transition-all uppercase"
          >
            <LogOut size={14} />
            <span>LOGOUT</span>
          </button>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {mobileOpen && (
        <div 
          onClick={() => setMobileOpen(false)} 
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}
    </>
  );
}
