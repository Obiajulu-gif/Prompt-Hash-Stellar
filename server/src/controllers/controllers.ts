import { NextFunction, Request, Response } from "express";
import connectDb from "../db/connectDb";
import User from "../models/User";
import Prompt from "../models/Prompt";
import { streamText } from 'ai';
import { openai } from "@ai-sdk/openai"

const API_BASE_URL = "https://secret-ai-gateway.onrender.com";

/* IMPROVE PROXY CONTROLLERS */

export const ImproveProxy = async (req: Request, res: Response, next: NextFunction): Promise<Response<any>> => {
    try {
        const promptText = req.body;

        console.log("Improve prompt request: ", promptText);

        const response = await fetch(`${API_BASE_URL}/api/improve-prompt`, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain",
                Accept: "application/json"
            }, 
            body: promptText
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
                details: responseData || responseText 
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
}

/* PROMPTS CONTROLLERS */

export const CreatePrompt = async (req: Request, res: Response, next: NextFunction): Promise<Response<any>> => {
    try {
        await connectDb();

        const promptData = await req.body;
        const { image, title, content, walletAddress, price, category } = promptData;

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

        // Find the user by wallet address
        const user = await User.findOne({ 
            walletAddress: walletAddress.toLowerCase() 
        });

        if (!user) {
            return res.status(404).json({ 
                error: "User not found. Please connect your wallet first." 
            });
        }

        const newPrompt = new Prompt({
            image,
            title,
            content,
            owner: user._id, // Set the owner as the user's ObjectId
            price,
            category: category || "Other",
            rating: 3,
        });

        await newPrompt.save();

        // Populate the owner details in the response
        const populatedPrompt = await newPrompt.populate('owner', 'username walletAddress');

        return res.status(201).json({ 
            message: "Prompt created successfully", 
            prompt: populatedPrompt 
        });
    } catch (err) {
        console.error("Create prompt error:", err);
        return res.status(500).json({ 
            error: (err as Error).message || "Failed to create prompt" 
        });
    }
}

export const GetPrompts = async (req: Request, res: Response, next: NextFunction): Promise<Response<any>> => {
  try {
    await connectDb();

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const walletAddress = searchParams.get("walletAddress");

    let query: any = {};

    if (category) {
      query.category = category;
    }

    if (walletAddress) {
      const user = await User.findOne({ 
        walletAddress: walletAddress.toLowerCase() 
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
        error: (error as Error).message || "Failed to fetch prompts" 
    });
  }
}

/* USER CONTROLLERS */

export const CreateUser = async (req: Request, res: Response, next: NextFunction): Promise<Response<any>> => {
  try {
    await connectDb();

    const { walletAddress, username } = await req.body;

    if (!walletAddress) {
        return res.status(400).json({ 
            error: "Wallet address is required" 
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
        error: (error as Error).message || "Failed to register user" 
    });
  }
}

export const GetUsers =  async (req: Request, res: Response, next: NextFunction): Promise<Response<any>> => {
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
            error: "User not found" 
        });
      }
    } else {
      users = await User.find({});
    }

    return res.json(users);
  } catch (error) {
    console.error("Fetch users error:", error);
    return res.status(500).json({ 
        error: (error as Error).message || "Failed to fetch users" 
    });
  }
}

/* POST CHAT */
export const PostChat = async (req: Request, res: Response, next: NextFunction) => {
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

	return result.toDataStreamResponse();
}