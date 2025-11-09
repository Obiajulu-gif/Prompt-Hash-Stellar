import { Button } from "./ui/button";
// import Link from "next/link"
import { Link } from "react-router-dom";
import { FloatingPaper } from "@/components/floating-paper";
import { RoboAnimation } from "@/components/robo-animation";
import { SparklesCore } from "@/components/sparkles";
import { ArrowRight } from "lucide-react"; // Added Lucide icon

export function Hero() {
  return (
    <div className="relative">
      {/* Floating papers background */}
      <div className="absolute inset-0 overflow-hidden">
        <FloatingPaper count={6} />
      </div>
      <div className="absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-500">
            AI Prompt Marketplace
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-300">
            Explore the best prompts from top creators. Generate images, text &
            code with ease.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Link href="/browse">
              <Button
                size="lg"
                className="rounded-full bg-purple-600 hover:bg-purple-700"
              >
                <span className="flex items-center gap-2">
                  <span>Explore Prompts</span>
                  <ArrowRight size={16} />
                </span>
              </Button>
            </Link>
            <div className="flex items-center space-x-1">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="inline-block h-6 w-6 rounded-full bg-gray-700 ring-2 ring-gray-900"
                  />
                ))}
              </div>
              <div className="text-sm text-gray-400">
                <span className="font-semibold text-white">4.9★</span> (3.7k+
                reviews)
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Animated robot */}
      <div className="absolute bottom-0 right-0 w-96 h-96">
        <RoboAnimation />
      </div>
    </div>
  );
}
