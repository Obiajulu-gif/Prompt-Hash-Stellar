import express from 'express';
import { CreatePrompt, GetPrompts } from '../controllers/controllers';

export const promptRouter = express.Router();

promptRouter.route("/").post(CreatePrompt);

promptRouter.route("/").get(GetPrompts);