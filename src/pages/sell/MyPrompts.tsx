"use client";

import { useState } from "react";
// import { ethers } from "ethers";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, StarIcon } from "lucide-react";
// import Image from "next/image";
// import contractABI from "../../../contracts/PromptHashAbi.json";
import CustomAlert from "./CustomAlerts";

// Define interfaces for type safety
interface Prompt {
  id: string;
  title: string;
  description: string;
  category: string;
  imageUrl: string;
  price: string;
  likes: string;
  owner: string;
  exists: boolean;
  onSale: boolean;
}

const MyPrompts = () => {
  const [userPrompts, _setUserPrompts] = useState<Prompt[]>([]);
  const [isLoading, _setIsLoading] = useState<boolean>(true);
  const [error, _setError] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [salePrice, setSalePrice] = useState<string>("");
  const [alert, setAlert] = useState<{
    isOpen: boolean;
    message: string;
    type: "success" | "error";
  }>({
    isOpen: false,
    message: "",
    type: "success",
  });

  // const showAlert = (message: string, type: "success" | "error") => {
  // 	setAlert({
  // 		isOpen: true,
  // 		message,
  // 		type,
  // 	});
  // };

  // useEffect(() => {
  // 	fetchUserPrompts();
  // }, []);

  // const fetchUserPrompts = async () => {
  // 	try {
  // 		setIsLoading(true);

  // 		if (!window.ethereum) {
  // 			throw new Error("Please install MetaMask");
  // 		}

  // 		const provider = new ethers.BrowserProvider(window.ethereum);
  // 		const signer = await provider.getSigner();
  // 		const userAddress = await signer.getAddress();

  // 		const contractAddress = process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESS;
  // 		if (!contractAddress) {
  // 			throw new Error("Contract address not found");
  // 		}

  // 		const contract = new ethers.Contract(
  // 			contractAddress,
  // 			contractABI,
  // 			provider
  // 		);

  // 		const promptIds = await contract.getUserPrompts(userAddress);

  // 		const promptsData = await Promise.all(
  // 			promptIds.map(async (id: bigint) => {
  // 				const prompt = await contract.prompts(id);
  // 				return {
  // 					id: id.toString(),
  // 					title: prompt[0],
  // 					description: prompt[1],
  // 					category: prompt[2],
  // 					imageUrl: prompt[3],
  // 					price: ethers.formatEther(prompt[4]),
  // 					likes: prompt[5].toString(),
  // 					owner: prompt[6],
  // 					exists: prompt[7],
  // 					onSale: prompt[8],
  // 				} as Prompt;
  // 			})
  // 		);

  // 		setUserPrompts(promptsData);
  // 	} catch (error) {
  // 		console.error("Error fetching user prompts:", error);
  // 		setError(error instanceof Error ? error.message : "An error occurred");
  // 	} finally {
  // 		setIsLoading(false);
  // 	}
  // };

  const openModal = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedPrompt(null);
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    target.src = "/images/codeguru.png";
    target.onerror = null;
  };

  // const handleListForSale = async (prompt: Prompt) => {
  // 	try {
  // 		if (!window.ethereum) {
  // 			throw new Error("Please install MetaMask");
  // 		}

  // 		const provider = new ethers.BrowserProvider(window.ethereum);
  // 		const signer = await provider.getSigner();

  // 		const contract = new ethers.Contract(
  // 			process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESS!,
  // 			contractABI,
  // 			signer
  // 		);

  // 		showAlert("Processing transaction...", "success");

  // 		const tx = await contract.updateSaleStatus(
  // 			prompt.id,
  // 			true, // newOnSale
  // 			salePrice // newPrice
  // 		);

  // 		await tx.wait();
  // 		showAlert("Prompt listed for sale successfully!", "success");

  // 		await fetchUserPrompts();
  // 		closeModal();
  // 		setSalePrice("");
  // 	} catch (error) {
  // 		console.error("Error listing prompt for sale:", error);
  // 		showAlert(
  // 			error instanceof Error
  // 				? error.message
  // 				: "Failed to list prompt for sale",
  // 			"error"
  // 		);
  // 	}
  // };

  // const handleRemoveFromSale = async (prompt: Prompt) => {
  // 	try {
  // 		if (!window.ethereum) {
  // 			throw new Error("Please install MetaMask");
  // 		}

  // 		const provider = new ethers.BrowserProvider(window.ethereum);
  // 		const signer = await provider.getSigner();

  // 		const contract = new ethers.Contract(
  // 			process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESS!,
  // 			contractABI,
  // 			signer
  // 		);

  // 		showAlert("Processing transaction...", "success");

  // 		const tx = await contract.updateSaleStatus(
  // 			prompt.id,
  // 			false, // newOnSale
  // 			0 // newPrice
  // 		);

  // 		await tx.wait();
  // 		showAlert("Prompt removed from sale successfully!", "success");

  // 		await fetchUserPrompts();
  // 		closeModal();
  // 	} catch (error) {
  // 		console.error("Error removing prompt from sale:", error);
  // 		showAlert(
  // 			error instanceof Error ? error.message : "Failed to remove from sale",
  // 			"error"
  // 		);
  // 	}
  // };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-red-500 p-4">{error}</div>;
  }

  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-6">My Prompts</h1>

      {userPrompts.length === 0 ? (
        <div className="text-center text-gray-500 p-4">
          You don't own any prompts yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {userPrompts.map((prompt) => (
            <Card
              key={prompt.id}
              className="group relative overflow-hidden transition-all hover:shadow-lg"
            >
              <div className="aspect-video relative overflow-hidden">
                <img
                  src={prompt.imageUrl || "/images/codeguru.png"}
                  alt={prompt.title}
                  // fill
                  className="object-cover transition-transform group-hover:scale-105"
                  onError={handleImageError}
                />
                <Badge className="absolute top-2 right-2 z-10">
                  {prompt.category}
                </Badge>
              </div>
              <CardContent className="p-4">
                <h3 className="font-semibold">{prompt.title}</h3>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {prompt.description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1 text-yellow-500">
                    <StarIcon className="h-4 w-4 fill-current" />
                    <span className="text-sm">{prompt.likes}</span>
                  </div>
                  <Badge variant={prompt.onSale ? "default" : "secondary"}>
                    {prompt.onSale ? "For Sale" : "Not for Sale"}
                  </Badge>
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0 flex justify-between items-center">
                <span className="text-lg font-bold">{prompt.price} STRK</span>
                <Button onClick={() => openModal(prompt)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Edit Prompt
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {isModalOpen && selectedPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-lg max-w-xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold">{selectedPrompt.title}</h2>
                <button
                  onClick={closeModal}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className="aspect-video mb-4 rounded-lg overflow-hidden">
                <img
                  src={selectedPrompt.imageUrl || "/images/codeguru.png"}
                  alt={selectedPrompt.title}
                  width={800}
                  height={450}
                  onError={handleImageError}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex items-center justify-between mb-4">
                <Badge>{selectedPrompt.category}</Badge>
                <div className="flex items-center gap-1 text-yellow-500">
                  <StarIcon className="h-4 w-4 fill-current" />
                  <span>{selectedPrompt.likes}</span>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">Description</h3>
                <p className="text-muted-foreground">
                  {selectedPrompt.description}
                </p>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-2xl font-bold">
                  {selectedPrompt.price} STRK
                </span>
                <div className="space-x-2">
                  {selectedPrompt.onSale ? (
                    <Button
                      variant="destructive"
                      // onClick={() => handleRemoveFromSale(selectedPrompt)}
                    >
                      Remove from Sale
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Price in STRK"
                        value={salePrice}
                        onChange={(e) => setSalePrice(e.target.value)}
                        className="px-3 py-2 border rounded-md w-32"
                      />
                      <Button
                        variant="default"
                        // onClick={() => handleListForSale(selectedPrompt)}
                        disabled={!salePrice || Number(salePrice) <= 0}
                      >
                        List for Sale
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <CustomAlert
        message={alert.message}
        type={alert.type}
        isOpen={alert.isOpen}
        onClose={() => setAlert((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default MyPrompts;
