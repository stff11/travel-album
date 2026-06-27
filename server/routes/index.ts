import { Router, type IRouter } from "express";
import healthRouter from "./health";
import photosRouter from "./photos";
import tripsRouter from "./trips";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(photosRouter);
router.use(tripsRouter);
router.use(statsRouter);

export default router;
