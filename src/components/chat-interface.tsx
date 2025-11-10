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

    // Simulate agent typing
    setIsTyping(true);

    try {
      // Call the API
      const response = await getChatResponse(content, selectedModel);

      // Extract the response text from the object
      let responseText = "Sorry, I couldn't generate a response.";

      if (response) {
        // Check if response has a "response" property (lowercase)
        if (typeof response === "object" && response.response) {
          responseText = response.response;
        }
        // Check if response has a "Response" property (uppercase) for backward compatibility
        else if (typeof response === "object" && response.Response) {
          responseText = response.Response;
        }
        // If it's a string, use it directly
        else if (typeof response === "string") {
          responseText = response;
        }
        // If it's an object but doesn't have response, stringify it
        else if (typeof response === "object") {
          responseText = JSON.stringify(response);
        }
      }

      // If the content is about bills, override with the specific response
      if (
        content.toLowerCase().includes("bill") ||
        content.toLowerCase().includes("payment")
      ) {
        responseText =
          "Please hold for a second.\n\nOk, I can help you with that.\n\nI'm pulling up your current bill information.\n\nYour current bill is $150, and it is due on August 31, 2024.\n\nIf you need more details, feel free to ask!";
      }

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
      console.error("Error getting chat response:", error);

      // Fallback response
      const fallbackMessage: Message = {
        id: Date.now().toString(),
        sender: "agent",
        content:
          "I apologize, but I'm having trouble connecting to our services. Could you please try again?",
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
        // Handle different response formats
        if (typeof result === "string") {
          return result;
        } else if (typeof result === "object") {
          // Check for common properties that might contain the improved prompt
          if (result.improved) {
            return result.improved;
          } else if (result.Response) {
            return result.Response;
          } else if (result.response) {
            return result.response;
          }
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
