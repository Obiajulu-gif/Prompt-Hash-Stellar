"use client";

import React, { useState } from "react";
import { Button } from "./ui/button";
import { Send, Loader2, ShieldAlert } from "lucide-react";

interface PromptPlaygroundProps {
  previewPrompt: string;
  title?: string;
}

export function PromptPlayground({ previewPrompt, title = "Prompt" }: PromptPlaygroundProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/test-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previewPrompt,
          userInput: userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      // Handle text stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantMessage += chunk;

          setMessages((prev) => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1].content = assistantMessage;
            return newMessages;
          });
        }
      }
    } catch (error) {
      console.error("Playground error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: Could not connect to the testing sandbox." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] w-full max-w-2xl mx-auto border border-gray-800 rounded-lg overflow-hidden bg-gray-950">
      <div className="bg-gray-900 p-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="font-semibold text-white flex items-center gap-2">
          Sandbox: {title}
        </h3>
        <div className="flex items-center gap-1 text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">
          <ShieldAlert className="w-3 h-3" />
          <span>Protected Preview</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 h-full flex items-center justify-center flex-col gap-2">
            <p>Test the prompt preview safely.</p>
            <p className="text-sm">The underlying full prompt remains fully encrypted.</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] p-3 rounded-lg text-sm ${msg.role === "user" ? "bg-purple-600 text-white rounded-br-none" : "bg-gray-800 text-gray-200 rounded-bl-none"}`}>
                {msg.content}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 bg-gray-900 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a test message..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:outline-none focus:border-purple-500"
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading || !input.trim()} className="bg-purple-600 hover:bg-purple-700">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </form>
    </div>
  );
}