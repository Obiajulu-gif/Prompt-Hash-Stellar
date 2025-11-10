import { useState, ChangeEvent, useEffect } from "react";
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
// import fungible_allowlist_example from "@/contracts/fungible_allowlist_example";
import prompt_hash from "@/contracts/prompt_hash";
// import { StellarWalletsKit, WalletNetwork } from "@creit.tech/stellar-wallets-kit";
// import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk"
import {  } from "@creit-tech/stellar-wallets-kit"
import { PROMPTHASH_ADDRESS } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { kit } from "@/util/wallet";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";
import { u32 } from "@stellar/stellar-sdk/contract";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { FeeBumpTransaction, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
// import { ethers } from "ethers";
// import { useAccount, useContract, useReadContract, useSendTransaction } from "@starknet-react/core";
// import { PROMPTHASH_STARKNET_ABI, PROMPTHASH_STARKNET_ADDRESS } from "@/lib/constants";
// import { getUint256FromDecimal } from "@/lib/utils";
// import { useRouter } from "next/navigation";

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

  const RPC_URL = "http://localhost:8000/rpc";

  const [errors, setErrors] = useState<{ [key: string]: string | null }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<number>();

  const getNextToken = async () => {
    
    const { result: getNextTokenResult } = await prompt_hash.get_next_token();
    const nextToken = getNextTokenResult.unwrap();
    console.log(nextToken)
    const { address } = await kit.getAddress();
    console.log(address);
    setNextToken(Number(nextToken));
  }

  const { address } = useWallet();

  useEffect(() => {
    getNextToken();
    console.log(nextToken)
  }, [nextToken]);

  const submitTransaction = async (
    tx: Transaction | FeeBumpTransaction,
    server: Server,
  ): Promise<Api.GetTransactionResponse | null> => {
    try {
      return server
      .sendTransaction(tx)
      .then(async (reply) => {
        if (reply.status !== "PENDING") {
          throw reply;
        }

        return server.pollTransaction(reply.hash, {
          sleepStrategy: (_iter: number) => 500,
          attempts: 5
        });
      })
      .then((finalStatus) => {
        switch (finalStatus.status) {
          case Api.GetTransactionStatus.SUCCESS:
            console.log("✅ Transaction succeeded:", finalStatus.txHash);
            return finalStatus;

          case Api.GetTransactionStatus.FAILED:
            console.error("❌ Transaction failed:", finalStatus);
            throw new Error(`Transaction failed: ${finalStatus.resultXdr}`);

          case Api.GetTransactionStatus.NOT_FOUND:
            console.error("⚠️ Transaction not found:", finalStatus);
            throw new Error("Transaction not found or dropped by network");
        }
      })
    } catch (err) {
      console.error(err)
      return null;
    }
  }

  const createAndApprove = async (): Promise<boolean> => {
    if (!address || !RPC_URL) { 
      console.log("Address or RPC URL undefined"); 
      return false; 
    };

    const server = new Server(RPC_URL, {
      allowHttp: true
    });

    try {
      const raw = await prompt_hash.create_prompt({
        creator: address,
        image_url: formData.imageUrl,
        description: formData.description,
        title: formData.title,
        category: formData.title,
        price: BigInt(formData.price)
      })

      
      console.log("Raw response: ", raw);
      const xdr = raw.toXDR();

      const signed = await kit.signTransaction(xdr, {
        address,
        networkPassphrase: WalletNetwork.TESTNET
      })

      // const signedAndSent = await raw.signAndSend({
      //   force: true,
      //   signTransaction: async () => signed
      // })
      // console.log(signedAndSent);
      // console.log("Signers required", raw.needsNonInvokerSigningBy({ includeAlreadySigned: false }))
      // console.log(signed)

      const tx = TransactionBuilder.fromXDR(signed.signedTxXdr, WalletNetwork.TESTNET);
      console.log("Transaction from XDR: ", tx)

      try {
        const res = await server.sendTransaction(tx);
        console.log(res);
      } catch (err) {
        console.error(err);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      const liveUntilLedger = 9999;

      const rawApprove = await prompt_hash.approve({
        approver: address,
        approved: PROMPTHASH_ADDRESS,
        token_id: nextToken ? (nextToken - 1) as u32 : 0,
        live_until_ledger: liveUntilLedger as u32
      });
      
      console.log("I got here, after promptHash.approve", rawApprove);
      const approveXDR = rawApprove.toXDR();
      console.log("I got here, after rawApprove.toXDR()");

      const approveSigned = await kit.signTransaction(approveXDR, {
        address,
        networkPassphrase: WalletNetwork.TESTNET
      })
      console.log("Approve signed Tx XDR: ", approveSigned);

      const approvedSignedTx = TransactionBuilder.fromXDR(approveSigned.signedTxXdr, WalletNetwork.TESTNET);

      try {
        const res = await server.sendTransaction(approvedSignedTx);
        console.log("Response from submit: ", res);
      } catch (err) {
        console.error(err);
      }

      console.log("Signed and Submitted");

      return true;
    } catch (err) {
      console.error((err as Error).message);
      console.error(err);
      return false
    }

  }

  // const createAndApprove = async (): Promise<boolean> => {
  //   if (!address || !RPC_URL) { 
  //     console.log("Address or RPC URL undefined"); 
  //     return false; 
  //   }

  //   const server = new Server(RPC_URL, {
  //     allowHttp: true
  //   });

  //   try {
  //     // Create prompt
  //     const raw = await prompt_hash.create_prompt({
  //       creator: address,
  //       image_url: formData.imageUrl,
  //       description: formData.description,
  //       title: formData.title,
  //       category: formData.title,
  //       price: BigInt(formData.price)
  //     });
      
  //     console.log("Raw response:", raw);
  //     const xdr = raw.toXDR();

  //     const signed = await kit.signTransaction(xdr, {
  //       address,
  //       networkPassphrase: WalletNetwork.TESTNET
  //     });
  //     console.log("Signed:", signed);

  //     const tx = TransactionBuilder.fromXDR(signed.signedTxXdr, WalletNetwork.TESTNET);
  //     console.log("Transaction from XDR:", tx);

  //     // Send and wait for confirmation
  //     console.log("Sending create_prompt transaction...");
  //     const sendResponse = await server.sendTransaction(tx);
  //     console.log("Send response:", sendResponse);

  //     if (sendResponse.status === "PENDING" || sendResponse.status === "TRY_AGAIN_LATER") {
  //       console.log("⏳ Waiting for transaction confirmation...");
        
  //       // Poll for result
  //       const result = await server.getTransaction(sendResponse.hash);
  //       console.log("Transaction result:", result);

  //       if (result.status === "SUCCESS") {
  //         console.log("✅ Prompt created successfully!");
  //       } else if (result.status === "FAILED") {
  //         console.error("❌ Transaction failed:", result);
  //         return false;
  //       } else if (result.status === "NOT_FOUND") {
  //         // Transaction still processing, wait a bit
  //         await new Promise(resolve => setTimeout(resolve, 2000));
  //         const retryResult = await server.getTransaction(sendResponse.hash);
  //         console.log("Retry result:", retryResult);
          
  //         if (retryResult.status !== "SUCCESS") {
  //           console.error("❌ Transaction did not succeed:", retryResult);
  //           return false;
  //         }
  //       }
  //     }

  //     // Wait before approve
  //     await new Promise(resolve => setTimeout(resolve, 2000));

  //     // Approve
  //     const rawApprove = await prompt_hash.approve({
  //       approver: address,
  //       approved: PROMPTHASH_ADDRESS,
  //       token_id: nextToken ? (nextToken - 1) : 0,
  //       live_until_ledger: 9999
  //     });
      
  //     console.log("Approve transaction built:", rawApprove);
  //     const approveXDR = rawApprove.toXDR();

  //     const approveSigned = await kit.signTransaction(approveXDR, {
  //       address,
  //       networkPassphrase: WalletNetwork.TESTNET
  //     });
  //     console.log("Approve signed:", approveSigned);

  //     const approvedSignedTx = TransactionBuilder.fromXDR(
  //       approveSigned.signedTxXdr, 
  //       WalletNetwork.TESTNET
  //     );

  //     console.log("Sending approve transaction...");
  //     const approveSendResponse = await server.sendTransaction(approvedSignedTx);
  //     console.log("Approve send response:", approveSendResponse);

  //     if (approveSendResponse.status === "PENDING" || approveSendResponse.status === "TRY_AGAIN_LATER") {
  //       console.log("⏳ Waiting for approve confirmation...");
        
  //       const approveResult = await server.getTransaction(approveSendResponse.hash);
  //       console.log("Approve result:", approveResult);

  //       if (approveResult.status === "SUCCESS") {
  //         console.log("✅ Approved successfully!");
  //       } else {
  //         await new Promise(resolve => setTimeout(resolve, 2000));
  //         const retryResult = await server.getTransaction(approveSendResponse.hash);
          
  //         if (retryResult.status !== "SUCCESS") {
  //           console.error("❌ Approve did not succeed:", retryResult);
  //           return false;
  //         }
  //       }
  //     }

  //     console.log("✅ All transactions completed successfully!");
  //     return true;

  //   } catch (err) {
  //     console.error("Error:", err);
  //     return false;
  //   }
  // };

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
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
      console.log("Creating prompt with:");
      console.log("- Title:", formData.title);
      console.log("- Price:", formData.price, "STRK");
      console.log("- Category:", formData.category);

      const createdAndApproved = await createAndApprove();

      if (!createdAndApproved) return;

      setSuccess("Prompt created successfully!");

      // Reset form
      setFormData({
        imageUrl: "",
        title: "",
        description: "",
        category: "",
        price: "2",
      });
      navigate("/browse");
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
