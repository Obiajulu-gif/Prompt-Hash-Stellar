"use client";
import { useState } from "react";
import { Button } from "./ui/button";
// import Link from "next/link";
import { Link } from "react-router-dom";
import { Card, CardContent, CardFooter } from "./ui/card";
import { Badge } from "@/components/ui/badge";
import { StarIcon, ShoppingCart } from "lucide-react";

const featuredPrompts = [
  {
    id: 1,
    title: "Creative Story Generator",
    description:
      "Write a captivating short story based on the following prompt: [Insert your story idea or theme]. The story should include well-developed characters, engaging dialogue, and a compelling narrative arc. Adjust the style and tone to match [genre: fantasy, sci-fi, mystery, etc.], and add an unexpected plot twist for intrigue.",
    image: "/images/creative-story.png",
    price: "0.1 STRK",
    category: "Creative Writing",
    rating: 4.8,
  },
  {
    id: 2,
    title: "SEO Content Optimizer",
    description:
      "Optimize the following content for SEO while maintaining natural readability. Ensure proper keyword placement, improve meta descriptions, and enhance structure with headers and bullet points. If necessary, adjust the tone to better match [target audience]. Content:\n\n[Paste your content here]",
    image: "/images/seo.png",
    price: "0.08 STRK",
    category: "Marketing",
    rating: 4.9,
  },
  {
    id: 3,
    title: "Code Refactoring Assistant",
    description:
      "Refactor the following code to improve readability, maintainability, and performance. Identify redundancies, apply best practices, and optimize logic where possible. Provide a before-and-after comparison with explanations. Code:\n\n[Paste your code here]",
    image: "/images/code-refactoring.png",
    price: "0.15 STRK",
    category: "Programming",
    rating: 4.7,
  },
];

export function FeaturedPrompts() {
  const [selectedPrompt, setSelectedPrompt] = useState(null);

  const handleCardClick = (prompt) => {
    setSelectedPrompt(prompt);
  };

  const closeModal = () => {
    setSelectedPrompt(null);
  };

  return (
    <>
      <section className="py-16 px-6 bg-transparent">
        <div className="mx-auto max-w-7xl">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Featured Prompts
            </h2>
            <Link href="/browse" passHref>
              <Button
                variant="outline"
                className="border-gray-700 text-purple-500"
              >
                View all
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredPrompts.map((prompt) => (
              <Card
                key={prompt.id}
                onClick={() => handleCardClick(prompt)}
                className="bg-gray-800 border-gray-700 overflow-hidden group hover:border-purple-500 transition-all cursor-pointer"
              >
                <div className="aspect-video relative overflow-hidden">
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
                  <h3 className="text-lg font-semibold text-white">
                    {prompt.title}
                  </h3>
                  <p className="mt-2 text-sm text-gray-300 line-clamp-2">
                    {prompt.description}
                  </p>
                  <div className="flex items-center gap-1 text-yellow-500 mt-3">
                    <StarIcon className="h-4 w-4 fill-current" />
                    <span className="text-sm font-medium">{prompt.rating}</span>
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-0 flex justify-between items-center">
                  <span className="text-lg font-bold text-white">
                    {prompt.price}
                  </span>
                  <Button className="bg-purple-600 hover:bg-purple-700 flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4" />
                    Buy Now
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Modal */}
      {selectedPrompt && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-gray-900 p-6 rounded shadow-lg max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedPrompt.image && (
              <img
                src={selectedPrompt.image}
                alt={selectedPrompt.title}
                className="mb-4 w-full h-auto rounded text-gray-200"
              />
            )}
            <h3 className="text-xl font-bold text-gray-200 mb-2">
              {selectedPrompt.title}
            </h3>
            <p className="mb-4 text-gray-400">{selectedPrompt.description}</p>
            <Button onClick={closeModal}>Close</Button>
          </div>
        </div>
      )}
    </>
  );
}
