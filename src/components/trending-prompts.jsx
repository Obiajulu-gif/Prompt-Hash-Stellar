"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter } from "./ui/card";
import { Badge } from "./ui/badge";
// import Link from "next/link";
import { StarIcon, X, EyeIcon } from "lucide-react";

const trendingPrompts = [
	{
		id: 1,
		title: "Cyberpunk Character",
		image: "/images/cyberpunk.png",
		price: "0.05 STRK",
		category: "Image",
		rating: 4.8,
		description:
			"Generate a highly detailed cyberpunk character with neon colors, futuristic attire, and a dystopian city backdrop. The character should have cybernetic enhancements, a unique fashion style, and a moody, high-tech atmosphere. Specify gender, pose, and any additional accessories if needed.",
	},
	{
		id: 2,
		title: "Fantasy Landscape",
		image: "/images/fantasy.png",
		price: "0.03 STRK",
		category: "Image",
		rating: 4.9,
		description:
			"Create a breathtaking fantasy landscape filled with magical elements. Include towering castles, floating islands, mystical forests, or ancient ruins based on your preference. The scene should evoke wonder, using dramatic lighting and vibrant colors. Specify details like time of day, weather, or magical creatures if applicable.",
	},
	{
		id: 3,
		title: "Sci-Fi Story Generator",
		image: "/images/sci-fi.png",
		price: "0.02 STRK",
		category: "Text",
		rating: 4.7,
		description:
			"Write an original sci-fi story featuring advanced technology, space exploration, or dystopian futures. Develop a gripping plot with unique characters, world-building, and unexpected twists. Specify any details such as setting (space, cyberpunk city, alien planet) and theme (adventure, thriller, mystery).",
	},
	{
		id: 4,
		title: "Product Description",
		image: "/images/product-sales.png",
		price: "0.01 STRK",
		category: "Marketing",
		rating: 4.6,
		description:
			"Generate a persuasive and engaging product description for [product name]. Highlight its key features, benefits, and unique selling points. Tailor the tone for [target audience] and keep it within [word count] for maximum impact. If applicable, include a call-to-action to drive conversions.",
	},
	{
		id: 5,
		title: "React Component Builder",
		image: "/images/react-component.png",
		price: "0.08 STRK",
		category: "Code",
		rating: 4.9,
		description:
			"Generate a reusable and optimized React component for [component function]. Ensure it follows best practices, includes props for customization, and is styled using [CSS framework or plain CSS]. Provide example usage and explain how the component integrates into a larger project.",
	},
];

function PromptModal({ prompt, onClose }) {
	if (!prompt) return null;

	// Close modal when clicking outside modal content
	const handleOverlayClick = () => {
		onClose();
	};

	return (
		<div
			onClick={handleOverlayClick}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		>
			<div
				onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside modal
				className="bg-gray-800 text-white rounded-lg shadow-lg max-w-md mx-4 p-6 relative"
			>
				<h2 className="text-2xl font-bold mb-4">{prompt.title}</h2>
				<img
					src={prompt.image || "/placeholder.svg"}
					alt={prompt.title}
					className="w-full h-auto object-cover rounded mb-4"
				/>
				<p className="mb-4">{prompt.description}</p>
				<div className="flex items-center justify-between">
					<span className="font-bold">{prompt.price}</span>
					<Button variant="outline font-bold text-purple-500" onClick={onClose}>
						<X className="h-4 w-4 mr-2" />
						Close
					</Button>
				</div>
			</div>
		</div>
	);
}

export function TrendingPrompts() {
	const [selectedPrompt, setSelectedPrompt] = useState(null);

	const openModal = (prompt) => {
		setSelectedPrompt(prompt);
	};

	const closeModal = () => {
		setSelectedPrompt(null);
	};

	return (
		<>
			<section className="py-12 px-6 bg-transparent">
				<div className="mx-auto max-w-7xl">
					<div className="flex justify-between items-center mb-8">
						<h2 className="text-2xl font-bold tracking-tight">Hot Prompts</h2>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
						{trendingPrompts.map((prompt) => (
							<Card
								key={prompt.id}
								className="bg-gray-900 border-gray-800 overflow-hidden group hover:border-purple-500 transition-all"
							>
								<div className="aspect-[3/2] relative overflow-hidden">
									<img
										src={prompt.image || "/placeholder.svg"}
										alt={prompt.title}
										className="object-cover w-full h-full transition-transform group-hover:scale-105"
									/>
									<Badge className="absolute top-2 right-2 bg-black/60 text-white">
										{prompt.category}
									</Badge>
								</div>
								<CardContent className="p-4">
									<h3 className="font-medium text-white truncate">
										{prompt.title}
									</h3>
									<div className="flex items-center gap-1 text-yellow-500 mt-1">
										<StarIcon className="h-4 w-4 fill-current" />
										<span className="text-sm font-medium">{prompt.rating}</span>
									</div>
								</CardContent>
								<CardFooter className="p-4 pt-0 flex justify-between items-center">
									<span className="text-sm font-bold text-white">
										{prompt.price}
									</span>
									<Button
										size="sm"
										variant="ghost"
										className="text-purple-400 hover:text-blue-300 hover:bg-transparent p-0 flex items-center gap-1"
										onClick={() => openModal(prompt)}
									>
										<EyeIcon className="h-4 w-4" />
										View
									</Button>
								</CardFooter>
							</Card>
						))}
					</div>
				</div>
			</section>
			{selectedPrompt && (
				<PromptModal prompt={selectedPrompt} onClose={closeModal} />
			)}
		</>
	);
}
