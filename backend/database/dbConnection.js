import { prisma } from "./prismaClient.js";
import { ensureDefaultAdmin } from "../utils/seedAdmin.js";

export const dbConnection = () => {
    prisma
    .$connect()
    .then(async () => {
        console.log("Connected to database successfully!");
        await ensureDefaultAdmin();
    })
    .catch(err => {
        console.log(`Some error occured while connecting to database! ${err}`);
    });
};
