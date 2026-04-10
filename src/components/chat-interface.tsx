"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { ConversationDetails } from "@/components/conversation-details";
import { getChatResponse, improvePrompt, type AIModel } from "@/lib/api";

export function ChatInterface() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "actions" | "customer" | "settings"
  >("actions");
  const [conversation, setConversation] = useState<Message[]>([
    {
      id: "1",
      sender: "agent",
      content: "Hello, I am a generative AI agent. How may I assist you today?",
      timestamp: "4:08:28 PM",
      reactions: { likes: 0, dislikes: 0 },
    },
  ]);

  const [customerName, _setCustomerName] = useState("GS");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] =
    useState<AIModel>("gemini-2.5-flash");
  const [inputValue, setInputValue] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);

  const extractResponseText = (response: unknown) => {
    if (typeof response === "string") {
      return response;
    }

    if (response && typeof response === "object") {
      const record = response as Record<string, unknown>;
      if (typeof record.response === "string") {
        return record.response;
      }

      if (typeof record.Response === "string") {
        return record.Response;
      }

      return JSON.stringify(record);
    }

    return "Sorry, I couldn't generate a response.";
  };

  const extractImprovedPrompt = (result: unknown) => {
    if (typeof result === "string") {
      return result;
    }

    if (result && typeof result === "object") {
      const record = result as Record<string, unknown>;
      const candidate =
        typeof record.improved === "string"
          ? record.improved
          : typeof record.Response === "string"
            ? record.Response
            : typeof record.response === "string"
              ? record.response
              : undefined;
      return candidate;
    }

    return undefined;
  };

  // Handle sending a message
  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    // Add customer message
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

    // Simulate agent typing
    setIsTyping(true);

    try {
      // Call the API
      const response = await getChatResponse(content, selectedModel);

      // Extract the response text from the object
      const responseText = extractResponseText(response);

      // Add AI response
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
      const message =
        error instanceof Error
          ? error.message
          : "The chat gateway could not be reached.";
      console.error("Error getting chat response:", error);
      setChatError(message);

      // Fallback response
      const fallbackMessage: Message = {
        id: Date.now().toString(),
        sender: "agent",
        content:
          "I couldn't reach the external chat gateway. Check the configured API base URL and try again.",
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        reactions: { likes: 0, dislikes: 0 },
      };

      setIsTyping(false);
      setConversation((prev) => [...prev, fallbackMessage]);
    }
  };

  // Improve the prompt
  const handleImprovePrompt = async (content: string) => {
    if (!content.trim()) return content;

    try {
      // Send just the prompt text, not an object
      const result = await improvePrompt(content);

      if (result) {
        const improved = extractImprovedPrompt(result);
        if (improved) {
          return improved;
        }
      }

      return content;
    } catch (error) {
      console.error("Error improving prompt:", error);
      return content;
    }
  };

  const handleReaction = (messageId: string, type: "like" | "dislike") => {
    setConversation((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              reactions: {
                ...message.reactions,
                likes:
                  type === "like"
                    ? message.reactions.likes + 1
                    : message.reactions.likes,
                dislikes:
                  type === "dislike"
                    ? message.reactions.dislikes + 1
                    : message.reactions.dislikes,
              },
            }
          : message,
      ),
    );
  };

  const handleSaveConversation = () => {
    alert("Conversation saved successfully!");
  };

  const handleCloseConversation = () => {
    if (confirm("Are you sure you want to close this conversation?")) {
      setConversation([
        {
          id: "1",
          sender: "agent",
          content:
            "Hello, I am a generative AI agent. How may I assist you today?",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          reactions: { likes: 0, dislikes: 0 },
        },
      ]);
    }
  };

  return (
    <div className="flex w-full h-screen bg-gradient-to-r from-purple-400 to-blue-500 overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      />

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col md:flex-row h-full">
        <ChatArea
          conversation={conversation}
          isTyping={isTyping}
          chatError={chatError}
          customerName={customerName}
          onSendMessage={handleSendMessage}
          onImprovePrompt={handleImprovePrompt}
          onReaction={handleReaction}
          onSaveConversation={handleSaveConversation}
          onCloseConversation={handleCloseConversation}
          inputValue={inputValue}
          setInputValue={setInputValue}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          onToggleDetails={() => setIsDetailsOpen(!isDetailsOpen)}
        />

        {/* Conversation Details */}
        <ConversationDetails
          isOpen={isDetailsOpen}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          customerName={customerName}
          onClose={() => setIsDetailsOpen(false)}
        />
      </div>
    </div>
  );
}

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
