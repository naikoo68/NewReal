import { Router } from "express";
import { paymentConfig, createOrder } from "../controllers/paymentController.js";

const router = Router();

// Both public — used by the client registration form before an account exists.
router.get("/config", paymentConfig);
router.post("/create-order", createOrder);

export default router;
