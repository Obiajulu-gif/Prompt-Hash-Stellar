"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { ConversationDetails } from "@/components/conversation-details";
import { getChatResponse, improvePrompt, type AIModel } from "@/lib/api";

export type Message = {
  id: string;
  sender: "agent" | "customer";
  content: string;
  timestamp: string;
  reactions: {
    likes: number;
    dislikes: number;
  };
};

export function ChatInterface() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "parameters" | "engineer" | "history"
  >("parameters");

  const [conversation, setConversation] = useState<Message[]>([
    {
      id: "1",
      sender: "agent",
      content:
        "Welcome to the Chat Studio. Load a prompt or start drafting below to begin testing against the Stellar-linked LLM gateway.",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      reactions: { likes: 0, dislikes: 0 },
    },
  ]);

  const [engineerName, _setEngineerName] = useState("Francis");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] =
    useState<AIModel>("gemini-2.5-flash");
  const [inputValue, setInputValue] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);

  const extractResponseText = (response: unknown) => {
    if (typeof response === "string") return response;
    if (response && typeof response === "object") {
      const record = response as Record<string, unknown>;
      return (
        (record.response as string) ||
        (record.Response as string) ||
        JSON.stringify(record)
      );
    }
    return "Failed to generate iteration output.";
  };

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    const newCustomerMessage: Message = {
      id: Date.now().toString(),
      sender: "customer",
      content,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      reactions: { likes: 0, dislikes: 0 },
    };

    setConversation((prev) => [...prev, newCustomerMessage]);
    setInputValue("");
    setChatError(null);
    setIsTyping(true);

    try {
      const response = await getChatResponse(content, selectedModel);
      const responseText = extractResponseText(response);

      const newAgentMessage: Message = {
        id: Date.now().toString(),
        sender: "agent",
        content: responseText,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        reactions: { likes: 0, dislikes: 0 },
      };

      setIsTyping(false);
      setConversation((prev) => [...prev, newAgentMessage]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Gateway Timeout");
      setIsTyping(false);
    }
  };

  const handleImprovePrompt = async (content: string) => {
    if (!content.trim()) return content;
    try {
      const result = await improvePrompt(content);
      if (result && typeof result === "object") {
        const record = result as Record<string, any>;
        return record.improved || record.response || content;
      }
      return typeof result === "string" ? result : content;
    } catch (error) {
      return content;
    }
  };

  const handleReaction = (messageId: string, type: "like" | "dislike") => {
    setConversation((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              reactions: {
                ...msg.reactions,
                [type === "like" ? "likes" : "dislikes"]:
                  msg.reactions[type === "like" ? "likes" : "dislikes"] + 1,
              },
            }
          : msg,
      ),
    );
  };

  return (
    <div className="flex w-full h-full bg-[#020617] overflow-hidden">
      <Sidebar
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      />

      <div className="flex flex-1 flex-col lg:flex-row h-full">
        <ChatArea
          conversation={conversation}
          isTyping={isTyping}
          chatError={chatError}
          customerName={engineerName}
          onSendMessage={handleSendMessage}
          onImprovePrompt={handleImprovePrompt}
          onReaction={handleReaction}
          onSaveConversation={() => alert("Prompt Session Saved")}
          onCloseConversation={() => setConversation([])}
          inputValue={inputValue}
          setInputValue={setInputValue}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          onToggleDetails={() => setIsDetailsOpen(!isDetailsOpen)}
        />

        <ConversationDetails
          isOpen={isDetailsOpen}
          activeTab={
            activeTab === "parameters" ||
            activeTab === "engineer" ||
            activeTab === "history"
              ? activeTab
              : "parameters"
          }
          onTabChange={(tab) => setActiveTab(tab as any)}
          customerName={engineerName}
          onClose={() => setIsDetailsOpen(false)}
        />
      </div>
    </div>
  );
}
