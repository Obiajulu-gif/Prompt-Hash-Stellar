// import Image from "next/image"
import { Prompt } from "./FetchAllPrompts";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, StarIcon } from "lucide-react";
// import { getUint256FromDecimal, shortenAddress } from "@/lib/utils"
import { Button } from "@/components/ui/button";
// import { useAccount, useContract, useSendTransaction } from "@starknet-react/core"
// import { ERC20ABI, PROMPTHASH_STARKNET_ABI, PROMPTHASH_STARKNET_ADDRESS, STARGATE_STRK_ADDRESS } from "@/lib/constants"
// import { useMemo } from "react"
import { toast } from "sonner";
import { shortenAddress } from "@/lib/utils";
import prompt_hash from "@/contracts/prompt_hash";
import { useWallet } from "@/hooks/useWallet";

export const PromptModal = ({
  selectedPrompt,
  closeModal,
  handleImageError,
}: {
  selectedPrompt: Prompt;
  closeModal: () => void;
  handleImageError: (e: any) => void;
  // index: number,
}) => {
  // const { address } = useAccount();

  // const { contract } = useContract({
  //     abi: PROMPTHASH_STARKNET_ABI,
  //     address: PROMPTHASH_STARKNET_ADDRESS
  // })



  // const { contract: strk_contract } = useContract({
  //     abi: ERC20ABI,
  //     address: STARGATE_STRK_ADDRESS
  // })

  // const approveCalls = useMemo(() => {
  //     if (!selectedPrompt || !address) return;

  //     const priceInU256 = getUint256FromDecimal(selectedPrompt.price);

  //     return strk_contract?.populate("approve", [PROMPTHASH_STARKNET_ADDRESS, priceInU256])
  //   }, [selectedPrompt, address]);

  // const buyCalls = useMemo(() => {
  //     if (!selectedPrompt || !address) return

  //     const promptIdInU256 = getUint256FromDecimal(selectedPrompt.id);

  //     return contract?.populate("buy_prompt", [Number(selectedPrompt.id)])
  // }, [selectedPrompt, address])

  // const { sendAsync } = useSendTransaction(approveCalls && buyCalls ? {
  //     calls: [approveCalls, buyCalls]
  // } : ({} as any))
  const { address } = useWallet();

  const buyPrompt = async () => {
    if (!address) return;

    try {
      await prompt_hash.approve({
        approver: address,
        approved: "CA6HD2JQ3LS3GCV77ZV46MVIDAKTB6FUFWC6WWVESWM6MEDQXPRQIFYQ",
        token_id: parseInt(selectedPrompt.id),
        live_until_ledger: 1
      })

      const { result } = await prompt_hash.buy_prompt({
        buyer: address,
        token_id: BigInt(selectedPrompt.id)
      })

      const bought = result.isOk();
      if (bought) {
        toast.success("Prompt purchase successful")
        closeModal();
      }
    } catch (error) {
      console.error(error);
    }
  }

  // const handleBuyPrompt = async () => {
  //   closeModal();
  //   toast.success("Prompt purchase successful");
  // };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-2xl font-bold">{selectedPrompt?.title}</h2>
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
              src={selectedPrompt?.imageUrl || "/images/codeguru.png"}
              alt={selectedPrompt?.title || `prompt ${selectedPrompt?.id}`}
              width={800}
              height={450}
              onError={handleImageError}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex items-center justify-between mb-4">
            <Badge>{selectedPrompt?.category}</Badge>
            <div className="flex items-center gap-1 text-yellow-500">
              <StarIcon className="h-4 w-4 fill-current" />
              <span>{selectedPrompt?.likes}</span>
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-2">Description</h3>
            <p className="text-muted-foreground">
              {selectedPrompt?.description}
            </p>
          </div>

          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-2">Seller</h3>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                {selectedPrompt?.owner.slice(0, 2)}
              </div>
              <span className="font-mono">
                {shortenAddress(selectedPrompt?.owner!)}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-2xl font-bold">
              {selectedPrompt?.price} XLM
            </span>
            <Button onClick={buyPrompt}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Buy Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
