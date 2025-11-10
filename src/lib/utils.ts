import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const shortenAddress = (address: string): string => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const PROMPTHASH_ADDRESS = "CDDPCEOAPCN3L3RI7MLKJ3NOFAKWZIWNRDLPKLPDHRBDRPAB7TI3Z6WZ";