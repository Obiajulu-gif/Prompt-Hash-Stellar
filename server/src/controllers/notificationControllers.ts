import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Notification from "../models/Notification";

export const GetNotifications = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    const notifications = await Notification.find({
      recipientWallet: walletAddress.toLowerCase(),
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json(notifications);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const GetUnreadCount = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    const count = await Notification.countDocuments({
      recipientWallet: walletAddress.toLowerCase(),
      read: false,
    });

    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const MarkAsRead = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    await Notification.updateMany(
      {
        recipientWallet: walletAddress.toLowerCase(),
        read: false,
      },
      { read: true }
    );

    return res.json({ message: "Notifications marked as read." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const ClearNotifications = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    await Notification.deleteMany({
      recipientWallet: walletAddress.toLowerCase(),
    });

    return res.json({ message: "Notifications cleared." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
