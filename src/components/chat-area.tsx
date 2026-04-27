"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Copy,
  ThumbsUp,
  X,
  Wand2,
  Loader2,
  Bot,
  Menu,
  Terminal,
  Save,
  Send,
  User,
  ThumbsDown,
  Download,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { Message } from "@/components/chat-interface";
import type { AIModel } from "@/lib/api";
import { Typewriter } from "@/components/typewriter";
import ReactMarkdown from "react-markdown";

interface ChatAreaProps {
  conversation: Message[];
  isTyping: boolean;
  chatError: string | null;
  customerName: string;
  onSendMessage: (content: string) => void;
  onImprovePrompt: (content: string) => Promise<string>;
  onReaction: (messageId: string, type: "like" | "dislike") => void;
  onSaveConversation: () => void;
  onCloseConversation: () => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  selectedModel: AIModel;
  setSelectedModel: (model: AIModel) => void;
  onToggleDetails: () => void;
}

export function ChatArea({
  conversation,
  isTyping,
  chatError,
  onSendMessage,
  onImprovePrompt,
  onReaction,
  onSaveConversation,
  onCloseConversation,
  inputValue,
  setInputValue,
  selectedModel,
  setSelectedModel,
  onToggleDetails,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isImproving, setIsImproving] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, isTyping]);

  const handleImprove = async () => {
    if (!inputValue.trim()) return;
    setIsImproving(true);
    const improved = await onImprovePrompt(inputValue);
    setInputValue(improved);
    setIsImproving(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#020617] border-r border-white/5 relative">
      {/* Studio Header */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-white/5 bg-slate-950/50 backdrop-blur-xl z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Terminal size={18} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-white">
              Chat Studio
            </h2>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">
              Live Session
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={selectedModel}
            onValueChange={(value) => setSelectedModel(value as AIModel)}
          >
            <SelectTrigger className="w-[180px] h-8 text-[11px] bg-white/5 border-white/10 rounded-xl text-slate-300 font-mono focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all hover:bg-white/[0.08]">
              <SelectValue placeholder="Select Model" />
            </SelectTrigger>
            <SelectContent className="bg-slate-950 border-white/10 text-slate-300 rounded-xl shadow-2xl backdrop-blur-xl">
              <SelectItem
                value="gemini-2.5-flash"
                className="text-xs font-mono focus:bg-emerald-500/10 focus:text-emerald-400 cursor-pointer transition-colors"
              >
                Gemini 2.5 Flash
              </SelectItem>
              <SelectItem
                value="gemini-2.0-flash"
                className="text-xs font-mono focus:bg-emerald-500/10 focus:text-emerald-400 cursor-pointer transition-colors"
              >
                Gemini 2.0 Flash
              </SelectItem>
              <SelectItem
                value="gemini-pro-latest"
                className="text-xs font-mono focus:bg-emerald-500/10 focus:text-emerald-400 cursor-pointer transition-colors"
              >
                Gemini Pro
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveConversation}
            className="h-8 transition-all duration-300 bg-white/[0.02] border-white/10 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/5 items-center gap-2 hidden sm:flex rounded-xl px-4 shadow-sm"
          >
            <Save
              size={14}
              className="transition-transform group-hover:scale-110"
            />
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Save Session
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleDetails}
            className="lg:hidden text-slate-400"
          >
            <Menu size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCloseConversation}
            className="hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
          >
            <X size={18} />
          </Button>
        </div>
      </div>

      {/* Workspace / Message Feed */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-transparent custom-scrollbar">
        {chatError && (
          <div className="max-w-2xl mx-auto p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono">
            {`[ERROR]: ${chatError}`}
          </div>
        )}

        {conversation.map((message) => (
          <div
            key={message.id}
            className="group animate-in fade-in slide-in-from-bottom-2 duration-500"
          >
            <div className="flex items-start gap-5 max-w-4xl mx-auto">
              <div
                className={`mt-1 p-2 rounded-lg shrink-0 border ${
                  message.sender === "agent"
                    ? "bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                    : "bg-white/5 border-white/10"
                }`}
              >
                {message.sender === "agent" ? (
                  <Bot size={16} className="text-emerald-400" />
                ) : (
                  <User size={16} className="text-slate-400" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-black uppercase tracking-widest ${message.sender === "agent" ? "text-emerald-400" : "text-slate-500"}`}
                  >
                    {message.sender === "agent"
                      ? "PromptHub Agent"
                      : "Prompt Engineer"}
                  </span>
                  <span className="text-[10px] font-mono text-slate-700">
                    {message.timestamp}
                  </span>
                </div>

                <div
                  className={`p-5 rounded-2xl leading-relaxed text-[15px] transition-all border ${
                    message.sender === "agent"
                      ? "bg-slate-900/50 border-white/5 text-slate-200 shadow-sm"
                      : "bg-white/[0.02] border-white/5 text-slate-300 font-mono whitespace-pre-wrap"
                  }`}
                >
                  {message.sender === "agent" ? (
                    <Typewriter
                      text={message.content}
                      className="prose prose-invert prose-emerald max-w-none"
                    />
                  ) : (
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  )}
                </div>

                {/* Only render action buttons for agent messages */}
                {message.sender === "agent" && (
                  <div className="flex gap-2 mt-2 ml-10">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 transition-all hover:bg-gray-100"
                      // onClick={() => handleCopyMessage(message.content)}
                      title="Copy message"
                    >
                      <Copy size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 transition-all hover:bg-gray-100"
                      // onClick={() => handleDownloadMessage(message.content)}
                      title="Download message"
                    >
                      <Download size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 transition-all hover:bg-gray-100"
                      onClick={() => onReaction(message.id, "like")}
                      title="Like message"
                    >
                      <ThumbsUp
                        size={16}
                        className={
                          message.reactions.likes > 0
                            ? "text-blue-600 fill-blue-600"
                            : ""
                        }
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 transition-all hover:bg-gray-100"
                      onClick={() => onReaction(message.id, "dislike")}
                      title="Dislike message"
                    >
                      <ThumbsDown
                        size={16}
                        className={
                          message.reactions.dislikes > 0
                            ? "text-red-600 fill-red-600"
                            : ""
                        }
                      />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-4 max-w-4xl mx-auto animate-pulse">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Bot size={16} className="text-emerald-400" />
            </div>
            <span className="text-[10px] font-mono text-emerald-500/50 uppercase tracking-widest">
              Processing context...
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Studio Composer */}
      <div className="p-6 border-t border-white/5 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
          <div className="relative bg-[#0f172a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <textarea
              rows={3}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter prompt instructions..."
              className="w-full bg-transparent border-none focus:ring-0 p-4 text-sm font-mono placeholder:text-slate-600 resize-none text-slate-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendMessage(inputValue);
                }
              }}
            />
            <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02] border-t border-white/5">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleImprove}
                  disabled={isImproving || !inputValue.trim()}
                  className="text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/10 rounded-lg uppercase tracking-tighter"
                >
                  {isImproving ? (
                    <Loader2 size={14} className="animate-spin mr-2" />
                  ) : (
                    <Wand2 size={14} className="mr-2" />
                  )}
                  Auto-Refine
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSaveConversation}
                  className="text-[10px] text-slate-500 uppercase tracking-tighter"
                >
                  <Save size={14} className="mr-2" /> Save Draft
                </Button>
              </div>
              <Button
                onClick={() => onSendMessage(inputValue)}
                disabled={!inputValue.trim() || isTyping}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 h-9 rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] active:scale-95"
              >
                Execute <Send size={14} className="ml-2" />
              </Button>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-center text-slate-600 font-mono uppercase tracking-[0.2em]">
            Press Enter to Execute • Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
