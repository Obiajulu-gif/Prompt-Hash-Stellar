import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export default function PricingSection() {
	return (
		<section className="py-16 bg-black">
			<div className="container">
				<div className="text-center mb-12">
					<h2 className="text-3xl font-bold mb-4">
						Simple, Transparent Pricing
					</h2>
					<p className="text-gray-400 max-w-2xl mx-auto">
						Choose the plan that works best for you, whether you're just getting
						started or a power user.
					</p>
				</div>

				<div className="grid md:grid-cols-3 gap-8 max-w-5xl text-gray-400 mx-auto">
					{[
						{
							name: "Free",
							price: "0",
							description: "Perfect for exploring and getting started",
							features: [
								"Access to free prompts",
								"Basic prompt generation",
								"Community support",
								"Limited API access",
							],
							cta: "Get Started",
							popular: false,
						},
						{
							name: "Pro",
							price: "19",
							description: "For serious creators and professionals",
							features: [
								"Everything in Free",
								"Unlimited prompt generation",
								"Priority support",
								"Full API access",
								"Advanced analytics",
								"Custom prompt templates",
							],
							cta: "Upgrade to Pro",
							popular: true,
						},
						{
							name: "Enterprise",
							price: "99",
							description: "For teams and organizations",
							features: [
								"Everything in Pro",
								"Team collaboration",
								"Custom integrations",
								"Dedicated account manager",
								"SLA guarantees",
								"Custom branding",
							],
							cta: "Contact Sales",
							popular: false,
						},
					].map((plan, index) => (
						<div
							key={index}
							className={`rounded-lg border ${
								plan.popular
									? "border-purple-500 bg-purple-950/20"
									: "border-gray-800 bg-gray-950"
							} p-8 relative`}
						>
							{plan.popular && (
								<div className="absolute top-0 right-0 bg-purple-600 text-white text-xs font-medium px-3 py-1 rounded-bl-lg rounded-tr-lg">
									Most Popular
								</div>
							)}

							<h3 className="text-xl font-bold mb-2">{plan.name}</h3>
							<div className="flex items-baseline mb-4">
								<span className="text-3xl font-bold">${plan.price}</span>
								<span className="text-gray-400 ml-1">/month</span>
							</div>
							<p className="text-gray-400 text-sm mb-6">{plan.description}</p>

							<ul className="space-y-3 mb-8">
								{plan.features.map((feature, i) => (
									<li key={i} className="flex items-start gap-2">
										<Check className="size-5 text-green-500 shrink-0 mt-0.5" />
										<span className="text-sm">{feature}</span>
									</li>
								))}
							</ul>

							<Button
								className={
									plan.popular
										? "w-full bg-purple-600 hover:bg-purple-700"
										: "w-full"
								}
								variant={plan.popular ? "default" : "outline"}
							>
								{plan.cta}
							</Button>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
