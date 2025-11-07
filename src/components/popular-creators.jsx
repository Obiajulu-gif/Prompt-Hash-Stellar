import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

const creators = [
	{
		id: 1,
		name: "Alex.Atom",
		prompts: 24,
		followers: "5.2K",
		image: "/images/alex.sol.png",
	},
	{
		id: 2,
		name: "PromptMaster",
		prompts: 36,
		followers: "8.7K",
		image: "/images/promptmaster.png",
	},
	{
		id: 3,
		name: "AIArtist",
		prompts: 18,
		followers: "3.9K",
		image: "/images/aiartist.png",
	},
	{
		id: 4,
		name: "CodeGuru",
		prompts: 42,
		followers: "6.1K",
		image: "/images/codeguru.png",
	},
];

export function PopularCreators() {
	return (
		<section className="py-16 px-6 bg-gray-950">
			<div className="mx-auto max-w-7xl">
				<div className="flex justify-between items-center mb-8">
					<h2 className="text-2xl font-bold tracking-tight text-white">
						Popular Creators
					</h2>
					<Button variant="outline" className="border-gray-700 text-purple-500">
						View all
					</Button>
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
					{creators.map((creator) => (
						<Card
							key={creator.id}
							className="bg-gray-900 border-gray-800 hover:border-purple-500 transition-all"
						>
							<CardContent className="p-6">
								<div className="flex items-center gap-4">
									<img
										src={creator.image || "/placeholder.svg"}
										alt={creator.name}
										className="w-16 h-16 rounded-full object-cover border-2 border-purple-500"
									/>
									<div>
										<h3 className="font-semibold text-white">{creator.name}</h3>
										<p className="text-sm text-gray-400">
											{creator.prompts} prompts
										</p>
									</div>
								</div>
								<div className="mt-4 flex justify-between items-center">
									<Badge
										variant="outline"
										className="border-gray-700 text-gray-300"
									>
										{creator.followers} followers
									</Badge>
									<Button
										variant="ghost"
										className="text-purple-400 hover:text-purple-300"
									>
										Follow
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	);
}
