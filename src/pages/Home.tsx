import { Navigation } from "../components/navigation";
import { Hero } from "../components/hero";
import { TrendingPrompts } from "../components/trending-prompts";
import { FeaturedPrompts } from "../components/featured-prompts";
import { CategoryShowcase } from "../components/category-showcase";
import { PopularCreators } from "../components/popular-creators";
import { SellerCTA } from "../components/seller-cta";
import { Footer } from "../components/footer";
import { SparklesCore } from "@/components/sparkles";
import { AiChatButton } from "../components/ai-chatbox";
import MarqueeSection from "@/components/marquee-section";
import PricingSection from "@/components/pricing-section";
import FaqSection from "@/components/faq-section";
export default function Home() {
	return (
		<div className="min-h-screen flex flex-col bg-gray-950 text-white">
			{/* Ambient background with moving particles */}
			<div className="h-full w-full absolute inset-0 z-0">
				<SparklesCore
					id="tsparticlesfullpage"
					background="transparent"
					minSize={0.6}
					maxSize={1.4}
					particleDensity={100}
					className="w-full h-full"
					particleColor="#FFFFFF"
				/>
			</div>
			<Navigation />
			<main className="flex-1">
				<Hero />
				<MarqueeSection />
				<TrendingPrompts />
				<FeaturedPrompts />
				<CategoryShowcase />
				<SellerCTA />
				<PricingSection />
				<PopularCreators />
				<AiChatButton />
				<FaqSection/>
			</main>
			<Footer />
		</div>
	);
}
