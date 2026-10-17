import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our type scale uses named sizes (text-body, text-caption…). Without telling
// tailwind-merge, it would treat them as colours and drop `text-label-2`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "caption2",
            "caption",
            "footnote",
            "body",
            "headline",
            "title3",
            "title2",
            "title1",
            "large",
            "numeral",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
