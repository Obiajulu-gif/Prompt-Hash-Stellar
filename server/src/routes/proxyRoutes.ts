import express from "express";
import { ImproveProxy } from "../controllers/controllers";

export const proxyrouter = express.Router();

proxyrouter.route("/").post(ImproveProxy);
