import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Prompt } from "./FetchAllPrompts";
// import Image from "next/image"
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, StarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
// import { useContract, useSendTransaction } from "@starknet-react/core"
// import { ERC20ABI, PROMPTHASH_STARKNET_ABI, PROMPTHASH_STARKNET_ADDRESS, STARGATE_STRK_ADDRESS } from "@/lib/constants"
// import { useMemo } from "react"

export const PromptCard = ({
  prompt,
  handleImageError,
  index,
  openModal,
}: {
  prompt: Prompt;
  handleImageError: (e: any) => void;
  index: number;
  openModal: (prompt: Prompt) => void;
}) => {
  return (
    <Card
      key={prompt?.id}
      className="group relative overflow-hidden transition-all hover:shadow-lg"
    >
      <div className="aspect-video relative overflow-hidden">
        <img
          src={prompt?.imageUrl || "/images/codeguru.png"}
          alt={prompt?.title || `Prompt ${index}`}
          // fill
          className="object-cover transition-transform group-hover:scale-105"
          onError={handleImageError}
        />
        <Badge className="absolute top-2 right-2 z-10">
          {prompt?.category}
        </Badge>
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold">{prompt?.title}</h3>
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {prompt?.description}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex items-center gap-1 text-yellow-500">
            <StarIcon className="h-4 w-4 fill-current" />
            <span className="text-sm">{prompt?.likes}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Seller: {prompt?.owner.slice(0, 6)}...
          </p>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-between items-center">
        <span className="text-lg font-bold">{prompt?.price} XLM</span>
        <Button onClick={() => openModal(prompt)}>
          <ShoppingCart className="mr-2 h-4 w-4" />
          Buy Now
        </Button>
      </CardFooter>
    </Card>
  );
};
