import { Link, NavLink } from "react-router-dom";
import { Activity, Menu, MessageCircle, Search, ShoppingBag, User } from "lucide-react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import DisplayWallet from "./DisplayWallet";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  { to: "/browse", label: "Browse", icon: Search },
  { to: "/sell", label: "Sell", icon: ShoppingBag },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/status", label: "Status", icon: Activity },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-white/10 text-white"
      : "text-slate-300 hover:bg-white/5 hover:text-white",
  ].join(" ");

export function Navigation() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/images/logo.png"
              alt="PromptHash"
              width={36}
              height={36}
              className="rounded-full border border-white/10 bg-white/5 p-1"
            />
            <div>
              <div className="text-sm uppercase tracking-[0.28em] text-amber-300">
                PromptHash
              </div>
              <div className="text-xs text-slate-400">
                Stellar testnet marketplace
              </div>
            </div>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClasses}>
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <ThemeToggle />
          <DisplayWallet />
        </div>

        <Sheet>
          <SheetTrigger asChild className="md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="border border-white/10 text-white hover:bg-white/10"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent className="border-white/10 bg-slate-950 text-white">
            <div className="mt-8 space-y-3">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={linkClasses}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
              <div className="flex items-center gap-2 border-t border-white/10 pt-4">
                <ThemeToggle />
                <DisplayWallet />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
