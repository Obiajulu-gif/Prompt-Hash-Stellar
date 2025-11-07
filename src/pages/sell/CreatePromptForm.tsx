import { useState, ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertCircle, DollarSign, Loader2 } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
// import { ethers } from "ethers";
// import { useAccount, useContract, useReadContract, useSendTransaction } from "@starknet-react/core";
// import { PROMPTHASH_STARKNET_ABI, PROMPTHASH_STARKNET_ADDRESS } from "@/lib/constants";
// import { getUint256FromDecimal } from "@/lib/utils";
// import { useRouter } from "next/navigation";

const contractABI = [
	{
		inputs: [
			{ type: "uint256", name: "price" },
			{ type: "string", name: "title" },
			{ type: "string", name: "description" },
			{ type: "string", name: "category" },
			{ type: "string", name: "imageUrl" },
		],
		name: "create",
		outputs: [{ type: "uint256" }],
		stateMutability: "payable",
		type: "function",
	},
];

interface FormData {
	imageUrl: string;
	title: string;
	description: string;
	category: string;
	price: string;
}

export function CreatePromptForm() {
	const [formData, setFormData] = useState<FormData>({
		imageUrl: "",
		title: "",
		description: "",
		category: "",
		price: "2",
	});

	const [errors, setErrors] = useState<{ [key: string]: string | null }>({});
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// const { address } = useAccount();
	// const { contract } = useContract({
	// 	abi: PROMPTHASH_STARKNET_ABI,
	// 	address: PROMPTHASH_STARKNET_ADDRESS
	// })

	// const { data: nextToken } = useReadContract({
	// 	abi: PROMPTHASH_STARKNET_ABI,
	// 	address: PROMPTHASH_STARKNET_ADDRESS,
	// 	functionName: "get_next_token",
	// 	args: [],
	// 	watch: true,
	// })

	// const createCalls = useMemo(() => {
	// 	const isValid = !!address && formData.imageUrl.length > 0 && formData.description.length > 0;
	// 	if (!isValid) return;

	// 	return contract?.populate("create_prompt", [formData.imageUrl, formData.description, formData.title, formData.category, Number(formData.price)]);
	// }, [address, formData])

	// const approveCalls = useMemo(() => {
	// 	if (!nextToken) return;

	// 	const nextTokenInU256 = getUint256FromDecimal(nextToken.toString());
	// 	return contract?.populate("approve", [PROMPTHASH_STARKNET_ADDRESS, nextTokenInU256]) // change this to the id he is going to create
	// }, []);

	// const { sendAsync: createToken, status } = useSendTransaction(createCalls ? {
	// 	calls: [createCalls]
	// } : ({} as any));

	// const { sendAsync: approve } = useSendTransaction(approveCalls ? {
	// 	calls: [approveCalls]
	// }: ({} as any));

	const handleChange = (
		e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
	) => {
		const { name, value } = e.target;
		setFormData((prev) => ({ ...prev, [name]: value }));
		if (errors[name]) {
			setErrors((prev) => ({ ...prev, [name]: null }));
		}
	};

	const handleCategoryChange = (value: string) => {
		setFormData((prev) => ({ ...prev, category: value }));
		if (errors.category) {
			setErrors((prev) => ({ ...prev, category: null }));
		}
	};

	const validateForm = (): boolean => {
		const newErrors: { [key: string]: string } = {};

		if (!formData.imageUrl.trim()) newErrors.imageUrl = "Image URL is required";
		if (!formData.title.trim()) newErrors.title = "Title is required";
		if (formData.title.length < 3)
			newErrors.title = "Title must be at least 3 characters";
		if (!formData.description.trim())
			newErrors.description = "Description is required";
		if (formData.description.length < 10)
			newErrors.description = "Description must be at least 10 characters";
		if (!formData.category) newErrors.category = "Category is required";
		if (!formData.price) newErrors.price = "Price is required";
		if (isNaN(Number(formData.price)) || Number(formData.price) < 2) {
			newErrors.price = "Price must be at least 2 STRK";
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	// const { push } = useRouter();
	const navigate = useNavigate();

	const handleSubmit = async () => {
		// e.preventDefault();
		setError(null);
		setSuccess(null);

		if (!validateForm()) return;

		setIsSubmitting(true);

		try {
			// if (!window.ethereum) {
			// 	throw new Error("Please install MetaMask");
			// }

			// await window.ethereum.request({ method: "eth_requestAccounts" });

			// const provider = new ethers.BrowserProvider(window.ethereum);
			// const signer = await provider.getSigner();
			// const contractAddress = process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESS;

			// if (!contractAddress) {
			// 	throw new Error("Contract address not found");
			// }

			// const contract = new ethers.Contract(
			// 	contractAddress,
			// 	contractABI,
			// 	signer
			// );

			// // Convert price to wei
			// const priceInHbar = ethers.parseEther(formData.price);
			// // Creation fee is 2 HBAR
			// const creationFee = ethers.parseEther("2.0");

			console.log("Creating prompt with:");
			console.log("- Title:", formData.title);
			console.log("- Price:", formData.price, "STRK");
			console.log("- Category:", formData.category);

			// const tx = await contract.create(
			// 	priceInHbar,
			// 	formData.title,
			// 	formData.description,
			// 	formData.category,
			// 	formData.imageUrl,
			// 	{
			// 		value: creationFee,
			// 		gasLimit: 4000000,
			// 	}
			// );

			// const { transaction_hash: createTxHash } = await createToken();

			// console.log("Transaction sent:", tx.hash);

			// await tx.wait();
			setSuccess("Prompt created successfully!");

			// Reset form
			setFormData({
				imageUrl: "",
				title: "",
				description: "",
				category: "",
				price: "2",
			});
			navigate('/browse')
		} catch (err) {
			console.error("Error creating prompt:", err);
			setError(err instanceof Error ? err.message : "Failed to create prompt");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div className="space-y-2">
					<label className="text-sm font-medium">Image URL</label>
					<Input
						placeholder="Enter image URL"
						name="imageUrl"
						value={formData.imageUrl}
						onChange={handleChange}
						className={errors.imageUrl ? "border-red-500" : "border-purple-400"}
					/>
					{errors.imageUrl && (
						<p className="text-sm text-red-500 flex items-center gap-1">
							<AlertCircle className="h-3 w-3" />
							{errors.imageUrl}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<label className="text-sm font-medium">Title</label>
					<Input
						placeholder="Enter prompt title"
						name="title"
						value={formData.title}
						onChange={handleChange}
						className={errors.title ? "border-red-500" : "border-purple-400"}
					/>
					{errors.title && (
						<p className="text-sm text-red-500 flex items-center gap-1">
							<AlertCircle className="h-3 w-3" />
							{errors.title}
						</p>
					)}
				</div>
			</div>

			<div className="space-y-2">
				<label className="text-sm font-medium">Description</label>
				<Textarea
					placeholder="Enter prompt description..."
					name="description"
					value={formData.description}
					onChange={handleChange}
					className={
						errors.description ? "border-red-500" : "border-purple-400"
					}
					rows={4}
				/>
				{errors.description && (
					<p className="text-sm text-red-500 flex items-center gap-1">
						<AlertCircle className="h-3 w-3" />
						{errors.description}
					</p>
				)}
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div className="space-y-2">
					<label className="text-sm font-medium">Category</label>
					<Select
						value={formData.category}
						onValueChange={handleCategoryChange}
					>
						<SelectTrigger
							className={
								errors.category ? "border-red-500" : "border-purple-400"
							}
						>
							<SelectValue placeholder="Select category" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="Marketing">Marketing</SelectItem>
							<SelectItem value="Creative Writing">Creative Writing</SelectItem>
							<SelectItem value="Programming">Programming</SelectItem>
							<SelectItem value="Music">Music</SelectItem>
							<SelectItem value="Gaming">Gaming</SelectItem>
							<SelectItem value="Other">Other</SelectItem>
						</SelectContent>
					</Select>
					{errors.category && (
						<p className="text-sm text-red-500 flex items-center gap-1">
							<AlertCircle className="h-3 w-3" />
							{errors.category}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<label className="text-sm font-medium">Price (STRK)</label>
					<div className="relative">
						<DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							type="number"
							placeholder="2.00"
							name="price"
							value={formData.price}
							onChange={handleChange}
							step="1"
							min={2}
							max={1000}
							className={`pl-9 ${
								errors.price ? "border-red-500" : "border-purple-400"
							}`}
						/>
					</div>
					{errors.price && (
						<p className="text-sm text-red-500 flex items-center gap-1">
							<AlertCircle className="h-3 w-3" />
							{errors.price}
						</p>
					)}
				</div>
			</div>

			<Button 
				// type="submit" 
				className="w-full" 
				disabled={isSubmitting}
				onClick={handleSubmit}
			>
				{isSubmitting ? (
					<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				) : (
					"Submit Prompt"
				)}
			</Button>

			{error && (
				<p className="text-sm text-red-500 flex items-center gap-1 mt-2">
					<AlertCircle className="h-3 w-3" />
					{error}
				</p>
			)}

			{success && (
				<p className="text-sm text-green-500 flex items-center gap-1 mt-2">
					{success}
				</p>
			)}
		</div>
	);
}
