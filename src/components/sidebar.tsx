"use client";

import {
  Terminal,
  Zap,
  Cpu,
  History,
  Settings,
  Activity,
  Layers,
  Menu,
  X,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onToggleMobileMenu: () => void;
}

export function Sidebar({ isOpen, onClose, onToggleMobileMenu }: SidebarProps) {
  const navItems = [
    { icon: <Terminal size={16} />, label: "Prompt Lab", active: true },
    { icon: <Cpu size={16} />, label: "Model Config" },
    { icon: <Layers size={16} />, label: "Deployments" },
    { icon: <History size={16} />, label: "Iteration Logs" },
    { icon: <Activity size={16} />, label: "Observability" },
    { icon: <Code2 size={16} />, label: "SDK Keys" },
    { icon: <Settings size={16} />, label: "Workspace" },
  ];

  return (
    <>
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleMobileMenu}
        className="md:hidden fixed top-3 left-3 z-50 bg-slate-900 border border-white/10 text-white shadow-xl rounded-xl h-10 w-10"
      >
        {isOpen ? <X size={20} /> : <Menu size={20} />}
      </Button>

      <div
        className={`w-[220px] border-r border-white/5 h-full flex-shrink-0 bg-slate-950 transition-all duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } z-40 fixed md:relative`}
      >
        <div className="p-6 border-b border-white/5 bg-slate-900/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.1)]">
              <Zap size={16} className="text-emerald-400 fill-emerald-400/20" />
            </div>
            <div>
              <h2 className="font-bold text-xs text-white tracking-tight uppercase italic">
                PromptHub
              </h2>
              <p className="text-[9px] text-slate-500 font-mono font-bold tracking-widest uppercase">
                v2.5.0-Alpha
              </p>
            </div>
          </div>
        </div>

        <nav className="py-6 px-3">
          <div className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] mb-4 px-4">
            Workbench
          </div>
          <ul className="space-y-1.5">
            {navItems.map((item, index) => (
              <li key={index}>
                <a
                  href="#"
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group ${
                    item.active
                      ? "text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 shadow-[inset_0_0_10px_rgba(16,185,129,0.05)]"
                      : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent"
                  }`}
                >
                  <span
                    className={
                      item.active
                        ? "text-emerald-400"
                        : "text-slate-500 group-hover:text-slate-300"
                    }
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer Info */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/5">
          <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">
                Stellar Connected
              </span>
            </div>
            <p className="text-[9px] text-slate-500 leading-tight">
              Gateway operating on testnet protocol-20.
            </p>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-[#020617]/80 backdrop-blur-sm z-30 animate-in fade-in duration-300"
          onClick={onClose}
        ></div>
      )}
    </>
  );
}
