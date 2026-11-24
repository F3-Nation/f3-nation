import { Montserrat } from "next/font/google";

/** f3nation.com's typeface, so the map reads as part of the site. */
export const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
});
