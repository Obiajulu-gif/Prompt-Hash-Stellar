"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface TypewriterProps {
	text: string;
	speed?: number;
	className?: string;
}

export function Typewriter({
	text,
	speed = 30,
	className = "",
}: TypewriterProps) {
	const [displayedText, setDisplayedText] = useState("");
	const [currentIndex, setCurrentIndex] = useState(0);
	const [isComplete, setIsComplete] = useState(false);
	const [showCursor, setShowCursor] = useState(true);

	// Reset when text changes
	useEffect(() => {
		setDisplayedText("");
		setCurrentIndex(0);
		setIsComplete(false);
		setShowCursor(true);
	}, [text]);

	// Typing effect
	useEffect(() => {
		if (currentIndex < text.length) {
			const timeout = setTimeout(() => {
				setDisplayedText((prev) => prev + text[currentIndex]);
				setCurrentIndex((prev) => prev + 1);
			}, speed);

			return () => clearTimeout(timeout);
		} else {
			setIsComplete(true);
			// Stop blinking cursor after typing is complete
			setTimeout(() => setShowCursor(false), 1000);
		}
	}, [currentIndex, text, speed]);

	// Blinking cursor effect
	useEffect(() => {
		if (!isComplete) {
			const cursorInterval = setInterval(() => {
				setShowCursor((prev) => !prev);
			}, 1000);

			return () => clearInterval(cursorInterval);
		}
	}, [isComplete]);

	return (
		<div className={className}>
			<ReactMarkdown>{displayedText}</ReactMarkdown>
			{showCursor && !isComplete && (
				<span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse"></span>
			)}
		</div>
	);
}
