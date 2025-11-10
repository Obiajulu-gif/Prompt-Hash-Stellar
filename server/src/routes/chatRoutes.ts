import express from "express";
import { PostChat } from "../controllers/controllers";

export const chatRouter = express.Router();

chatRouter.route("/").post(PostChat);
