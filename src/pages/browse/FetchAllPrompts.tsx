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
// import fungible_allowlist_example from "@/contracts/fungible_allowlist_example";
// import { contractAddressToHex, shortenAddress } from "@/lib/utils";
import prompt_hash from "@/contracts/prompt_hash";
import { PromptCard } from "./PromptCard";
import { PromptModal } from "./PromptModal";

const ITEMS_PER_PAGE = 10;

export type Prompt = {
  id: string; //in contract
  title: string;
  description: string; //in contract
  category: string;
  imageUrl: string; //in contract
  price: string;
  likes: number;
  owner: string; //not in contract
  exists: boolean; //in contract
  onSale: boolean; //in contract
}

const FetchAllPrompts = ({
  selectedCategory = "",
  priceRange = [0, 1000], // Default price range
  searchQuery = "",
}) => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  // const [isLoading, setIsLoading] = useState(false);
  const [error, _setError] = useState(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchPrompts = async (): Promise<Prompt[]> => {
    
    const { result } = await prompt_hash.get_all_prompts();
    let formattedPrompts: Prompt[] = []
    if (result.isOk()) {
      console.log("Ok Prompts fetched: ", result.unwrap());
      const prompts = result.unwrap();
      formattedPrompts = prompts.map((prompt) => {
        return {
          id: prompt.id.toString(),
          title: prompt.title.toString(),
          description: prompt.description.toString(),
          category: prompt.category.toString(),
          imageUrl: prompt.image_url.toString(),
          price: prompt.price.toString(),
          likes: 2,
          owner: prompt.owner.toString(),
          exists: !!prompt,
          onSale: prompt.for_sale
        }
      })
      setPrompts(formattedPrompts);

      return formattedPrompts
    } else if (result.isErr()) {
      console.log("Error fetching prompts: ", result.unwrapErr());
      return []
    }
    return []
  }

  useEffect(() => {
    fetchPrompts();
  }, [])

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

  // const array = new Array(10);

  // Pagination logic
  const totalPages = Math.ceil(prompts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPrompts = prompts.slice(startIndex, endIndex);

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
            <PromptCard
              prompt={prompt}
              index={index}
              openModal={openModal}
              handleImageError={handleImageError}
            />
          );
        })}
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
        <PromptModal
          closeModal={closeModal}
          selectedPrompt={selectedPrompt}
          handleImageError={handleImageError}
        />
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
