import { Suspense } from "react";
import Link from "next/link";

import { RERENDER_LOGS } from "@acme/shared/common/constants";

import { Header } from "./header";
import { SubmitBugReportCard } from "./submit-bug-report-card";

export default async function HelpPage() {
  RERENDER_LOGS && console.log("MapPage rerender");

  return (
    <main className="pointer-events-auto relative max-h-dvh gap-4 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-[3%] py-8">
        <Suspense fallback={<div>Loading...</div>}>
          <Header />
        </Suspense>
        <div>
          Here is the{" "}
          <Link
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 underline"
            href="https://github.com/F3-Nation/f3-nation-map/issues"
          >
            F3 Nation Map's github repo
          </Link>{" "}
          if you'd like to contribute or report an issue directly. Otherwise,
          please use the form below.
        </div>
        <SubmitBugReportCard />
        <div>
          Your report will be reviewed as soon as possible. If you've left your
          email we'll try to reach out to you.
        </div>
      </div>
    </main>
  );
}
