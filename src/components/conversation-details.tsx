"use client";

import {
  X,
  User,
  SettingsIcon,
  Zap,
  Box,
  Cpu,
  History,
  Shield,
  Code2,
  Terminal,
  Globe,
  Volume2,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ConversationDetailsProps {
  isOpen: boolean;
  activeTab: "parameters" | "engineer" | "settings";
  onTabChange: (tab: "parameters" | "engineer" | "settings") => void;
  customerName: string;
  onClose: () => void;
}

export function ConversationDetails({
  isOpen,
  activeTab,
  onTabChange,
  customerName,
  onClose,
}: ConversationDetailsProps) {
  if (!isOpen) return null;

  return (
    <div className="w-full lg:w-[320px] border-l border-white/5 h-full flex-shrink-0 bg-slate-950 shadow-2xl transition-all duration-300 fixed right-0 top-0 bottom-0 lg:relative z-30 overflow-y-auto overflow-x-hidden">
      <div className="p-5 border-b border-white/5 bg-slate-900/20">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Context Panel
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 hover:bg-red-500/10 text-slate-500"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as any)}
        className="w-full"
      >
        <TabsList className="w-full grid grid-cols-3 bg-transparent border-b border-white/5 rounded-none h-12 p-0">
          <TabsTrigger
            value="parameters"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-emerald-500/5 text-slate-500 data-[state=active]:text-emerald-400 text-[10px] uppercase font-bold tracking-tighter"
          >
            <Sliders size={12} className="mr-1" /> Params
          </TabsTrigger>
          <TabsTrigger
            value="engineer"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500/5 text-slate-500 data-[state=active]:text-blue-400 text-[10px] uppercase font-bold tracking-tighter"
          >
            <User size={12} className="mr-1" /> Profile
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-purple-500/5 text-slate-500 data-[state=active]:text-purple-400 text-[10px] uppercase font-bold tracking-tighter"
          >
            <SettingsIcon size={12} className="mr-1" /> Config
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="parameters"
          className="p-5 space-y-6 m-0 animate-in fade-in duration-500"
        >
          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              In-Context Actions
            </h3>
            <div className="space-y-2">
              {[
                {
                  icon: Code2,
                  label: "Export as JSON",
                  color: "text-blue-400",
                },
                {
                  icon: Shield,
                  label: "Scan for PII",
                  color: "text-emerald-400",
                },
                {
                  icon: Box,
                  label: "View Stellar Metadata",
                  color: "text-amber-400",
                },
              ].map((action, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start border-white/5 bg-white/[0.02] hover:bg-white/[0.05] text-slate-300 text-xs py-5"
                >
                  <action.icon size={14} className={`mr-3 ${action.color}`} />
                  {action.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-white/5">
            <h4 className="text-[10px] font-bold text-emerald-400 uppercase mb-3 flex items-center gap-2">
              <Zap size={12} /> Optimization Tip
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed italic font-mono">
              "Providing few-shot examples in your prompt can decrease
              hallucination rates by up to 40% for this model."
            </p>
          </div>
        </TabsContent>

        <TabsContent
          value="engineer"
          className="p-5 space-y-6 m-0 animate-in fade-in duration-500"
        >
          <div className="space-y-4">
            <div className="flex flex-col items-center py-4 bg-white/[0.02] rounded-2xl border border-white/5">
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-emerald-500 p-0.5 mb-3">
                <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                  <User size={32} className="text-white" />
                </div>
              </div>
              <p className="font-bold text-white tracking-tight">
                {customerName}
              </p>
              <p className="text-[10px] text-slate-500 uppercase font-mono tracking-widest mt-1">
                Prompt Architect
              </p>
            </div>

            <div className="space-y-3">
              {[
                { icon: Terminal, label: "Auth ID", value: "PH-992x" },
                { icon: History, label: "Total Runs", value: "1,204" },
                { icon: Cpu, label: "Compute Tier", value: "Premium" },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center px-2 py-1"
                >
                  <span className="text-[11px] text-slate-500 flex items-center gap-2">
                    <stat.icon size={12} /> {stat.label}
                  </span>
                  <span className="text-[11px] font-mono text-slate-300">
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="settings"
          className="p-5 space-y-6 m-0 animate-in fade-in duration-500"
        >
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 flex items-center gap-2">
                  <Globe size={14} /> Global Context
                </span>
                <div className="h-4 w-8 rounded-full bg-emerald-500/20 relative cursor-pointer border border-emerald-500/30">
                  <div className="absolute right-1 top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
              </div>
              <div className="flex items-center justify-between opacity-50">
                <span className="text-xs text-slate-400 flex items-center gap-2">
                  <Volume2 size={14} /> Voice Feedback
                </span>
                <div className="h-4 w-8 rounded-full bg-slate-800 relative border border-white/10" />
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-white/5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                System Persona
              </label>
              <select className="w-full bg-white/[0.02] border border-white/10 rounded-lg p-2.5 text-xs text-slate-300 outline-none focus:border-emerald-500/50">
                <option className="bg-slate-900">Technical Advisor</option>
                <option className="bg-slate-900">Creative Partner</option>
                <option className="bg-slate-900">Code Auditor</option>
              </select>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
