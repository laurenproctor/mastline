import { Inter, Newsreader } from "next/font/google";

/**
 * The two faces of the editorial direction, in one place because more than one
 * layout needs them and two next/font calls for the same family would ship the
 * same files under two sets of variables.
 *
 * Newsreader carries the headlines. Its optical-size axis has to be requested
 * explicitly -- next/font ships only the weight axis of a variable font
 * otherwise -- because the direction sets font-variation-settings: "opsz" per
 * element, 72 on display headlines down to 18 in a record. Its italic is a real
 * cut, and the emphasis inside every headline is set in it.
 */
export const brandSans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const brandSerif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});
