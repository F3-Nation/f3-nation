"use client";

import { Copy, MessageSquare, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@acme/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { toast } from "@acme/ui/toast";

interface PhoneActionPopoverProps {
  phoneNumber: string;
  iconSize?: "sm" | "md" | "lg";
  className?: string;
}

const iconSizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const buttonSizes = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

/**
 * A popover component that displays phone action options: Call, Text, and Copy.
 */
export const PhoneActionPopover = ({
  phoneNumber,
  iconSize = "md",
  className,
}: PhoneActionPopoverProps) => {
  const [open, setOpen] = useState(false);

  const iconClass = iconSizes[iconSize];
  const buttonClass = cn(
    "rounded-full bg-muted hover:bg-muted-foreground/20 transition-colors",
    buttonSizes[iconSize],
  );

  const handleCopy = async () => {
    try {
      // Check if clipboard API is available
      if (!navigator.clipboard) {
        toast.error("Clipboard not available in this browser");
        return;
      }
      await navigator.clipboard.writeText(phoneNumber);
      toast.success("Phone number copied to clipboard");
      setOpen(false);
    } catch (error) {
      toast.error("Failed to copy phone number");
    }
  };

  const handleActionClick = () => {
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(buttonClass, className)}
          title="Phone"
          aria-label="Phone"
        >
          <Phone className={iconClass} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2">
        <div className="flex flex-col gap-1">
          <Link
            href={`tel:${phoneNumber}`}
            onClick={handleActionClick}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <Phone className="h-4 w-4" />
            <span>Call</span>
          </Link>
          <Link
            href={`sms:${phoneNumber}`}
            onClick={handleActionClick}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            <span>Text</span>
          </Link>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
          >
            <Copy className="h-4 w-4" />
            <span>Copy</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
