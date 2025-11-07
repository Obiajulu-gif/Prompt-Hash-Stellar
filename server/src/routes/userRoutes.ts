import express from 'express';
import { CreateUser, GetUsers } from '../controllers/controllers';

export const userRouter = express.Router();

userRouter.route("/").post(CreateUser);

userRouter.route("/").get(GetUsers);