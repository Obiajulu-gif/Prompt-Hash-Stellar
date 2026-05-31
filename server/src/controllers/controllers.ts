import { NextFunction, Request, Response } from "express";
import connectDb from "../db/connectDb";
import User from "../models/User";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  validateListingMetadata,
} from "../services/listingValidation";

const API_BASE_URL = "https://secret-ai-gateway.onrender.com";

/* IMPROVE PROXY CONTROLLERS */

export const ImproveProxy = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response<any>> => {
  try {
    const promptText = req.body;

    console.log("Improve prompt request: ", promptText);

    const response = await fetch(`${API_BASE_URL}/api/improve-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: promptText,
    });

    // Get the response data
    const responseData = await response.json().catch(() => {});
    const responseText = await response.text().catch(() => {});

    // Log the response for debugging
    console.log("Improve prompt response status:", response.status);
    console.log("Improve prompt response data:", responseData || responseText);

    // If the response is not OK, return the error details
    if (!response.ok) {
      return res.status(response.status).json({
        error: "API Error",
        details: responseData || responseText,
      });
    }

    return res.json(responseData);
  } catch (err) {
    console.error("Error in improve-proxy:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : String(err),
    });
    // { status: 500 }
  }
};

/* PROMPTS CONTROLLERS */

export const CreatePrompt = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response<any>> => {
  try {
    await connectDb();

    const promptData = await req.body;
    const { image, title, content, walletAddress, price, category } =
      promptData;

    // Validate required fields with specific messages
    const missingFields = [];
    if (!image) missingFields.push("Image URL");
    if (!title) missingFields.push("Title");
    if (!content) missingFields.push("Content");
    if (!walletAddress) missingFields.push("Wallet Address");
    if (!price) missingFields.push("Price");

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const { normalized, errors } = validateListingMetadata({
      image,
      title,
      content,
      price,
      category,
    });

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        error: "Invalid listing metadata",
        fields: errors,
      });
    }

    // Find the user by wallet address
    const user = await User.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found. Please connect your wallet first.",
      });
    }

    const newPrompt = new Prompt({
      image: normalized.image,
      title: normalized.title,
      content: normalized.content,
      owner: user._id, // Set the owner as the user's ObjectId
      price: normalized.price,
      category: normalized.category,
      rating: 3,
    });

    await newPrompt.save();

    // Populate the owner details in the response
    const populatedPrompt = await newPrompt.populate(
      "owner",
      "username walletAddress",
    );

    return res.status(201).json({
      message: "Prompt created successfully",
      prompt: populatedPrompt,
    });
  } catch (err) {
    console.error("Create prompt error:", err);
    return res.status(500).json({
      error: (err as Error).message || "Failed to create prompt",
    });
  }
};

export const GetPrompts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response<any>> => {
  try {
    await connectDb();

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const walletAddress = searchParams.get("walletAddress");

    let query: any = { listingStatus: 'published', isActive: true };

    if (category) {
      query.category = category;
    }

    if (walletAddress) {
      const user = await User.findOne({
        walletAddress: walletAddress.toLowerCase(),
      });
      if (user) {
        query.owner = user._id;
      }
    }

    const prompts = await Prompt.find(query)
      .populate("owner", "username walletAddress")
      .sort({ createdAt: -1 });

    return res.json(prompts);
  } catch (error) {
    console.error("Fetch prompts error:", error);

    return res.status(500).json({
      error: (error as Error).message || "Failed to fetch prompts",
    });
  }
};

/* USER CONTROLLERS */

export const CreateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response<any>> => {
  try {
    await connectDb();

    const { walletAddress, username } = await req.body;

    if (!walletAddress) {
      return res.status(400).json({
        error: "Wallet address is required",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    if (existingUser) {
      console.log("User already exists:", existingUser);
      return res.status(200).json({
        message: "Login successful",
      });
    }

    // Generate random username if not provided
    const generatedUsername =
      username || `user${Math.floor(100000 + Math.random() * 900000)}`;

    // Create new user if doesn't exist
    const newUser = new User({
      walletAddress: walletAddress.toLowerCase(),
      username: generatedUsername,
      rating: 4,
    });
    await newUser.save();

    return res.status(201).json({
      message: "User registered successfully",
      user: newUser,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      error: (error as Error).message || "Failed to register user",
    });
  }
};

export const GetUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response<any>> => {
  try {
    await connectDb();

    // Get wallet address from search params if provided
    const { searchParams } = new URL(req.url);
    const walletAddress = searchParams.get("walletAddress");

    let users;

    if (walletAddress) {
      users = await User.findOne({
        walletAddress: walletAddress.toLowerCase(),
      });

      if (!users) {
        return res.status(404).json({
          error: "User not found",
        });
      }
    } else {
      users = await User.find({});
    }

    return res.json(users);
  } catch (error) {
    console.error("Fetch users error:", error);
    return res.status(500).json({
      error: (error as Error).message || "Failed to fetch users",
    });
  }
};

/* POST CHAT */
export const PostChat = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { messages } = await req.body;

  // Convert messages to the format expected by the AI SDK
  const formattedMessages = messages.map((message: any) => ({
    role: message.role === "ai" ? "assistant" : "user",
    content: message.content,
  }));

  const result = streamText({
    model: openai("gpt-4o"),
    messages: formattedMessages,
  });

  return result.pipeTextStreamToResponse(res);
};

/* BUYER COLLECTIONS CONTROLLERS */

export const GetOwnedPrompts = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    const purchases = await Purchase.find({
      buyerWallet: walletAddress.toLowerCase(),
    })
      .populate({ path: 'promptId', model: Prompt })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      owned: purchases.map((p) => ({
        purchaseId: p._id,
        prompt: p.promptId,
        txHash: p.txHash,
        versionIndex: p.versionIndex,
        purchasedAt: p.createdAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const GetSavedPrompts = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    const saved = await Purchase.find({
      buyerWallet: walletAddress.toLowerCase(),
      saved: true,
    })
      .populate({ path: 'promptId', model: Prompt })
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      saved: saved.map((p) => ({
        purchaseId: p._id,
        prompt: p.promptId,
        savedAt: p.updatedAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const SavePrompt = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { walletAddress, promptId } = req.body;
    if (!walletAddress || !promptId) {
      return res.status(400).json({ error: 'walletAddress and promptId are required' });
    }
    const purchase = await Purchase.findOneAndUpdate(
      { buyerWallet: walletAddress.toLowerCase(), promptId },
      { saved: true, versionIndex: 1, txHash: "" },
      { upsert: true, new: true },
    );
    return res.status(200).json({ saved: true, purchaseId: purchase._id });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const UnsavePrompt = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { walletAddress, promptId } = req.body;
    if (!walletAddress || !promptId) {
      return res.status(400).json({ error: 'walletAddress and promptId are required' });
    }
    await Purchase.findOneAndUpdate(
      { buyerWallet: walletAddress.toLowerCase(), promptId },
      { saved: false },
    );
    return res.status(200).json({ saved: false });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/* DRAFT LIFECYCLE CONTROLLERS */

const PUBLISH_REQUIRED_FIELDS = ['image', 'title', 'content', 'price', 'category'];

export const GetDraftPrompts = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    const user = await User.findOne({ walletAddress: walletAddress.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const drafts = await Prompt.find({
      owner: user._id,
      listingStatus: { $in: ['draft', 'ready'] },
    }).sort({ updatedAt: -1 });

    return res.status(200).json({
      drafts: drafts.map((d) => {
        const missingFields = PUBLISH_REQUIRED_FIELDS.filter(
          (f) => !d[f as keyof typeof d],
        );
        return {
          ...d.toObject(),
          missingFields,
          isPublishable: missingFields.length === 0,
        };
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const PublishPrompt = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { id } = req.params;
    const prompt = await Prompt.findById(id);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const { errors } = validateListingMetadata({
      image: prompt.image,
      title: prompt.title,
      content: prompt.content,
      price: prompt.price,
      category: prompt.category,
    });

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        error: 'Prompt is not publishable',
        fields: errors,
      });
    }

    const missingFields = PUBLISH_REQUIRED_FIELDS.filter(
      (f) => !prompt[f as keyof typeof prompt],
    );
    if (missingFields.length > 0) {
      return res.status(422).json({
        error: 'Prompt is not publishable',
        missingFields,
        reason: `Required fields are missing: ${missingFields.join(', ')}`,
      });
    }

    prompt.listingStatus = 'published';
    await prompt.save();

    return res.status(200).json({ listingStatus: 'published', promptId: prompt._id });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const ArchivePrompt = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    await connectDb();
    const { id } = req.params;
    const prompt = await Prompt.findByIdAndUpdate(
      id,
      { listingStatus: 'archived' },
      { new: true },
    );
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
    return res.status(200).json({ listingStatus: 'archived', promptId: prompt._id });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
