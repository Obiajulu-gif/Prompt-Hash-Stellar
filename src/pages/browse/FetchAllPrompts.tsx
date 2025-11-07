"use client";

import { useState, useEffect } from "react";
// import { ethers, toBigInt } from "ethers";
import { Button } from "@/components/ui/button";
// import { Card, CardContent, CardFooter } from "@/components/ui/card";
// import { Badge } from "@/components/ui/badge";
import {
  // StarIcon,
  // Eye,
  // ShoppingCart,
  // Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
// import Image from "next/image";
// import contractABI from "../../../contracts/PromptHashAbi.json";
// import { useAccount, useContract, useReadContract } from "@starknet-react/core";
// import { PROMPTHASH_STARKNET_ABI, PROMPTHASH_STARKNET_ADDRESS } from "@/lib/constants";
// import { contractAddressToHex, shortenAddress } from "@/lib/utils";
import { PromptCard } from "./PromptCard";
import { PromptModal } from "./PromptModal";

const ITEMS_PER_PAGE = 10;

export type Prompt = {
  id: string //in contract
  title: string
  description: string //in contract
  category: string 
  imageUrl: string //in contract
  price: string
  likes: number
  owner: string //not in contract
  exists: boolean //in contract
  onSale: boolean //in contract
} | undefined

const FetchAllPrompts = ({
  selectedCategory = "",
  priceRange = [0, 1000], // Default price range
  searchQuery = "",
}) => {
  const [_prompts, _setPrompts] = useState([]);
  // const [isLoading, setIsLoading] = useState(false);
  const [error, _setError] = useState(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // const { address } = useAccount();
  
  // const { contract } = useContract({
  //   abi: PROMPTHASH_STARKNET_ABI,
  //   address: PROMPTHASH_STARKNET_ADDRESS
  // });

  // const { data: rawPrompts, isLoading } = useReadContract({
  //   abi: PROMPTHASH_STARKNET_ABI,
  //   address: PROMPTHASH_STARKNET_ADDRESS,
  //   functionName: "get_all_prompts",
  //   args: [],
  //   watch: true
  // })

  // const formattedPrompts: Prompt[] = rawPrompts ?
  //   rawPrompts.map((prompt, index) => {
  //     return {
  //       id: prompt.id.toString(),
  //       title: prompt.title,
  //       description: prompt.description,
  //       category: prompt.category,
  //       imageUrl: prompt.image_url,
  //       price: prompt.price.toString(),
  //       likes: 2,
  //       owner: contractAddressToHex(prompt.owner),
  //       exists: !!prompt,
  //       onSale: prompt.for_sale
  //     }
  //   }) : []

  // const promptHashCall = useMemo(() => {
  //   return [
  //     contract?.populate("approve", [PROMPTHASH_STARKNET_ADDRESS, ])
  //   ]
  // }, []);

  // const erc721Call = useMemo(() => {
    
  // }, []);

  useEffect(() => {
    // Reset to first page when filters change
    setCurrentPage(1);
  }, [selectedCategory, priceRange, searchQuery]);

  const handleImageError = (e: any) => {
    e.target.onerror = null;
    e.target.src = "/images/codeguru.png";
  };

  const openModal = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedPrompt(undefined);
  };

  // const handleBuyPrompt = async (prompt) => {
  //   try {
  //     if (!window.ethereum) {
  //       throw new Error("Please install MetaMask");
  //     }

  //     const provider = new ethers.BrowserProvider(window.ethereum);
  //     const signer = await provider.getSigner();

  //     const contract = new ethers.Contract(
  //       process.env.NEXT_PUBLIC_DEPLOYMENT_ADDRESS,
  //       contractABI,
  //       signer
  //     );

  //     const promptPrice = ethers.parseEther(prompt.price);
  //     console.log("Prompt price:", ethers.formatEther(promptPrice), "HBAR");

  //     const tx = await contract.buy(prompt.id, {
  //       value: promptPrice,
  //     });

  //     closeModal();
  //     fetchPrompts();
  //   } catch (error) {
  //     console.error("Error buying prompt:", error);
  //   }
  // };

  const array = new Array(10);

  // Pagination logic
  const totalPages = Math.ceil((array).length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPrompts = array.slice(startIndex, endIndex);

  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  // if (isLoading) {
  //   return (
  //     <div className="flex justify-center items-center min-h-[400px]">
  //       <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
  //     </div>
  //   );
  // }

  if (error) {
    return <div className="text-center text-red-500 p-4">{error}</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {currentPrompts.map((prompt, index) => {
          // if (!prompt) return
          return (
          // <Card
          //   key={prompt?.id}
          //   className="group relative overflow-hidden transition-all hover:shadow-lg"
          // >
          //   <div className="aspect-video relative overflow-hidden">
          //     <Image
          //       src={prompt?.imageUrl || "/images/codeguru.png"}
          //       alt={prompt?.title || `Prompt ${index}`}
          //       fill
          //       className="object-cover transition-transform group-hover:scale-105"
          //       onError={handleImageError}
          //     />
          //     <Badge className="absolute top-2 right-2 z-10">
          //       {prompt?.category}
          //     </Badge>
          //   </div>
          //   <CardContent className="p-4">
          //     <h3 className="font-semibold">
          //       {prompt?.title}
          //     </h3>
          //     <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          //       {prompt?.description}
          //     </p>
          //     <div className="flex items-center gap-2 mt-2">
          //       <div className="flex items-center gap-1 text-yellow-500">
          //         <StarIcon className="h-4 w-4 fill-current" />
          //         <span className="text-sm">
          //           {prompt?.likes}
          //         </span>
          //       </div>
          //       <p className="text-sm text-muted-foreground">
          //         Seller: {prompt?.owner.slice(0, 6)}...
          //       </p>
          //     </div>
          //   </CardContent>
          //   <CardFooter className="p-4 pt-0 flex justify-between items-center">
          //     <span className="text-lg font-bold">
          //       {prompt?.price} STRK
          //     </span>
          //     <Button 
          //       onClick={() => openModal(prompt)}
          //     >
          //       <ShoppingCart className="mr-2 h-4 w-4" />
          //       Buy Now
          //     </Button>
          //   </CardFooter>
          // </Card>
          <PromptCard prompt={prompt} index={index} openModal={openModal} handleImageError={handleImageError} />
        )})}
      </div>
      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-8">
          <Button
            variant="outline"
            onClick={prevPage}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={nextPage}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {/* Prompt Detail Modal */}
      {isModalOpen && selectedPrompt && (
        // <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        //   <div className="bg-background rounded-lg shadow-lg max-w-xl w-full max-h-[90vh] overflow-auto">
        //     <div className="p-6">
        //       <div className="flex justify-between items-start mb-4">
        //         <h2 className="text-2xl font-bold">
        //           {selectedPrompt.title}
        //         </h2>
        //         <button
        //           onClick={closeModal}
        //           className="text-muted-foreground hover:text-foreground"
        //         >
        //           <svg
        //             xmlns="http://www.w3.org/2000/svg"
        //             width="24"
        //             height="24"
        //             viewBox="0 0 24 24"
        //             fill="none"
        //             stroke="currentColor"
        //             strokeWidth="2"
        //             strokeLinecap="round"
        //             strokeLinejoin="round"
        //           >
        //             <line x1="18" y1="6" x2="6" y2="18"></line>
        //             <line x1="6" y1="6" x2="18" y2="18"></line>
        //           </svg>
        //         </button>
        //       </div>

        //       <div className="aspect-video mb-4 rounded-lg overflow-hidden">
        //         <Image
        //           src={selectedPrompt.imageUrl || "/images/codeguru.png"}
        //           alt={selectedPrompt.title}
        //           width={800}
        //           height={450}
        //           onError={handleImageError}
        //           className="w-full h-full object-cover"
        //         />
        //       </div>

        //       <div className="flex items-center justify-between mb-4">
        //         <Badge>
        //           {selectedPrompt.category}
        //         </Badge>
        //         <div className="flex items-center gap-1 text-yellow-500">
        //           <StarIcon className="h-4 w-4 fill-current" />
        //           <span>
        //             {selectedPrompt.likes}
        //           </span>
        //         </div>
        //       </div>

        //       <div className="mb-4">
        //         <h3 className="text-lg font-semibold mb-2">Description</h3>
        //         <p className="text-muted-foreground">
        //           {selectedPrompt.description}
        //         </p>
        //       </div>

        //       <div className="mb-4">
        //         <h3 className="text-lg font-semibold mb-2">Seller</h3>
        //         <div className="flex items-center gap-2">
        //           <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
        //             {selectedPrompt.owner.slice(0, 2)}
        //           </div>
        //           <span className="font-mono">
        //             {shortenAddress(selectedPrompt.owner)}
        //           </span>
        //         </div>
        //       </div>

        //       <div className="flex justify-between items-center">
        //         <span className="text-2xl font-bold">
        //           {selectedPrompt.price} STRK
        //         </span>
        //         <Button 
        //           // onClick={() => handleBuyPrompt(selectedPrompt)}
        //         >
        //           <ShoppingCart className="mr-2 h-4 w-4" />
        //           Buy Now
        //         </Button>
        //       </div>
        //     </div>
        //   </div>
        // </div>
        <PromptModal closeModal={closeModal} selectedPrompt={selectedPrompt} handleImageError={handleImageError}/>
      )}
    </>
  );
};

// Add prop types if using TypeScript
FetchAllPrompts.defaultProps = {
  selectedCategory: "",
  priceRange: [0, 1000],
  searchQuery: "",
};

export default FetchAllPrompts;
