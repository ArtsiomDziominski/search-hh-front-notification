import dotenv from "dotenv";

dotenv.config()

export const isDevelopment = process.env.NODE_ENV === "development";
console.log('NODE_ENV', process.env.NODE_ENV);
