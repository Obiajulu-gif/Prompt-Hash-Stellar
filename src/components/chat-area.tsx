"use client";

import type React from "react";

import { useState, useRef, useEffect } from "react";
import {
	Copy,
	Download,
	ThumbsUp,
	ThumbsDown,
	X,
	Wand2,
	Loader2,
	Bot,
	Menu,
	MessageSquare,
	Save,
	Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Message } from "@/components/chat-interface";
import type { AIModel } from "@/lib/api";
import { Typewriter } from "@/components/typewriter";
import ReactMarkdown from "react-markdown";

interface ChatAreaProps {
	conversation: Message[];
	isTyping: boolean;
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

// Format message content based on model response
const formatMessageContent = (content: string): string => {
	try {
		// Check if the content is JSON
		if (content.trim().startsWith("{") && content.trim().endsWith("}")) {
			const parsedContent = JSON.parse(content);

			// Handle Gemini model response format
			if (parsedContent.response) {
				return parsedContent.response;
			}
		}

		return content;
	} catch (error) {
		// If parsing fails, return the original content
		console.log("Error parsing message content:", error);
		return content;
	}
};
export function ChatArea({
	conversation,
	isTyping,
	customerName,
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

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [conversation, isTyping]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onSendMessage(inputValue);
	};

	const handleCopyMessage = (content: string) => {
		navigator.clipboard
			.writeText(content)
			.then(() => {
				alert("Message copied to clipboard");
			})
			.catch((err) => {
				console.error("Could not copy text: ", err);
			});
	};

	const handleDownloadMessage = (content: string) => {
		const element = document.createElement("a");
		const file = new Blob([content], { type: "text/plain" });
		element.href = URL.createObjectURL(file);
		element.download = "message.txt";
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	};

	const handleImprovePrompt = async () => {
		if (!inputValue.trim()) return;

		setIsImproving(true);
		try {
			const improvedPrompt = await onImprovePrompt(inputValue);
			setInputValue(improvedPrompt);
		} catch (error) {
			console.error("Error improving prompt:", error);
		} finally {
			setIsImproving(false);
		}
	};

	return (
		<div className="flex-1 flex flex-col h-full bg-gradient-to-r from-purple-400 to-blue-500 backdrop-blur-sm shadow-lg max-w-full">
			{/* Chat header */}
			<div className="flex justify-between items-center p-2 sm:p-4 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
				<div className="flex items-center gap-2">
					<MessageSquare size={18} className="text-blue-600" />
					<span className="font-semibold">Chat Playground</span>
				</div>
				<div className="flex items-center gap-1 sm:gap-4">
					<select
						title="Select AI model"
						value={selectedModel}
						onChange={(e) => setSelectedModel(e.target.value as AIModel)}
						className="text-xs sm:text-sm border rounded-md py-1 px-1 sm:px-2 bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					>
						<option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
						<option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
						<option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
						<option value="gemini-flash-latest">Gemini Flash Latest</option>
						<option value="gemini-pro-latest">Gemini Pro Latest</option>
						<option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp</option>
					</select>
					<Button
						variant="outline"
						size="sm"
						onClick={onSaveConversation}
						className="transition-all hover:bg-blue-50 flex items-center gap-1 hidden sm:flex"
					>
						<Save size={16} />
						<span className="hidden sm:inline">Save conversation</span>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={onToggleDetails}
						className="md:hidden"
						title="Toggle details"
					>
						<Menu size={18} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={onCloseConversation}
						className="transition-all hover:bg-red-50 hover:text-red-500"
						title="Close conversation"
					>
						<X size={18} />
					</Button>
				</div>
			</div>

			{/* Messages area */}
			<div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-4 sm:space-y-6 bg-white/50">
				{conversation.map((message) => (
					<div
						key={message.id}
						className="space-y-1 animate-fadeIn rounded-lg p-2 sm:p-3 hover:bg-gray-50/50"
					>
						<div className="flex items-center gap-2">
							<div
								className={`w-8 h-8 rounded-full flex items-center justify-center ${
									message.sender === "agent" ? "bg-blue-100" : "bg-purple-100"
								}`}
							>
								{message.sender === "agent" ? (
									<Bot size={16} className="text-blue-600" />
								) : (
									<div className="font-semibold text-sm text-purple-600">
										User
									</div>
								)}
							</div>
							<span className="font-semibold text-blue-600">
								{message.sender === "agent" ? "PromptHub agent" : "User"}
							</span>
							<span className="text-xs text-gray-500">{message.timestamp}</span>
						</div>

						<div className="ml-10">
							{message.sender === "agent" ? (
								<Typewriter
									text={formatMessageContent(message.content)}
									className="prose prose-sm max-w-none"
								/>
							) : (
								<div className="prose prose-sm max-w-none">
									<ReactMarkdown>{message.content}</ReactMarkdown>
								</div>
							)}
						</div>

						{/* Only render action buttons for agent messages */}
						{message.sender === "agent" && (
							<div className="flex gap-2 mt-2 ml-10">
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 transition-all hover:bg-gray-100"
									onClick={() => handleCopyMessage(message.content)}
									title="Copy message"
								>
									<Copy size={16} />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 transition-all hover:bg-gray-100"
									onClick={() => handleDownloadMessage(message.content)}
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
				))}

				{isTyping && (
					<div className="space-y-1 animate-fadeIn">
						<div className="flex items-center gap-2">
							<div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
								<Bot size={16} className="text-blue-600" />
							</div>
							<span className="font-semibold text-blue-600">
								PromptHub agent
							</span>
							<span className="text-xs text-gray-500">
								{new Date().toLocaleTimeString([], {
									hour: "2-digit",
									minute: "2-digit",
								})}
							</span>
						</div>
						<div className="flex items-center gap-1 ml-10">
							<div className="h-2 w-2 bg-blue-400 rounded-full animate-bounce"></div>
							<div
								className="h-2 w-2 bg-blue-400 rounded-full animate-bounce"
								style={{ animationDelay: "0.2s" }}
							></div>
							<div
								className="h-2 w-2 bg-blue-400 rounded-full animate-bounce"
								style={{ animationDelay: "0.4s" }}
							></div>
						</div>
					</div>
				)}

				<div ref={messagesEndRef} />
			</div>

			{/* Input area */}
			<div className="p-2 sm:p-4 border-t border-gray-200 bg-white/80 backdrop-blur-sm">
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<Input
							className="flex-1 border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
							placeholder="Type a message..."
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							disabled={isTyping}
						/>
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={handleImprovePrompt}
							disabled={isTyping || isImproving || !inputValue.trim()}
							title="Improve prompt"
							className="bg-white border-gray-300 hover:bg-blue-50 transition-all"
						>
							{isImproving ? (
								<Loader2 className="h-5 w-5 animate-spin text-blue-600" />
							) : (
								<Wand2 className="h-5 w-5 text-blue-600" />
							)}
						</Button>
					</div>
					<Button
						type="submit"
						disabled={isTyping || !inputValue.trim()}
						className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white transition-all flex items-center gap-2"
					>
						<Send size={16} />
						Send
					</Button>
				</form>
			</div>
		</div>
	);
}
