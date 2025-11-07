import { useEffect, useState } from "react";
import { Users, Code, ImageIcon, Zap } from "lucide-react";

export default function StatsCounter() {
	const [counts, setCounts] = useState({
		users: 0,
		prompts: 0,
		images: 0,
		transactions: 0,
	});

	const targets = {
		users: 25000,
		prompts: 100000,
		images: 5000000,
		transactions: 250000,
	};

	useEffect(() => {
		const duration = 2000; // 2 seconds animation
		const steps = 60;
		const interval = duration / steps;

		let step = 0;

		const timer = setInterval(() => {
			step++;

			const progress = Math.easeInOutCubic(step / steps);

			setCounts({
				users: Math.floor(progress * targets.users),
				prompts: Math.floor(progress * targets.prompts),
				images: Math.floor(progress * targets.images),
				transactions: Math.floor(progress * targets.transactions),
			});

			if (step >= steps) {
				clearInterval(timer);
			}
		}, interval);

		return () => clearInterval(timer);
	}, []);

	// Easing function
	Math.easeInOutCubic = (t) =>
		t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

	return (
		<section className="py-12 bg-black">
			<div className="container">
				<div className="grid grid-cols-2 md:grid-cols-4 gap-6">
					<div className="flex flex-col items-center text-center">
						<div className="size-12 rounded-full bg-purple-900/30 flex items-center justify-center mb-4">
							<Users className="size-6 text-purple-400" />
						</div>
						<div className="text-2xl md:text-3xl font-bold mb-1">
							{counts.users.toLocaleString()}+
						</div>
						<p className="text-sm text-gray-400">Active Users</p>
					</div>

					<div className="flex flex-col items-center text-center">
						<div className="size-12 rounded-full bg-blue-900/30 flex items-center justify-center mb-4">
							<Code className="size-6 text-blue-400" />
						</div>
						<div className="text-2xl md:text-3xl font-bold mb-1">
							{counts.prompts.toLocaleString()}+
						</div>
						<p className="text-sm text-gray-400">AI Prompts</p>
					</div>

					<div className="flex flex-col items-center text-center">
						<div className="size-12 rounded-full bg-pink-900/30 flex items-center justify-center mb-4">
							<ImageIcon className="size-6 text-pink-400" />
						</div>
						<div className="text-2xl md:text-3xl font-bold mb-1">
							{counts.images.toLocaleString()}+
						</div>
						<p className="text-sm text-gray-400">Generated Images</p>
					</div>

					<div className="flex flex-col items-center text-center">
						<div className="size-12 rounded-full bg-green-900/30 flex items-center justify-center mb-4">
							<Zap className="size-6 text-green-400" />
						</div>
						<div className="text-2xl md:text-3xl font-bold mb-1">
							{counts.transactions.toLocaleString()}+
						</div>
						<p className="text-sm text-gray-400">Transactions</p>
					</div>
				</div>
			</div>
		</section>
	);
}
