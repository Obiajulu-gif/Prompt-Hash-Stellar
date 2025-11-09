"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export default function FaqSection() {
	const [openIndex, setOpenIndex] = useState<number | null>(0);

	const faqs = [
		{
			question: "What is PromptHash?",
			answer:
				"PromptHash is an AI prompt marketplace where creators can sell their prompts and users can discover high-quality prompts for various AI models. Our platform supports prompts for text generation, image creation, code assistance, and more.",
		},
		{
			question: "How do I sell my prompts on PromptHash?",
			answer:
				"To sell prompts on PromptHash, create an account, verify your identity, and submit your prompts for review. Once approved, your prompts will be listed on the marketplace, and you'll earn revenue whenever someone purchases them.",
		},
		{
			question: "What payment methods do you accept?",
			answer:
				"We accept various payment methods including credit/debit cards, PayPal, and cryptocurrency (STRK, ETH, and BTC). All transactions are secure and encrypted.",
		},
		{
			question: "How does the hackathon work?",
			answer:
				"Our hackathon is a time-limited competition where participants create innovative AI prompts or applications using our platform. Submissions are judged based on creativity, utility, and technical implementation. Winners receive prizes and recognition in the PromptHash community.",
		},
		{
			question: "Can I request a custom prompt?",
			answer:
				"Yes! You can request custom prompts from our top creators. Simply browse creator profiles, find someone whose style matches your needs, and send them a custom request with your requirements.",
		},
	];

	return (
		<section className="py-16 bg-gray-950">
			<div className="container">
				<h2 className="text-2xl font-bold text-center mb-12">
					Frequently Asked Questions
				</h2>

				<div className="max-w-3xl mx-auto divide-y divide-gray-800">
					{faqs.map((faq, index) => (
						<div key={index} className="py-5">
							<button
								onClick={() => setOpenIndex(openIndex === index ? null : index)}
								className="flex w-full items-center justify-between text-left"
							>
								<h3 className="text-lg font-medium">{faq.question}</h3>
								<ChevronDown
									className={`size-5 transition-transform ${
										openIndex === index ? "rotate-180" : ""
									}`}
								/>
							</button>

							{openIndex === index && (
								<div className="mt-3 text-gray-400">
									<p>{faq.answer}</p>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
