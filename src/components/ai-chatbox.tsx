"use client";

import type React from "react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Send, Sparkles, User, Copy, Loader2, Wand2 } from "lucide-react";
import { getChatResponse, improvePrompt, type AIModel } from "../lib/api";
import ReactMarkdown from "react-markdown";
import { Typewriter } from "@/components/typewriter";

type Message = {
	role: "ai" | "user";
	content: string;
	isTyping?: boolean;
};

export function AiChatButton() {
	const [isOpen, setIsOpen] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const [messages, setMessages] = useState<Message[]>([
		{
			role: "ai",
			content: "Hi, how can I help you today?",
			isTyping: false,
		},
	]);
	const [isLoading, setIsLoading] = useState(false);
	const [selectedModel, setSelectedModel] =
		useState<AIModel>("gemini-2.5-flash");
	const [isImproving, setIsImproving] = useState(false);

	const chatRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const toggleChat = () => {
		setIsOpen(!isOpen);
	};

	// Scroll to bottom when messages change
	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages]);

	// Handle form submission
	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!inputValue.trim()) return;

		// Add user message
		const userMessage: Message = {
			role: "user",
			content: inputValue,
		};

		setMessages((prev) => [...prev, userMessage]);
		setInputValue("");
		setIsLoading(true);

		try {
			// Call the API
			const response = await getChatResponse(inputValue, selectedModel);

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

			// Add AI response with typing effect
			const aiMessage: Message = {
				role: "ai",
				content: responseText,
				isTyping: true,
			};

			setMessages((prev) => [...prev, aiMessage]);

			// After the typing animation is complete, mark it as finished
			setTimeout(() => {
				setMessages((prev) =>
					prev.map((msg, idx) =>
						idx === prev.length - 1 ? { ...msg, isTyping: false } : msg
					)
				);
			}, responseText.length * 30 + 1000); // Approximate time for typing + buffer
		} catch (error) {
			console.error("Error getting response:", error);
			// Add error message
			const errorMessage: Message = {
				role: "ai",
				content:
					"Sorry, there was an error processing your request. Please try again.",
			};
			setMessages((prev) => [...prev, errorMessage]);
		} finally {
			setIsLoading(false);
		}
	};

	// Improve the prompt
	const handleImprovePrompt = async () => {
		if (!inputValue.trim()) return;

		setIsImproving(true);

		try {
			// Send just the prompt text, not an object
			const result = await improvePrompt(inputValue);

			if (result) {
				// Handle different response formats
				if (typeof result === "string") {
					setInputValue(result);
				} else if (typeof result === "object") {
					// Check for common properties that might contain the improved prompt
					if (result.improved) {
						setInputValue(result.improved);
					} else if (result.Response) {
						setInputValue(result.Response);
					} else if (result.response) {
						setInputValue(result.response);
					} else {
						// If we can't find a specific property, log the object
						console.warn("Unexpected improve prompt response format:", result);
						// Try to use the first string property we find
						for (const key in result) {
							if (typeof result[key] === "string") {
								setInputValue(result[key]);
								break;
							}
						}
					}
				}
			}
		} catch (error) {
			console.error("Error improving prompt:", error);
			// Show a user-friendly error message
			alert("Failed to improve prompt. Please try again.");
		} finally {
			setIsImproving(false);
		}
	};

	// Close modal when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (chatRef.current && !chatRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		} else {
			document.removeEventListener("mousedown", handleClickOutside);
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen]);

	// Copy message to clipboard
	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		alert("Copied to clipboard!");
	};

	return (
		<>
			{/* Chat Button */}
			<Button
				onClick={toggleChat}
				className="fixed animate-bounce bottom-6 right-6 rounded-full w-20 h-20 p-0 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-lg z-50 transition-transform hover:scale-110"
				aria-label="Open chat"
			>
				<Bot size={40} className="text-white" />
			</Button>

			{/* Chat Modal */}
			{isOpen && (
				<div
					ref={chatRef}
					className="fixed bottom-[calc(5rem+1.2rem)] right-6 bg-white dark:bg-gray-900 p-6 rounded-xl border border-border w-[520px] h-[550px] shadow-xl z-50 flex flex-col bg-gradient-to-r from-purple-400/20 to-blue-400/20 backdrop-blur-sm text-black"
				>
					{/* Header */}
					<div className="flex flex-col space-y-2 pb-4 border-b border-gray-200 dark:border-gray-700">
						<div className="flex justify-between items-center">
							<div className="flex items-center gap-2">
								<Bot size={24} className="text-blue-600 dark:text-blue-400" />
								<h2 className="font-bold text-xl tracking-tight bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
									Prompt Hub AI
								</h2>
							</div>
							<select
								title="Select AI model"
								value={selectedModel}
								onChange={(e) => setSelectedModel(e.target.value as AIModel)}
								className="text-sm border rounded-md py-1 px-2 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							>
								<option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
								<option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
								<option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
								<option value="gemini-flash-latest">Gemini Flash Latest</option>
								<option value="gemini-pro-latest">Gemini Pro Latest</option>
								<option value="gemini-2.0-flash-exp">
									Gemini 2.0 Flash Exp
								</option>
							</select>
						</div>
						<p className="text-sm text-gray-600 dark:text-gray-300">
							Ask me anything about prompts and the marketplace
						</p>
					</div>

					{/* Chat Container */}
					<div className="flex-1 overflow-y-auto pr-4 space-y-4 ">
						{messages.map((message, index) => (
							<div
								key={index}
								className={`flex gap-3 my-4 text-sm ${
									message.role === "ai"
										? "bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg"
										: "bg-purple-50 dark:bg-purple-950/30 p-3 rounded-lg"
								}`}
							>
								<span className="relative flex shrink-0 overflow-hidden rounded-full w-10 h-10">
									<div
										className={`rounded-full p-2 ${
											message.role === "ai"
												? "bg-blue-100 dark:bg-blue-900"
												: "bg-purple-100 dark:bg-purple-900"
										}`}
									>
										{message.role === "ai" ? (
											<Sparkles className="h-6 w-6 text-blue-600 dark:text-blue-400" />
										) : (
											<User className="h-6 w-6 text-purple-600 dark:text-purple-400" />
										)}
									</div>
								</span>
								<div className="leading-relaxed flex-1">
									<span
										className={`block font-bold mb-1 ${
											message.role === "ai"
												? "text-blue-700 dark:text-blue-300"
												: "text-purple-700 dark:text-purple-300"
										}`}
									>
										{message.role === "ai" ? "AI" : "You"}
									</span>
									<div className="prose prose-sm dark:prose-invert max-w-none">
										{message.role === "ai" && message.isTyping ? (
											<Typewriter text={message.content} />
										) : (
											<ReactMarkdown>{message.content}</ReactMarkdown>
										)}
									</div>
								</div>
								{/* Copy button - only for user messages */}
								{message.role === "ai" && (
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleCopy(message.content)}
										className="text-purple-500 hover:text-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900/50"
									>
										<Copy className="h-4 w-4" />
									</Button>
								)}
							</div>
						))}
						{isLoading && (
							<div className="flex gap-3 my-4 text-sm bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg animate-pulse">
								<span className="relative flex shrink-0 overflow-hidden rounded-full w-10 h-10">
									<div className="rounded-full bg-blue-100 dark:bg-blue-900 p-2">
										<Sparkles className="h-6 w-6 text-blue-600 dark:text-blue-400" />
									</div>
								</span>
								<div className="leading-relaxed flex-1">
									<span className="block font-bold mb-1 text-blue-700 dark:text-blue-300">
										AI
									</span>
									<div className="flex items-center">
										<Loader2 className="h-4 w-4 mr-2 animate-spin text-blue-600 dark:text-blue-400" />
										<span className="text-blue-600 dark:text-blue-400">
											Thinking...
										</span>
									</div>
								</div>
							</div>
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Input Box */}
					<div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-auto">
						<form onSubmit={handleSubmit} className="flex flex-col space-y-3">
							<div className="flex items-center space-x-2">
								<Input
									className="flex-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 rounded-md"
									placeholder="Type your message..."
									value={inputValue}
									onChange={(e) => setInputValue(e.target.value)}
									disabled={isLoading}
								/>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={handleImprovePrompt}
									disabled={isLoading || isImproving || !inputValue.trim()}
									title="Improve prompt"
									className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:bg-purple-50 dark:hover:bg-purple-900/30"
								>
									{isImproving ? (
										<Loader2 className="h-5 w-5 animate-spin text-purple-600" />
									) : (
										<Wand2 className="h-5 w-5 text-purple-600" />
									)}
								</Button>
							</div>
							<Button
								type="submit"
								disabled={isLoading || !inputValue.trim()}
								className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white py-2 rounded-md transition-all"
							>
								<Send className="h-5 w-5 mr-2" />
								Send
							</Button>
						</form>
					</div>
				</div>
			)}
		</>
	);
}
