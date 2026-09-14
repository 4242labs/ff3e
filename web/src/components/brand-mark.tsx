// The 42labs asterisk, on its own — tight rails, avatars, favicons, app chrome.
//
// This is the ONE copy. Consuming apps install it from the registry
// (`npx shadcn@latest add @42labs/brand-mark`) rather than re-tracing the vector
// or pasting the path, so the mark can never drift between products.
//
// Contract: `fill=currentColor`, so the mark takes its colour from `text-*`.
// It defaults to the brand token (`text-logo`, which flips orange→mint with the
// theme) and to a 1:1 box; pass `className` to size it like any other icon.

import * as React from "react"

import { cn } from "@/lib/utils"

function BrandMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="brand-mark"
      viewBox="0 0 407 402"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden="true"
      className={cn("size-6 shrink-0 text-logo", className)}
      {...props}
    >
      <g transform="matrix(1,0,0,1,-1645.81,-695.442)">
        <g transform="matrix(1,0,0,1,1611.68,666.908)">
          <path d="M307.719,28.534L376.536,67.698L267.995,213.165L440.877,190.226L440.877,267.995L267.995,247.294L267.995,249.532L377.655,388.285L305.481,428.569L236.664,267.995L234.426,267.995L160.014,429.688L95.113,388.285L203.654,246.175L34.129,267.995L34.129,190.226L202.535,212.046L202.535,209.808L95.113,68.817L164.49,29.653L235.545,189.107L238.342,189.107L307.719,28.534Z" />
        </g>
      </g>
    </svg>
  )
}

export { BrandMark }
