"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Info, MessageCircleQuestion } from "lucide-react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { closeModal, ModalType, openModal } from "~/utils/store/modal";
import { SubmitBugReportCard } from "../../help/submit-bug-report-card";
import { VersionInfo } from "../version-info";

const HELP_VIDEOS = [
  {
    title: "F3 Map Tour",
    url: "https://www.loom.com/share/264d77bc331d48519e05b1a2976b9761",
    description: "The basics of using the F3 Map",
    thumbnail: "/tour-video-thumbnail.png",
  },
  {
    title: "Editing the Map",
    url: "https://www.loom.com/share/8db7309cd4944cecb7c618b45582ece1",
    description: "Adding & updating locations & events",
    thumbnail: "/edit-video-thumbnail.png",
  },
] as const;

export function MapHelpModal() {
  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[800px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl">Map Help & Feedback</DialogTitle>
          <DialogDescription>
            We want to continually improve the map, so please let us know about
            any issues or ideas you have. Check out the{" "}
            <Link
              href="https://github.com/F3-Nation/f3-nation-map/issues"
              target="_blank"
              className="text-blue-500 hover:underline"
            >
              F3 Map github repo
            </Link>{" "}
            to see the code, planned features, and existing issues.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 md:grid-cols-[1fr_300px]">
          {/* Left column - Feedback form */}
          <div className="space-y-4">
            <SubmitBugReportCard />
          </div>

          {/* Right column - Help videos */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Help Videos</h3>
            {HELP_VIDEOS.map((video) => (
              <Card
                key={video.url}
                className="cursor-pointer bg-card hover:bg-accent"
              >
                <Link
                  href={video.url}
                  target="_blank"
                  className="hover:bg-accent"
                >
                  <CardHeader className="p-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Image
                        src={video.thumbnail}
                        alt={video.title}
                        className="rounded-md object-contain"
                        width={60}
                        height={40}
                      />
                      <Link
                        href={video.url}
                        target="_blank"
                        className="hover:text-blue-600 hover:underline"
                      >
                        {video.title}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0 text-sm text-muted-foreground">
                    {video.description}
                  </CardContent>
                </Link>
              </Card>
            ))}
            <div className="flex flex-col gap-1 ">
              <h3 className="text-lg font-semibold">Other</h3>
              <div className="flex flex-col gap-1">
                <button
                  className="flex w-full flex-row items-center justify-center gap-2 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
                  onClick={() => {
                    openModal(ModalType.ABOUT_MAP);
                  }}
                >
                  <Info className="size-4" />
                  <span className="text-xs">About</span>
                </button>
              </div>
              <Link
                className="flex w-full flex-row items-center justify-center gap-2 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
                target="_blank"
                href={"https://f3nation.com/about-f3"}
              >
                <MessageCircleQuestion className="size-4" />
                <span className="text-xs">F3 FAQs</span>
                <ArrowRight className="size-3 text-foreground" />
              </Link>
              <VersionInfo className="text-center text-xs text-foreground/60" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
