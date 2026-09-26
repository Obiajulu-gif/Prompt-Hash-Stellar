import express from "express";
import { PostChat } from "../controllers/controllers.js";

export const chatRouter = express.Router();

chatRouter.route("/").post(PostChat);
