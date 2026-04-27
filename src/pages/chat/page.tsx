import { ChatInterface } from "@/components/chat-interface";
import { Navigation } from "@/components/navigation";

export default function ChatHome() {
  return (
    <div className="flex flex-col h-screen bg-[#020617] text-slate-100 selection:bg-emerald-500/30">
      <Navigation />
      <main className="flex-1 overflow-hidden">
        <ChatInterface />
      </main>
    </div>
  );
}
