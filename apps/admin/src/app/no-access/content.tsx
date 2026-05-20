"use client";

import { ExternalLink } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  navigateToSsoLogin,
  navigateToSsoLogout,
  useAdminSession,
} from "~/lib/auth/client";

const CLEAR_BROWSER_DATA_GUIDE_URL =
  "https://us.norton.com/blog/how-to/how-to-clear-cookies";

export default function NoAccess() {
  const searchParams = useSearchParams();
  const { data: session } = useAdminSession();
  const router = useRouter();
  const reason = searchParams?.get("reason");

  const isNotAdmin = reason === "not-admin";
  const isNotEditor = reason === "not-editor";
  const hasNoAdminAccess = reason === "no-admin-access";
  const isPermissionDenied = isNotAdmin || isNotEditor || hasNoAdminAccess;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="rounded-full bg-red-100 p-3">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            {isPermissionDenied ? "Permission Required" : "Access Denied"}
          </h2>

          {reason === "account-does-not-exist" ? (
            <p className="text-gray-600">
              This account does not exist. You need to create an account first.
            </p>
          ) : !session ? (
            <p className="text-gray-600">You are not logged in.</p>
          ) : isPermissionDenied ? (
            <div className="space-y-3">
              <p className="text-gray-600">
                You are signed in as{" "}
                <span className="font-medium">{session.email}</span>, but this
                account does not have the required permissions.
              </p>
              <p className="text-sm text-gray-500">
                Required role:{" "}
                <span className="font-medium text-green-600">editor</span> or{" "}
                <span className="font-medium text-green-600">admin</span>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-gray-600">
                {"You don't have access to the requested resource."}
              </p>
              {session?.roles && session.roles.length > 0 && (
                <p className="text-sm text-gray-500">
                  Your roles:{" "}
                  {session.roles.map((role, index) => (
                    <span key={role.orgId}>
                      {index > 0 && ", "}
                      <span className="font-medium text-red-600">
                        {role.orgName} - {role.roleName}
                      </span>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}

          {/* Troubleshooting section */}
          {session && (
            <div className="mt-4 w-full rounded-md bg-gray-50 p-4 text-left">
              <p className="text-sm font-medium text-gray-700">
                Think you should have access?
              </p>
              <p className="mt-1 text-sm text-gray-500">
                If your permissions were recently updated, try clearing your
                browser&apos;s application data (cookies and cache) and signing
                in again.
              </p>
              <a
                href={CLEAR_BROWSER_DATA_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                How to clear browser data
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          <div className="flex w-full flex-col gap-2 pt-2">
            {session ? (
              <>
                <button
                  onClick={() => navigateToSsoLogout()}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Sign out and try a different account
                </button>
                <button
                  onClick={() => router.push("/")}
                  className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Go to home page
                </button>
              </>
            ) : (
              <button
                onClick={() => navigateToSsoLogin("/")}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
